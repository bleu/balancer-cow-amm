// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

/// @notice Deployment parameters
abstract contract Params {
  struct BFactoryDeploymentParams {
    address bDao;
  }

  struct BCoWFactoryDeploymentParams {
    address settlement;
    address hooksTrampoline;
    address bDaoMsig;
  }

  /// @notice Settlement address
  address internal constant _GPV2_SETTLEMENT = 0x9008D19f58AAbD9eD0D60971565AA8510560ab41;
  /// @notice Balancer DAO address (has controller permission to collect fees from BFactory pools)
  address internal constant _B_DAO = 0xce88686553686DA562CE7Cea497CE749DA109f9F;
  /// @notice Balancer DAO multisig address on Arbitrum. Pausing and unpausing the BCoWFactory contract is controlled by this address.
  /// chainId == 42_161
  address internal constant _B_DAO_MSIG = 0xaF23DC5983230E9eEAf93280e312e57539D098D0;
  /// @notice Balancer DAO multisig address on Mainnet. Pausing and unpausing the BCoWFactory contract is controlled by this address.
  /// chainId == 1
  address internal constant _B_DAO_MSIG_MAINNET = 0x3e7d1eab13ad0104D2750B8863b489dc9DfB6b8D;
  /// @notice Balancer DAO multisig address on Gnosis Chain. Pausing and unpausing the BCoWFactory contract is controlled by this address.
  /// chainId == 100
  address internal constant _B_DAO_MSIG_GNOSIS = 0xd6110A7756080a4e3BCF4e7EBBCA8E8aDFBC9962;
  /// @notice Juani(Balancer Labs) EOA. Pausing and unpausing the BCoWFactory contract is controlled by this address.
  /// chainId == 11_155_111
  address internal constant _SEPOLIA_JUANI_EOA = 0x9098b50ee2d9E4c3C69928A691DA3b192b4C9673;
  /// @notice Balancer DAO multisig address on Gnosis Chain. Pausing and unpausing the BCoWFactory contract is controlled by this address.
  /// chainId == 8453
  address internal constant _B_DAO_MSIG_BASE = 0xC40DCFB13651e64C8551007aa57F9260827B6462;

  /// @notice BFactory deployment parameters
  BFactoryDeploymentParams internal _bFactoryDeploymentParams;

  /// @notice BCoWFactory deployment parameters
  BCoWFactoryDeploymentParams internal _bCoWFactoryDeploymentParams;

  constructor(
    uint256 chainId
  ) {
    if (chainId == 1) {
      // Ethereum Mainnet
      _bFactoryDeploymentParams = BFactoryDeploymentParams({bDao: _B_DAO});
      _bCoWFactoryDeploymentParams = BCoWFactoryDeploymentParams({
        settlement: _GPV2_SETTLEMENT,
        hooksTrampoline: chainId == 100
          ? 0x01DcB88678aedD0C4cC9552B20F4718550250574
          : 0x60Bf78233f48eC42eE3F101b9a05eC7878728006,
        bDaoMsig: _B_DAO_MSIG_MAINNET
      });
    } else if (chainId == 100) {
      // Gnosis Chain
      _bFactoryDeploymentParams = BFactoryDeploymentParams({bDao: _B_DAO});
      _bCoWFactoryDeploymentParams = BCoWFactoryDeploymentParams({
        settlement: _GPV2_SETTLEMENT,
        hooksTrampoline: chainId == 100
          ? 0x01DcB88678aedD0C4cC9552B20F4718550250574
          : 0x60Bf78233f48eC42eE3F101b9a05eC7878728006,
        bDaoMsig: _B_DAO_MSIG_GNOSIS
      });
    } else if (chainId == 11_155_111) {
      // Sepolia
      _bFactoryDeploymentParams = BFactoryDeploymentParams({bDao: _B_DAO});
      _bCoWFactoryDeploymentParams = BCoWFactoryDeploymentParams({
        settlement: _GPV2_SETTLEMENT,
        hooksTrampoline: chainId == 100
          ? 0x01DcB88678aedD0C4cC9552B20F4718550250574
          : 0x60Bf78233f48eC42eE3F101b9a05eC7878728006,
        bDaoMsig: _SEPOLIA_JUANI_EOA
      });
    } else if (chainId == 42_161) {
      // Arbitrum
      _bFactoryDeploymentParams = BFactoryDeploymentParams({bDao: _B_DAO});
      _bCoWFactoryDeploymentParams = BCoWFactoryDeploymentParams({
        settlement: _GPV2_SETTLEMENT,
        hooksTrampoline: chainId == 100
          ? 0x01DcB88678aedD0C4cC9552B20F4718550250574
          : 0x60Bf78233f48eC42eE3F101b9a05eC7878728006,
        bDaoMsig: _B_DAO_MSIG_MAINNET
      });
    } else if (chainId == 8453) {
      // Base
      _bFactoryDeploymentParams = BFactoryDeploymentParams({bDao: _B_DAO});
      _bCoWFactoryDeploymentParams = BCoWFactoryDeploymentParams({
        settlement: _GPV2_SETTLEMENT,
        hooksTrampoline: chainId == 100
          ? 0x01DcB88678aedD0C4cC9552B20F4718550250574
          : 0x60Bf78233f48eC42eE3F101b9a05eC7878728006,
        bDaoMsig: _B_DAO_MSIG_BASE
      });
    } else {
      revert('Params: unknown chain ID');
    }
  }
}
