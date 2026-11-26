// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {BCoWFactory} from 'contracts/BCoWFactory.sol';
import {BCoWPool} from 'contracts/BCoWPool.sol';
import {Test} from 'forge-std/Test.sol';
import {IBCoWFactory} from 'interfaces/IBCoWFactory.sol';
import {IBCoWPool} from 'interfaces/IBCoWPool.sol';
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
}
