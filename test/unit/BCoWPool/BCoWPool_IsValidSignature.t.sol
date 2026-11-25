// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {SevenAssetSettlementToken} from '../../integration/SevenAssetCoWSettlement.t.sol';
import {HooksTrampoline} from '../../vendor/HooksTrampoline.sol';
import {IERC20} from '@cowprotocol/interfaces/IERC20.sol';
import {GPv2Order} from '@cowprotocol/libraries/GPv2Order.sol';
import {Strings} from '@openzeppelin/contracts/utils/Strings.sol';
import {BCoWFactory} from 'contracts/BCoWFactory.sol';
import {BCoWFeeEscrow} from 'contracts/BCoWFeeEscrow.sol';
import {BCoWPool} from 'contracts/BCoWPool.sol';
import {Test} from 'forge-std/Test.sol';
import {IBCoWPool} from 'interfaces/IBCoWPool.sol';
import {IBPool} from 'interfaces/IBPool.sol';
import {ISettlement} from 'interfaces/ISettlement.sol';

contract BCoWPoolIsValidSignature is Test {
  using GPv2Order for GPv2Order.Data;

  error UnknownToken();

  uint256 internal constant KEY = 0xc01234;
  address internal settler = address(0x5151);
  HooksTrampoline internal trampoline;
  BCoWPool internal pool;
  SevenAssetSettlementToken[] internal tokens;

  function setUp() public {
    vm.mockCall(settler, abi.encodeCall(ISettlement.domainSeparator, ()), abi.encode(bytes32('domain')));
    vm.mockCall(settler, abi.encodeCall(ISettlement.vaultRelayer, ()), abi.encode(settler));
    trampoline = new HooksTrampoline(settler);
    pool = _deploy(180, 100, vm.addr(KEY));
    uint8[8] memory decimals = [uint8(18), 6, 8, 18, 6, 18, 8, 18];
    uint256[8] memory weights = [uint256(8), 6, 6, 6, 6, 4, 4, 2];
    for (uint256 i; i < 8; ++i) {
      SevenAssetSettlementToken token = new SevenAssetSettlementToken(decimals[i]);
      token.mint(address(this), 1000 * 10 ** decimals[i]);
      token.approve(address(pool), type(uint256).max);
      pool.bind(address(token), 1000 * 10 ** decimals[i], weights[i] * 1e18);
      tokens.push(token);
    }
    pool.setSwapFee(pool.MAX_FEE());
    pool.finalize();
  }

  function _deploy(
    uint32 duration,
    uint16 bps,
    address curator
  ) internal returns (BCoWPool) {
    return
      new BCoWPool(
        settler, address(trampoline), BCoWPool.Settings(address(this), curator, duration, bps), 'Pool', 'BPT'
      );
  }

  function _order(
    uint256 sell,
    uint256 buy,
    uint256 fraction
  ) internal view returns (GPv2Order.Data memory o) {
    uint256 beforeBuy = tokens[buy].balanceOf(address(pool));
    uint256 limit = beforeBuy * fraction / 10_000;
    uint256 sold = pool.calcOutGivenIn(
      beforeBuy,
      pool.getDenormalizedWeight(address(tokens[buy])),
      tokens[sell].balanceOf(address(pool)),
      pool.getDenormalizedWeight(address(tokens[sell])),
      limit,
      0
    );
    o = GPv2Order.Data(
      IERC20(address(tokens[sell])),
      IERC20(address(tokens[buy])),
      address(0),
      sold * 99 / 100,
      limit,
      uint32(block.timestamp + 180),
      bytes32(0),
      0,
      GPv2Order.KIND_SELL,
      false,
      GPv2Order.BALANCE_ERC20,
      GPv2Order.BALANCE_ERC20
    );
    o.appData = pool.appDataHash(o.hash(pool.SOLUTION_SETTLER_DOMAIN_SEPARATOR()), limit);
  }

  function _h0(
    GPv2Order.Data memory o
  ) internal view returns (bytes32 h) {
    bytes32 saved = o.appData;
    o.appData = bytes32(0);
    h = o.hash(pool.SOLUTION_SETTLER_DOMAIN_SEPARATOR());
    o.appData = saved;
  }

  function _signature(
    GPv2Order.Data memory o,
    uint256 epoch,
    uint256 key
  ) internal view returns (bytes memory) {
    (uint8 v, bytes32 r, bytes32 s) =
      vm.sign(key, pool.curatorDigest(o.hash(pool.SOLUTION_SETTLER_DOMAIN_SEPARATOR()), epoch));
    return abi.encode(o, epoch, abi.encodePacked(r, s, v));
  }

  function _commit(
    GPv2Order.Data memory o
  ) internal {
    bytes32 h0 = _h0(o);
    vm.prank(settler);
    pool.commit(h0, o.buyAmount);
  }

  function _validate(
    GPv2Order.Data memory o,
    uint256 epoch,
    uint256 key
  ) internal view returns (bytes4) {
    return pool.isValidSignature(o.hash(pool.SOLUTION_SETTLER_DOMAIN_SEPARATOR()), _signature(o, epoch, key));
  }

  function _fill(
    GPv2Order.Data memory o,
    uint256 extra
  ) internal {
    vm.prank(address(pool));
    tokens[_index(address(o.sellToken))].transfer(address(this), o.sellAmount);
    tokens[_index(address(o.buyToken))].mint(address(pool), o.buyAmount + extra);
  }

  function _index(
    address token
  ) internal view returns (uint256) {
    for (uint256 i; i < 8; ++i) {
      if (address(tokens[i]) == token) return i;
    }
    revert UnknownToken();
  }

  function _pay() internal {
    vm.prank(settler);
    pool.transferFee();
  }

  function test_HookGasEightTokens() public {
    // No token reads precede commit in this test; setup runs separately.
    // Keep both hooks in one transaction to preserve transient storage.
    vm.prank(settler);
    uint256 start = gasleft();
    pool.commit(bytes32('gas measurement'), 100e6);
    uint256 preGas = start - gasleft();
    vm.prank(address(pool));
    tokens[0].transfer(address(this), 1e18);
    tokens[1].mint(address(pool), 100e6);
    vm.prank(settler);
    start = gasleft();
    pool.transferFee();
    uint256 postGas = start - gasleft();
    emit log_named_uint('8-token commit gas', preGas);
    emit log_named_uint('8-token fee gas', postGas);
    assertLt(preGas, 80_000);
    assertLt(postGas, 120_000);
    assertGt(pool.feeEscrow().claimable(vm.addr(KEY), address(tokens[1])), 0);
  }

  function test_SignatureCannotReplayOnAnotherPoolOrChain() public {
    GPv2Order.Data memory o = _order(0, 1, 100);
    bytes memory sig = _signature(o, 0, KEY);
    bytes32 hash = o.hash(pool.SOLUTION_SETTLER_DOMAIN_SEPARATOR());
    vm.chainId(block.chainid + 1);
    _commit(o);
    vm.expectRevert(IBCoWPool.InvalidCuratorSignature.selector);
    pool.isValidSignature(hash, sig);
  }

  function test_ValidCuratorOrder() public {
    GPv2Order.Data memory o = _order(0, 1, 100);
    _commit(o);
    assertEq(_validate(o, 0, KEY), bytes4(0x1626ba7e));
  }

  function test_NoCommitAndWrongAmountRejected() public {
    GPv2Order.Data memory o = _order(0, 1, 100);
    bytes memory sig = _signature(o, 0, KEY);
    bytes32 hash = o.hash(pool.SOLUTION_SETTLER_DOMAIN_SEPARATOR());
    vm.expectRevert(IBCoWPool.OrderDoesNotMatchCommitmentHash.selector);
    pool.isValidSignature(hash, sig);
    bytes32 h0 = _h0(o);
    vm.prank(settler);
    pool.commit(h0, o.buyAmount + 1);
    vm.expectRevert(IBCoWPool.OrderDoesNotMatchCommitmentHash.selector);
    pool.isValidSignature(hash, sig);
  }

  function test_StolenCuratorKeyCannotAuthorizeBelowCurveTrade() public {
    GPv2Order.Data memory o = _order(0, 1, 100);
    o.sellAmount *= 2;
    o.appData = bytes32(0);
    o.appData = pool.appDataHash(o.hash(pool.SOLUTION_SETTLER_DOMAIN_SEPARATOR()), o.buyAmount);
    _commit(o);
    bytes memory sig = _signature(o, 0, KEY);
    bytes32 hash = o.hash(pool.SOLUTION_SETTLER_DOMAIN_SEPARATOR());
    vm.expectRevert(IBPool.BPool_TokenAmountOutBelowMinOut.selector);
    pool.isValidSignature(hash, sig);
  }

  function test_WrongAppDataCannotShareCommitment() public {
    GPv2Order.Data memory o = _order(0, 1, 100);
    _commit(o);
    assertEq(_validate(o, 0, KEY), bytes4(0x1626ba7e));
    o.appData = bytes32('another document');
    bytes memory sig = _signature(o, 0, KEY);
    bytes32 hash = o.hash(pool.SOLUTION_SETTLER_DOMAIN_SEPARATOR());
    vm.expectRevert(IBCoWPool.AppDataDoesNotMatch.selector);
    pool.isValidSignature(hash, sig);
  }

  function test_WrongMessageHashAndSigner() public {
    GPv2Order.Data memory o = _order(0, 1, 100);
    _commit(o);
    bytes memory sig = _signature(o, 0, KEY);
    vm.expectRevert(IBCoWPool.OrderDoesNotMatchMessageHash.selector);
    pool.isValidSignature(bytes32('wrong'), sig);
    sig = _signature(o, 0, KEY + 1);
    bytes32 hash = o.hash(pool.SOLUTION_SETTLER_DOMAIN_SEPARATOR());
    vm.expectRevert(IBCoWPool.InvalidCuratorSignature.selector);
    pool.isValidSignature(hash, sig);
  }

  function test_OnlyCuratorCanRaiseEpoch() public {
    vm.expectRevert(IBCoWPool.OnlyCurator.selector);
    pool.revoke(1);
    vm.prank(vm.addr(KEY));
    pool.revoke(2);
    vm.expectRevert(IBCoWPool.InvalidEpoch.selector);
    vm.prank(vm.addr(KEY));
    pool.revoke(2);
    GPv2Order.Data memory o = _order(0, 1, 100);
    _commit(o);
    bytes memory sig = _signature(o, 1, KEY);
    bytes32 hash = o.hash(pool.SOLUTION_SETTLER_DOMAIN_SEPARATOR());
    vm.expectRevert(IBCoWPool.InvalidEpoch.selector);
    pool.isValidSignature(hash, sig);
    assertEq(_validate(o, 2, KEY), bytes4(0x1626ba7e));
  }

  function test_ReplaceCuratorInvalidatesOldSignatures() public {
    vm.expectRevert(IBCoWPool.OnlyCreator.selector);
    vm.prank(address(0xbad));
    pool.setCurator(vm.addr(KEY + 1));
    pool.setCurator(vm.addr(KEY + 1));
    GPv2Order.Data memory o = _order(0, 1, 100);
    _commit(o);
    bytes memory sig = _signature(o, 0, KEY);
    bytes32 hash = o.hash(pool.SOLUTION_SETTLER_DOMAIN_SEPARATOR());
    vm.expectRevert(IBCoWPool.InvalidCuratorSignature.selector);
    pool.isValidSignature(hash, sig);
    assertEq(_validate(o, 0, KEY + 1), bytes4(0x1626ba7e));
  }

  function test_CommitRestrictsLiquidityAndSwapsAndSecondCommit() public {
    GPv2Order.Data memory o = _order(0, 1, 100);
    _commit(o);
    vm.expectRevert(IBPool.BPool_Reentrancy.selector);
    vm.prank(settler);
    pool.commit(bytes32('second'), o.buyAmount);
    uint256[] memory amounts = new uint256[](8);
    vm.expectRevert(IBPool.BPool_Reentrancy.selector);
    pool.joinPool(1e18, amounts);
    vm.expectRevert(IBPool.BPool_Reentrancy.selector);
    pool.exitPool(1e18, amounts);
    vm.expectRevert(IBPool.BPool_Reentrancy.selector);
    pool.swapExactAmountIn(address(tokens[0]), 1, address(tokens[1]), 0, type(uint256).max);
    vm.expectRevert(IBPool.BPool_Reentrancy.selector);
    pool.swapExactAmountOut(address(tokens[0]), type(uint256).max, address(tokens[1]), 1, type(uint256).max);
  }

  function test_TrampolineIgnoresSecondCommitButSecondOrderStaysInvalid() public {
    GPv2Order.Data memory o = _order(0, 1, 100);
    GPv2Order.Data memory other = _order(1, 0, 100);
    HooksTrampoline.Hook[] memory hooks = new HooksTrampoline.Hook[](2);
    hooks[0] = HooksTrampoline.Hook(address(pool), abi.encodeCall(pool.commit, (_h0(o), o.buyAmount)), 100_000);
    hooks[1] = HooksTrampoline.Hook(address(pool), abi.encodeCall(pool.commit, (_h0(other), other.buyAmount)), 100_000);
    vm.prank(settler);
    trampoline.execute(hooks);
    assertEq(_validate(o, 0, KEY), bytes4(0x1626ba7e));
    bytes memory sig = _signature(other, 0, KEY);
    bytes32 hash = other.hash(pool.SOLUTION_SETTLER_DOMAIN_SEPARATOR());
    vm.expectRevert(IBCoWPool.OrderDoesNotMatchCommitmentHash.selector);
    pool.isValidSignature(hash, sig);
  }

  function test_OnlySettlementAndTrampolineCanRunHooks() public {
    vm.expectRevert(IBCoWPool.CommitOutsideOfSettlement.selector);
    pool.commit(bytes32('order'), 1);
    vm.expectRevert(IBCoWPool.CommitOutsideOfSettlement.selector);
    pool.transferFee();
    HooksTrampoline.Hook[] memory hooks = new HooksTrampoline.Hook[](0);
    vm.expectRevert(HooksTrampoline.NotASettlement.selector);
    trampoline.execute(hooks);
    vm.expectRevert(IBCoWPool.NoPendingCommitment.selector);
    vm.prank(settler);
    pool.transferFee();
  }

  function test_ZeroCommitmentCannotClearMutex() public {
    vm.expectRevert(IBCoWPool.OrderDoesNotMatchCommitmentHash.selector);
    vm.prank(settler);
    pool.commit(bytes32(0), 1);
  }

  function test_SettingsBoundsAndFactoryCreator() public {
    vm.expectRevert(IBCoWPool.InvalidSettings.selector);
    _deploy(59, 100, vm.addr(KEY));
    vm.expectRevert(IBCoWPool.InvalidSettings.selector);
    _deploy(301, 100, vm.addr(KEY));
    vm.expectRevert(IBCoWPool.InvalidSettings.selector);
    _deploy(180, 10_000, vm.addr(KEY));
    vm.expectRevert(IBPool.BPool_AddressZero.selector);
    _deploy(180, 100, address(0));
    assertEq(_deploy(60, 0, vm.addr(KEY)).orderDuration(), 60);
    assertEq(_deploy(300, 9999, vm.addr(KEY)).orderDuration(), 300);
    BCoWFactory f = new BCoWFactory(settler, address(trampoline), address(this));
    BCoWPool p = BCoWPool(address(f.newBPool('custom', 'C', vm.addr(KEY), 240, 200)));
    assertEq(p.creator(), address(this));
    assertEq(p.curator(), vm.addr(KEY));
    assertEq(p.orderDuration(), 240);
    assertEq(p.curatorFeeBps(), 200);
  }

  function test_PartialFillAndLongDurationRejected() public {
    GPv2Order.Data memory o = _order(0, 1, 100);
    o.partiallyFillable = true;
    vm.expectRevert(IBCoWPool.PartialFillNotAllowed.selector);
    pool.verify(o);
    o.partiallyFillable = false;
    o.validTo = uint32(block.timestamp + 181);
    vm.expectRevert(IBCoWPool.BCoWPool_OrderValidityTooLong.selector);
    pool.verify(o);
  }

  function testFuzz_AppDataMatchesIndependentBuilder(
    bytes32 h0,
    uint256 amount
  ) public view {
    string memory target = Strings.toHexString(uint160(address(pool)), 20);
    string memory callData = string.concat('0x', _hex(abi.encodeCall(pool.commit, (h0, amount))));
    bytes memory expected = abi.encodePacked(
      '{"version":"1.6.0","appCode":"Bleu CoW AMM","metadata":{"hooks":{"pre":[{"target":"',
      target,
      '","callData":"',
      callData,
      '","gasLimit":"100000"}],"post":[{"target":"',
      target,
      '","callData":"0xacb2ad6f","gasLimit":"150000"}]}}}'
    );
    assertEq(pool.appData(h0, amount), expected);
    assertEq(pool.appDataHash(h0, amount), keccak256(expected));
  }

  function _hex(
    bytes memory data
  ) internal pure returns (string memory) {
    bytes memory out = new bytes(data.length * 2);
    bytes16 alphabet = '0123456789abcdef';
    for (uint256 i; i < data.length; ++i) {
      out[i * 2] = alphabet[uint8(data[i]) >> 4];
      out[i * 2 + 1] = alphabet[uint8(data[i]) & 15];
    }
    return string(out);
  }

  function testFuzz_FeePreservesCurveMixedDecimals(
    uint256 sell,
    uint256 buy,
    uint256 fraction,
    uint256 extra
  ) public {
    sell = bound(sell, 0, 6);
    buy = (sell + bound(buy, 1, 6)) % 7;
    fraction = bound(fraction, 10, 2000);
    GPv2Order.Data memory o = _order(sell, buy, fraction);
    uint256 buyWeight = pool.getDenormalizedWeight(address(o.buyToken));
    uint256 sellWeight = pool.getDenormalizedWeight(address(o.sellToken));
    uint256 beforeBuy = o.buyToken.balanceOf(address(pool));
    uint256 beforeSell = o.sellToken.balanceOf(address(pool));
    uint256 baseline = pool.calcInGivenOut(beforeBuy, buyWeight, beforeSell, sellWeight, o.sellAmount, 0);
    _commit(o);
    assertEq(_validate(o, 0, KEY), bytes4(0x1626ba7e));
    extra = bound(extra, 0, o.buyAmount);
    _fill(o, extra);
    _pay();
    uint256 fee = pool.feeEscrow().claimable(vm.addr(KEY), address(o.buyToken));
    assertLe(fee, o.buyAmount > baseline ? (o.buyAmount - baseline) / 100 : 0);
    assertGe(pool.calcOutGivenIn(beforeBuy, buyWeight, beforeSell, sellWeight, o.buyAmount - fee, 0), o.sellAmount);
    assertEq(o.buyToken.balanceOf(address(pool)), beforeBuy + o.buyAmount + extra - fee);
    vm.expectRevert(IBCoWPool.NoPendingCommitment.selector);
    vm.prank(settler);
    pool.transferFee();
    // Fee settlement leaves the mutex held through the rest of the transaction.
    vm.expectRevert(IBPool.BPool_Reentrancy.selector);
    pool.exitPool(1, new uint256[](8));
  }

  function test_All42M7FeeDirections() public {
    uint256 snapshot = vm.snapshot();
    for (uint256 sell; sell < 7; ++sell) {
      for (uint256 distance = 1; distance < 7; ++distance) {
        testFuzz_FeePreservesCurveMixedDecimals(sell, distance, 100, 0);
        assertTrue(vm.revertTo(snapshot));
      }
    }
  }

  function test_NoFillAndMultipleDeltasDoNotPay() public {
    GPv2Order.Data memory o = _order(0, 1, 100);
    _commit(o);
    vm.expectRevert(IBCoWPool.InvalidTradeDeltas.selector);
    vm.prank(settler);
    pool.transferFee();
    _fill(o, 0);
    tokens[2].mint(address(pool), 1);
    vm.expectRevert(IBCoWPool.InvalidTradeDeltas.selector);
    vm.prank(settler);
    pool.transferFee();
    assertEq(pool.feeEscrow().claimable(vm.addr(KEY), address(o.buyToken)), 0);
  }

  function test_BlockedCuratorCanEarnAndWithdrawToAlternateRecipient() public {
    GPv2Order.Data memory o = _order(0, 1, 100);
    _commit(o);
    _fill(o, 0);
    address beneficiary = vm.addr(KEY);
    vm.mockCallRevert(
      address(o.buyToken),
      abi.encodeWithSignature('transfer(address,uint256)', beneficiary, uint256(0)),
      bytes('blocked')
    );
    _pay();
    BCoWFeeEscrow escrow = pool.feeEscrow();
    uint256 earned = escrow.claimable(beneficiary, address(o.buyToken));
    assertGt(earned, 0);
    vm.mockCallRevert(
      address(o.buyToken), abi.encodeWithSignature('transfer(address,uint256)', beneficiary, earned), bytes('blocked')
    );
    vm.expectRevert(bytes('blocked'));
    vm.prank(beneficiary);
    escrow.withdraw(address(o.buyToken), beneficiary);
    assertEq(escrow.claimable(beneficiary, address(o.buyToken)), earned);
    vm.prank(beneficiary);
    escrow.withdraw(address(o.buyToken), address(0x1234));
    assertEq(o.buyToken.balanceOf(address(0x1234)), earned);
  }

  function test_EarnedFeesWithdrawToChosenRecipient() public {
    GPv2Order.Data memory o = _order(0, 1, 100);
    _commit(o);
    _fill(o, o.buyAmount);
    _pay();
    BCoWFeeEscrow escrow = pool.feeEscrow();
    uint256 earned = escrow.claimable(vm.addr(KEY), address(o.buyToken));
    assertGt(earned, 0);
    vm.expectRevert(BCoWFeeEscrow.OnlyPool.selector);
    escrow.credit(address(this), address(o.buyToken), 1);
    // Other callers can only withdraw their own (zero) balance.
    escrow.withdraw(address(o.buyToken), address(this));
    assertEq(escrow.claimable(vm.addr(KEY), address(o.buyToken)), earned);
    vm.prank(vm.addr(KEY));
    escrow.withdraw(address(o.buyToken), address(0x1234));
    assertEq(o.buyToken.balanceOf(address(0x1234)), earned);
    assertEq(escrow.claimable(vm.addr(KEY), address(o.buyToken)), 0);
  }
}
