/// @title MockStEth
/// @notice A mock of StEth for testing WstEthOracle.
contract MockStEth {
    uint256 private _pooledEth;

    function setPooledEthByShares(uint256 pooledEth_) external {
        _pooledEth = pooledEth_;
    }

    function getPooledEthByShares(uint256) external view returns (uint256) {
        return _pooledEth;
    }
}
