// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.25;

/**
 * @title BCoWConst
 * @notice Constants used in the scope of the BCoWPool contract.
 */
contract BCoWConst {
  /// @notice Minimum lifetime setting; allow additional order-book latency at deployment.
  uint32 public constant MIN_ORDER_DURATION = 60 seconds;

  /// @notice Largest future validity allowed for any AMM order, in seconds.
  uint32 public constant MAX_ORDER_DURATION = 5 minutes;
}
