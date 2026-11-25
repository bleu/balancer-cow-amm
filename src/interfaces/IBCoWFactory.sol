// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.25;

import {IBFactory} from 'interfaces/IBFactory.sol';
import {IBPool} from 'interfaces/IBPool.sol';

interface IBCoWFactory is IBFactory {
  /**
   * @notice Emitted when a bCoWPool created by this factory is finalized
   * @param bCoWPool The pool just finalized
   */
  event COWAMMPoolCreated(address indexed bCoWPool);

  /**
   * @notice thrown when the caller of `logBCoWPool()` is not a bCoWPool created by this factory
   */
  error BCoWFactory_NotValidBCoWPool();

  /**
   * @notice Emits the COWAMMPoolCreated event if the caller is a bCoWPool, to be indexed by off-chain agents
   */
  function logBCoWPool() external;

  /**
   * @notice The address of the CoW Protocol settlement contract. It is the
   * only address that can set commitments.
   * @return solutionSettler The address of the solution settler.
   */
  // solhint-disable-next-line style-guide-casing
  function SOLUTION_SETTLER() external view returns (address solutionSettler);

  /// @notice Trampoline authorized to run settlement hooks for newly deployed pools.
  /// @return Trampoline address.
  // solhint-disable-next-line style-guide-casing
  function HOOKS_TRAMPOLINE() external view returns (address);

  /// @notice Deploys a pool with custom curator settings; caller is the immutable creator.
  /// @param name LP token name.
  /// @param symbol LP token symbol.
  /// @param curator Initial ECDSA signer.
  /// @param duration Maximum future order validity, in seconds.
  /// @param feeBps Share of limit surplus, in basis points.
  /// @return pool Newly deployed pool.
  function newBPool(
    string memory name,
    string memory symbol,
    address curator,
    uint32 duration,
    uint16 feeBps
  ) external returns (IBPool pool);
}
