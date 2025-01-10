// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IStabilityPool} from "../../external/IStabilityPool.sol";
import {ISBold} from "../../interfaces/ISBold.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Constants} from "../../libraries/helpers/Constants.sol";

/// @title SpLogic
/// @notice Manages liquidity in Stability Pools.
library SpLogic {
    using Math for uint256;

    /// @notice Provides $BOLD to SPs, based on the weight of each pool.
    /// @param sps The SPs to provide $BOLD to.
    /// @param assets The $BOLD amount.
    function provideToSP(ISBold.SP[] memory sps, uint256 assets) internal {
        for (uint256 i = 0; i < sps.length; i++) {
            ISBold.SP memory sp = sps[i];
            // Calculate amount for SP, based on the specified weight
            uint256 amount = assets.mulDiv(sp.weight, Constants.BPS_DENOMINATOR);
            // Provide amount to SP (accumulated gains are not transferred).
            IStabilityPool(sp.sp).provideToSP(amount, false);
        }
    }

    /// @notice Withdraws $BOLD from SPs.
    /// @param sps The SPs to withdraw $BOLD from.
    /// @param shares The $sBOLD shares.
    /// @param totalSupply The total supply of $sBOLD.
    /// @param decimals The $sBOLD decimals.
    /// @param shouldProvide Should the withdraw provide leftover assets to current pools
    function withdrawFromSP(
        ISBold.SP[] memory sps,
        uint256 shares,
        uint256 totalSupply,
        uint256 decimals,
        bool shouldProvide
    ) internal {
        // Get the portion of all shares
        uint256 portion = shares.mulDiv(10 ** decimals, totalSupply);
        uint256 accumulatedYield;

        for (uint256 i = 0; i < sps.length; i++) {
            // Get $BOLD compounded deposits from each SP
            IStabilityPool sp = IStabilityPool(sps[i].sp);
            // Accounted yield gains from deposits
            uint256 compoundedBold = sp.getCompoundedBoldDeposit(address(this));
            // Calculate the pro-rata amount
            uint256 amountProRataOnCompounded = compoundedBold.mulDiv(portion, 10 ** decimals, Math.Rounding.Ceil);

            if (amountProRataOnCompounded == 0) continue;

            // Pending yield gains from deposits
            uint256 pendingYield = sp.getDepositorYieldGainWithPending(address(this));

            // Withdraw amount from SP (accumulated gains are transferred).
            sp.withdrawFromSP(amountProRataOnCompounded, true);

            // Calculate the pro-rata amount on the collected yield.
            uint256 amountProRataOnYield = pendingYield.mulDiv(portion, 10 ** decimals, Math.Rounding.Ceil);

            // Add to the accumulated asset amount by subtracting the pro-rata of the yield.
            accumulatedYield += pendingYield - amountProRataOnYield;
        }

        // Provide the accumulated asset amount back to SPs.
        if (shouldProvide) provideToSP(sps, accumulatedYield);
    }

    /// @notice Aggregates $BOLD assets from each pool and returns the total holdings.
    /// @param sps The SPs to get $BOLD from.
    /// @param bold The $BOLD address.
    /// @return amount The aggregated compounded $BOLD deposits.
    function getBoldAssets(ISBold.SP[] memory sps, IERC20 bold) internal view returns (uint256 amount) {
        for (uint256 i = 0; i < sps.length; i++) {
            // Add $BOLD compounded deposits from each SP
            amount += _getBoldAssetsSP(sps[i].sp);
        }
        // Add $BOLD internal balance
        amount += bold.balanceOf(address(this));
    }

    /// @notice Aggregates collateral assets from each pool and returns an array with collateral assets structures.
    /// @param sps The SPs to get collateral from.
    /// @param onlyInternal The flag used to aggregate only internal balances.
    /// @return collBalances The aggregated collateral structs containing address and balance.
    function getCollBalances(
        ISBold.SP[] memory sps,
        bool onlyInternal
    ) internal view returns (ISBold.CollBalance[] memory collBalances) {
        collBalances = new ISBold.CollBalance[](sps.length);

        for (uint256 i = 0; i < sps.length; i++) {
            collBalances[i] = _getCollBalanceSP(sps[i], onlyInternal);
        }
    }

    /// @notice Returns $BOLD assets from SP.
    /// @param _sp The SP address.
    /// @return The aggregated compounded $BOLD deposit from SP.
    function _getBoldAssetsSP(address _sp) private view returns (uint256) {
        IStabilityPool sp = IStabilityPool(_sp);
        // Accounted yield gains from deposits
        uint256 compoundedBold = sp.getCompoundedBoldDeposit(address(this));
        // Pending yield gains from deposits
        uint256 pendingYield = sp.getDepositorYieldGainWithPending(address(this));

        return compoundedBold + pendingYield;
    }

    /// @notice Returns collateral assets structure from SP.
    /// @param _sp The SP address.
    /// @param _onlyInternal The flag used to aggregate only internal balances.
    /// @return collBalance The collateral struct containing address and balance from SP.
    function _getCollBalanceSP(
        ISBold.SP memory _sp,
        bool _onlyInternal
    ) internal view returns (ISBold.CollBalance memory) {
        // Get collateral balance in contract
        uint256 collInternal = IERC20(_sp.coll).balanceOf(address(this));
        // Return only internal collateral holdings
        if (_onlyInternal) return ISBold.CollBalance({addr: _sp.coll, balance: collInternal});
        // Get collateral accumulated amounts
        uint256 collAccumulatedGains = IStabilityPool(_sp.sp).getDepositorCollGain(address(this));
        // Get collateral accumulated stashed amounts
        uint256 collAccumulatedStashedGains = IStabilityPool(_sp.sp).stashedColl(address(this));
        // Calculate total amount
        uint256 totalBalance = collAccumulatedGains + collAccumulatedStashedGains + collInternal;

        return ISBold.CollBalance({addr: _sp.coll, balance: totalBalance});
    }
}
