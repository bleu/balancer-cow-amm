// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.25;

import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';

/// @notice Pool-specific custody of earned curator fees, independent of pool reserves.
contract BCoWFeeEscrow {
  using SafeERC20 for IERC20;

  /// @notice The only pool allowed to credit already-transferred fees.
  // solhint-disable-next-line style-guide-casing
  address public immutable pool;
  /// @notice Earned fees by curator and token.
  mapping(address curator => mapping(address token => uint256 amount)) public claimable;

  /// @notice Fees withdrawn by their beneficiary.
  /// @param curator Beneficiary withdrawing fees.
  /// @param token Fee token.
  /// @param recipient Destination chosen by the beneficiary.
  /// @param amount Amount withdrawn.
  event Withdrawn(address indexed curator, address indexed token, address indexed recipient, uint256 amount);

  /// @notice Only the deploying pool may credit fees.
  error OnlyPool();
  /// @notice Withdrawal recipient must not be zero.
  error InvalidRecipient();

  constructor() {
    pool = msg.sender;
  }

  /// @notice Records fees already transferred by the deploying pool.
  /// @param curator Beneficiary of the fees.
  /// @param token Fee token.
  /// @param amount Amount already transferred to escrow.
  function credit(
    address curator,
    address token,
    uint256 amount
  ) external {
    if (msg.sender != pool) revert OnlyPool();
    claimable[curator][token] += amount;
  }

  /// @notice Withdraws the caller's fees to a chosen recipient.
  /// @param token Fee token to withdraw.
  /// @param recipient Nonzero destination for the full claim.
  function withdraw(
    address token,
    address recipient
  ) external {
    if (recipient == address(0)) revert InvalidRecipient();
    uint256 amount = claimable[msg.sender][token];
    claimable[msg.sender][token] = 0;
    IERC20(token).safeTransfer(recipient, amount);
    emit Withdrawn(msg.sender, token, recipient, amount);
  }
}
