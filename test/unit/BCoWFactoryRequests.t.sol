// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {BCoWFactory} from 'contracts/BCoWFactory.sol';
import {BCoWPool} from 'contracts/BCoWPool.sol';
import {Test} from 'forge-std/Test.sol';
import {IBCoWFactory} from 'interfaces/IBCoWFactory.sol';
import {IBCoWPool} from 'interfaces/IBCoWPool.sol';
import {IBPool} from 'interfaces/IBPool.sol';
import {ISettlement} from 'interfaces/ISettlement.sol';

contract BCoWFactoryRequestsTest is Test {
  BCoWFactory factory;
  address settler = address(0x5151);

  function setUp() public {
    vm.mockCall(settler, abi.encodeCall(ISettlement.domainSeparator, ()), abi.encode(bytes32('domain')));
    vm.mockCall(settler, abi.encodeCall(ISettlement.vaultRelayer, ()), abi.encode(address(0x1234)));
    factory = new BCoWFactory(settler, address(0x1234), address(this));
  }

  function test_RequestRecoveryAndOwnership() public {
    bytes32 id = keccak256('browser request');
    address creator = address(0xa11ce);
    assertEq(factory.createdPool(creator, id), address(0));
    vm.prank(creator);
    BCoWPool pool = BCoWPool(address(factory.createPool(id, 'MAG7', 'M7', address(0xc0ffee), 180, 100)));
    assertEq(factory.createdPool(creator, id), address(pool));
    assertEq(pool.creator(), creator);
    assertEq(pool.getController(), creator);
    assertEq(pool.FACTORY(), address(factory));
    assertTrue(factory.isBPool(address(pool)));
    vm.expectRevert(IBCoWFactory.CreationRequestAlreadyUsed.selector);
    vm.prank(creator);
    factory.createPool(id, 'duplicate', 'D', creator, 180, 100);
    assertEq(factory.createdPool(creator, id), address(pool));
  }

  function test_RequestIdsAreNamespacedAndMultipleRequestsRecover() public {
    bytes32 id = bytes32(uint256(1));
    address a = address(0xa);
    address b = address(0xb);
    vm.prank(a);
    address first = address(factory.createPool(id, 'A', 'A', a, 180, 100));
    vm.prank(b);
    address second = address(factory.createPool(id, 'B', 'B', b, 180, 100));
    vm.prank(a);
    address third = address(factory.createPool(bytes32(uint256(2)), 'C', 'C', a, 180, 100));
    assertNotEq(first, second);
    assertNotEq(first, third);
    assertEq(factory.createdPool(a, id), first);
    assertEq(factory.createdPool(b, id), second);
    assertEq(factory.createdPool(a, bytes32(uint256(2))), third);
  }

  function test_RevertLeavesRequestAvailableAndPauseIsRespected() public {
    bytes32 id = bytes32(uint256(1));
    vm.expectRevert(IBCoWPool.InvalidSettings.selector);
    factory.createPool(id, 'bad', 'B', address(this), 301, 100);
    assertEq(factory.createdPool(address(this), id), address(0));
    factory.pause();
    vm.expectRevert(bytes4(keccak256('EnforcedPause()')));
    factory.createPool(id, 'paused', 'P', address(this), 180, 100);
    factory.unpause();
    factory.createPool(id, 'good', 'G', address(this), 180, 100);
    assertNotEq(factory.createdPool(address(this), id), address(0));
  }

  function test_CustomPublicFeeAndSolverSettingsAreRecoverableAndIndependent() public {
    bytes32 id = bytes32(uint256(3));
    address creator_ = address(0xa11ce);
    vm.prank(creator_);
    BCoWPool pool =
      BCoWPool(address(factory.createPool(id, 'Public', 'PUB', address(0xc0ffee), 180, 100, 0.003e18, true)));
    assertEq(factory.createdPool(creator_, id), address(pool));
    assertTrue(factory.isBPool(address(pool)));
    assertEq(pool.creator(), creator_);
    assertEq(pool.getController(), creator_);
    assertEq(pool.getSwapFee(), 0.003e18);
    assertEq(pool.curatorFeeBps(), 100);
    assertTrue(pool.solverOrdersEnabled());
    vm.expectRevert(IBCoWPool.PublicSwapFeeIsFixed.selector);
    vm.prank(creator_);
    pool.setSwapFee(0.01e18);
    vm.prank(creator_);
    pool.setController(address(0xb0b));
    vm.expectRevert(IBCoWPool.PublicSwapFeeIsFixed.selector);
    vm.prank(address(0xb0b));
    pool.setSwapFee(0.01e18);
    vm.expectRevert(IBCoWPool.OnlyCreator.selector);
    vm.prank(address(0xb0b));
    pool.setSolverOrdersEnabled(false);
    vm.prank(creator_);
    pool.setSolverOrdersEnabled(false);
    assertFalse(pool.solverOrdersEnabled());
  }

  function test_PublicFeeBoundsAndLegacyDefaults() public {
    vm.expectRevert(IBPool.BPool_FeeBelowMinimum.selector);
    factory.createPool(bytes32(uint256(1)), 'Bad', 'B', address(this), 180, 100, 1e12 - 1, false);
    assertEq(factory.createdPool(address(this), bytes32(uint256(1))), address(0));
    vm.expectRevert(IBPool.BPool_FeeAboveMaximum.selector);
    factory.newBPool('Bad', 'B', address(this), 180, 100, 1e18, true);
    BCoWPool pool = BCoWPool(address(factory.newBPool('Legacy', 'L')));
    assertEq(pool.getSwapFee(), pool.MAX_FEE());
    assertFalse(pool.solverOrdersEnabled());
    assertEq(factory.POOL_SETTINGS_VERSION(), 2);
  }
}
