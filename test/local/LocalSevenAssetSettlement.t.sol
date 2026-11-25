// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {SevenAssetSettlementChecks} from '../integration/SevenAssetCoWSettlement.t.sol';
import {Signatures} from '../vendor/services/Signatures.sol';
import {IERC1271} from '../vendor/services/interfaces/IERC1271.sol';
import {ISettlement as ServiceSettlement, Interaction} from '../vendor/services/interfaces/ISettlement.sol';
import {IVaultRelayer} from '../vendor/services/interfaces/IVaultRelayer.sol';
import {GPv2AllowListAuthentication} from '@cowprotocol/GPv2AllowListAuthentication.sol';
import {GPv2Settlement} from '@cowprotocol/GPv2Settlement.sol';
import {IVault} from '@cowprotocol/interfaces/IVault.sol';
import {GPv2Interaction} from '@cowprotocol/libraries/GPv2Interaction.sol';
import {GPv2Order} from '@cowprotocol/libraries/GPv2Order.sol';
import {ISettlement} from 'interfaces/ISettlement.sol';

/// @notice Deploys the actual pinned CoW contracts without a fork or mocked authentication.
contract LocalSevenAssetCoWSettlementTest is SevenAssetSettlementChecks {
  GPv2AllowListAuthentication internal authentication;

  function setUp() public {
    authentication = new GPv2AllowListAuthentication();
    authentication.initializeManager(address(this));
    address localSolver = vm.addr(0x51501);
    authentication.addSolver(localSolver);
    // ERC20 balance markers transfer directly through the real vault relayer.
    // Balancer Vault internal balances and batchSwap are outside this fixture.
    GPv2Settlement localSettlement = new GPv2Settlement(authentication, IVault(address(0)));
    _setUpPool(ISettlement(address(localSettlement)), localSolver);
  }

  function test_OrderBookSignatureSimulationRunsPreHooks() public {
    prices[0] = prices[0] * 11 / 10;
    Batch memory batch = _prepareBatch(true);
    Signatures validator = new Signatures();
    Interaction[] memory pre = new Interaction[](1);
    pre[0] = Interaction(batch.interactions[0][0].target, 0, batch.interactions[0][0].callData);
    // Settlement trade signatures prefix the owner; the order book passes it separately.
    bytes memory encoded = batch.trades[0].signature;
    bytes memory signature = new bytes(encoded.length - 20);
    for (uint256 i; i < signature.length; ++i) {
      signature[i] = encoded[i + 20];
    }
    bytes memory result = GPv2Settlement(payable(address(settlement)))
      .simulateDelegatecall(
        address(validator),
        abi.encodeCall(
          validator.validate,
          (
            Signatures.Contracts(ServiceSettlement(address(settlement)), IVaultRelayer(settlement.vaultRelayer())),
            IERC1271(address(pool)),
            GPv2Order.hash(batch.order, settlement.domainSeparator()),
            signature,
            pre
          )
        )
      );
    assertGt(abi.decode(result, (uint256)), 0);
    // Simulation reverts all effects, including the transient commitment.
    vm.prank(solver);
    settlement.settle(tokens, batch.clearingPrices, batch.trades, batch.interactions);
  }

  function test_SkippingPostHookSettlesWithoutPayingCurator() public {
    prices[0] = prices[0] * 11 / 10;
    Batch memory batch = _prepareBatch(true);
    batch.interactions[2] = new GPv2Interaction.Data[](0);
    vm.prank(solver);
    settlement.settle(tokens, batch.clearingPrices, batch.trades, batch.interactions);
    assertEq(pool.feeEscrow().claimable(vm.addr(CURATOR_KEY), address(batch.order.buyToken)), 0);
    assertEq(batch.order.buyToken.balanceOf(address(pool)), balancesBefore[batch.buyIndex] + batch.received);
  }

  function test_OnlyManagerCanRegisterSolver() public {
    address unauthorized = makeAddr('unauthorized');
    vm.expectRevert(bytes('GPv2: caller not manager'));
    vm.prank(unauthorized);
    authentication.addSolver(unauthorized);
  }
}
