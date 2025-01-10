## Introducing sBOLD

sBOLD is a yield-bearing tokenized representation of a weighted average deposit into Liquity's v2 Stability Pools. The protocol accepts BOLD deposits and routes them into the wstETH, rETH and wETH stability pools in fixed proportions (50%, 30% and 20%, respectively) in the initial configuration after deployment. The operational Stability Pools can be rebalanced with different weights and changed. In return, the depositor receives an ERC4626 token that could be integrated with third-party protocols like money markets, decentralized exchanges and yield trading platforms for improved capital efficiency. 

The yield-bearing component of sBOLD stems from two streams. 

First, it captures the pro-rata distributions of the interest rate paid by the borrowers to the Stability Pools. A hodler of 1 sBOLD receives the equivalent of the interest paid to 50 cents deposited into the wstETH Stability Pool plus 30 cents deposited into the rETH Stability Pool and 20 cents into the wETH Stability Pool.

Second, the sBOLD holders capture the liquidation penalty with minimum collateral price exposure. Theoretically, Stability Pool depositors acquire liquidated collateral at a discount. However, the penalty is not realized until the collateral is sold for the underlying asset, BOLD. sBOLD automates the process on behalf of the users by incentivising solvers triggering withdrawal and swap transactions of accumulated collaterals, effectively realizing the penalty as quickly as possible. The architecture does not only remove the price exposure to Stability Pool depositors, but also facilitates better third-party integrations due to the lack of multiple underlying assets backing sBOLD.

## Technical Overview

The architecture of sBOLD Protocol is built around the prevalent and industry-compatible ERC4626 standard, which serves as the entry-point between external accounts and the core underlying mechanisms.
sBOLD provides a capital-efficient way for liquidity provision across multiple stability pools, part of the new Bold protocol infrastructure. Each connected stability pool is provided BOLD, based on pre-configured weights in basis points. 

<img width="971" alt="sBOLD-overview" src="https://github.com/user-attachments/assets/8da12fe7-c42a-4828-a568-ca314c42ffe0">

## Accounting

sBold contract is standard-conforming ERC-4626 vault with additional functionality to integrate aggregation of the tokens in the stability pools owned by the accounts and effectively swapping the collateral tokens to the primary BOLD token. The vault accounts only one type of token: the vault's underlying asset (simply called asset in the code) and calculates in real time the quote for collateral across each pool in BOLD. Because ERC-4626 is a superset of ERC-20, vaults are also tokens, called vault shares or sBOLD. These shares represent a proportional claim on the vault's assets, and are exchangeable for larger quantities of the underlying asset over time as interest is accrued in BOLD and collateral from liquidations is accumulated. As recommended by ERC-4626, shares have the same number of decimals as their underlying asset's token.

### Exchange Rate

The exchange rate in the sBold protocol is calculated as a product of the division between the total value in BOLD, held by the contract in each stability pool, with accumulated collateral added with denominations to the primary BOLD token, and the total supply of sBOLD vault shares. 

The denomination of the accumulated collateral to BOLD is calculated based on the minimum, which will be received after the swap, with a reward and fee deducted from the received quantity. 

A subsequent deduction from the total value is applied by removing the maximum allowed collateral value, which can be held by the contract, and effectively the one which should be swapped, before limiting the deposit and withdrawal. This limit should exist in the vault to create a net delta positive for the caller of the swap and effectively incentivise third party actors to rebalance.

### Rounding

The quantity of assets that can be redeemed for a given number of shares is always rounded down, and the number of shares required to withdraw a given quantity of assets is rounded up. This ensures that depositors cannot withdraw more than they deposited plus accrued interest and accumulated collateral. These two behaviours ensure that all impact of rounding happens in favour of the vault and of disadvantage of the depositor in order to ensure solvency of the system.

### Fee

sBold applies an entry fee on deposit and respective mint. The entry fee is a configurable parameter, which can be increased up to specific quantity stored in bps and is transferred to a fee receiver configured in the sBold contract.

On deposit, the fee is deducted from the quantity of the assets, which is provided to the Bold's stability pools, resulting in minting fewer shares, compared to the mechanism on mint, where the exact requested quantity is minted, but the price being paid for a share is increased by the fee.

The fee is calculated in the previewDeposit and the previewMint functions but is not accounted for in case the sBOLD's total supply is equal to zero.

## Interactions

sBold protocol as a standard-conforming ERC4626 vault implements the fundamental deposit, mint, withdraw, and redeem functionalities. These main methods operate around the product of the exchange rate specification, simply summarised, the rate is calculated based on the total BOLD holdings and the total supply of sBOLD. 

Each of the methods is only executable in a condition where the total collateral value denominated to BOLD is at maximum equal to the configured limit in the contract storage. This upper boundary ensures the protection against DoS, where malicious account transfer small quantities and effectively blocks the operations. 

### Provide

The stability pool (each simply called SP) liquidity provision in sBold is executed through the deposit and mint functions. Deposit and mint functions apply an entry fee, which deducts a fraction from the desired deposit quantity or adds a fraction of the cost of the share on mint. 

sBold calculates the quantities to provide to each operational SP based on the configured weights in the contract storage.

### Withdraw 

The sBold withdrawal operations are share the same compatible behaviour as deposit and mint. Accounts can withdraw assets and burn the corresponding sBold shares based on BOLD<>sBOLD exchange rate. 

On withdraw and redeem accounts withdraw assets from the operational stability pools, based on the share portion over the total supply. In that way, a fair quantity of primary asset is distributed to the account and burnt in share units.

### Swap

sBold introduces a mechanism for collateral aggregation across each internally operational Bold stability pool, which claims the accumulated discounted funds and swaps them for BOLD with a low boundary, based on slippage tolerance configuration. After the swaps are successfully executed, the contract deposits the BOLD primary asset with the same preset weights to each of the connected stability pools.

The swap can be triggered by any actor, who could provide call data, which could be effective enough to result in a quantity of primary assets, equal to or more than the minimum calculated. The swaps can be partial and for a single collateral to ensure system's flexibility.

sBold will onboard only trusted adapters, which are industry standard or internally owned and resilient strategies. Initially, sBold will rely on the battle-tested 1inch router v6 to aggregate the best liquidity options. In this configuration, the swap caller should input a route call received from the 1inch API.

## Price Oracle

### Registry

The sBold's price oracle configurations are settled in the so-called Registry contract, which is the main source of truth for quote segregation. Each price Oracle contract should comply with the IPriceOracle interface to be onboarded in the registry. The presented function interfaces in the IPriceOracle are the getQuote(uint256 inAmount, address base) and isBaseSupported(address base).

The registry contract itself complies with the IPriceOracle interface and proxies static calls to the onboarded adapters. Each quote is returned in denomination to USD and is scaled to an amount with a precision of 18 to keep the homogenous behavior of the system.

A registry contract instance is managed by an admin, who configures the respective price oracles through the setOracles(Oracle[] memory oracles) functionality. In the current implementation, the base asset to adapter relation is 1:1, meaning a base asset can be attached to one adapter.

### ChainlinkOracle

The base in the context system Chainlink Oracle adapter represents a contract that inherits the IPriceOracle and is responsible for obtaining the price for a base asset from a feed in which the quote asset is only USD. The adapter scales the result to decimals precision of 18, based on the feed's decimals. On getting a quote, checks for the price validity and staleness are performed.

### ChainlinkLstOracle

The Chainlink LST (liquid-staking token) oracle adapter shares the same IPriceOracle interface and is responsible for obtaining the price for an LST to ETH quote asset and the price for ETH to USD quote asset. This operation is executed for LSTs (base assets in the context of the system), which don't possess a feed to USD quote asset. The adapter scales the result to decimal precision of 18 and returns a quote for the LST to USD. The performed checks are the same as in the standard ChainlinkOracle adapter.

### Pyth

In the context of the sBold protocol system, the Pyth adapter is IPriceOracle compliant and is responsible for executing the operations for the BOLD/USD feed. The adapter performs checks for confidence width, price staleness, and allowed exponent and scales the quote amount to a decimal precision of 18 by the exponent of the feed.

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
