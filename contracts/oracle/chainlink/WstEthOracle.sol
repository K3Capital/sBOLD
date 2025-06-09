// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IStEth} from "../../interfaces/IStEth.sol";
import {Common} from "../../libraries/Common.sol";
import {BaseChainlinkOracle} from "./BaseChainlinkOracle.sol";
import {Constants} from "../../libraries/helpers/Constants.sol";

/// @title WstEthOracle
/// @notice PriceOracle adapter that derives WstETH/USD prices by combining a Chainlink STETH/USD feed with the canonical WstETH/STETH conversion rate.
contract WstEthOracle is BaseChainlinkOracle {
    /// @notice The max staleness mapped to feed address.
    mapping(address => uint256) public feedToMaxStaleness;
    /// @dev Used for correcting for the decimals of base and quote.
    uint8 public constant QUOTE_DECIMALS = 18;
    /// @notice Name of the oracle.
    string public constant name = "WstEthOracle V1";
    /// @notice The STETH instance.
    IStEth public constant stEth = IStEth(0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84);
    /// @notice The address of the token to USD.
    Feed public feed;

    /// @notice Deploys a WstEthOracle price oracle.
    /// @param _base The address of the base asset.
    /// @param _feed The structure for the STETH to USD feed.
    constructor(address _base, Feed memory _feed) {
        Common.revertZeroAddress(_base);
        Common.revertZeroAddress(_feed.addr);

        if (_feed.maxStaleness < MAX_STALENESS_LOWER_BOUND || _feed.maxStaleness > MAX_STALENESS_UPPER_BOUND) {
            revert InvalidMaxStaleness();
        }

        base = _base;
        feed = _feed;
    }

    /// @inheritdoc BaseChainlinkOracle
    function getQuote(uint256 inAmount, address _base) external view override returns (uint256) {
        if (!isBaseSupported(_base)) revert InvalidFeed();
        // Get STETH/USD price
        uint256 stEthInUsd = _getLatestAnswer(feed);
        // Get WSTETH/STETH price
        uint256 wstEthToStEthPrice = stEth.getPooledEthByShares(10 ** Constants.ORACLE_PRICE_PRECISION);

        if (wstEthToStEthPrice == 0) revert InvalidPrice();

        // Calculate WSTETH/USD price
        uint256 price = (stEthInUsd * wstEthToStEthPrice) / 10 ** Constants.ORACLE_PRICE_PRECISION;

        return (inAmount * price) / 10 ** Constants.ORACLE_PRICE_PRECISION;
    }

    /// @inheritdoc BaseChainlinkOracle
    function isBaseSupported(address _base) public view override returns (bool) {
        return base == _base;
    }
}
