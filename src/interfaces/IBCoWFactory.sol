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

  /// @notice A creator has already used this request ID.
  error CreationRequestAlreadyUsed();

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

  /// @notice Recovers a UI-created pool without reading events.
  /// @param creator Wallet that submitted the creation.
  /// @param requestId Browser-generated unique creation ID.
  /// @return pool Created pool, or zero if the request never succeeded.
  function createdPool(
    address creator,
    bytes32 requestId
  ) external view returns (address pool);

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
  /// @notice Creates a recoverable pool with the caller as creator/controller.
  /// @param requestId Unique ID persisted by the browser before submitting.
  /// @param name LP token name.
  /// @param symbol LP token symbol.
  /// @param curator Initial signing address.
  /// @param duration Maximum order lifetime in seconds.
  /// @param feeBps Curator's share of limit surplus in basis points.
  /// @return pool Created pool.
  function createPool(
    bytes32 requestId,
    string memory name,
    string memory symbol,
    address curator,
    uint32 duration,
    uint16 feeBps
  ) external returns (IBPool pool);
  /// @notice Pool creation settings supported by this factory.
  /// @return Version 2 supports fixed public fees and optional unsigned solver orders.
  // solhint-disable-next-line style-guide-casing
  function POOL_SETTINGS_VERSION() external view returns (uint256);

  /// @notice Creates a pool with independent public swap and CoW settings.
  /// @param name LP token name.
  /// @param symbol LP token symbol.
  /// @param curator Curator signing address.
  /// @param duration Maximum CoW order duration.
  /// @param feeBps Curator share of CoW limit surplus.
  /// @param publicSwapFee Immutable public swap fee scaled by 1e18.
  /// @param solverOrdersEnabled Initial unsigned solver policy.
  /// @return pool Created pool controlled by the caller.
  function newBPool(
    string memory name,
    string memory symbol,
    address curator,
    uint32 duration,
    uint16 feeBps,
    uint256 publicSwapFee,
    bool solverOrdersEnabled
  ) external returns (IBPool pool);

  /// @notice Creates a recoverable pool with independent public swap and CoW settings.
  /// @param requestId Unique browser creation request ID.
  /// @param name LP token name.
  /// @param symbol LP token symbol.
  /// @param curator Curator signing address.
  /// @param duration Maximum CoW order duration.
  /// @param feeBps Curator share of CoW limit surplus.
  /// @param publicSwapFee Immutable public swap fee scaled by 1e18.
  /// @param solverOrdersEnabled Initial unsigned solver policy.
  /// @return pool Created pool controlled by the caller.
  function createPool(
    bytes32 requestId,
    string memory name,
    string memory symbol,
    address curator,
    uint32 duration,
    uint16 feeBps,
    uint256 publicSwapFee,
    bool solverOrdersEnabled
  ) external returns (IBPool pool);
}
