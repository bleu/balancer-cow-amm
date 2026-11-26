// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.25;

import {GPv2Order} from '@cowprotocol/libraries/GPv2Order.sol';
import {IERC1271} from '@openzeppelin/contracts/interfaces/IERC1271.sol';
import {IBPool} from 'interfaces/IBPool.sol';
import {ISettlement} from 'interfaces/ISettlement.sol';

interface IBCoWPool is IERC1271, IBPool {
  /// @notice The creator replaced the authorized signer.
  /// @param oldCurator Previous signer.
  /// @param newCurator New signer.
  event CuratorChanged(address indexed oldCurator, address indexed newCurator);
  /// @notice The curator raised its minimum signing epoch.
  /// @param minEpoch Lowest epoch accepted from now on.
  event OrdersRevoked(uint256 minEpoch);
  /// @notice A fill paid the curator's fee to escrow.
  /// @param curator Beneficiary credited in escrow.
  /// @param token Incoming token used for payment.
  /// @param amount Fee in raw token units.
  event CuratorFeePaid(address indexed curator, address indexed token, uint256 amount);

  /// @notice Creator changed whether authenticated solver origins may use unsigned orders.
  /// @param enabled Whether unsigned solver orders are accepted.
  event SolverOrdersEnabled(bool enabled);

  /// @notice The public swap fee is fixed at pool deployment.
  error PublicSwapFeeIsFixed();
  /// @notice Unsigned solver orders require opt-in, settlement caller and an authenticated origin.
  error SolverOrderNotAuthorized();

  /// @notice Deployment settings exceed the supported duration or fee bounds.
  error InvalidSettings();
  /// @notice Only the immutable creator may replace the curator.
  error OnlyCreator();
  /// @notice Only the current curator may revoke epochs.
  error OnlyCurator();
  /// @notice Signing epoch is revoked or a revocation does not increase it.
  error InvalidEpoch();
  /// @notice Signature was not produced by the current curator.
  error InvalidCuratorSignature();
  /// @notice Fee hook requires an unconsumed transaction commitment.
  error NoPendingCommitment();
  /// @notice Reserve changes do not identify one funded sell trade.
  error InvalidTradeDeltas();
  /// @notice Standing orders must be fill-or-kill.
  error PartialFillNotAllowed();

  /**
   * @notice Thrown when a CoW order has a non-zero fee
   */
  error BCoWPool_FeeMustBeZero();

  /**
   * @notice Thrown when a CoW order is executed after its deadline
   */
  error BCoWPool_OrderValidityTooLong();

  /**
   * @notice Thrown when a CoW order has an unknown type (must be GPv2Order.KIND_SELL)
   */
  error BCoWPool_InvalidOperation();

  /**
   * @notice Thrown when a CoW order has an invalid balance marker. BCoWPool
   * only supports BALANCE_ERC20, instructing to use the underlying ERC20
   * balance directly instead of balancer's internal accounting
   */
  error BCoWPool_InvalidBalanceMarker();

  /**
   * @notice The `commit` function can only be called inside a CoW Swap
   * settlement. This error is thrown when the function is called from another
   * context.
   */
  error CommitOutsideOfSettlement();

  /**
   * @notice Error thrown when a solver tries to settle an AMM order on CoW
   * Protocol whose hash doesn't match the one that has been committed to.
   */
  error OrderDoesNotMatchCommitmentHash();

  /**
   * @notice On signature verification, the hash of the order supplied as part
   * of the signature does not match the provided message hash.
   * This usually means that the verification function is being provided a
   * signature that belongs to a different order.
   */
  error OrderDoesNotMatchMessageHash();

  /**
   * @notice Thrown when AppData that was provided during signature verification
   * does not match the canonical document derived for this commitment.
   */
  error AppDataDoesNotMatch();

  /**
   * @notice Thrown when the receiver of the order is not the bCoWPool itself.
   */
  error BCoWPool_ReceiverIsNotBCoWPool();

  /**
   * @notice Restricts a specific AMM to being able to trade only the order
   * with the specified hash.
   * @dev The commitment is used to enforce that exactly one AMM order is
   * valid when a CoW Protocol batch is settled.
   * @param orderHash CoW EIP-712 order digest with appData set to zero.
   * @param buyAmount The order limit recorded for fee calculation.
   */
  function commit(
    bytes32 orderHash,
    uint256 buyAmount
  ) external;

  /// @notice Pays the pending fill fee to the curator escrow at most once.
  function transferFee() external;

  /// @notice Updates solver access without changing curator authority or fees.
  /// @param enabled Whether eligible solver origins may build unsigned CoW orders.
  function setSolverOrdersEnabled(
    bool enabled
  ) external;

  /// @notice Current creator-controlled unsigned solver policy.
  /// @return Whether solver-originated orders are enabled.
  function solverOrdersEnabled() external view returns (bool);

  /**
   * @notice The address that can pull funds from the AMM vault to execute an order
   * @return vaultRelayer The address of the vault relayer.
   */
  // solhint-disable-next-line style-guide-casing
  function VAULT_RELAYER() external view returns (address vaultRelayer);

  /**
   * @notice The domain separator used for hashing CoW Protocol orders.
   * @return solutionSettlerDomainSeparator The domain separator.
   */
  // solhint-disable-next-line style-guide-casing
  function SOLUTION_SETTLER_DOMAIN_SEPARATOR() external view returns (bytes32 solutionSettlerDomainSeparator);

  /**
   * @notice The address of the CoW Protocol settlement contract. It is the
   * authorized alongside the configured trampoline to set commitments.
   * @return solutionSettler The address of the solution settler.
   */
  // solhint-disable-next-line style-guide-casing
  function SOLUTION_SETTLER() external view returns (ISettlement solutionSettler);

  /**
   * @notice This function checks that the input order is admissible for the
   * constant-product curve for the given trading parameters.
   * @param order `GPv2Order.Data` of a discrete order to be verified.
   */
  function verify(
    GPv2Order.Data memory order
  ) external view;
}
