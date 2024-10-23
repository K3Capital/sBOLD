// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ISBold} from "../../interfaces/ISBold.sol";
import {IPriceOracle} from "../../interfaces/IPriceOracle.sol";
import {Constants} from "../../libraries/helpers/Constants.sol";
import {Decimals} from "../../libraries/helpers/Decimals.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {QuoteLogic} from "./QuoteLogic.sol";

/// @title SwapLogic
/// @notice Logic for swap execution.
library SwapLogic {
    using Math for uint256;

    /// @notice Swaps each SP collateral for $BOLD and returns total swapped amount.
    /// @param adapter The adapter to use to execute swap
    /// @param priceOracle The price oracle to use for getting the quote.
    /// @param balances An array of balances representing the collateral balance structs.
    /// @param swapData The swap data.
    /// @param maxSlippage The minimum amount to receive after the swap.
    /// @param dst The unit in which the `src` is swapped.
    /// @return amount The quote amount with subtracted fees.
    function swap(
        address adapter,
        IPriceOracle priceOracle,
        ISBold.CollBalance[] memory balances,
        bytes[] memory swapData,
        uint256 maxSlippage,
        address dst,
        uint8 dstDecimals
    ) internal returns (uint256 amount) {
        // Execute swap for each Coll
        for (uint256 i = 0; i < balances.length; i++) {
            // Return if balance is not present
            if (balances[i].balance == 0) continue;
            // Get collateral in $BOLD
            uint256 collInBold = QuoteLogic.getInBoldQuote(
                priceOracle,
                dst,
                balances[i].addr,
                balances[i].balance,
                dstDecimals
            );
            // Calculate minimum amount out in $BOLD
            uint256 minOut = calcMinOut(Decimals.scale(collInBold, dstDecimals), maxSlippage);
            // Swap `src` for `bold`
            uint256 amountOut = _execute(adapter, balances[i].addr, dst, balances[i].balance, minOut, swapData[i]);
            // Aggregate total amount of $BOLD received after swap
            amount += amountOut;
            // Emit on each swap
            emit ISBold.Swap(adapter, balances[i].addr, dst, balances[i].balance, amountOut, minOut);
        }
    }

    /// @notice Calculates minimum amount to be returned, based on the maximum slippage set.
    /// @param amount The amount to be swapped.
    /// @param maxSlippage The maximum slippage tolerance on swap in basis points.
    /// @return amount The amount returned by swap adapter after fees.
    function calcMinOut(uint256 amount, uint256 maxSlippage) internal pure returns (uint256) {
        return amount - amount.mulDiv(maxSlippage, Constants.BPS_DENOMINATOR);
    }

    /// @notice Deducts swap fee in BPS and reward for `caller` in BPS.
    /// @param amountOut The amount returned by swap adapter before fees.
    /// @param swapFeeBps The fee applied over the swap in basis points.
    /// @param rewardBps The reward for the `caller` applied over the swap in basis points.
    function applyFees(
        uint256 amountOut,
        uint256 swapFeeBps,
        uint256 rewardBps
    ) internal pure returns (uint256, uint256, uint256) {
        uint256 fee = amountOut.mulDiv(swapFeeBps, Constants.BPS_DENOMINATOR);
        uint256 reward = amountOut.mulDiv(rewardBps, Constants.BPS_DENOMINATOR);
        return (amountOut - fee - reward, fee, reward);
    }

    /// @notice Executes `call()` to swap `inAmount` of `src` token to `dst`.
    /// @param _src The unit that is swapped.
    /// @param _dst The unit in which the `src` is swapped.
    /// @param _inAmount The amount of `base` to be swapped.
    /// @param _minOut The minimum amount to receive after the swap.
    /// @param _swapData The swap data for 1inch router.
    function _execute(
        address _adapter,
        address _src,
        address _dst,
        uint256 _inAmount,
        uint256 _minOut,
        bytes memory _swapData
    ) private returns (uint256) {
        IERC20 dst = IERC20(_dst);
        // Get balance before the swap
        uint256 balance0 = dst.balanceOf(address(this));
        // Approve `_inAmount` for `adapter`
        IERC20(_src).approve(_adapter, _inAmount);
        // Execute swap
        (bool success, ) = _adapter.call(_swapData);
        // Revert on failed swap
        if (!success) revert ISBold.ExecutionFailed();
        // Get balance after the swap
        uint256 balance1 = dst.balanceOf(address(this));
        // Get the amount received
        uint256 amountOut = balance1 - balance0;
        // Check if the amount received is equal or higher to the minimum
        if (amountOut < _minOut) revert ISBold.InsufficientAmount(amountOut);
        // Return decoded data
        return amountOut;
    }
}
