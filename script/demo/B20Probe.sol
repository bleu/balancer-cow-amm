// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

// Test-only assertion harness; never deployed.
/* solhint-disable custom-errors, one-contract-per-file */

import {HooksTrampoline} from '../../test/vendor/HooksTrampoline.sol';
import {GPv2VaultRelayer} from '@cowprotocol/GPv2VaultRelayer.sol';
import {IERC20} from '@cowprotocol/interfaces/IERC20.sol';
import {IVault} from '@cowprotocol/interfaces/IVault.sol';
import {GPv2Order} from '@cowprotocol/libraries/GPv2Order.sol';
import {GPv2Transfer} from '@cowprotocol/libraries/GPv2Transfer.sol';
import {BCoWFactory} from 'contracts/BCoWFactory.sol';
import {BCoWPool} from 'contracts/BCoWPool.sol';

// Test-only code installed with eth_call state overrides. Never broadcast it.
contract ProbeTokenSource {
  function release(
    address token,
    address recipient,
    uint256 amount
  ) external {
    require(IERC20(token).transfer(recipient, amount), 'source transfer');
  }
}

/// @notice Read-only Base eth_call harness; exercises native B20 calls, not solver execution.
contract B20Probe {
  struct TradeState {
    uint256 sold;
    uint256 beforeBuy;
    uint256 beforeSell;
  }

  GPv2VaultRelayer public vaultRelayer;

  function run(
    address[] calldata tokens,
    address[] calldata sources,
    uint256 sellIndex,
    uint256 buyIndex
  ) external returns (uint256 preGas, uint256 postGas, uint256 fee) {
    (BCoWPool pool, HooksTrampoline trampoline) = _setup(tokens, sources);
    return _trade(pool, trampoline, tokens[sellIndex], tokens[buyIndex]);
  }

  function domainSeparator() external pure returns (bytes32) {
    return keccak256('native B20 probe');
  }

  function _setup(
    address[] calldata tokens,
    address[] calldata sources
  ) private returns (BCoWPool pool, HooksTrampoline trampoline) {
    require(tokens.length == 7 && sources.length == 7, 'seven assets');
    vaultRelayer = new GPv2VaultRelayer(IVault(address(0)));
    trampoline = new HooksTrampoline(address(this));
    BCoWFactory factory = new BCoWFactory(address(this), address(trampoline), address(this));
    pool = BCoWPool(address(factory.createPool(bytes32(uint256(1)), 'Native test', 'TEST', address(this), 180, 100)));
    uint256[7] memory weights = [uint256(8), 6, 6, 6, 6, 4, 4];
    for (uint256 i; i < 7; ++i) {
      require(IERC20(tokens[i]).decimals() == 8, 'decimals');
      ProbeTokenSource(sources[i]).release(tokens[i], address(this), 4e8);
      require(IERC20(tokens[i]).approve(address(pool), type(uint256).max), 'approval');
      pool.bind(tokens[i], 2e8, weights[i] * 1e18);
    }
    pool.finalize();
    for (uint256 i; i < 7; ++i) {
      require(
        IERC20(tokens[i]).allowance(address(pool), address(vaultRelayer)) == type(uint256).max, 'relayer allowance'
      );
    }
    uint256[] memory bounds = new uint256[](7);
    for (uint256 i; i < 7; ++i) {
      bounds[i] = type(uint256).max;
    }
    pool.joinPool(1e18, bounds);
    pool.exitPool(1e18, new uint256[](7));
    require(pool.totalSupply() == 100e18, 'LP roundtrip');
  }

  function _trade(
    BCoWPool pool,
    HooksTrampoline trampoline,
    address sell,
    address buy
  ) private returns (uint256 preGas, uint256 postGas, uint256 fee) {
    uint256 buyAmount = 1e7;
    TradeState memory t;
    t.beforeBuy = pool.getBalance(buy);
    t.beforeSell = pool.getBalance(sell);
    t.sold = pool.calcOutGivenIn(
        t.beforeBuy, pool.getDenormalizedWeight(buy), t.beforeSell, pool.getDenormalizedWeight(sell), buyAmount, 0
      ) * 99 / 100;
    HooksTrampoline.Hook[] memory hooks = new HooksTrampoline.Hook[](1);
    hooks[0] = HooksTrampoline.Hook(address(pool), abi.encodeCall(pool.commit, (bytes32('probe'), buyAmount)), 100_000);
    uint256 start = gasleft();
    trampoline.execute(hooks);
    preGas = start - gasleft();
    GPv2Transfer.Data[] memory transfers = new GPv2Transfer.Data[](1);
    transfers[0] = GPv2Transfer.Data(address(pool), IERC20(sell), t.sold, GPv2Order.BALANCE_ERC20);
    vaultRelayer.transferFromAccounts(transfers);
    require(IERC20(buy).transfer(address(pool), buyAmount), 'buy transfer');
    hooks[0] = HooksTrampoline.Hook(address(pool), abi.encodeCall(pool.transferFee, ()), 150_000);
    start = gasleft();
    trampoline.execute(hooks);
    postGas = start - gasleft();
    fee = pool.feeEscrow().claimable(address(this), buy);
    require(fee > 0, 'fee hook did not pay');
    require(IERC20(sell).balanceOf(address(pool)) == t.beforeSell - t.sold, 'sell delta');
    require(IERC20(buy).balanceOf(address(pool)) == t.beforeBuy + buyAmount - fee, 'buy delta');
    pool.feeEscrow().withdraw(buy, address(this));
    require(pool.feeEscrow().claimable(address(this), buy) == 0, 'withdraw');
  }
}
