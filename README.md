## Introducing sBOLD

sBOLD is a yield-bearing tokenized representation of a deposit into Liquity’s v2 Stability Pools based on a weights set on deploymnet. The protocol will initially accept BOLD deposits and route them into the wstETH, rETH and wETH stability pools in fixed proportions (60%, 30% and 10%, respectively). In return, the depositor receives an ERC4626 token that could be integrated with third-party protocols like money markets, decentralized exchanges and yield trading platforms for improved capital efficiency. 

sBOLD possesses a rebalancing feature, by which the weights and the Stability Pools can be changed and the funds are provided with the new ratios to the respective Stability Pools set. The operation is only permitted to be executed by the vault administrator and only if the collateral left in the contract is less than maximum collateral in BOLD previously set.

The yield-bearing component of sBOLD stems from two streams. 

First, it captures the pro-rata distributions of the interest rate paid by the borrowers to the Stability Pools. A hodler of 1 sBOLD receives the equivalent of the interest paid to 60 cents deposited into the wstETH Stability Pool plus 30 cents deposited into the rETH Stability Pool and 10 cents into the wETH Stability Pool.

Second, the sBOLD holders capture the liquidation penalty with minimum collateral price exposure. Theoretically, Stability Pool depositors acquire liquidated collateral at a discount. However, the penalty is not realized until the collateral is sold for the underlying asset, BOLD. sBOLD automates the process on behalf of the users by incentivising solvers triggering withdrawal and swap transactions of accumulated collaterals, effectively realizing the penalty as quickly as possible. The architecture does not only remove the price exposure to Stability Pool depositors, but also facilitates better third-party integrations due to the lack of multiple underlying assets backing sBOLD.

## Technical Overview

The architecture of sBOLD Protocol is built around the prevalent and industry-compatible ERC4626 standard, which serves as the entry-point between external accounts and the core underlying mechanisms.

sBOLD provides a capital-efficient way for liquidity provision across multiple stability pools, part of the new Liquity v2 protocol infrastructure. Each connected stability pool is provided BOLD, based on pre-configured weights in basis points. 

<img width="971" alt="sBOLD-overview" src="https://github.com/user-attachments/assets/8da12fe7-c42a-4828-a568-ca314c42ffe0">

### ERC-20

The underlying asset is the ERC-20 token, in the face of the BOLD token that will be held by the vault.

### sBOLD

sBOLD is the primary entry-point contract and implements the logic that is common to all vaults, such as tracking, validating the boundaries for positions, previewing deposit and withdrawal quantities, and applying fees. 

The primary component also includes extra logic for the communication with the stability pools connected, and swapping the accumulated collateral gains to the primary BOLD token. 

For code organization purposes, some of its logic is delegated to static (non-upgradeable) modules.

### Price Oracle

PriceOracle components interface with external pricing systems to calculate the quote for the BOLD and collateral tokens in USD in real time.

### Swap Adapter

SwapAdapter contract represents an external or internal contract call to which a data for swap is delegated to execute a transaction in which the sBOLD contract should receive a minimum quantity of BOLD in exchange for accumulated collateral from liquidations based on the real time quotes received.

## Accounting

sBold contract is standard-conforming ERC-4626 vault with additional functionality to integrate aggregation of the tokens in the stability pools owned by the accounts and effectively swapping the collateral tokens to the primary BOLD token. The vault accounts only one type of token: the vault's underlying asset (simply called asset in the code) and calculates in real time the quote for collateral across each pool in BOLD. Because ERC-4626 is a superset of ERC-20, vaults are also tokens, called vault shares or sBOLD. These shares represent a proportional claim on the vault's assets, and are exchangeable for larger quantities of the underlying asset over time as interest is accrued in BOLD and collateral from liquidations is accumulated. As recommended by ERC-4626, shares have the same number of decimals as their underlying asset's token.

### Exchange Rate

The exchange rate in the sBOLD protocol is calculated as a product of the division between the total value in BOLD, held by the contract in each stability pool, with accumulated interest added with denominations to the primary BOLD token, and the total supply of sBOLD vault shares.

As such, assuming no bad debt from unsuccessful liquidations, sBOLD will act as a compounding token similar to wstETH.

The denomination of the accumulated collateral to BOLD is calculated based on the minimum, which will be received after the swap, with a reward and fee deducted from the received quantity.

The main deposit and withdraw operations in sBold are enabled if the accumulated collateral is less or equal to the maximum amount in collateral value set by the administrator. This limit should exist in the vault to create a net delta positive for the caller of the swap and effectively incentivise third-party actors to rebalance and should be subtracted from the total amount in BOLD for the vault to account only realised gains.

### Rounding

The quantity of assets that can be redeemed for a given number of shares is always rounded down, and the number of shares required to withdraw a given quantity of assets is rounded up. This ensures that depositors cannot withdraw more than they have deposited plus interest and liquidation premium accrued. These two behaviours ensure that all impact of rounding happens in favour of the vault and of disadvantage of the depositor in order to ensure solvency of the system.

### Fee

sBOLD may apply an entry fee on deposit and respective mint transactions. The entry fee is a configurable parameter and initially set to 0, but can be increased up to specific quantity stored in basis points and is transferred to a fee receiver configured in the sBOLD contract.

If introduced, on deposit the fee is deducted from the quantity of the assets supplied to Liquity v2’s Stability Pools, resulting in minting fewer shares, compared to the mechanism on mint, where the exact requested quantity is minted.

The fee is calculated in the previewDeposit and the previewMint functions but is not accounted for in case the sBOLD’s total supply is equal to zero.

## Interactions

sBOLD protocol as a standard-conforming ERC4626 vault implements the fundamental deposit, mint, withdraw, and redeem functionalities. These main methods operate around the product of the exchange rate specification, simply summarized, the rate is calculated based on the total BOLD holdings and the total supply of sBOLD.

The deposit and withdrawal operations are only enabled in a condition where the total collateral value denominated to BOLD is at maximum equal to the configured limit in the contract storage (simply called BC_U_max, from the B1 formula).  

Before executing any core operation the protocol checks the current exposure to accumulated collateral assets. This check ensures the system remains within defined operational limits, especially following periods of high liquidation activity.

The protocol calculates the total value of collateral accumulated and expresses this value in both USD and BOLD. If the collateral exposure exceeds a predefined threshold, it indicates that a significant share of the protocol’s assets has been generated into collateral assets. While this does not imply insolvency, it reflects an imbalanced asset composition.

In such cases, the protocol temporarily restricts the deposit and withdraw operations to avoid increasing exposure further and to maintain healthy system dynamics. This mechanism helps protect liquidity and ensure the protocol remains stable and responsive during volatile market conditions. 

### Deposit

The Stability Pool (each simply called SP) liquidity provision in BOLD is executed through the deposit and mint functions. Deposit and mint functions apply an entry fee, which deducts a fraction from the desired deposit quantity or adds a fraction of the cost of the share on mint.

On the first deposit, the contract mints a constant amount of shares, and a constant amount of assets is transferred to limit the possibility of an inflation attack. An entry fee is not applied on the first deposit, performed on deployment of the contract. sBOLD calculates the quantities to provide to each operational SP based on the configured weights in the contract storage.

### Withdraw 

The sBOLD withdrawal operations share the same compatible behaviour as deposit and mint. Accounts can withdraw assets and burn the corresponding sBOLD shares based on internally calculated BOLD/sBOLD exchange rate.

On withdrawal and redeem, accounts withdraw assets from the operational Stability Pools, based on the share’s portion over the total supply in the sBOLD protocol. That way, a fair quantity of primary assets are distributed to the account and burnt in share units.

When account initiates a withdrawal, the system determines how much BOLD can be withdrawn by factoring a real-time system conditions and available liquidity in BOLD. Before approving any withdrawal, it checks whether the protocol’s collateral gains remain healthy and ensures the vault is not paused. If the system is in a good state, the account’s maximum withdrawal amount is calculated based on their share of the vault and the liquidity in BOLD. This ensures that the withdrawals are accepted only when the system can support them, preserving both liquidity and protocol integrity.

### Swap

sBOLD introduces a mechanism for collateral aggregation across each internally operational  Stability Pool on Liquity v2, which claims the accumulated liquidated collateral and swaps it for BOLD with a low boundary, based on slippage tolerance configuration. After the swaps are successfully executed, the contract deposits the swapped amount of BOLD with the same preset weights to each of the connected stability pools.

The swap can be triggered by any account that can provide call data, which could be effective enough to result in an amount of primary assets equal to or more than the minimum calculated.  The swaps can be partial and for a single collateral to ensure the system's flexibility, meaning that an account can swap only fractions of the collateral amount for one or more pools in case of insufficient market liquidity.

The swap fee receiver is rewarded a return in basis points, configured by the admin with a restriction for minimum value. The calculated quantity is based on the total received BOLD quantity from each swap. sBOLD’s swap can also apply a fee, calculated in the same way as the reward, which has an initial value of 0 and a maximum value restriction and is transferred to the preconfigured fee receiver address.

sBOLD will onboard only trusted adapters, which are industry standard or internally owned and resilient strategies. Initially, sBOLD will rely on the battle-tested 1inch v6 router to aggregate the best liquidity options. In this configuration, the swap caller should input a route call received from the 1inch API.

## Rebalance

The sBold Protocol offers the flexibility to adjust existing Stability Pools or establish new weight allocations. There should be a minimum of one and a maximum of five configured pools, collectively representing 100% in basis points. The process of rebalancing can be performed only by the administrator, and it unfolds over four stages:

1. **Swap**

   The underlying collateral, generated from the Stability Pools is swapped to BOLD. In case of insufficient swap, where the collateral left in the protocol is more than B_CUmax, the execution reverts.

2. **Withdraw**

   The total amount provided in each Stability Pool is withdrawn and sent to the sBOLD contract.

3. **Reconfiguration**

   The existing Stability Pools are decommissioned and the new ones are established with their respective weight allocations.

4. **Provide**

   The final stage involves the allocation of the total BOLD holdings to the newly established Stability Pools. This distribution is carried out in accordance with the configuration defined in the third step.

## Price Oracle

### Registry
The sBold’s price oracle configurations are settled in the so-called Registry contract, which is the main source of truth for quote segregation. Each price Oracle contract should comply with the IPriceOracle interface to be onboarded in the registry. The presented function interfaces in the IPriceOracle are the getQuote(uint256 inAmount, address base) and isBaseSupported(address base).

The registry contract itself complies with the IPriceOracle interface and proxies static calls to the onboarded adapters. Each quote is returned in denomination to USD and is scaled to an amount with a precision of 18 to keep the homogenous behavior of the system.

A registry contract instance is managed by an admin, who configures the respective price oracles through the setOracles(Oracle[] memory oracles) functionality. In the current implementation, the base asset to adapter relation is 1:1, meaning a base asset can be attached to one adapter.

### ChainlinkOracle

The base in the context system Chainlink Oracle adapter represents a contract that inherits the IPriceOracle and is responsible for obtaining the price for a base asset from a feed in which the quote asset is only USD. The adapter scales the result to decimals precision of 18, based on the feed’s decimals. On getting a quote, checks for the price validity and staleness are performed.

The oracle adapter is used for the ETH/USD price derivation.

### ChainlinkLstOracle

The Chainlink LST (liquid-staking token) oracle adapter shares the same IPriceOracle interface and is responsible for obtaining the price for an LST to ETH quote asset and the price for ETH to USD quote asset. 

The ChainlinkLstOracle contract provides a straightforward way to derive LST/USD price by combining:

   1. A Chainlink feed reporting the current ETH / USD price;
   2. A Chainlink feed reporting the current LST / ETH price;

The adapter scales the result to decimal precision of 18 and returns a quote for the LST to USD. The performed checks are the same as in the standard ChainlinkOracle adapter.

The oracle adapter is used for the rETH/USD price derivation.

### WstEthOracle
The WstEthOracle oracle adapter shares the same IPriceOracle and serves for the derivation of the WstEth/USD price by combining:

   1. A Chainlink feed reporting the current STETH / USD price;
   2. The canonical conversion rate from WstETH to STETH (via the StETH contract);

Under the hood, it inherits from BaseChainlinkOracle, which handles common tasks such as fetching and validating raw Chainlink answers. The WstEthOracle layer takes the latest STETH / USD value (normalized to 18 decimals), multiplies it by how much ETH each WstETH share represents (also 18 decimals), and then rescales the product to 18 decimals again. If any step returns zero or a stale/invalid price, the oracle will revert.

The oracle adapter is used for the WstETH/USD price derivation.

### Pyth

In the context of the sBold protocol system, the Pyth adapter is IPriceOracle compliant and is responsible for executing the operations for the BOLD/USD feed. The adapter performs checks for confidence width, price staleness, and allowed exponent and scales the quote amount to a decimal precision of 18 by the exponent of the feed.

The oracle adapter is used for the BOLD/USD price derivation.


## Usage

### Install
To install sBOLD dependancies:

```
npm install
```

### Development
To run sBOLD unit tests:

```
npm run test
```

To run sBOLD test coverage:

```
npm run coverage
```
