// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @title Constants
/// @notice Presents common constants.
library Constants {
    /// @notice The maximum value in BPS.
    uint256 internal constant BPS_DENOMINATOR = 10_000;
    /// @notice The maximum fee on deposit in BPS.
    uint256 internal constant BPS_MAX_DEPOSIT_FEE = 500;
    /// @notice The maximum fee in BPS.
    uint256 internal constant BPS_MAX_FEE = 250;
    /// @notice The minimum reward in BPS.
    uint256 internal constant BPS_MAX_REWARD = 250;
    /// @notice The upper boundary for maximum slippage tolerance in BPS.
    uint256 internal constant BPS_MAX_SLIPPAGE = 500;
    /// @notice The upper boundary for maximum collateral denominated in $BOLD.
    uint256 internal constant MAX_COLL_IN_BOLD_UPPER_BOUND = 1_000_000e18;
    /// @notice The price precision returned from oracle.
    uint256 internal constant ORACLE_PRICE_PRECISION = 18;
}
