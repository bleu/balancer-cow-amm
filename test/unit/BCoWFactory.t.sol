// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {BCoWFactory} from 'contracts/BCoWFactory.sol';
import {BCoWPool} from 'contracts/BCoWPool.sol';
import {BCoWPoolDeployer} from 'contracts/BCoWPoolDeployer.sol';
import {Test} from 'forge-std/Test.sol';
import {IBCoWFactory} from 'interfaces/IBCoWFactory.sol';
import {IBCoWPool} from 'interfaces/IBCoWPool.sol';
import {ISettlement} from 'interfaces/ISettlement.sol';
import {MockBCoWFactory} from 'test/manual-smock/MockBCoWFactory.sol';

interface IFactory {
  function paused() external view returns (bool);
  function pause() external;
  function unpause() external;
}

contract BCoWFactoryTest is Test {
  address public factoryDeployer = makeAddr('factoryDeployer');
  address public solutionSettler = makeAddr('solutionSettler');
  address public bdaoMsig = makeAddr('bdaoMsig');
  address public hooksTrampoline = address(0x1234);
  string constant ERC20_NAME = 'Balancer Pool Token';
  string constant ERC20_SYMBOL = 'BPT';

  MockBCoWFactory factory;

  function setUp() external {
    vm.prank(factoryDeployer);
    factory = new MockBCoWFactory(solutionSettler, hooksTrampoline, bdaoMsig);
    vm.mockCall(solutionSettler, abi.encodePacked(ISettlement.domainSeparator.selector), abi.encode(bytes32(0)));
    vm.mockCall(
      solutionSettler, abi.encodePacked(ISettlement.vaultRelayer.selector), abi.encode(makeAddr('vault relayer'))
    );
  }

  function test_ConstructorWhenCalled(
    address _bDao,
    address _newSettler,
    address _trampoline
  ) external {
    vm.prank(_bDao);
    MockBCoWFactory _newFactory = new MockBCoWFactory(_newSettler, _trampoline, bdaoMsig);
    // it should set solution settler
    assertEq(_newFactory.SOLUTION_SETTLER(), _newSettler);
    // it should set app data
    assertEq(_newFactory.HOOKS_TRAMPOLINE(), _trampoline);
    // it should set BDao
    assertEq(_newFactory.getBDao(), _bDao);
    // it should set the bdaoMsig
    assertEq(_newFactory.BDAO_MSIG(), bdaoMsig);
  }

  function test__newBPoolWhenCalled() external {
    address _futurePool = vm.computeCreateAddress(address(factory), 2);
    IBCoWPool _newPool = IBCoWPool(address(factory.call__newBPool(ERC20_NAME, ERC20_SYMBOL)));
    assertEq(address(_newPool), _futurePool);
    // it should set the new BCoWPool solution settler
    assertEq(address(_newPool.SOLUTION_SETTLER()), solutionSettler);
    // it should set the new BCoWPool app data
    assertEq(BCoWPool(address(_newPool)).hooksTrampoline(), hooksTrampoline);
    // it should deploy a new BCoWPool
    assertEq(BCoWPool(address(_newPool)).creator(), address(this));
    assertEq(BCoWPool(address(_newPool)).curator(), address(this));
  }

  function test_DeploymentModuleKeepsFactoryContextAndFitsEvmLimits() external {
    BCoWFactory production = new BCoWFactory(solutionSettler, hooksTrampoline, bdaoMsig);
    BCoWPool p = BCoWPool(address(production.newBPool('Custom', 'C', address(0x5678), 240, 321)));
    assertEq(p.FACTORY(), address(production));
    assertEq(p.getController(), address(this));
    assertEq(p.creator(), address(this));
    assertEq(p.curator(), address(0x5678));
    assertTrue(production.isBPool(address(p)));
    assertLt(address(production).code.length, 24_576);
    assertLt(address(p).code.length, 24_576);
    assertLt(address(production.POOL_DEPLOYER()).code.length, 24_576);
    assertEq(production.POOL_DEPLOYER().FACTORY(), address(production));
    BCoWPoolDeployer module = production.POOL_DEPLOYER();
    vm.expectRevert(BCoWPoolDeployer.OnlyFactoryContext.selector);
    module.deploy(bytes(''));
  }

  function test_CustomSettingsRevertsPropagateThroughDeploymentModule() external {
    vm.expectRevert(IBCoWPool.InvalidSettings.selector);
    factory.newBPool('Bad', 'B', address(this), 301, 100);
    vm.prank(bdaoMsig);
    factory.pause();
    vm.expectRevert(bytes4(keccak256('EnforcedPause()')));
    factory.newBPool('Paused', 'P', address(this), 180, 100);
  }

  function test_LogBCowPoolRevertWhen_TheSenderIsNotAValidPool(
    address _caller
  ) external {
    // it should revert
    vm.expectRevert(IBCoWFactory.BCoWFactory_NotValidBCoWPool.selector);
    vm.prank(_caller);
    factory.logBCoWPool();
  }

  function test_LogBCowPoolWhenTheSenderIsAValidPool(
    address _pool
  ) external {
    factory.set__isBPool(address(_pool), true);
    // it should emit a COWAMMPoolCreated event
    vm.expectEmit(address(factory));
    emit IBCoWFactory.COWAMMPoolCreated(_pool);
    vm.prank(_pool);
    IBCoWFactory(address(factory)).logBCoWPool();
  }

  function test_isNotPausedAfterDeployment() external {
    assertTrue(!IFactory(address(factory)).paused(), 'Factory should not be paused');
    factory.newBPool(ERC20_NAME, ERC20_SYMBOL);
  }

  function test_pause() external {
    vm.prank(bdaoMsig);
    IFactory(address(factory)).pause();
    assertTrue(IFactory(address(factory)).paused(), 'Factory should be paused');
    vm.expectRevert(bytes4(keccak256('EnforcedPause()')));
    factory.call__newBPool(ERC20_NAME, ERC20_SYMBOL);
  }

  function test_unpause() external {
    vm.startPrank(bdaoMsig);
    IFactory(address(factory)).pause();
    IFactory(address(factory)).unpause();
    vm.stopPrank();

    assertTrue(!IFactory(address(factory)).paused(), 'Factory should not be paused after deployment');
    factory.newBPool(ERC20_NAME, ERC20_SYMBOL);
  }
}
