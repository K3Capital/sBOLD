import { expect } from 'chai';
import { ethers } from 'hardhat';
import { getContractAddress } from '@ethersproject/address';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { ZeroAddress, getCreateAddress } from 'ethers';
import { Signer } from 'ethers';
import { MockBold, MockERC20, MockPriceOracle, MockRouter, MockStabilityPool, SBold } from '../../types';
import { ONE_ETH, SWAP_INTERFACE, WEIGHTS } from './utils/constants';
import { calcAssetsInSPs } from './utils/helpers';

const name = 'BOLD:stETH';
const symbol = 'sBOLD';
const random = '0x3333333333333333333333333333333333333333';
const initialDeposit = ONE_ETH;

describe('sBold', async function () {
  let owner: Signer;
  let vault: Signer;
  let bob: Signer;

  let vaultAddress: string;

  let sBold: SBold;
  let bold: MockERC20;
  let stETH: MockERC20;
  let wstETH: MockERC20;
  let rETH: MockERC20;
  let priceOracle: MockPriceOracle;
  let sp0: MockStabilityPool;
  let sp1: MockStabilityPool;
  let sp2: MockStabilityPool;
  let router: MockRouter;

  async function fixture() {
    [owner, vault, bob] = await ethers.getSigners();

    vaultAddress = await vault.getAddress();

    // $BOLD instance
    bold = (await ethers.deployContract('MockBold')).connect(owner) as MockBold;
    // collateral/stETH instance
    stETH = (await ethers.deployContract('MockERC20')).connect(owner) as MockERC20;
    // collateral/wstETH instance
    wstETH = (await ethers.deployContract('MockERC20')).connect(owner) as MockERC20;
    // collateral/rETH instance
    rETH = (await ethers.deployContract('MockERC20')).connect(owner) as MockERC20;
    // Price oracle contract
    priceOracle = (await ethers.deployContract('MockPriceOracle')).connect(owner) as MockPriceOracle;
    // Stability Pool contract
    sp0 = (await ethers.deployContract('MockStabilityPool')).connect(owner) as MockStabilityPool;
    // Stability Pool contract
    sp1 = (await ethers.deployContract('MockStabilityPool')).connect(owner) as MockStabilityPool;
    // Stability Pool contract
    sp2 = (await ethers.deployContract('MockStabilityPool')).connect(owner) as MockStabilityPool;
    // Set collateral - stETH
    await sp0.setColl(stETH.target);
    // Set collateral - wstETH
    await sp1.setColl(wstETH.target);
    // Set collateral - rETH
    await sp2.setColl(rETH.target);
    // Set $BOLD
    await sp0.setBold(bold.target);
    // Set $BOLD
    await sp1.setBold(bold.target);
    // Set $BOLD
    await sp2.setBold(bold.target);

    await priceOracle.setQuote(bold.target, ONE_ETH);

    // setup
    await bold.mint(BigInt(10 ** 18));
    // precompute sBold address
    const precomputedSBoldAddress = getCreateAddress({
      from: await owner.getAddress(),
      nonce: (await owner.getNonce()) + 1,
    });

    await bold.connect(owner).approve(precomputedSBoldAddress, BigInt(10 ** 18));

    // sBold instance
    sBold = (
      await ethers.deployContract('sBold', [
        bold.target,
        name,
        symbol,
        [
          {
            addr: sp0.target,
            weight: WEIGHTS[0],
          },
          {
            addr: sp1.target,
            weight: WEIGHTS[1],
          },
          {
            addr: sp2.target,
            weight: WEIGHTS[2],
          },
        ],
        priceOracle.target,
        vaultAddress,
      ])
    ).connect(owner) as SBold;
    // Mock Router contract
    router = (await ethers.deployContract('MockRouter')).connect(owner) as MockRouter;
    // Set router receiver
    await router.setReceiver(sBold.target);
  }

  beforeEach(async function () {
    await loadFixture(fixture);
  });

  describe('#constructor', function () {
    it('should deploy sBold contract', async function () {
      await bold.mint(BigInt(10 ** 18));

      // precompute sBold address
      const precomputedSBoldAddress = getCreateAddress({
        from: await owner.getAddress(),
        nonce: (await owner.getNonce()) + 1,
      });

      await bold.connect(owner).approve(precomputedSBoldAddress, BigInt(10 ** 18));

      const SBoldFactory = await ethers.getContractFactory('sBold');
      const sBold = await SBoldFactory.deploy(
        bold.target,
        name,
        symbol,
        [
          {
            addr: sp0.target,
            weight: 10000,
          },
        ],
        priceOracle.target,
        vaultAddress,
      );

      expect(sBold.target).to.not.eq(ZeroAddress);

      expect(await sBold.asset()).to.eq(bold.target);
      expect(await sBold.name()).to.eq(name);
      expect(await sBold.symbol()).to.eq(symbol);
      expect(await sBold.decimals()).to.eq(18);

      expect((await sBold.sps(0)).sp).to.eq(sp0.target);
      expect((await sBold.sps(0)).weight).to.eq(10000);

      expect(await sBold.priceOracle()).to.eq(priceOracle.target);
      expect(await sBold.vault()).to.eq(vaultAddress);

      expect(await sBold.owner()).to.eq(await owner.getAddress());
    });

    it('should revert to deploy sBold if SPs are not added', async function () {
      const SBoldFactory = await ethers.getContractFactory('sBold');
      await expect(
        SBoldFactory.deploy(bold.target, name, symbol, [], priceOracle.target, vaultAddress),
      ).to.be.rejectedWith('InvalidSPLength');
    });

    it('should revert to deploy sBold if SPs are over the max allowed', async function () {
      const SBoldFactory = await ethers.getContractFactory('sBold');

      const sp3 = (await ethers.deployContract('MockStabilityPool')).connect(owner) as MockStabilityPool;
      await sp3.setColl(stETH.target);

      await expect(
        SBoldFactory.deploy(
          bold.target,
          name,
          symbol,
          [
            {
              addr: sp0.target,
              weight: 2500,
            },
            {
              addr: sp1.target,
              weight: 2500,
            },
            {
              addr: sp2.target,
              weight: 2500,
            },
            {
              addr: sp3.target,
              weight: 2500,
            },
          ],
          priceOracle.target,
          vaultAddress,
        ),
      ).to.be.rejectedWith('InvalidSPLength');
    });

    it('should revert to deploy sBold if SPs are not added', async function () {
      const SBoldFactory = await ethers.getContractFactory('sBold');

      const sp3 = (await ethers.deployContract('MockStabilityPool')).connect(owner) as MockStabilityPool;
      await sp3.setColl(stETH.target);

      await expect(
        SBoldFactory.deploy(
          bold.target,
          name,
          symbol,
          [
            {
              addr: sp0.target,
              weight: 2500,
            },
            {
              addr: sp1.target,
              weight: 2500,
            },
            {
              addr: sp2.target,
              weight: 2500,
            },
            {
              addr: sp3.target,
              weight: 2500,
            },
          ],
          priceOracle.target,
          vaultAddress,
        ),
      ).to.be.rejectedWith('InvalidSPLength');
    });

    it('should revert to deploy sBold if SPs have more total weight than maximum bps', async function () {
      const SBoldFactory = await ethers.getContractFactory('sBold');
      await expect(
        SBoldFactory.deploy(
          bold.target,
          name,
          symbol,
          [
            {
              addr: sp0.target,
              weight: 2500,
            },
            {
              addr: sp1.target,
              weight: 4000,
            },
            {
              addr: sp2.target,
              weight: 4001,
            },
          ],
          priceOracle.target,
          vaultAddress,
        ),
      ).to.be.rejectedWith('InvalidTotalWeight');
    });

    it('should revert to deploy sBold if SPs have less total weight than maximum bps', async function () {
      const SBoldFactory = await ethers.getContractFactory('sBold');
      await expect(
        SBoldFactory.deploy(
          bold.target,
          name,
          symbol,
          [
            {
              addr: sp0.target,
              weight: 2500,
            },
            {
              addr: sp1.target,
              weight: 4000,
            },
            {
              addr: sp2.target,
              weight: 3999,
            },
          ],
          priceOracle.target,
          vaultAddress,
        ),
      ).to.be.rejectedWith('InvalidTotalWeight');
    });

    it('should revert to deploy sBold if there are duplicates', async function () {
      const SBoldFactory = await ethers.getContractFactory('sBold');
      await expect(
        SBoldFactory.deploy(
          bold.target,
          name,
          symbol,
          [
            {
              addr: sp0.target,
              weight: 5000,
            },
            {
              addr: sp0.target,
              weight: 5000,
            },
          ],
          priceOracle.target,
          vaultAddress,
        ),
      ).to.be.rejectedWith('DuplicateAddress');
    });

    it('should revert to deploy sBold if SP weight is 0', async function () {
      const SBoldFactory = await ethers.getContractFactory('sBold');
      await expect(
        SBoldFactory.deploy(
          bold.target,
          name,
          symbol,
          [
            {
              addr: sp0.target,
              weight: 10000,
            },
            {
              addr: sp1.target,
              weight: 0,
            },
          ],
          priceOracle.target,
          vaultAddress,
        ),
      ).to.be.rejectedWith('ZeroWeight');
    });
  });

  describe('#pause', function () {
    it('should pause sBold', async function () {
      await expect(sBold.pause()).to.emit(sBold, 'Paused');

      expect(await sBold.paused()).to.eq(true);
    });

    it('should fail to pause if caller is not owner', async function () {
      await expect(sBold.connect(bob).pause()).to.be.rejectedWith('OwnableUnauthorizedAccount');
    });
  });

  describe('#unpause', function () {
    it('should unpause sBold', async function () {
      await sBold.pause();

      await expect(sBold.unpause()).to.emit(sBold, 'Unpaused');

      expect(await sBold.paused()).to.eq(false);
    });

    it('should fail to unpause if caller is not owner', async function () {
      await sBold.pause();

      await expect(sBold.connect(bob).unpause()).to.be.rejectedWith('OwnableUnauthorizedAccount');
    });
  });

  describe('#setPriceOracle', function () {
    it('should set price oracle and emit event', async function () {
      await expect(sBold.setPriceOracle(random)).to.emit(sBold, 'PriceOracleSet');

      expect(await sBold.priceOracle()).to.eq(random);
    });

    it('should revert to set price if caller is not the owner', async function () {
      const contractSigner = sBold.connect(bob) as SBold;

      await expect(contractSigner.setPriceOracle(ZeroAddress)).to.be.rejectedWith('OwnableUnauthorizedAccount');
    });

    it('should revert to set price oracle with zero address', async function () {
      await expect(sBold.setPriceOracle(ZeroAddress)).to.be.rejectedWith('InvalidAddress');
    });
  });

  describe('#setVault', function () {
    it('should set vault and emit event', async function () {
      await expect(sBold.setVault(random)).to.emit(sBold, 'VaultSet');

      expect(await sBold.vault()).to.eq(random);
    });

    it('should revert to set vault if caller is not the owner', async function () {
      const contractSigner = sBold.connect(bob) as SBold;

      await expect(contractSigner.setVault(ZeroAddress)).to.be.rejectedWith('OwnableUnauthorizedAccount');
    });

    it('should revert to set vault with zero address', async function () {
      await expect(sBold.setVault(ZeroAddress)).to.be.rejectedWith('InvalidAddress');
    });
  });

  describe('#setFees', function () {
    it('should set fees and emit event', async function () {
      const feeBps = 100;
      const swapFeeBps = 200;

      await expect(sBold.setFees(feeBps, swapFeeBps)).to.emit(sBold, 'FeesSet');

      expect(await sBold.feeBps()).to.eq(feeBps);
      expect(await sBold.swapFeeBps()).to.eq(swapFeeBps);
    });

    it('should revert to set fees if caller is not the owner', async function () {
      const contractSigner = sBold.connect(bob) as SBold;

      const feeBps = 100;
      const swapFeeBps = 200;

      await expect(contractSigner.setFees(feeBps, swapFeeBps)).to.be.rejectedWith('OwnableUnauthorizedAccount');
    });

    it('should revert to set fees if fee over the max', async function () {
      const feeBps = 1000;
      const swapFeeBps = 200;

      await expect(sBold.setFees(feeBps, swapFeeBps)).to.be.rejectedWith('InvalidConfiguration');
    });

    it('should revert to set fees if fee over the max', async function () {
      const feeBps = 100;
      const swapFeeBps = 2000;

      await expect(sBold.setFees(feeBps, swapFeeBps)).to.be.rejectedWith('InvalidConfiguration');
    });
  });

  describe('#setReward', function () {
    it('should set reward and emit event', async function () {
      const rewardBps = 100;

      await expect(sBold.setReward(rewardBps)).to.emit(sBold, 'RewardSet');

      expect(await sBold.rewardBps()).to.eq(rewardBps);
    });

    it('should revert to set reward if caller is not the owner', async function () {
      const rewardBps = 100;

      const contractSigner = sBold.connect(bob) as SBold;

      await expect(contractSigner.setReward(rewardBps)).to.be.rejectedWith('OwnableUnauthorizedAccount');
    });

    it('should revert to set reward with value below the minimum', async function () {
      const rewardBps = 0;

      await expect(sBold.setReward(rewardBps)).to.be.rejectedWith('InvalidConfiguration');
    });
  });

  describe('#setMaxSlippage', function () {
    it('should set max slippage and emit event', async function () {
      const maxSlippage = 100;

      await expect(sBold.setMaxSlippage(maxSlippage)).to.emit(sBold, 'MaxSlippageSet');

      expect(await sBold.maxSlippage()).to.eq(maxSlippage);
    });

    it('should revert to set max slippage if caller is not the owner', async function () {
      const contractSigner = sBold.connect(bob) as SBold;

      const maxSlippage = 100;

      await expect(contractSigner.setMaxSlippage(maxSlippage)).to.be.rejectedWith('OwnableUnauthorizedAccount');
    });

    it('should revert to set max slippage with slippage over the max', async function () {
      const maxSlippage = 1001;

      await expect(sBold.setMaxSlippage(maxSlippage)).to.be.rejectedWith('InvalidConfiguration');
    });
  });

  describe('#setSwapAdapter', function () {
    it('should set swap adapter and emit event', async function () {
      await expect(sBold.setSwapAdapter(random)).to.emit(sBold, 'SwapAdapterSet');

      expect(await sBold.swapAdapter()).to.eq(random);
    });

    it('should revert to set swap adapter if caller is not the owner', async function () {
      const contractSigner = sBold.connect(bob) as SBold;

      await expect(contractSigner.setSwapAdapter(random)).to.be.rejectedWith('OwnableUnauthorizedAccount');
    });

    it('should revert to set swap adapter with zero address', async function () {
      await expect(sBold.setSwapAdapter(ZeroAddress)).to.be.rejectedWith('InvalidAddress');
    });
  });

  describe('#setMaxCollInBold', function () {
    it('should set max collateral value and emit event', async function () {
      const maxCollInBold = 100;

      await expect(sBold.setMaxCollInBold(maxCollInBold)).to.emit(sBold, 'MaxCollValueSet');

      expect(await sBold.maxCollInBold()).to.eq(maxCollInBold);
    });

    it('should revert to set max collateral value if caller is not the owner', async function () {
      const maxCollInBold = 100;

      const contractSigner = sBold.connect(bob) as SBold;

      await expect(contractSigner.setMaxCollInBold(maxCollInBold)).to.be.rejectedWith('OwnableUnauthorizedAccount');
    });

    it('should revert to set max collateral value with zero value', async function () {
      await expect(sBold.setMaxCollInBold(0)).to.be.rejectedWith('InvalidConfiguration');
    });

    it('should revert to set max collateral value with value over the limit', async function () {
      const maxCollInBold = ethers.parseEther('7501');

      await expect(sBold.setMaxCollInBold(maxCollInBold)).to.be.rejectedWith('InvalidConfiguration');
    });
  });

  describe('#getSBoldRate', function () {
    it('should get $sBOLD rate', async function () {
      const ownerAddress = await owner.getAddress();

      const amount = ethers.parseEther('1000000');
      const yieldGain = ethers.parseEther('100400');
      const accumulatedColl = ONE_ETH;
      const collToUsd = ethers.parseEther('2245');
      const quote = (accumulatedColl * collToUsd) / ONE_ETH;

      // setup
      await bold.mint(amount);
      await bold.approve(sBold.target, amount);

      // Set quote for $BOLD - $BOLD = 1 USD
      await priceOracle.setQuote(bold.target, ONE_ETH);

      // 1st deposit
      await sBold.deposit(ONE_ETH, ownerAddress);

      // 1 $BOLD deposited $BOLD
      await sp0.setCompoundedBoldDeposit(ONE_ETH);

      // 2nd deposit
      await sBold.deposit(amount - ONE_ETH, ownerAddress);

      // 1100400 $BOLD = 1100400 USD => 1100400 ** 1e18
      await sp0.setCompoundedBoldDeposit(amount + yieldGain);
      // $BOLD = 1 USD
      await priceOracle.setQuote(bold.target, ONE_ETH);

      // 1 collateral = 2245 USD => 2245 ** 1e18
      await sp0.setDepositorCollGain(accumulatedColl);
      // amount * collateral price to USD
      await priceOracle.setQuote(stETH.target, quote);

      // sBOLD rate = sBOLD total supply / deposited $BOLD + yield from $BOLD + USD value from accumulated collateral
      // => (1000001 + 100400 + 2245) / 1000001
      // => 1.102645000000000000 $sBOLD = 1 $BOLD
      const expectedRate = ((amount + yieldGain + quote + ONE_ETH) * ONE_ETH) / (amount + ONE_ETH);

      const rate = await sBold.getSBoldRate();

      expect(rate).to.approximately(expectedRate, 1);
    });

    it('should return 1e18 $sBOLD rate after first deposit', async function () {
      const rate = await sBold.getSBoldRate();

      expect(rate).to.eq(ONE_ETH);
    });
  });

  describe('#calcFragments', function () {
    ([BigInt(500), BigInt(2000), BigInt(2001)] as bigint[]).forEach((maxCollInBold: bigint) => {
      it(`should get assets amounts with maxCollInBold of ${maxCollInBold}`, async function () {
        const ownerAddress = await owner.getAddress();
        const amount = ethers.parseEther('1');
        const yieldGain = ethers.parseEther('0.1');
        const accumulatedColl = ONE_ETH;
        const collToUsd = ethers.parseEther('2000');
        const quote = (accumulatedColl * collToUsd) / ONE_ETH;

        // setup
        await bold.mint(amount);
        await bold.approve(sBold.target, amount);

        // Set quote for $BOLD - $BOLD = 1 USD
        await priceOracle.setQuote(bold.target, ONE_ETH);

        // deposit
        await sBold.deposit(ONE_ETH, ownerAddress);

        // 1 $BOLD = 1 USD => 1 ** 1e18
        await sp0.setCompoundedBoldDeposit(amount + yieldGain);
        // $BOLD = 1 USD
        await priceOracle.setQuote(bold.target, ONE_ETH);

        // 1 collateral = 2245 USD => 2245 ** 1e18
        await sp0.setDepositorCollGain(accumulatedColl);
        // amount * collateral price to USD
        await priceOracle.setQuote(stETH.target, quote);

        let maxCollInBoldScaled = maxCollInBold * ONE_ETH;

        // set max collateral in $BOLD
        // *this amount should be disregarded in each operation before it swapped to the primary $BOLD asset
        await sBold.setMaxCollInBold(maxCollInBoldScaled);

        const [totalInBold, boldAmount, collInUsd] = await sBold.calcFragments();

        if (maxCollInBoldScaled > quote) {
          maxCollInBoldScaled = quote;
        }

        const expTotal = amount + yieldGain + quote + ONE_ETH - maxCollInBoldScaled;

        expect(totalInBold).to.eq(expTotal);
        expect(boldAmount).to.eq(amount + yieldGain + ONE_ETH);
        expect(collInUsd).to.eq(quote);
      });
    });
  });

  describe('#maxDeposit', function () {
    it('should maxDeposit return 0 when collateral is over the max limit', async function () {
      const ownerAddress = await owner.getAddress();

      const quote = 1000;
      await sp0.setDepositorCollGain(quote);

      await priceOracle.setQuote(bold.target, ONE_ETH);
      await priceOracle.setQuote(stETH.target, quote);

      // setup
      await bold.mint(ONE_ETH);
      await bold.approve(sBold.target, ONE_ETH);

      expect(await sBold.maxDeposit(ownerAddress)).to.be.eq(0);
    });
  });

  describe('#maxMint', function () {
    it('should maxMint return 0 when collateral is over the max limit', async function () {
      const ownerAddress = await owner.getAddress();

      const quote = 1000;
      await sp0.setDepositorCollGain(quote);

      await priceOracle.setQuote(bold.target, ONE_ETH);
      await priceOracle.setQuote(stETH.target, quote);

      // setup
      await bold.mint(ONE_ETH);
      await bold.approve(sBold.target, ONE_ETH);

      expect(await sBold.maxMint(ownerAddress)).to.be.eq(0);
    });
  });

  describe('#maxWithdraw', function () {
    it('should maxWithdraw return 0 when collateral is over the max limit', async function () {
      const ownerAddress = await owner.getAddress();

      const quote = 1000;
      await sp0.setDepositorCollGain(quote);

      await priceOracle.setQuote(bold.target, ONE_ETH);
      await priceOracle.setQuote(stETH.target, quote);

      // setup
      await bold.mint(ONE_ETH);
      await bold.approve(sBold.target, ONE_ETH);

      expect(await sBold.maxWithdraw(ownerAddress)).to.be.eq(0);
    });
  });

  describe('#maxRedeem', function () {
    it('should maxRedeem return 0 when collateral is over the max limit', async function () {
      const ownerAddress = await owner.getAddress();

      const quote = 1000;
      await sp0.setDepositorCollGain(quote);

      await priceOracle.setQuote(bold.target, ONE_ETH);
      await priceOracle.setQuote(stETH.target, quote);

      // setup
      await bold.mint(ONE_ETH);
      await bold.approve(sBold.target, ONE_ETH);

      expect(await sBold.maxRedeem(ownerAddress)).to.be.eq(0);
    });
  });

  describe('#deposit', function () {
    it('should create first deposit $BOLD', async function () {
      const ownerAddress = await owner.getAddress();

      // setup
      await bold.mint(ONE_ETH);
      await bold.approve(sBold.target, ONE_ETH);

      // 1st deposit
      await sBold.deposit(ONE_ETH, ownerAddress);

      const sBoldBalanceOwner = await sBold.balanceOf(ownerAddress);
      expect(sBoldBalanceOwner).to.eq(ONE_ETH);
    });

    ([BigInt(0), BigInt(100)] as bigint[]).forEach((feeBps: bigint) => {
      it(`should create deposits with fee of ${feeBps} in BPS`, async function () {
        const ownerAddress = await owner.getAddress();

        // set fee
        if (feeBps > 0) {
          await sBold.setFees(feeBps, 0);
        }

        // deposit 2 $BOLD assets before fees
        // *on first deposit the fee is not applied!
        const depositAssetsAmount = BigInt(2) * ONE_ETH;

        // setup
        await bold.mint(depositAssetsAmount);
        await bold.approve(sBold.target, depositAssetsAmount);

        // deposit
        await sBold.deposit(ONE_ETH, ownerAddress);

        // update
        // one $BOLD * (1 - fee)
        await sp0.setCompoundedBoldDeposit(ONE_ETH - (ONE_ETH * feeBps) / BigInt(10_000));
        await priceOracle.setQuote(bold.target, ONE_ETH);

        // deposit
        await sBold.deposit(ONE_ETH, ownerAddress);

        // 2 $BOLD * (1 - fee)
        const expSBoldBalance = depositAssetsAmount - (depositAssetsAmount * feeBps) / BigInt(10_000);

        const sBoldBalanceOwner = await sBold.balanceOf(ownerAddress);
        expect(sBoldBalanceOwner).to.eq(expSBoldBalance);
      });
    });

    it('should create consecutive $BOLD deposits', async function () {
      const bobAddress = await bob.getAddress();

      // setup
      await bold.mint(ONE_ETH);
      await bold.approve(sBold.target, ONE_ETH);

      // 1st deposit
      await sBold.deposit(ONE_ETH, await owner.getAddress());

      const yieldGain0 = ethers.parseEther('0.1');
      const updatedCompBold0 = ONE_ETH + yieldGain0;
      await sp0.setCompoundedBoldDeposit(updatedCompBold0);
      await priceOracle.setQuote(bold.target, ONE_ETH);

      const rate0 = await sBold.getSBoldRate();
      const totalSupply0 = await sBold.totalSupply();
      // rate = 1.1 value / 1 $sBOLD total supply
      const expectedRate0 = ((updatedCompBold0 + initialDeposit) * ONE_ETH) / totalSupply0;

      expect(rate0).to.approximately(expectedRate0, 1);

      const contractSigner = sBold.connect(bob) as SBold;
      const boldSigner = bold.connect(bob) as MockERC20;

      const secondDepositorAmount = BigInt(2) * ONE_ETH;
      await boldSigner.mint(secondDepositorAmount);
      await boldSigner.approve(sBold.target, secondDepositorAmount);

      // 2nd deposit
      await contractSigner.deposit(secondDepositorAmount, bobAddress);

      const sBoldBalanceBob0 = await sBold.balanceOf(bobAddress);
      // no additional yield gain or accumulated collateral => 2 $BOLD / rate0  = ~1.81 $sBOLD
      const expectedsBoldBalanceBob0 = (secondDepositorAmount * ONE_ETH) / rate0;

      expect(sBoldBalanceBob0).to.eq(expectedsBoldBalanceBob0);

      const yieldGain1 = ethers.parseEther('0.1');
      const updatedCompBold1 = updatedCompBold0 + secondDepositorAmount + yieldGain1;
      await sp0.setCompoundedBoldDeposit(updatedCompBold1);
      await priceOracle.setQuote(bold.target, ONE_ETH);

      const rate1 = await sBold.getSBoldRate();
      const totalSupply1 = await sBold.totalSupply();
      // rate = 2.88 $sBOLD total supply / 3.2 USD value
      const expectedRate1 = ((updatedCompBold1 + initialDeposit) * ONE_ETH) / totalSupply1;

      expect(rate1).to.approximately(expectedRate1, 1);
    });

    it('should revert in case of failed Stability Pool LP', async function () {
      const ownerAddress = await owner.getAddress();

      // setup
      await sp0.setBold(bold.target);

      await bold.mint(BigInt(3) * ONE_ETH);
      await bold.approve(sBold.target, BigInt(3) * ONE_ETH);

      await sp0.setRevert(true);

      await expect(sBold.deposit(ONE_ETH, ownerAddress)).to.be.reverted;
    });

    it('should revert to deposit if collateral is over max allowed', async function () {
      const ownerAddress = await owner.getAddress();

      const quote = 1000;
      await sp0.setDepositorCollGain(quote);

      await priceOracle.setQuote(bold.target, ONE_ETH);
      await priceOracle.setQuote(stETH.target, quote);

      // setup
      await bold.mint(ONE_ETH);
      await bold.approve(sBold.target, ONE_ETH);

      await expect(sBold.deposit(ONE_ETH, ownerAddress)).to.be.rejectedWith('CollOverLimit');
    });

    it('should revert to deposit if sBOLD is paused', async function () {
      const ownerAddress = await owner.getAddress();

      // setup
      await sBold.pause();

      // deposit
      await expect(sBold.deposit(ONE_ETH, ownerAddress)).to.be.rejectedWith('EnforcedPause');
    });
  });

  describe('#mint', function () {
    it('should create first mint $sBOLD', async function () {
      const ownerAddress = await owner.getAddress();

      // setup
      await bold.mint(BigInt(3) * ONE_ETH);
      await bold.approve(sBold.target, BigInt(3) * ONE_ETH);

      // 1st deposit
      await sBold.mint(ONE_ETH, await owner.getAddress());

      const sBoldBalanceOwner0 = await sBold.balanceOf(ownerAddress);
      expect(ONE_ETH).to.eq(sBoldBalanceOwner0);
    });

    ([BigInt(0), BigInt(100)] as bigint[]).forEach((feeBps: bigint) => {
      it(`should create mints with fee of ${feeBps} in BPS`, async function () {
        const ownerAddress = await owner.getAddress();

        // set fee
        if (feeBps > 0) {
          await sBold.setFees(feeBps, 0);
        }

        // mint 2 $sBOLD shares before fees
        const mintShareAmount = BigInt(2) * ONE_ETH;

        // the price of 2 $sBOLD shares with fees added
        // *on first mint the fee is not applied!
        const fee = (mintShareAmount * feeBps) / BigInt(10_000);

        // setup
        await bold.mint(mintShareAmount + fee);
        await bold.approve(sBold.target, mintShareAmount + fee);

        // mint
        await sBold.mint(ONE_ETH, ownerAddress);

        // update
        await sp0.setCompoundedBoldDeposit(ONE_ETH);
        await priceOracle.setQuote(bold.target, ONE_ETH);

        // mint
        await sBold.mint(ONE_ETH, ownerAddress);

        const sBoldBalanceOwner = await sBold.balanceOf(ownerAddress);
        expect(sBoldBalanceOwner).to.eq(mintShareAmount);
      });
    });

    it('should create consecutive $sBOLD mints', async function () {
      const bobAddress = await bob.getAddress();

      // setup
      await bold.mint(ONE_ETH);
      await bold.approve(sBold.target, ONE_ETH);

      // 1st deposit - 1 $sBOLD in $BOLD value
      await sBold.mint(ONE_ETH, await owner.getAddress());

      const yieldGain0 = ethers.parseEther('0.1');
      const updatedCompBold0 = ONE_ETH + yieldGain0;
      // Add yield gain of 0.1 $BOLD - 10%
      await sp0.setCompoundedBoldDeposit(updatedCompBold0);
      await priceOracle.setQuote(bold.target, ONE_ETH);

      const totalSupply0 = await sBold.totalSupply();

      const rate0 = await sBold.getSBoldRate();
      // rate = 1.1 value / 1 $sBOLD total supply
      const expectedRate0 = ((initialDeposit + updatedCompBold0) * ONE_ETH) / totalSupply0;

      expect(rate0).to.approximately(expectedRate0, 1);

      const contractSigner = sBold.connect(bob) as SBold;
      const boldSigner = bold.connect(bob) as MockERC20;

      const secondDepositorShares = ethers.parseEther('2');
      const secondDepositorAmount = ethers.parseEther('2.1');

      await boldSigner.mint(secondDepositorAmount);
      await boldSigner.approve(sBold.target, secondDepositorAmount);

      // 1st deposit - 2 $sBOLD in $BOLD value
      await contractSigner.mint(secondDepositorShares, await bob.getAddress());

      const sBoldBalanceBob1 = await sBold.balanceOf(bobAddress);

      // deposited amount of $BOLD in the SPs
      const boldBalanceSP0 = await bold.balanceOf(sp0.target);
      const boldBalanceSP1 = await bold.balanceOf(sp1.target);
      const boldBalanceSP2 = await bold.balanceOf(sp2.target);

      // 1st mint + 2nd mint + yield gains
      const updatedCompBold1 = ONE_ETH + secondDepositorAmount;

      let assetsInSPs = calcAssetsInSPs(updatedCompBold1);

      await sp0.setCompoundedBoldDeposit(assetsInSPs[0]);
      await sp1.setCompoundedBoldDeposit(assetsInSPs[1]);
      await sp2.setCompoundedBoldDeposit(assetsInSPs[2]);

      const total = ONE_ETH + secondDepositorAmount;

      expect(sBoldBalanceBob1).to.eq(secondDepositorShares);

      const expBalanceInSPsTotal = calcAssetsInSPs(total);

      expect(boldBalanceSP0).to.eq(expBalanceInSPsTotal[0] - BigInt(1));
      expect(boldBalanceSP1).to.eq(expBalanceInSPsTotal[1] - BigInt(1));
      expect(boldBalanceSP2).to.eq(expBalanceInSPsTotal[2] - BigInt(1));

      const totalSupply1 = await sBold.totalSupply();

      const rate1 = await sBold.getSBoldRate();

      // rate is the $sBOLD / (deposited amount of $BOLD in the SP + yield gain) =>
      // 4.1 / 4 => ~1.25
      const expectedRate1 = ((initialDeposit + updatedCompBold1) * ONE_ETH) / totalSupply1;

      expect(rate1).to.approximately(expectedRate1, 1);
    });

    it('should revert in case of failed Stability Pool LP', async function () {
      const ownerAddress = await owner.getAddress();

      // setup
      await bold.mint(BigInt(3) * ONE_ETH);
      await bold.approve(sBold.target, BigInt(3) * ONE_ETH);

      await sp0.setRevert(true);

      await expect(sBold.mint(ONE_ETH, ownerAddress)).to.be.reverted;
    });

    it('should revert to mint if collateral is over max allowed', async function () {
      const ownerAddress = await owner.getAddress();

      const quote = 1000;
      await sp0.setDepositorCollGain(quote);

      await priceOracle.setQuote(bold.target, ONE_ETH);
      await priceOracle.setQuote(stETH.target, quote);

      // setup
      await bold.mint(ONE_ETH);
      await bold.approve(sBold.target, ONE_ETH);

      await expect(sBold.mint(ONE_ETH, ownerAddress)).to.be.rejectedWith('CollOverLimit');
    });

    it('should revert to mint if sBOLD is paused', async function () {
      const ownerAddress = await owner.getAddress();

      // setup
      await sBold.pause();

      // mint
      await expect(sBold.mint(ONE_ETH, ownerAddress)).to.be.rejectedWith('EnforcedPause');
    });
  });

  describe('#withdraw', function () {
    it('should withdraw $BOLD', async function () {
      const ownerAddress = await owner.getAddress();

      // setup
      await bold.mint(ONE_ETH);
      await bold.approve(sBold.target, ONE_ETH);

      // deposit
      await sBold.deposit(ONE_ETH, ownerAddress);

      // appreciate
      const yieldGain = ethers.parseEther('0.1');
      const updatedCompBold = ONE_ETH + yieldGain;

      // stub amounts
      await bold.mintTo(sp0.target, updatedCompBold);
      await bold.mintTo(sp1.target, updatedCompBold);
      await bold.mintTo(sp2.target, updatedCompBold);

      let assetsInSPs = calcAssetsInSPs(updatedCompBold);

      await sp0.setCompoundedBoldDeposit(assetsInSPs[0]);
      await sp1.setCompoundedBoldDeposit(assetsInSPs[1]);
      await sp2.setCompoundedBoldDeposit(assetsInSPs[2]);

      await priceOracle.setQuote(bold.target, ONE_ETH);

      const maxWithdraw = await sBold.maxWithdraw(ownerAddress);

      // withdraw
      await sBold.withdraw(maxWithdraw, ownerAddress, ownerAddress);

      const expCompoundedBoldBalance = ONE_ETH + yieldGain / BigInt(2) - BigInt(1);
      const compoundedBoldBalance = await bold.balanceOf(ownerAddress);
      expect(compoundedBoldBalance).to.eq(expCompoundedBoldBalance);
    });

    it('should withdraw based on portion and not account 0 amounts from SPs', async function () {
      const ownerAddress = await owner.getAddress();

      // setup
      await bold.mint(ONE_ETH);
      await bold.approve(sBold.target, ONE_ETH);

      // deposit
      await sBold.deposit(ONE_ETH, ownerAddress);

      // appreciate
      const yieldGain = ethers.parseEther('0.1');
      const updatedCompBold = ONE_ETH + yieldGain;

      // stub amounts
      await bold.mintTo(sp0.target, updatedCompBold);

      let assetsInSPs = calcAssetsInSPs(updatedCompBold);

      // Get yield gains only from SP0
      await sp0.setCompoundedBoldDeposit(assetsInSPs[0]);

      // set quote
      await priceOracle.setQuote(bold.target, ONE_ETH);

      // withdraw
      await sBold.withdraw(assetsInSPs[0], ownerAddress, ownerAddress);

      const compoundedBoldBalance = await bold.balanceOf(ownerAddress);

      expect(compoundedBoldBalance).to.eq(assetsInSPs[0]);
    });

    it('should withdraw when amount is received by other account', async function () {
      const ownerAddress = await owner.getAddress();
      const bobAddress = await bob.getAddress();

      const boldSignerBob = bold.connect(bob) as MockBold;
      const sBoldSignerBob = sBold.connect(bob) as SBold;

      // setup
      await bold.mint(ONE_ETH);
      await bold.approve(sBold.target, ONE_ETH);
      await boldSignerBob.mint(ONE_ETH);
      await boldSignerBob.approve(sBold.target, ONE_ETH);

      // deposit
      await sBold.deposit(ONE_ETH, ownerAddress);
      await sp0.setCompoundedBoldDeposit(ONE_ETH);
      // Bob deposits and sets `owner` as receiver
      await sBoldSignerBob.deposit(ONE_ETH, ownerAddress);

      // appreciate
      const yieldGain = ethers.parseEther('0.1');
      const updatedCompBold = ONE_ETH + yieldGain;

      let assetsInSPs = calcAssetsInSPs(updatedCompBold);

      // Get yield gains only from SP0
      await bold.mintTo(sp0.target, assetsInSPs[0]);
      await sp0.setCompoundedBoldDeposit(assetsInSPs[0]);

      // set quote
      await priceOracle.setQuote(bold.target, ONE_ETH);

      const maxWithdraw = await sBold.maxWithdraw(ownerAddress);
      const maxWithdrawBob = await sBold.maxWithdraw(bobAddress);

      expect(maxWithdrawBob).to.eq(0);

      const totalSupply = await sBold.totalSupply();

      // withdraw
      await sBold.withdraw(maxWithdraw, ownerAddress, ownerAddress);
      // 1 $BOLD from first deposit + decreased funds from consecutive deposits / total supply
      const expCompoundedBoldBalance = (((initialDeposit + assetsInSPs[0]) * ONE_ETH) / totalSupply) * BigInt(2);
      const compoundedBoldBalance = await bold.balanceOf(ownerAddress);

      expect(compoundedBoldBalance).to.eq(expCompoundedBoldBalance);
      expect(sBoldSignerBob.withdraw(ONE_ETH, ownerAddress, ownerAddress)).to.be.revertedWith(
        'ERC4626ExceededMaxRedeem',
      );
    });

    it('should withdraw $BOLD, consecutive withdraws', async function () {
      const ownerAddress = await owner.getAddress();
      const bobAddress = await bob.getAddress();

      // setup
      // mints
      await bold.mint(ONE_ETH);
      await bold.mintTo(bobAddress, ONE_ETH);
      // approvals
      await bold.approve(sBold.target, ONE_ETH);
      await bold.connect(bob).approve(sBold.target, ONE_ETH);

      const contractSignerOwner = sBold.connect(owner) as SBold;
      const contractSignerBob = sBold.connect(bob) as SBold;

      // deposit
      await contractSignerOwner.deposit(ONE_ETH, ownerAddress);

      // stub amounts
      let assetsInSPs = calcAssetsInSPs(ONE_ETH);

      await sp0.setCompoundedBoldDeposit(assetsInSPs[0]);
      await sp1.setCompoundedBoldDeposit(assetsInSPs[1]);
      await sp2.setCompoundedBoldDeposit(assetsInSPs[2]);

      await bold.mintTo(sp0.target, assetsInSPs[0]);
      await bold.mintTo(sp1.target, assetsInSPs[1]);
      await bold.mintTo(sp2.target, assetsInSPs[2]);

      await priceOracle.setQuote(bold.target, ONE_ETH);

      // deposit
      await contractSignerBob.deposit(ONE_ETH, bobAddress);

      // appreciate
      const yieldGain = ethers.parseEther('0.2');
      const updatedCompBold = BigInt(2) * ONE_ETH + yieldGain;

      // stub amounts
      await bold.mintTo(sp0.target, updatedCompBold);

      assetsInSPs = calcAssetsInSPs(updatedCompBold);

      await sp0.setCompoundedBoldDeposit(assetsInSPs[0]);
      await sp1.setCompoundedBoldDeposit(assetsInSPs[1]);
      await sp2.setCompoundedBoldDeposit(assetsInSPs[2]);

      await priceOracle.setQuote(bold.target, ONE_ETH);

      // get max amounts
      const maxWithdrawOwner = await sBold.maxWithdraw(ownerAddress);

      // withdraw
      await contractSignerOwner.withdraw(maxWithdrawOwner, ownerAddress, ownerAddress);

      // deduct withdrawn 1/3 share of the compounded $BOLD
      const boldProRata = updatedCompBold - updatedCompBold / BigInt(3);

      // stub amounts
      assetsInSPs = calcAssetsInSPs(boldProRata);

      await sp0.setCompoundedBoldDeposit(assetsInSPs[0]);
      await sp1.setCompoundedBoldDeposit(assetsInSPs[1]);
      await sp2.setCompoundedBoldDeposit(assetsInSPs[2]);

      await priceOracle.setQuote(bold.target, ONE_ETH);

      const maxWithdrawBob = await sBold.maxWithdraw(bobAddress);

      // withdraw
      await contractSignerBob.withdraw(maxWithdrawBob, bobAddress, bobAddress);

      // assert
      expect(await bold.balanceOf(ownerAddress)).to.approximately((initialDeposit + updatedCompBold) / BigInt(3), 1);
      expect(await bold.balanceOf(bobAddress)).to.approximately((initialDeposit + updatedCompBold) / BigInt(3), 1);
    });

    it('should revert if trying to withdraw more than max', async function () {
      const ownerAddress = await owner.getAddress();

      // setup
      await bold.mint(ONE_ETH);
      await bold.approve(sBold.target, ONE_ETH);

      // deposit
      await sBold.deposit(ONE_ETH, ownerAddress);

      // appreciate
      const yieldGain = ethers.parseEther('0.1');
      const updatedCompBold = ONE_ETH + yieldGain;

      // stub amounts
      await bold.mintTo(sp0.target, updatedCompBold);
      await bold.mintTo(sp1.target, updatedCompBold);
      await bold.mintTo(sp2.target, updatedCompBold);

      let assetsInSPs = calcAssetsInSPs(updatedCompBold);

      await sp0.setCompoundedBoldDeposit(assetsInSPs[0]);
      await sp1.setCompoundedBoldDeposit(assetsInSPs[1]);
      await sp2.setCompoundedBoldDeposit(assetsInSPs[2]);

      await priceOracle.setQuote(bold.target, ONE_ETH);

      const maxWithdraw = await sBold.maxWithdraw(ownerAddress);

      // withdraw
      await expect(sBold.withdraw(maxWithdraw + BigInt(1), ownerAddress, ownerAddress)).to.be.reverted;
    });

    it('should revert to withdraw if collateral is over max allowed', async function () {
      const ownerAddress = await owner.getAddress();

      const quote = 1000;
      await sp0.setDepositorCollGain(quote);

      await priceOracle.setQuote(bold.target, ONE_ETH);
      await priceOracle.setQuote(stETH.target, quote);

      // setup
      await bold.mint(ONE_ETH);
      await bold.approve(sBold.target, ONE_ETH);

      const maxWithdraw = await sBold.maxWithdraw(ownerAddress);

      await expect(sBold.withdraw(maxWithdraw, ownerAddress, ownerAddress)).to.be.rejectedWith('CollOverLimit');
    });

    it('should revert to withdraw if sBOLD is paused', async function () {
      const ownerAddress = await owner.getAddress();

      // setup
      await sBold.pause();

      const maxWithdraw = await sBold.maxWithdraw(ownerAddress);

      // withdraw
      await expect(sBold.withdraw(maxWithdraw, ownerAddress, ownerAddress)).to.be.rejectedWith('EnforcedPause');
    });
  });

  describe('#redeem', function () {
    it('should redeem $sBOLD', async function () {
      const ownerAddress = await owner.getAddress();

      // setup
      await bold.mint(ONE_ETH);
      await bold.approve(sBold.target, ONE_ETH);

      // deposit
      await sBold.deposit(ONE_ETH, ownerAddress);

      // appreciate
      const yieldGain = ethers.parseEther('0.1');
      const updatedCompBold = ONE_ETH + yieldGain;

      // stub amounts
      await bold.mintTo(sp0.target, updatedCompBold);

      let assetsInSPs = calcAssetsInSPs(updatedCompBold);

      await sp0.setCompoundedBoldDeposit(assetsInSPs[0]);
      await sp1.setCompoundedBoldDeposit(assetsInSPs[1]);
      await sp2.setCompoundedBoldDeposit(assetsInSPs[2]);

      await bold.mintTo(sp0.target, assetsInSPs[0]);
      await bold.mintTo(sp1.target, assetsInSPs[1]);
      await bold.mintTo(sp2.target, assetsInSPs[2]);

      await priceOracle.setQuote(bold.target, ONE_ETH);

      const maxRedeem = await sBold.maxRedeem(ownerAddress);

      // redeem
      await sBold.redeem(maxRedeem, ownerAddress, ownerAddress);

      const expCompoundedBoldBalance = ONE_ETH + yieldGain / BigInt(2);
      const compoundedBoldBalance = await bold.balanceOf(ownerAddress);

      expect(compoundedBoldBalance).to.approximately(expCompoundedBoldBalance, 1);
    });

    it('should redeem $sBOLD and get $BOLD, consecutive redeems', async function () {
      const ownerAddress = await owner.getAddress();
      const bobAddress = await bob.getAddress();

      // setup
      // mint
      await bold.mint(ONE_ETH);
      await bold.mintTo(bobAddress, ONE_ETH);
      // approve
      await bold.approve(sBold.target, ONE_ETH);
      await bold.connect(bob).approve(sBold.target, ONE_ETH);

      const contractSignerOwner = sBold.connect(owner) as SBold;
      const contractSignerBob = sBold.connect(bob) as SBold;

      // deposit
      await contractSignerOwner.deposit(ONE_ETH, ownerAddress);

      // update generated yield
      let assetsInSPs = calcAssetsInSPs(ONE_ETH);

      // stub amounts
      await sp0.setCompoundedBoldDeposit(assetsInSPs[0]);
      await sp1.setCompoundedBoldDeposit(assetsInSPs[1]);
      await sp2.setCompoundedBoldDeposit(assetsInSPs[2]);

      // set $BOLD quote for 1 $BOLD
      await priceOracle.setQuote(bold.target, ONE_ETH);

      // 2nd deposit
      await contractSignerBob.deposit(ONE_ETH, bobAddress);

      // appreciate
      const yieldGain = ethers.parseEther('0.2');
      const updatedCompBold = ONE_ETH * BigInt(2) + yieldGain;

      const boldProRata = updatedCompBold - updatedCompBold / BigInt(3);

      // stub amounts
      assetsInSPs = calcAssetsInSPs(updatedCompBold);

      await sp0.setCompoundedBoldDeposit(assetsInSPs[0]);
      await sp1.setCompoundedBoldDeposit(assetsInSPs[1]);
      await sp2.setCompoundedBoldDeposit(assetsInSPs[2]);

      await bold.mintTo(sp0.target, assetsInSPs[0]);
      await bold.mintTo(sp1.target, assetsInSPs[1]);
      await bold.mintTo(sp2.target, assetsInSPs[2]);

      const maxRedeemOwner = await sBold.maxRedeem(ownerAddress);

      // redeem
      await contractSignerOwner.redeem(maxRedeemOwner, ownerAddress, ownerAddress);

      // stub amounts
      assetsInSPs = calcAssetsInSPs(boldProRata);

      await sp0.setCompoundedBoldDeposit(assetsInSPs[0]);
      await sp1.setCompoundedBoldDeposit(assetsInSPs[1]);
      await sp2.setCompoundedBoldDeposit(assetsInSPs[2]);

      const maxRedeemBob = await sBold.maxRedeem(bobAddress);

      // redeem
      await contractSignerBob.redeem(maxRedeemBob, bobAddress, bobAddress);

      const expBalances = ONE_ETH + yieldGain / BigInt(3);

      // assert
      expect(await bold.balanceOf(ownerAddress)).to.approximately(expBalances, 1);
      expect(await bold.balanceOf(bobAddress)).to.approximately(expBalances, 1);
    });

    it('should revert if trying to redeem more than max', async function () {
      const ownerAddress = await owner.getAddress();

      // setup
      await bold.mint(ONE_ETH);
      await bold.approve(sBold.target, ONE_ETH);

      // deposit
      await sBold.deposit(ONE_ETH, ownerAddress);

      // appreciate
      const yieldGain = ethers.parseEther('0.1');
      const updatedCompBold = ONE_ETH + yieldGain;

      // stub amounts
      await bold.mintTo(sp0.target, updatedCompBold);
      await bold.mintTo(sp1.target, updatedCompBold);
      await bold.mintTo(sp2.target, updatedCompBold);

      let assetsInSPs = calcAssetsInSPs(updatedCompBold);

      await sp0.setCompoundedBoldDeposit(assetsInSPs[0]);
      await sp1.setCompoundedBoldDeposit(assetsInSPs[1]);
      await sp2.setCompoundedBoldDeposit(assetsInSPs[2]);

      await priceOracle.setQuote(bold.target, ONE_ETH);

      const maxRedeem = await sBold.maxRedeem(ownerAddress);

      // withdraw
      await expect(sBold.redeem(maxRedeem + BigInt(1), ownerAddress, ownerAddress)).to.be.reverted;
    });

    it('should revert to redeem if collateral is over max allowed', async function () {
      const ownerAddress = await owner.getAddress();

      const quote = 1000;
      await sp0.setDepositorCollGain(quote);

      await priceOracle.setQuote(bold.target, ONE_ETH);
      await priceOracle.setQuote(stETH.target, quote);

      // setup
      await bold.mint(ONE_ETH);
      await bold.approve(sBold.target, ONE_ETH);

      const maxRedeem = await sBold.maxRedeem(ownerAddress);

      await expect(sBold.redeem(maxRedeem, ownerAddress, ownerAddress)).to.be.rejectedWith('CollOverLimit');
    });

    it('should revert to redeem if sBOLD is paused', async function () {
      const ownerAddress = await owner.getAddress();

      // setup
      await sBold.pause();

      const maxRedeem = await sBold.maxRedeem(ownerAddress);

      // redeem
      await expect(sBold.redeem(maxRedeem, ownerAddress, ownerAddress)).to.be.rejectedWith('EnforcedPause');
    });
  });

  describe('#swap', function () {
    [
      // 0% swap fee in BPS
      [0, 0],
      // 0% swap fee in BPS + 5% reward in BPS
      [0, BigInt(500)],
      // 5% swap fee in BPS + 5% reward in BPS
      [BigInt(500), BigInt(500)],
    ].forEach(([swapFeeBps, rewardBps]) => {
      it('should swap collateral to $sBOLD', async function () {
        const ownerAddress = await owner.getAddress();

        // setup
        await bold.mint(ONE_ETH);
        await bold.approve(sBold.target, ONE_ETH);

        // deposit
        await sBold.deposit(ONE_ETH, ownerAddress);

        // appreciate
        const yieldGain = ethers.parseEther('0.1');
        const accumulatedColl = ethers.parseEther('0.2');
        const updatedCompBold = ONE_ETH + yieldGain;
        const ethUSDPrice = ethers.parseEther('2000');

        // stub amounts
        await bold.mintTo(sp0.target, updatedCompBold);

        let assetsInSPs = calcAssetsInSPs(updatedCompBold);
        let assetsInSPsColl = calcAssetsInSPs(accumulatedColl);

        // set yield gains
        await sp0.setCompoundedBoldDeposit(assetsInSPs[0]);
        await sp1.setCompoundedBoldDeposit(assetsInSPs[1]);
        await sp2.setCompoundedBoldDeposit(assetsInSPs[2]);

        // set collateral gains
        await sp0.setDepositorCollGain(assetsInSPsColl[0]);
        await sp1.setDepositorCollGain(assetsInSPsColl[1]);
        await sp2.setDepositorCollGain(assetsInSPsColl[2]);

        // set quotes
        await priceOracle.setQuote(bold.target, ONE_ETH);

        const quoteStETH = (assetsInSPsColl[0] * ethUSDPrice) / ONE_ETH; // 0.8 * 2000
        await priceOracle.setQuote(stETH.target, quoteStETH);

        const quoteWstETH = (assetsInSPsColl[1] * ethUSDPrice) / ONE_ETH; // 0.8 * 2000
        await priceOracle.setQuote(wstETH.target, quoteWstETH);

        const quoteRETH = (assetsInSPsColl[2] * ethUSDPrice) / ONE_ETH; // 0.4 * 2000
        await priceOracle.setQuote(rETH.target, quoteRETH);

        // Total collateral in USD = 4000 /2 * 2000/, so the swapped $BOLD should be 4000

        // mint $BOLD
        await bold.mintTo(sp0.target, assetsInSPs[0]);
        await bold.mintTo(sp1.target, assetsInSPs[1]);
        await bold.mintTo(sp2.target, assetsInSPs[2]);

        // mint Colls
        await stETH.mintTo(sp0.target, assetsInSPsColl[0]);
        await wstETH.mintTo(sp1.target, assetsInSPsColl[1]);
        await rETH.mintTo(sp2.target, assetsInSPsColl[2]);

        // set Colls to transfer
        await sp0.setTransferCollAmount(assetsInSPsColl[0]);
        await sp1.setTransferCollAmount(assetsInSPsColl[1]);
        await sp2.setTransferCollAmount(assetsInSPsColl[2]);

        // set collateral quotes
        await router.setQuotes(stETH.target, quoteStETH);
        await router.setQuotes(wstETH.target, quoteWstETH);
        await router.setQuotes(rETH.target, quoteRETH);

        await sBold.setSwapAdapter(router.target);

        // build calldata for swap adapter
        const callData0 = SWAP_INTERFACE.encodeFunctionData('swap', [
          stETH.target,
          bold.target,
          assetsInSPsColl[0],
          assetsInSPsColl[0],
          '0x',
        ]);
        const callData1 = SWAP_INTERFACE.encodeFunctionData('swap', [
          wstETH.target,
          bold.target,
          assetsInSPsColl[1],
          assetsInSPsColl[1],
          '0x',
        ]);
        const callData2 = SWAP_INTERFACE.encodeFunctionData('swap', [
          rETH.target,
          bold.target,
          assetsInSPsColl[2],
          assetsInSPsColl[2],
          '0x',
        ]);

        const bal0SP0 = await bold.balanceOf(sp0.target);
        const bal0SP1 = await bold.balanceOf(sp1.target);
        const bal0SP2 = await bold.balanceOf(sp2.target);

        // set fee
        if (swapFeeBps > 0) {
          await sBold.setFees(0, swapFeeBps);
        }

        // set reward
        if (rewardBps > 0) {
          await sBold.setReward(rewardBps);
        }

        // execute swap
        await sBold.swap([callData0, callData1, callData2], ownerAddress);

        const bal1SP0 = await bold.balanceOf(sp0.target);
        const bal1SP1 = await bold.balanceOf(sp1.target);
        const bal1SP2 = await bold.balanceOf(sp2.target);

        const deltaSP0 = bal1SP0 - bal0SP0;
        const deltaSP1 = bal1SP1 - bal0SP1;
        const deltaSP2 = bal1SP2 - bal0SP2;

        const swapFeeSP0 = (quoteStETH * BigInt(swapFeeBps)) / BigInt(10_000);
        const swapFeeSP1 = (quoteWstETH * BigInt(swapFeeBps)) / BigInt(10_000);
        const swapFeeSP2 = (quoteRETH * BigInt(swapFeeBps)) / BigInt(10_000);

        const rewardSP0 = (quoteStETH * BigInt(rewardBps)) / BigInt(10_000);
        const rewardSP1 = (quoteWstETH * BigInt(rewardBps)) / BigInt(10_000);
        const rewardSP2 = (quoteRETH * BigInt(rewardBps)) / BigInt(10_000);

        const expNetSP0 = quoteStETH - swapFeeSP0 - rewardSP0;
        const expNetSP1 = quoteWstETH - swapFeeSP1 - rewardSP1;
        const expNetSP2 = quoteRETH - swapFeeSP2 - rewardSP2;

        expect(deltaSP0).to.eq(expNetSP0);
        expect(deltaSP1).to.eq(expNetSP1);
        expect(deltaSP2).to.eq(expNetSP2);
      });
    });

    it('should fail to swap collateral to $sBOLD with invalid data length', async function () {
      const ownerAddress = await owner.getAddress();

      // setup
      await bold.mint(ONE_ETH);
      await bold.approve(sBold.target, ONE_ETH);

      // deposit
      await sBold.deposit(ONE_ETH, ownerAddress);

      // appreciate
      const yieldGain = ethers.parseEther('0.1');
      const accumulatedColl = ethers.parseEther('0.2');
      const updatedCompBold = ONE_ETH + yieldGain;
      const ethUSDPrice = ethers.parseEther('2000');

      await bold.mintTo(sp1.target, updatedCompBold);

      // set yield gains
      await sp1.setCompoundedBoldDeposit(updatedCompBold);

      // set collateral gains
      await sp1.setDepositorCollGain(accumulatedColl);

      // mint $BOLD
      await bold.mintTo(sp1.target, updatedCompBold);

      // mint Colls
      await wstETH.mintTo(sp1.target, accumulatedColl);

      // set Colls to transfer
      await sp1.setTransferCollAmount(accumulatedColl);

      // set quotes
      const quoteWstETH = (accumulatedColl * ethUSDPrice) / ONE_ETH; // 0.8 * 2000

      // set collateral quotes
      await router.setQuotes(stETH.target, quoteWstETH);

      await sBold.setSwapAdapter(router.target);

      // execute swap
      await expect(sBold.swap(['0x', '0x'], ownerAddress)).to.be.rejectedWith('InvalidDataArray');
    });

    it('should fail to swap collateral to $sBOLD with invalid data', async function () {
      const ownerAddress = await owner.getAddress();

      // setup
      await bold.mint(ONE_ETH);
      await bold.approve(sBold.target, ONE_ETH);

      // deposit
      await sBold.deposit(ONE_ETH, ownerAddress);

      // appreciate
      const yieldGain = ethers.parseEther('0.1');
      const accumulatedColl = ethers.parseEther('0.2');
      const updatedCompBold = ONE_ETH + yieldGain;
      const ethUSDPrice = ethers.parseEther('2000');

      await bold.mintTo(sp1.target, updatedCompBold);

      // set yield gains
      await sp1.setCompoundedBoldDeposit(updatedCompBold);

      // set collateral gains
      await sp1.setDepositorCollGain(accumulatedColl);

      // mint $BOLD
      await bold.mintTo(sp1.target, updatedCompBold);

      // mint Colls
      await wstETH.mintTo(sp1.target, accumulatedColl);

      // set Colls to transfer
      await sp1.setTransferCollAmount(accumulatedColl);

      // set quotes
      const quoteWstETH = (accumulatedColl * ethUSDPrice) / ONE_ETH; // 0.8 * 2000

      // set collateral quotes
      await router.setQuotes(stETH.target, quoteWstETH);

      await sBold.setSwapAdapter(router.target);

      // execute swap
      await expect(sBold.swap(['0x', '0x', '0x'], ownerAddress)).to.be.rejectedWith('ExecutionFailed');
    });

    it('should fail to swap collateral to $sBOLD if amountOut < minOut', async function () {
      const ownerAddress = await owner.getAddress();

      // setup
      await bold.mint(ONE_ETH);
      await bold.approve(sBold.target, ONE_ETH);

      // deposit
      await sBold.deposit(ONE_ETH, ownerAddress);

      // appreciate
      const yieldGain = ethers.parseEther('0.1');
      const accumulatedColl = ethers.parseEther('0.2');
      const updatedCompBold = ONE_ETH + yieldGain;
      const ethUSDPrice = ethers.parseEther('2000');

      await bold.mintTo(sp1.target, updatedCompBold);

      // set yield gains
      await sp1.setCompoundedBoldDeposit(updatedCompBold);

      // set collateral gains
      await sp1.setDepositorCollGain(accumulatedColl);

      // mint $BOLD
      await bold.mintTo(sp1.target, updatedCompBold);

      // mint Colls
      await wstETH.mintTo(sp1.target, accumulatedColl);

      // set Colls to transfer
      await sp1.setTransferCollAmount(accumulatedColl);

      const quoteWstETH = (accumulatedColl * ethUSDPrice) / ONE_ETH; // 0.8 * 2000
      await priceOracle.setQuote(wstETH.target, quoteWstETH);

      await priceOracle.setQuote(bold.target, ONE_ETH);

      // set collateral quotes
      await router.setQuotes(wstETH.target, quoteWstETH);

      await sBold.setSwapAdapter(router.target);

      // build calldata for swap adapter
      const callData1 = SWAP_INTERFACE.encodeFunctionData('swap', [
        wstETH.target,
        bold.target,
        accumulatedColl,
        accumulatedColl,
        '0x',
      ]);

      // set other receiver
      await router.setReceiver(await bob.getAddress());

      // execute swap
      await expect(sBold.swap(['0x', callData1, '0x'], ownerAddress)).to.be.rejectedWith('InsufficientAmount');
    });

    it('should revert to swap if sBOLD is paused', async function () {
      const ownerAddress = await owner.getAddress();

      // setup
      await sBold.pause();

      // swap
      await expect(sBold.swap(['0x', '0x', '0x'], ownerAddress)).to.be.rejectedWith('EnforcedPause');
    });
  });
});
