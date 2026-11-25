// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.25;

import {BCoWPool} from './BCoWPool.sol';
import {BCoWPoolDeployer} from './BCoWPoolDeployer.sol';
import {BFactory} from './BFactory.sol';
import {Address} from '@openzeppelin/contracts/utils/Address.sol';
import {Pausable} from '@openzeppelin/contracts/utils/Pausable.sol';

import {IBCoWFactory} from 'interfaces/IBCoWFactory.sol';
import {IBPool} from 'interfaces/IBPool.sol';

/**
 * @title BCoWFactory
 * @notice Creates new BCoWPools, logging their addresses and acting as a registry of pools.
 * @dev Inherits BFactory contract functionalities, but deploys BCoWPools instead of BPool.
 */
contract BCoWFactory is BFactory, IBCoWFactory, Pausable {
  /// @inheritdoc IBCoWFactory
  address public immutable SOLUTION_SETTLER;

  /// @inheritdoc IBCoWFactory
  address public immutable HOOKS_TRAMPOLINE;

  /// @notice Immutable module used to create pools in the factory context.
  BCoWPoolDeployer public immutable POOL_DEPLOYER;

  /// @notice Balancer DAO multisig authorized to pause deployment.
  address public immutable BDAO_MSIG;

  /// @notice Caller is not the factory pausing authority.
  /// @param sender Unauthorized caller.
  error OnlyBDaoMsigCanPauseOrUnpause(address sender);

  constructor(
    address solutionSettler,
    address hooksTrampoline,
    address bdaoMsig
  ) BFactory() {
    POOL_DEPLOYER = new BCoWPoolDeployer();
    SOLUTION_SETTLER = solutionSettler;
    HOOKS_TRAMPOLINE = hooksTrampoline;
    BDAO_MSIG = bdaoMsig;
  }

  /// @inheritdoc IBCoWFactory
  function logBCoWPool() external {
    if (!_isBPool[msg.sender]) revert BCoWFactory_NotValidBCoWPool();
    emit COWAMMPoolCreated(msg.sender);
  }

  /// @notice Disables new pool creation; callable only by BDAO_MSIG.
  function pause() external {
    if (msg.sender != BDAO_MSIG) {
      revert OnlyBDaoMsigCanPauseOrUnpause(msg.sender);
    }
    _pause();
  }

  /// @notice Enables new pool creation; callable only by BDAO_MSIG.
  function unpause() external {
    if (msg.sender != BDAO_MSIG) {
      revert OnlyBDaoMsigCanPauseOrUnpause(msg.sender);
    }
    _unpause();
  }

  /// @inheritdoc IBCoWFactory
  function newBPool(
    string memory name,
    string memory symbol,
    address curator,
    uint32 duration,
    uint16 feeBps
  ) external whenNotPaused returns (IBPool pool) {
    pool = _createPool(name, symbol, curator, duration, feeBps);
    _isBPool[address(pool)] = true;
    emit LOG_NEW_POOL(msg.sender, address(pool));
    pool.setController(msg.sender);
  }

  /**
   * @dev Deploys a BCoWPool instead of a regular BPool.
   * @param name The name of the Pool ERC20 token
   * @param symbol The symbol of the Pool ERC20 token
   * @return bCoWPool The deployed BCoWPool
   */
  function _newBPool(
    string memory name,
    string memory symbol
  ) internal virtual override whenNotPaused returns (IBPool bCoWPool) {
    bCoWPool = _createPool(name, symbol, msg.sender, 180, 100);
  }

  /// @notice Deploys a curated pool for the current caller.
  /// @param name LP token name.
  /// @param symbol LP token symbol.
  /// @param curator Initial ECDSA signer.
  /// @param duration Maximum future order validity in seconds.
  /// @param feeBps Share of limit surplus in basis points.
  /// @return Newly deployed pool.
  function _createPool(
    string memory name,
    string memory symbol,
    address curator,
    uint32 duration,
    uint16 feeBps
  ) private returns (IBPool) {
    bytes memory args = abi.encode(
      SOLUTION_SETTLER, HOOKS_TRAMPOLINE, BCoWPool.Settings(msg.sender, curator, duration, feeBps), name, symbol
    );
    bytes memory result =
      Address.functionDelegateCall(address(POOL_DEPLOYER), abi.encodeCall(BCoWPoolDeployer.deploy, (args)));
    return IBPool(abi.decode(result, (address)));
  }
}
