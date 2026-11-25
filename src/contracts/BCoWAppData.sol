// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.25;

/// F(h0, buyAmount) with constant parts as literals and SWAR hex for the two words.
/// @notice Builds the exact appData document uploaded by curator tooling.
abstract contract BCoWAppData {
  /// @notice First 32 lowercase hex characters of this pool address.
  bytes32 private immutable _POOL_HEX_HI;
  /// @notice Last eight lowercase hex characters of this pool address.
  bytes8 private immutable _POOL_HEX_LO;

  constructor() {
    bytes20 a = bytes20(address(this));
    _POOL_HEX_HI = _toHex16(bytes16(a));
    _POOL_HEX_LO = bytes8(_toHex16(bytes16(a << 128)));
  }

  /// @notice Builds the no-whitespace canonical CoW appData document.
  /// @param h0 CoW order digest with appData set to zero.
  /// @param buyAmount Committed order limit.
  /// @return Canonical UTF-8 JSON bytes.
  function appData(
    bytes32 h0,
    uint256 buyAmount
  ) public view returns (bytes memory) {
    return abi.encodePacked(
      '{"version":"1.6.0","appCode":"Bleu CoW AMM","metadata":{"hooks":{"pre":[{"target":"0x',
      _POOL_HEX_HI,
      _POOL_HEX_LO,
      '","callData":"0xe900ead8', // commit(bytes32,uint256)
      _toHex16(bytes16(h0)),
      _toHex16(bytes16(h0 << 128)),
      _toHex16(bytes16(bytes32(buyAmount))),
      _toHex16(bytes16(bytes32(buyAmount) << 128)),
      '","gasLimit":"100000"}],"post":[{"target":"0x',
      _POOL_HEX_HI,
      _POOL_HEX_LO,
      '","callData":"0xacb2ad6f","gasLimit":"150000"}]}}}' // transferFee()
    );
  }

  /// @notice Hash of the canonical no-whitespace appData document.
  /// @param h0 CoW order digest with appData set to zero.
  /// @param buyAmount Committed order limit.
  /// @return Hash required in the order appData field.
  function appDataHash(
    bytes32 h0,
    uint256 buyAmount
  ) public view returns (bytes32) {
    return keccak256(appData(h0, buyAmount));
  }

  /// @notice Converts 16 bytes into 32 lowercase hex characters, without branches.
  /// @param data Bytes to convert.
  /// @return r Lowercase hex characters, without a prefix.
  function _toHex16(
    bytes16 data
  ) internal pure returns (bytes32 r) {
    r = bytes32(data) & 0xFFFFFFFFFFFFFFFF000000000000000000000000000000000000000000000000
      | (bytes32(data) & 0x0000000000000000FFFFFFFFFFFFFFFF00000000000000000000000000000000) >> 64;
    r = r & 0xFFFFFFFF000000000000000000000000FFFFFFFF000000000000000000000000
      | (r & 0x00000000FFFFFFFF000000000000000000000000FFFFFFFF0000000000000000) >> 32;
    r = r & 0xFFFF000000000000FFFF000000000000FFFF000000000000FFFF000000000000
      | (r & 0x0000FFFF000000000000FFFF000000000000FFFF000000000000FFFF00000000) >> 16;
    r = r & 0xFF000000FF000000FF000000FF000000FF000000FF000000FF000000FF000000
      | (r & 0x00FF000000FF000000FF000000FF000000FF000000FF000000FF000000FF0000) >> 8;
    r = (r & 0xF000F000F000F000F000F000F000F000F000F000F000F000F000F000F000F000) >> 4
      | (r & 0x0F000F000F000F000F000F000F000F000F000F000F000F000F000F000F000F00) >> 8;
    r = bytes32(
      0x3030303030303030303030303030303030303030303030303030303030303030 + uint256(r)
        + ((uint256(r) + 0x0606060606060606060606060606060606060606060606060606060606060606) >> 4
            & 0x0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F) * 39
    );
  }
}
