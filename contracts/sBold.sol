// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.8.0;

import {ERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {BaseSBold} from "./base/BaseSBold.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SpLogic} from "./libraries/logic/SpLogic.sol";
import {SwapLogic} from "./libraries/logic/SwapLogic.sol";
import {QuoteLogic} from "./libraries/logic/QuoteLogic.sol";
import {Constants} from "./libraries/helpers/Constants.sol";
import {Decimals} from "./libraries/helpers/Decimals.sol";

/// @title sBold Protocol
/// @notice The $BOLD ERC4626 yield-bearing token.
contract sBold is ERC4626, BaseSBold {
    using Math for uint256;

    /// @notice Deploys sBold.
    /// @param _asset The address of the $BOLD instance.
    /// @param _name The name of `this` contract.
    /// @param _symbol The symbol of `this` contract.
    /// @param _sps The Stability Pools memory array.
    /// @param _priceOracle The address of the price oracle adapter.
    /// @param _vault The address of the vault for fee transfers.
    constructor(
        address _asset,
        string memory _name,
        string memory _symbol,
        SPConfig[] memory _sps,
        address _priceOracle,
        address _vault
    ) ERC4626(ERC20(_asset)) ERC20(_name, _symbol) BaseSBold(_sps, _priceOracle, _vault) {
        super.deposit(10 ** decimals(), address(this));
    }

    /*//////////////////////////////////////////////////////////////
                                 LOGIC
    //////////////////////////////////////////////////////////////*/

    /// @notice Deposits $BOLD in SP and mints corresponding $sBOLD.
    /// @param assets The amount of assets to deposit.
    /// @param receiver The address to mint the shares to.
    /// @return The amount of shares.
    function deposit(uint256 assets, address receiver) public override returns (uint256) {
        _checkCollHealth(true);

        uint256 shares = super.deposit(assets, receiver);

        uint256 fee = _calcFee(assets);
        if (fee > 0) SafeERC20.safeTransfer(IERC20(asset()), vault, fee);

        SpLogic.provideToSP(sps, assets - fee);

        return shares;
    }

    /// @notice Mints shares of $sBOLD and provides corresponding $BOLD to SP.
    /// @param shares The amount of shares to mint.
    /// @param receiver The address to send the shares to.
    /// @return The amount of assets.
    function mint(uint256 shares, address receiver) public override returns (uint256) {
        _checkCollHealth(true);

        uint256 assets = super.mint(shares, receiver);

        uint256 fee = _calcFee(assets);
        if (fee > 0) SafeERC20.safeTransfer(IERC20(asset()), vault, fee);

        SpLogic.provideToSP(sps, assets - fee);

        return assets;
    }

    /// @notice Redeems shares of $sBOLD in $BOLD and burns $sBOLD.
    /// @param shares The amount of shares to redeem.
    /// @param receiver The address to send the assets to.
    /// @param owner The owner of the shares.
    /// @return The amount of assets.
    function redeem(uint256 shares, address receiver, address owner) public override returns (uint256) {
        _checkCollHealth(true);

        uint256 maxShares = maxRedeem(owner);
        if (shares > maxShares) {
            revert ERC4626ExceededMaxRedeem(owner, shares, maxShares);
        }

        uint256 assets = previewRedeem(shares);

        SpLogic.withdrawFromSP(sps, shares, totalSupply(), decimals());

        _withdraw(_msgSender(), receiver, owner, assets, shares);

        return assets;
    }

    /// @notice Withdraws assets $BOLD from the SP and burns $sBOLD.
    /// @param assets The amount of assets to withdraw.
    /// @param receiver The address to send the shares to.
    /// @param owner The owner of the shares.
    /// @return The amount of shares.
    function withdraw(uint256 assets, address receiver, address owner) public override returns (uint256) {
        _checkCollHealth(true);

        uint256 maxAssets = maxWithdraw(owner);
        if (assets > maxAssets) {
            revert ERC4626ExceededMaxWithdraw(owner, assets, maxAssets);
        }

        uint256 shares = previewWithdraw(assets);

        SpLogic.withdrawFromSP(sps, shares, totalSupply(), decimals());

        _withdraw(_msgSender(), receiver, owner, assets, shares);

        return shares;
    }

    /// @notice Swaps collateral balances to $BOLD.
    /// @param data The swap data.
    /// @param receiver The reward receiver.
    function swap(bytes[] memory data, address receiver) public {
        if (data.length != sps.length) revert InvalidDataArray();

        IERC20 bold = IERC20(asset());

        // Claim collateral from all
        SpLogic.claimAllCollGains(sps);
        // Aggregate collateral balances
        CollBalance[] memory balances = SpLogic.getCollBalances(sps, true);
        // Execute swaps for each collateral to $BOLD
        uint256 assets = SwapLogic.swap(
            swapAdapter,
            priceOracle,
            balances,
            data,
            maxSlippage,
            address(bold),
            decimals()
        );

        (uint256 assetsNet, uint256 swapFee, uint256 reward) = SwapLogic.applyFees(assets, swapFeeBps, rewardBps);

        if (swapFee > 0) SafeERC20.safeTransfer(bold, vault, swapFee);
        if (reward > 0) SafeERC20.safeTransfer(bold, receiver, reward);

        SpLogic.provideToSP(sps, assetsNet);
    }

    /*//////////////////////////////////////////////////////////////
                                MAXIMUMS
    //////////////////////////////////////////////////////////////*/

    /// @dev Max deposit returns 0 if collateral is above max. See {IERC4626-maxDeposit}.
    function maxDeposit(address account) public view override returns (uint256) {
        if (!_checkCollHealth(false)) return 0;

        return super.maxDeposit(account);
    }

    /// @dev Max mint returns 0 if collateral is above max. See {IERC4626-maxMint}.
    function maxMint(address account) public view override returns (uint256) {
        if (!_checkCollHealth(false)) return 0;

        return super.maxMint(account);
    }

    /// @dev Max withdraw returns 0 if collateral is above max. See {IERC4626-maxWithdraw}.
    function maxWithdraw(address owner) public view override returns (uint256) {
        if (!_checkCollHealth(false)) return 0;

        return super.maxWithdraw(owner);
    }

    /// @dev Max redeem returns 0 if collateral is above max. See {IERC4626-maxRedeem}.
    function maxRedeem(address owner) public view override returns (uint256) {
        if (!_checkCollHealth(false)) return 0;

        return super.maxRedeem(owner);
    }

    /*//////////////////////////////////////////////////////////////
                               PREVIEWS
    //////////////////////////////////////////////////////////////*/

    /// @dev Preview deducting an entry fee on deposit. See {IERC4626-previewDeposit}.
    function previewDeposit(uint256 assets) public view virtual override returns (uint256) {
        uint256 fee = _calcFee(assets);

        return super.previewDeposit(assets - fee);
    }

    /// @dev Preview adding an entry fee on mint. See {IERC4626-previewMint}.
    function previewMint(uint256 shares) public view virtual override returns (uint256) {
        uint256 assets = super.previewMint(shares);

        return assets + _calcFee(assets);
    }

    /*//////////////////////////////////////////////////////////////
                               GETTERS
    //////////////////////////////////////////////////////////////*/

    /// @notice Calculates the $sBOLD:BOLD rate.
    /// @return The $sBOLD:$BOLD rate.
    function getSBoldRate() public view returns (uint256) {
        (uint256 totalBold, , ) = calcFragments();

        return (totalBold + 1).mulDiv(10 ** decimals(), totalSupply() + 10 ** _decimalsOffset());
    }

    /// @notice Calculates the total value in $BOLD of the assets in the contract.
    /// @return The total value in USD, $BOLD amount and collateral in USD.
    function calcFragments() public view returns (uint256, uint256, uint256) {
        address bold = asset();
        // Get compounded $BOLD amount
        uint256 boldAmount = SpLogic.getBoldAssets(sps, IERC20(bold));
        // Get collateral value in USD and $BOLD
        (uint256 collValue, uint256 collInBold) = _calcCollValue(bold);
        // Calculate based on the minimum amount to be received after swap
        uint256 collToBoldMinOut = SwapLogic.calcMinOut(collInBold, maxSlippage);
        // Apply fees after swap
        (uint256 collInBoldNet, , ) = SwapLogic.applyFees(collToBoldMinOut, swapFeeBps, rewardBps);
        // Calculate total $BOLD value
        uint256 totalBold = boldAmount + collInBoldNet;
        // Use collateral in $BOLD if its value is lower than the `maxCollInBold`.
        // `maxCollInBold` is the amount up to which we disregard collateral accumulation
        // and effectively it should be removed from the total value calculation representing a uPnL.
        // `maxCollInBold` should be around the breakeven for the swap caller.
        uint256 _maxCollInBold = maxCollInBold > collInBold ? collInBold : maxCollInBold;

        return (totalBold - _maxCollInBold, boldAmount, collValue);
    }

    /// @notice Converts the $BOLD assets to shares based on $sBOLD exchange rate.
    /// @return The calculated $sBOLD share, based on the total value held.
    function _convertToShares(uint256 assets, Math.Rounding rounding) internal view override returns (uint256) {
        return assets.mulDiv(10 ** decimals(), getSBoldRate(), rounding);
    }

    /// @notice Converts the $sBOLD shares to $BOLD assets based on $sBOLD exchange rate.
    /// @return The calculated $BOLD assets, based on the total value held.
    function _convertToAssets(uint256 shares, Math.Rounding rounding) internal view override returns (uint256) {
        return shares.mulDiv(getSBoldRate(), 10 ** decimals(), rounding);
    }

    /// @notice Calculates the collateral value in USD and $BOLD from all SPs.
    /// @return The total value collateral value and the collateral denominated in $BOLD.
    function _calcCollValue(address _bold) private view returns (uint256, uint256) {
        CollBalance[] memory collBalances = SpLogic.getCollBalances(sps, false);

        uint256 collValue = QuoteLogic.getAggregatedQuote(priceOracle, collBalances);
        uint256 boldUnitQuote = priceOracle.getQuote(10 ** decimals(), _bold);
        uint256 collInBold = boldUnitQuote.mulDiv(collValue, 10 ** Constants.ORACLE_PRICE_PRECISION);

        return (collValue, Decimals.scale(collInBold, decimals()));
    }

    /// @dev Calculates the fees that should be added to an amount `assets` that does not already include fees.
    /// Used in {IERC4626-deposit} and {IERC4626-mint} operations.
    function _calcFee(uint256 assets) private view returns (uint256) {
        return assets.mulDiv(feeBps, Constants.BPS_DENOMINATOR, Math.Rounding.Ceil);
    }

    /*//////////////////////////////////////////////////////////////
                               VALIDATIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Checks if the collateral value in USD is over the maximum allowed.
    function _checkCollHealth(bool _revert) private view returns (bool) {
        (, uint256 collValueInBold) = _calcCollValue(asset());

        if (collValueInBold <= maxCollInBold) return true;

        if (_revert) revert CollOverLimit();

        return false;
    }
}
