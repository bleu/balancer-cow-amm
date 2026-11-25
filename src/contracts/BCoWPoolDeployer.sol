// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity 0.8.25;

import {BCoWPool} from './BCoWPool.sol';

/// @notice Stores a creation-code fragment as non-executable contract data.
contract BCoWCreationCode {
  constructor(
    bytes memory code
  ) {
    assembly ('memory-safe') { return(add(code, 32), mload(code)) }
  }
}

/// @notice Immutable deployment module keeping pool initcode outside factory runtime.
/// @dev Delegatecalled by its creating factory so CREATE retains the factory as
/// pool deployer, controller and registry address. Code fragments start with STOP
/// and remain below EIP-170; combined pool initcode remains below EIP-3860.
contract BCoWPoolDeployer {
  /// @notice Factory whose context is authorized to create pools.
  address public immutable FACTORY;
  /// @notice First immutable pool creation-code fragment.
  address private immutable _CODE_FIRST;
  /// @notice Second immutable pool creation-code fragment.
  address private immutable _CODE_SECOND;

  /// @notice Module execution must use its creating factory's context.
  error OnlyFactoryContext();

  constructor() {
    FACTORY = msg.sender;
    bytes memory code = type(BCoWPool).creationCode;
    uint256 firstLength = code.length / 2;
    _CODE_FIRST = _store(code, 0, firstLength);
    _CODE_SECOND = _store(code, firstLength, code.length - firstLength);
  }

  /// @notice Creates a pool in the calling factory context.
  /// @param args ABI-encoded BCoWPool constructor arguments.
  /// @return pool Address of the newly deployed pool.
  function deploy(
    bytes memory args
  ) external returns (address pool) {
    if (address(this) != FACTORY) revert OnlyFactoryContext();
    address first = _CODE_FIRST;
    address second = _CODE_SECOND;
    bytes memory code = new bytes(first.code.length + second.code.length - 2);
    assembly ('memory-safe') {
      let firstLength := sub(extcodesize(first), 1)
      extcodecopy(first, add(code, 32), 1, firstLength)
      extcodecopy(second, add(add(code, 32), firstLength), 1, sub(extcodesize(second), 1))
    }
    code = bytes.concat(code, args);
    assembly ('memory-safe') {
      pool := create(0, add(code, 32), mload(code))
      if iszero(pool) {
        let ptr := mload(0x40)
        returndatacopy(ptr, 0, returndatasize())
        revert(ptr, returndatasize())
      }
    }
  }

  /// @notice Deploys a STOP-prefixed immutable fragment of creation code.
  /// @param code Full pool creation code.
  /// @param start Offset of the fragment.
  /// @param length Number of bytes to store.
  /// @return Address holding the fragment behind one STOP byte.
  function _store(
    bytes memory code,
    uint256 start,
    uint256 length
  ) private returns (address) {
    bytes memory fragment = new bytes(length + 1);
    assembly ('memory-safe') { mcopy(add(fragment, 33), add(add(code, 32), start), length) }
    return address(new BCoWCreationCode(fragment));
  }
}
