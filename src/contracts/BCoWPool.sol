// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.25;

/*

Coded for Balancer and CoW Swap with ♥ by

░██╗░░░░░░░██╗░█████╗░███╗░░██╗██████╗░███████╗██████╗░██╗░░░░░░█████╗░███╗░░██╗██████╗░
░██║░░██╗░░██║██╔══██╗████╗░██║██╔══██╗██╔════╝██╔══██╗██║░░░░░██╔══██╗████╗░██║██╔══██╗
░╚██╗████╗██╔╝██║░░██║██╔██╗██║██║░░██║█████╗░░██████╔╝██║░░░░░███████║██╔██╗██║██║░░██║
░░████╔═████║░██║░░██║██║╚████║██║░░██║██╔══╝░░██╔══██╗██║░░░░░██╔══██║██║╚████║██║░░██║
░░╚██╔╝░╚██╔╝░╚█████╔╝██║░╚███║██████╔╝███████╗██║░░██║███████╗██║░░██║██║░╚███║██████╔╝
░░░╚═╝░░░╚═╝░░░╚════╝░╚═╝░░╚══╝╚═════╝░╚══════╝╚═╝░░╚═╝╚══════╝╚═╝░░╚═╝╚═╝░░╚══╝╚═════╝░

https://defi.sucks

*/

import {BCoWAppData} from './BCoWAppData.sol';
import {BCoWConst} from './BCoWConst.sol';
import {BCoWFeeEscrow} from './BCoWFeeEscrow.sol';
import {BPool} from './BPool.sol';
import {GPv2Order} from '@cowprotocol/libraries/GPv2Order.sol';
import {IERC1271} from '@openzeppelin/contracts/interfaces/IERC1271.sol';
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {ECDSA} from '@openzeppelin/contracts/utils/cryptography/ECDSA.sol';
import {EIP712} from '@openzeppelin/contracts/utils/cryptography/EIP712.sol';
import {Math} from '@openzeppelin/contracts/utils/math/Math.sol';

import {IBCoWFactory} from 'interfaces/IBCoWFactory.sol';
import {IBCoWPool} from 'interfaces/IBCoWPool.sol';
import {IBPool} from 'interfaces/IBPool.sol';
import {ISettlement} from 'interfaces/ISettlement.sol';

/**
 * @title BCoWPool
 * @notice Pool contract that holds tokens, allows to swap, add and remove liquidity.
 * @dev Inherits BPool contract functionalities, and can trade on CoW Swap Protocol.
 */
// solhint-disable style-guide-casing
contract BCoWPool is IERC1271, IBCoWPool, BPool, BCoWConst, BCoWAppData, EIP712 {
  using GPv2Order for GPv2Order.Data;
  using SafeERC20 for IERC20;

  /// @notice Immutable settings chosen by the creator at deployment.
  /// @param creator Address authorized to replace the curator.
  /// @param curator Initial ECDSA order signer.
  /// @param orderDuration Maximum future order validity in seconds.
  /// @param curatorFeeBps Curator share of limit surplus in basis points.
  /// @param publicSwapFee Fixed fee charged by ordinary public swaps, scaled by 1e18.
  /// @param solverOrdersEnabled Whether authenticated solver origins may use unsigned orders.
  struct Settings {
    address creator;
    address curator;
    uint32 orderDuration;
    uint16 curatorFeeBps;
    uint256 publicSwapFee;
    bool solverOrdersEnabled;
  }

  /// @inheritdoc IBCoWPool
  address public immutable VAULT_RELAYER;

  /// @inheritdoc IBCoWPool
  bytes32 public immutable SOLUTION_SETTLER_DOMAIN_SEPARATOR;

  /// @inheritdoc IBCoWPool
  ISettlement public immutable SOLUTION_SETTLER;

  /// @notice Settlement-only trampoline allowed to execute hooks.
  address public immutable hooksTrampoline;
  /// @notice Creator authorized to replace the curator, independent of liquidity control.
  address public immutable creator;
  /// @notice Maximum future order validity in seconds.
  uint32 public immutable orderDuration;
  /// @notice Curator share of limit surplus in basis points.
  uint16 public immutable curatorFeeBps;
  /// @notice Separate custody for earned fees; excluded from LP reserves.
  BCoWFeeEscrow public immutable feeEscrow;
  /// @inheritdoc IBCoWPool
  bool public solverOrdersEnabled;
  /// @notice Current ECDSA signer of standing orders.
  address public curator;
  /// @notice Lowest accepted curator signing epoch.
  uint256 public minEpoch;

  /// @notice EIP-712 struct type binding a CoW order digest to a revocable epoch.
  bytes32 public constant CURATED_ORDER_TYPEHASH = keccak256('CuratedOrder(bytes32 orderHash,uint256 epoch)');
  /// @notice Transient flag consumed before paying a fee.
  bytes32 private constant _PENDING_SLOT = keccak256('BCoWPool.pending');
  /// @notice Transient storage of the committed order limit.
  bytes32 private constant _LIMIT_SLOT = keccak256('BCoWPool.limit');
  /// @notice Base transient slot for indexed pre-trade token balances.
  bytes32 private constant _BALANCES_SLOT = keccak256('BCoWPool.balances');

  constructor(
    address cowSolutionSettler,
    address hooksTrampoline_,
    Settings memory settings,
    // solhint-disable-next-line no-unused-vars
    string memory name,
    // solhint-disable-next-line no-unused-vars
    string memory symbol
  ) BPool(name, symbol) EIP712('Bleu CoW AMM', '1') {
    if (hooksTrampoline_ == address(0) || settings.creator == address(0) || settings.curator == address(0)) {
      revert BPool_AddressZero();
    }
    if (
      settings.orderDuration < MIN_ORDER_DURATION || settings.orderDuration > MAX_ORDER_DURATION
        || settings.curatorFeeBps >= 10_000
    ) revert InvalidSettings();
    if (settings.publicSwapFee < MIN_FEE) revert BPool_FeeBelowMinimum();
    if (settings.publicSwapFee > MAX_FEE) revert BPool_FeeAboveMaximum();
    _swapFee = settings.publicSwapFee;
    solverOrdersEnabled = settings.solverOrdersEnabled;
    SOLUTION_SETTLER = ISettlement(cowSolutionSettler);
    SOLUTION_SETTLER_DOMAIN_SEPARATOR = ISettlement(cowSolutionSettler).domainSeparator();
    VAULT_RELAYER = ISettlement(cowSolutionSettler).vaultRelayer();
    hooksTrampoline = hooksTrampoline_;
    creator = settings.creator;
    curator = settings.curator;
    orderDuration = settings.orderDuration;
    curatorFeeBps = settings.curatorFeeBps;
    feeEscrow = new BCoWFeeEscrow();
  }

  /// @inheritdoc IBPool
  /// @notice Public swaps use the fee selected at deployment, including before finalization.
  /// @dev Changing the public fee is not supported.
  function setSwapFee(
    uint256
  ) external pure override(BPool, IBPool) {
    revert PublicSwapFeeIsFixed();
  }

  /// @inheritdoc IBCoWPool
  function setSolverOrdersEnabled(
    bool enabled
  ) external _viewlock_ {
    if (msg.sender != creator) revert OnlyCreator();
    solverOrdersEnabled = enabled;
    emit SolverOrdersEnabled(enabled);
  }

  /// @inheritdoc IBCoWPool
  function commit(
    bytes32 h0,
    uint256 buyAmount
  ) external _viewlock_ _finalized_ {
    _onlyHookCaller();
    // Zero is the free mutex value and must never be accepted as a commitment.
    if (h0 == bytes32(0) || h0 == _MUTEX_TAKEN) revert OrderDoesNotMatchCommitmentHash();
    _setLock(h0);
    _storeTransient(_LIMIT_SLOT, buyAmount);
    _storeTransient(_PENDING_SLOT, 1);
    for (uint256 i; i < _tokens.length; ++i) {
      _storeTransient(bytes32(uint256(_BALANCES_SLOT) + i), IERC20(_tokens[i]).balanceOf(address(this)));
    }
  }

  /// @notice EIP-712 digest signed by the curator, scoped to this pool and chain.
  /// @param orderHash Full CoW EIP-712 order digest.
  /// @param epoch Revocable signing epoch.
  /// @return Digest to sign with the curator key.
  function curatorDigest(
    bytes32 orderHash,
    uint256 epoch
  ) public view returns (bytes32) {
    return _hashTypedDataV4(keccak256(abi.encode(CURATED_ORDER_TYPEHASH, orderHash, epoch)));
  }

  /// @notice Replaces the curator and immediately invalidates the previous signer's orders.
  /// @param newCurator Nonzero ECDSA signer replacing the current curator.
  function setCurator(
    address newCurator
  ) external _viewlock_ {
    if (msg.sender != creator) revert OnlyCreator();
    if (newCurator == address(0)) revert BPool_AddressZero();
    emit CuratorChanged(curator, newCurator);
    curator = newCurator;
  }

  /// @notice Invalidates every order signed with a smaller epoch.
  /// @param newMinEpoch Strictly greater minimum acceptable signing epoch.
  function revoke(
    uint256 newMinEpoch
  ) external _viewlock_ {
    if (msg.sender != curator) revert OnlyCurator();
    if (newMinEpoch <= minEpoch) revert InvalidEpoch();
    minEpoch = newMinEpoch;
    emit OrdersRevoked(newMinEpoch);
  }

  /// @inheritdoc IERC1271
  function isValidSignature(
    bytes32 orderHash,
    bytes memory signature
  ) external view returns (bytes4) {
    (GPv2Order.Data memory order, uint256 epoch, bytes memory curatorSig) =
      abi.decode(signature, (GPv2Order.Data, uint256, bytes));
    bytes32 appData_ = order.appData;
    order.appData = bytes32(0);
    bytes32 h0 = order.hash(SOLUTION_SETTLER_DOMAIN_SEPARATOR);
    order.appData = appData_;
    if (_getLock() != h0 || _loadTransient(_PENDING_SLOT) == 0 || order.buyAmount != _loadTransient(_LIMIT_SLOT)) {
      revert OrderDoesNotMatchCommitmentHash();
    }
    if (appData_ != appDataHash(h0, order.buyAmount)) revert AppDataDoesNotMatch();
    if (order.hash(SOLUTION_SETTLER_DOMAIN_SEPARATOR) != orderHash) revert OrderDoesNotMatchMessageHash();
    if (epoch < minEpoch) revert InvalidEpoch();
    if (curatorSig.length == 0) {
      if (
        !solverOrdersEnabled || msg.sender != address(SOLUTION_SETTLER)
          || !SOLUTION_SETTLER.authenticator().isSolver(tx.origin)
      ) revert SolverOrderNotAuthorized();
    } else if (ECDSA.recover(curatorDigest(orderHash, epoch), curatorSig) != curator) {
      revert InvalidCuratorSignature();
    }
    verify(order);
    return IERC1271.isValidSignature.selector;
  }

  /// @inheritdoc IBCoWPool
  function transferFee() external {
    _onlyHookCaller();
    if (_loadTransient(_PENDING_SLOT) == 0) revert NoPendingCommitment();
    _storeTransient(_PENDING_SLOT, 0);
    (address soldToken, address boughtToken, uint256 sold, uint256 received) = _tradeDeltas();
    uint256 limit = _loadTransient(_LIMIT_SLOT);
    if (received < limit) revert InvalidTradeDeltas();
    uint256 beforeBuy = _balanceBefore(boughtToken);
    uint256 beforeSell = _balanceBefore(soldToken);
    uint256 baseline =
      calcInGivenOut(beforeBuy, _records[boughtToken].denorm, beforeSell, _records[soldToken].denorm, sold, 0);
    if (baseline >= limit) return;
    uint256 fee = Math.mulDiv(limit - baseline, curatorFeeBps, 10_000);
    // Inverse and forward Balancer quotes round differently. Keep the same
    // forward curve guarantee as verify, including after fee rounding.
    if (
      fee == 0
        || calcOutGivenIn(
            beforeBuy, _records[boughtToken].denorm, beforeSell, _records[soldToken].denorm, limit - fee, 0
          ) < sold
    ) return;
    IERC20(boughtToken).safeTransfer(address(feeEscrow), fee);
    feeEscrow.credit(curator, boughtToken, fee);
    emit CuratorFeePaid(curator, boughtToken, fee);
  }

  /// @notice Measures a trade with exactly one outgoing and one incoming token.
  /// @return soldToken Token whose reserve decreased.
  /// @return boughtToken Token whose reserve increased.
  /// @return sold Amount removed from the outgoing reserve.
  /// @return received Amount added to the incoming reserve.
  function _tradeDeltas()
    private
    view
    returns (address soldToken, address boughtToken, uint256 sold, uint256 received)
  {
    for (uint256 i; i < _tokens.length; ++i) {
      address token = _tokens[i];
      uint256 before_ = _loadTransient(bytes32(uint256(_BALANCES_SLOT) + i));
      uint256 after_ = IERC20(token).balanceOf(address(this));
      if (after_ < before_) {
        if (soldToken != address(0)) revert InvalidTradeDeltas();
        soldToken = token;
        sold = before_ - after_;
      } else if (after_ > before_) {
        if (boughtToken != address(0)) revert InvalidTradeDeltas();
        boughtToken = token;
        received = after_ - before_;
      }
    }
    if (soldToken == address(0) || boughtToken == address(0)) revert InvalidTradeDeltas();
  }

  /// @notice Reads the committed reserve of a bound token.
  /// @param token Bound token address.
  /// @return Reserve before the committed trade.
  function _balanceBefore(
    address token
  ) private view returns (uint256) {
    return _loadTransient(bytes32(uint256(_BALANCES_SLOT) + _records[token].index));
  }

  /// @notice Restricts hook execution to the settlement and configured trampoline.
  function _onlyHookCaller() private view {
    if (msg.sender != address(SOLUTION_SETTLER) && msg.sender != hooksTrampoline) revert CommitOutsideOfSettlement();
  }

  /// @notice Writes transaction-scoped hook state.
  /// @param slot Transient storage key.
  /// @param value Value to store.
  function _storeTransient(
    bytes32 slot,
    uint256 value
  ) private {
    assembly ('memory-safe') { tstore(slot, value) }
  }

  /// @notice Reads transaction-scoped hook state.
  /// @param slot Transient storage key.
  /// @return value Stored value or zero.
  function _loadTransient(
    bytes32 slot
  ) private view returns (uint256 value) {
    assembly ('memory-safe') { value := tload(slot) }
  }

  /// @inheritdoc IBCoWPool
  function verify(
    GPv2Order.Data memory order
  ) public view virtual {
    if (order.partiallyFillable) revert PartialFillNotAllowed();
    if (address(order.buyToken) == address(order.sellToken) || order.sellAmount == 0 || order.buyAmount == 0) {
      revert InvalidTradeDeltas();
    }
    Record memory inRecord = _records[address(order.buyToken)];
    Record memory outRecord = _records[address(order.sellToken)];

    if (!inRecord.bound || !outRecord.bound) {
      revert BPool_TokenNotBound();
    }
    if (order.receiver != GPv2Order.RECEIVER_SAME_AS_OWNER) {
      revert BCoWPool_ReceiverIsNotBCoWPool();
    }
    if (order.validTo > block.timestamp + orderDuration) {
      revert BCoWPool_OrderValidityTooLong();
    }
    if (order.feeAmount != 0) {
      revert BCoWPool_FeeMustBeZero();
    }
    if (order.kind != GPv2Order.KIND_SELL) {
      revert BCoWPool_InvalidOperation();
    }
    if (order.buyTokenBalance != GPv2Order.BALANCE_ERC20 || order.sellTokenBalance != GPv2Order.BALANCE_ERC20) {
      revert BCoWPool_InvalidBalanceMarker();
    }

    uint256 buyTokenBalance = order.buyToken.balanceOf(address(this));
    if (order.buyAmount > bmul(buyTokenBalance, MAX_IN_RATIO)) {
      revert BPool_TokenAmountInAboveMaxRatio();
    }

    uint256 tokenAmountOut = calcOutGivenIn({
      tokenBalanceIn: buyTokenBalance,
      tokenWeightIn: inRecord.denorm,
      tokenBalanceOut: order.sellToken.balanceOf(address(this)),
      tokenWeightOut: outRecord.denorm,
      tokenAmountIn: order.buyAmount,
      swapFee: 0
    });

    if (tokenAmountOut < order.sellAmount) {
      revert BPool_TokenAmountOutBelowMinOut();
    }
  }

  /**
   * @inheritdoc BPool
   * @dev Grants infinite approval to the vault relayer for all tokens in the
   * pool after the finalization of the setup. Also emits COWAMMPoolCreated() event.
   */
  function _afterFinalize() internal virtual override {
    uint256 tokensLength = _tokens.length;
    for (uint256 i; i < tokensLength; i++) {
      IERC20(_tokens[i]).forceApprove(VAULT_RELAYER, type(uint256).max);
    }

    // Make the factory emit the event, to be easily indexed by off-chain agents
    // If this pool was not deployed using a bCoWFactory, this will revert and catch
    // And the event will be emitted by this contract instead
    // solhint-disable-next-line no-empty-blocks
    try IBCoWFactory(FACTORY).logBCoWPool() {}
    catch {
      emit IBCoWFactory.COWAMMPoolCreated(address(this));
    }
  }
}
