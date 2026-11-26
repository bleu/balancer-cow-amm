// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {SevenAssetSettlementChecks} from '../integration/SevenAssetCoWSettlement.t.sol';
import {HooksTrampoline} from '../vendor/HooksTrampoline.sol';
import {GPv2AllowListAuthentication} from '@cowprotocol/GPv2AllowListAuthentication.sol';
import {IERC20} from '@cowprotocol/interfaces/IERC20.sol';
import {GPv2Interaction} from '@cowprotocol/libraries/GPv2Interaction.sol';
import {GPv2Order} from '@cowprotocol/libraries/GPv2Order.sol';
import {GPv2Signing} from '@cowprotocol/mixins/GPv2Signing.sol';
import {BCoWFactory} from 'contracts/BCoWFactory.sol';
import {BCoWFeeEscrow} from 'contracts/BCoWFeeEscrow.sol';
import {BCoWHelper} from 'contracts/BCoWHelper.sol';
import {BCoWPool} from 'contracts/BCoWPool.sol';
import {ISettlement} from 'interfaces/ISettlement.sol';

/// @notice Real BNB token/settlement code; funding and solver enrollment exist only on the local fork.
contract OndoBnbCompatibilityTest is SevenAssetSettlementChecks {
  using GPv2Order for GPv2Order.Data;

  bool internal includeLimitSurplus;

  function setUp() public {
    vm.createSelectFork(
      vm.envOr('BNB_RPC_URL', string('https://bsc-rpc.publicnode.com')),
      vm.envOr('BNB_FORK_BLOCK', uint256(135_908_001))
    );
    assertEq(block.chainid, 56);
    settlement = ISettlement(0x9008D19f58AAbD9eD0D60971565AA8510560ab41);
    trampoline = HooksTrampoline(0x60Bf78233f48eC42eE3F101b9a05eC7878728006);
    solver = makeAddr('fork-only-solver');
    GPv2AllowListAuthentication auth = GPv2AllowListAuthentication(address(settlement.authenticator()));
    vm.prank(auth.manager());
    auth.addSolver(solver);
    trader = vm.addr(TRADER_KEY);
    BCoWFactory factory = new BCoWFactory(address(settlement), address(trampoline), address(this));
    helper = new BCoWHelper(address(factory));
    pool = BCoWPool(address(factory.newBPool('Ondo MAG7', 'M7', vm.addr(CURATOR_KEY), 180, 100)));
    address[7] memory assets = [
      0xA9eE28C80f960B889dFbd1902055218cBa016F75,
      0x6Bfe75D1ad432050eA973C3A3DcD88F02e2444C3,
      0x390a684EF9cADE28A7AD0DFa61AB1Eb3842618c4,
      0x4553cFe1C09f37f38b12dC509F676964e392F8Fc,
      0x091FC7778e6932d4009B087B191D1EE3bac5729A,
      0xD7dF5863A3e742F0c767768cDfcb63f09E0422f6,
      0x2494b603319d4D9F9715c9f4496d9E0364B59d93
    ];
    uint256[7] memory units = [uint256(8), 6, 6, 6, 6, 4, 4];
    for (uint256 i; i < 7; ++i) {
      IERC20 token = IERC20(assets[i]);
      assertEq(token.decimals(), 18);
      uint256 balance = units[i] * 1e15;
      // Test-only raw funding. No issuer mint, backing, or production acquisition is simulated.
      deal(assets[i], address(this), balance * 2);
      assertTrue(token.approve(address(pool), type(uint256).max));
      pool.bind(assets[i], balance, units[i] * 1e18);
      tokens.push(token);
      weights.push(units[i]);
      prices.push(1e18);
      balancesBefore.push(balance);
    }
    pool.finalize();
    supplyBefore = pool.totalSupply();
    lpSharesBefore = pool.balanceOf(address(this));
  }

  function _fundCounterparty(
    IERC20 token,
    uint256 amount
  ) internal override {
    deal(address(token), trader, amount);
  }

  function test_AllSevenAssetsJoinAndExitAtSmallSeedAmounts() public {
    uint256[] memory limits = new uint256[](7);
    for (uint256 i; i < 7; ++i) {
      assertEq(tokens[i].allowance(address(pool), settlement.vaultRelayer()), type(uint256).max);
      limits[i] = type(uint256).max;
    }
    pool.joinPool(1e18, limits);
    pool.exitPool(1e18, new uint256[](7));
    assertEq(pool.totalSupply(), supplyBefore);
    for (uint256 i; i < 7; ++i) {
      assertApproxEqAbs(tokens[i].balanceOf(address(pool)), balancesBefore[i], 2);
    }
  }

  function test_AllSevenIncomingTokensPayAndWithdrawCuratorFees() public {
    includeLimitSurplus = true;
    uint256 initial = vm.snapshot();
    for (uint256 i; i < 7; ++i) {
      if (i > 0) assertTrue(vm.revertTo(initial));
      // Each underweight token is bought once through the real BNB settlement and trampoline.
      prices[i] = prices[i] * 9 / 10;
      Batch memory batch = _prepareBatch(true);
      assertEq(batch.buyIndex, i);
      _coolSettlement();
      vm.prank(solver, solver);
      settlement.settle(tokens, batch.clearingPrices, batch.trades, batch.interactions);
      address curator = vm.addr(CURATOR_KEY);
      uint256 fee = pool.feeEscrow().claimable(curator, address(tokens[i]));
      assertGt(fee, 0);
      uint256 before = tokens[i].balanceOf(curator);
      BCoWFeeEscrow escrow = pool.feeEscrow();
      vm.prank(curator);
      escrow.withdraw(address(tokens[i]), curator);
      assertEq(tokens[i].balanceOf(curator), before + fee);
      assertEq(pool.feeEscrow().claimable(curator, address(tokens[i])), 0);
    }
  }

  function _coolSettlement() private {
    // Reset warm setup reads before measuring the canonical 100k/150k hook budgets.
    // These dependencies are pinned to the fork block alongside the token addresses.
    address[8] memory dependencies = [
      0xc046b05A920e4B412815934DD8E58904dDA73315,
      0x578f397CA4661D1dB4D9a65065D6B284A1A850fd,
      0x76be569C94C39a2E2492DE2F4D1C253F348250D0,
      0x62fbBe0312D31823579De46ab1d89fAE0b798E61,
      0xA8a823584Ac88cb48e7F8F467d1be9c0601E43F8,
      0x40C57923924B5c5c5455c48D93317139ADDaC8fb,
      0x6334924c787Ebd21C881740Ef6237Ef51962638F,
      address(pool.feeEscrow())
    ];
    for (uint256 i; i < dependencies.length; ++i) {
      _cool(dependencies[i]);
    }
    for (uint256 i; i < tokens.length; ++i) {
      _cool(address(tokens[i]));
    }
    _cool(address(trampoline));
    _cool(settlement.vaultRelayer());
    _cool(address(settlement));
    _cool(address(pool));
  }

  function _cool(
    address target
  ) private {
    // The repository pins an older forge-std interface; current Foundry provides this cheatcode.
    (bool success,) = address(vm).call(abi.encodeWithSignature('cool(address)', target));
    assertTrue(success);
  }

  function test_AllSevenOutgoingTokensSettleThroughTheRealRelayer() public {
    uint256 initial = vm.snapshot();
    for (uint256 i; i < 7; ++i) {
      if (i > 0) assertTrue(vm.revertTo(initial));
      prices[i] = prices[i] * 11 / 10;
      _executeAndVerify(true, solver);
    }
  }

  function test_BlockedPoolCannotJoinAndBalancesRemainUnchanged() public {
    // Model a policy change at the live blacklist dependency, retaining real token logic.
    vm.mockCall(
      0xA8a823584Ac88cb48e7F8F467d1be9c0601E43F8,
      abi.encodeWithSignature('isBlocked(address)', address(pool)),
      abi.encode(true)
    );
    uint256[] memory limits = new uint256[](7);
    for (uint256 i; i < 7; ++i) {
      limits[i] = type(uint256).max;
    }
    vm.expectRevert();
    pool.joinPool(1e18, limits);
    assertEq(pool.totalSupply(), supplyBefore);
    for (uint256 i; i < 7; ++i) {
      assertEq(tokens[i].balanceOf(address(pool)), balancesBefore[i]);
    }
  }

  function test_PausedTokenPreventsExitWithoutBurningShares() public {
    vm.mockCall(
      0x6334924c787Ebd21C881740Ef6237Ef51962638F,
      abi.encodeWithSignature('isTokenPaused(address)', address(tokens[0])),
      abi.encode(true)
    );
    vm.expectRevert();
    pool.exitPool(1e18, new uint256[](7));
    assertEq(pool.totalSupply(), supplyBefore);
    assertEq(pool.balanceOf(address(this)), lpSharesBefore);
  }

  function _prepareBatch(
    bool includeCommitment
  ) internal override returns (Batch memory batch) {
    batch = super._prepareBatch(includeCommitment);
    if (!includeLimitSurplus) return batch;
    // Fee is paid from signed limit surplus, not the additional execution surplus.
    batch.order.buyAmount = (batch.order.buyAmount + batch.received) / 2;
    batch.order.appData = bytes32(0);
    bytes32 h0 = batch.order.hash(settlement.domainSeparator());
    batch.order.appData = pool.appDataHash(h0, batch.order.buyAmount);
    (uint8 v, bytes32 r, bytes32 s) =
      vm.sign(CURATOR_KEY, pool.curatorDigest(batch.order.hash(settlement.domainSeparator()), 0));
    bytes memory sig = abi.encodePacked(address(pool), abi.encode(batch.order, uint256(0), abi.encodePacked(r, s, v)));
    batch.trades[0] = _trade(batch.order, batch.sellIndex, batch.buyIndex, GPv2Signing.Scheme.Eip1271, sig);
    batch.trades[1] = _counterTrade(batch);
    GPv2Interaction.Data[] memory pre = new GPv2Interaction.Data[](1);
    pre[0] = GPv2Interaction.Data(address(pool), 0, abi.encodeCall(pool.commit, (h0, batch.order.buyAmount)));
    batch.interactions[0] = _wrap(pre, 100_000);
  }
}
