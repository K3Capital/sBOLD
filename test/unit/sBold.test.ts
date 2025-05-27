import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { MaxInt256, ZeroAddress, getCreateAddress } from 'ethers';
import { Signer } from 'ethers';
import { MockBold, MockERC20, MockPriceOracle, MockRouter, MockStabilityPool, SBold, TestRouter } from '../../types';
import { BPS_DENOMINATOR, ONE_ETH, SWAP_INTERFACE, WEIGHTS } from './utils/constants';
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

  let encodedReadOnlyNonReentrant: string[];

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

    it('should revert to set vault with bold address', async function () {
      await expect(sBold.setVault(bold.target)).to.be.rejectedWith('InvalidAddress');
    });

    it('should revert to set vault with sBold address', async function () {
      await expect(sBold.setVault(sBold.target)).to.be.rejectedWith('InvalidAddress');
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

    it('should revert to set reward with value above the maximum', async function () {
      const rewardBps = 1001;

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

    it('should revert to set swap adapter with bold address', async function () {
      await expect(sBold.setSwapAdapter(bold.target)).to.be.rejectedWith('InvalidAddress');
    });

    it('should revert to set swap adapter with some of the SP addresses', async function () {
      await expect(sBold.setSwapAdapter(sp0.target)).to.be.rejectedWith('InvalidAddress');
    });

    it('should revert to set swap adapter with some of the collateral SP addresses', async function () {
      await expect(sBold.setSwapAdapter(stETH.target)).to.be.rejectedWith('InvalidAddress');
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
      const maxCollInBold = ethers.parseEther('1000001');

      await expect(sBold.setMaxCollInBold(maxCollInBold)).to.be.rejectedWith('InvalidConfiguration');
    });
  });

  describe('#totalAssets', function () {
    it('should get correct amount of total BOLD asset', async function () {
      await sp0.setCompoundedBoldDeposit(ONE_ETH);
      await sp1.setCompoundedBoldDeposit(ONE_ETH);
      await sp2.setCompoundedBoldDeposit(ONE_ETH);

      await sp0.setDepositorYieldGainWithPending(ONE_ETH);
      await sp1.setDepositorYieldGainWithPending(ONE_ETH);
      await sp2.setDepositorYieldGainWithPending(ONE_ETH);

      const boldAmount = await sBold.totalAssets();

      const expectedBoldAmount = BigInt(ONE_ETH) * BigInt(6) + (await bold.balanceOf(sBold.getAddress()));

      expect(expectedBoldAmount).to.eq(boldAmount);
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
      // 2nd deposit
      await sBold.deposit(amount - ONE_ETH, ownerAddress);

      let compBoldInSps = calcAssetsInSPs(amount + yieldGain);

      // set compounded yield - 1100400 $BOLD = 1100400 USD
      await sp0.setCompoundedBoldDeposit(compBoldInSps[0]);
      await sp1.setCompoundedBoldDeposit(compBoldInSps[1]);
      await sp2.setCompoundedBoldDeposit(compBoldInSps[2]);

      // $BOLD = 1 USD
      await priceOracle.setQuote(bold.target, ONE_ETH);

      // 1 collateral = 2245 USD => 2245 ** 1e18
      await sp0.setDepositorCollGain(accumulatedColl);
      // amount * collateral price to USD
      await priceOracle.setQuote(stETH.target, quote);

      // sBOLD rate = sBOLD total supply / deposited $BOLD + yield from $BOLD + USD value from accumulated collateral
      // => (1000001 + 100400 + 2245) / 1000001
      // => 1.102645000000000000 $BOLD = 1 $sBOLD
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
        let compBoldInSps = calcAssetsInSPs(amount + yieldGain);

        await sp0.setCompoundedBoldDeposit(compBoldInSps[0]);
        await sp1.setCompoundedBoldDeposit(compBoldInSps[1]);
        await sp2.setCompoundedBoldDeposit(compBoldInSps[2]);

        // $BOLD = 1 USD
        await priceOracle.setQuote(bold.target, ONE_ETH);

        // 1 collateral = 2245 USD => 2245 ** 1e18
        await sp0.setDepositorCollGain(accumulatedColl);
        // amount * collateral price to USD
        await priceOracle.setQuote(stETH.target, quote);

        const [totalInBold, boldAmount, collInUsd] = await sBold.calcFragments();

        const expTotal = amount + yieldGain + quote + ONE_ETH;

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

    it('should return 0 if sBOLD is paused', async function () {
      const ownerAddress = await owner.getAddress();

      // setup
      await sBold.pause();

      // deposit
      expect(await sBold.maxDeposit(ownerAddress)).to.be.eq(0);
    });

    it('should return 0 when external call to oracle for collateral fails', async function () {
      const ownerAddress = await owner.getAddress();

      const quote = 1000;
      await sp0.setDepositorCollGain(quote);

      // setup
      await priceOracle.setQuote(bold.target, ONE_ETH);
      await priceOracle.setQuote(stETH.target, quote);

      await priceOracle.setRevert(stETH.target, true);

      expect(await sBold.maxDeposit(ownerAddress)).to.be.eq(0);
    });

    it('should return 0 when external call to oracle for $BOLD fails', async function () {
      const ownerAddress = await owner.getAddress();

      const quote = 1000;
      await sp0.setDepositorCollGain(quote);

      // setup
      await priceOracle.setQuote(bold.target, ONE_ETH);
      await priceOracle.setQuote(stETH.target, quote);

      await priceOracle.setRevert(bold.target, true);

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

    it('should return 0 if sBOLD is paused', async function () {
      const ownerAddress = await owner.getAddress();

      // setup
      await sBold.pause();

      // deposit
      expect(await sBold.maxMint(ownerAddress)).to.be.eq(0);
    });

    it('should return 0 when external call to oracle for collateral fails', async function () {
      const ownerAddress = await owner.getAddress();

      const quote = 1000;
      await sp0.setDepositorCollGain(quote);

      // setup
      await priceOracle.setQuote(bold.target, ONE_ETH);
      await priceOracle.setQuote(stETH.target, quote);

      await priceOracle.setRevert(stETH.target, true);

      expect(await sBold.maxMint(ownerAddress)).to.be.eq(0);
    });

    it('should return 0 when external call to oracle for $BOLD fails', async function () {
      const ownerAddress = await owner.getAddress();

      const quote = 1000;
      await sp0.setDepositorCollGain(quote);

      // setup
      await priceOracle.setQuote(bold.target, ONE_ETH);
      await priceOracle.setQuote(stETH.target, quote);

      await priceOracle.setRevert(bold.target, true);

      expect(await sBold.maxMint(ownerAddress)).to.be.eq(0);
    });
  });

  describe('#maxWithdraw', function () {
    it('should maxWithdraw return value equal to the $BOLD amount', async function () {
      const ownerAddress = await owner.getAddress();
      const quote = ONE_ETH * BigInt(2000);
      const maxCollInBold = quote;

      // setup
      await bold.mint(ONE_ETH);
      await bold.approve(sBold.target, ONE_ETH);

      await sBold.setMaxCollInBold(maxCollInBold);

      // deposit
      await sBold.deposit(ONE_ETH, ownerAddress);

      // appreciate
      const pendingGains = ethers.parseEther('0.1');
      const compBold = ONE_ETH;

      let compBoldInSps = calcAssetsInSPs(compBold);
      let pendingGainsInSPs = calcAssetsInSPs(pendingGains);

      // set compounded yield
      await sp0.setCompoundedBoldDeposit(compBoldInSps[0]);
      await sp1.setCompoundedBoldDeposit(compBoldInSps[1]);
      await sp2.setCompoundedBoldDeposit(compBoldInSps[2]);

      // set pending yield
      await sp0.setDepositorYieldGainWithPending(pendingGainsInSPs[0]);
      await sp1.setDepositorYieldGainWithPending(pendingGainsInSPs[1]);
      await sp2.setDepositorYieldGainWithPending(pendingGainsInSPs[2]);

      await sp0.setDepositorCollGain(ONE_ETH);

      await priceOracle.setQuote(bold.target, ONE_ETH);
      await priceOracle.setQuote(stETH.target, quote);

      const maxWithdraw = await sBold.maxWithdraw(ownerAddress);
      // maxWithdraw should be equal to yield gains
      expect(maxWithdraw).to.be.eq(compBold + pendingGains);
    });

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

    it('should return 0 if sBOLD is paused', async function () {
      const ownerAddress = await owner.getAddress();

      // setup
      await sBold.pause();

      // deposit
      expect(await sBold.maxWithdraw(ownerAddress)).to.be.eq(0);
    });

    it('should return 0 when external call to oracle for collateral fails', async function () {
      const ownerAddress = await owner.getAddress();

      const quote = 1000;
      await sp0.setDepositorCollGain(quote);

      // setup
      await priceOracle.setQuote(bold.target, ONE_ETH);
      await priceOracle.setQuote(stETH.target, quote);

      await priceOracle.setRevert(stETH.target, true);

      expect(await sBold.maxWithdraw(ownerAddress)).to.be.eq(0);
    });

    it('should return 0 when external call to oracle for $BOLD fails', async function () {
      const ownerAddress = await owner.getAddress();

      const quote = 1000;
      await sp0.setDepositorCollGain(quote);

      // setup
      await priceOracle.setQuote(bold.target, ONE_ETH);
      await priceOracle.setQuote(stETH.target, quote);

      await priceOracle.setRevert(bold.target, true);

      expect(await sBold.maxWithdraw(ownerAddress)).to.be.eq(0);
    });
  });

  describe('#maxRedeem', function () {
    (
      [BigInt(1), BigInt(2), BigInt(5), BigInt(10), BigInt(25), BigInt(58), BigInt(10028), BigInt(1240028)] as bigint[]
    ).forEach((shares: bigint) => {
      it(`should maxRedeem return value equal to the $BOLD amount with shares of ${shares}`, async function () {
        const ownerAddress = await owner.getAddress();
        const quote = ONE_ETH * BigInt(1000);
        const maxCollInBold = quote;

        const depositAmount = ONE_ETH * shares;

        // setup
        await bold.mint(depositAmount);
        await bold.approve(sBold.target, depositAmount);

        await sBold.setMaxCollInBold(maxCollInBold);

        // deposit
        await sBold.deposit(depositAmount, ownerAddress);

        // appreciate
        const pendingGains = ethers.parseEther('0.1');
        const compBold = depositAmount;

        let compBoldInSps = calcAssetsInSPs(compBold);
        let pendingGainsInSPs = calcAssetsInSPs(pendingGains);

        // set compounded yield
        await sp0.setCompoundedBoldDeposit(compBoldInSps[0]);
        await sp1.setCompoundedBoldDeposit(compBoldInSps[1]);
        await sp2.setCompoundedBoldDeposit(compBoldInSps[2]);

        // set pending yield
        await sp0.setDepositorYieldGainWithPending(pendingGainsInSPs[0]);
        await sp1.setDepositorYieldGainWithPending(pendingGainsInSPs[1]);
        await sp2.setDepositorYieldGainWithPending(pendingGainsInSPs[2]);

        await sp0.setDepositorCollGain(ONE_ETH);

        await priceOracle.setQuote(bold.target, ONE_ETH);
        await priceOracle.setQuote(stETH.target, quote);

        const maxRedeem = await sBold.maxRedeem(ownerAddress);
        // total balance $BOLD = 2.1
        const balanceBold = compBold + pendingGains;

        const sharesFromTotalBold = await sBold.convertToShares(balanceBold);

        expect(maxRedeem).to.be.eq(sharesFromTotalBold);
      });
    });

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

    it('should return 0 if sBOLD is paused', async function () {
      const ownerAddress = await owner.getAddress();

      // setup
      await sBold.pause();

      // deposit
      expect(await sBold.maxRedeem(ownerAddress)).to.be.eq(0);
    });

    it('should return 0 when external call to oracle for collateral fails', async function () {
      const ownerAddress = await owner.getAddress();

      const quote = 1000;
      await sp0.setDepositorCollGain(quote);

      // setup
      await priceOracle.setQuote(bold.target, ONE_ETH);
      await priceOracle.setQuote(stETH.target, quote);

      await priceOracle.setRevert(stETH.target, true);

      expect(await sBold.maxRedeem(ownerAddress)).to.be.eq(0);
    });

    it('should return 0 when external call to oracle for $BOLD fails', async function () {
      const ownerAddress = await owner.getAddress();

      const quote = 1000;
      await sp0.setDepositorCollGain(quote);

      // setup
      await priceOracle.setQuote(bold.target, ONE_ETH);
      await priceOracle.setQuote(stETH.target, quote);

      await priceOracle.setRevert(bold.target, true);

      expect(await sBold.maxRedeem(ownerAddress)).to.be.eq(0);
    });
  });

  describe('#previewDeposit', function () {
    it('should previewDeposit return value equal to the $BOLD amount', async function () {
      const feeBps = BigInt(100);
      await sBold.setFees(feeBps, 0);

      const previewDeposit = await sBold.previewDeposit(ONE_ETH);

      // performs fee on total
      const expPreview = ONE_ETH - (ONE_ETH * feeBps) / (BigInt(10_000) + feeBps);

      expect(previewDeposit).to.approximately(expPreview, BigInt(1));
    });
  });

  describe('#previewMint', function () {
    it('should previewMint return value equal to the $sBOLD amount', async function () {
      const feeBps = BigInt(100);
      await sBold.setFees(feeBps, 0);

      const previewMint = await sBold.previewMint(ONE_ETH);

      // performs fee on total
      const expPreview = ONE_ETH + (ONE_ETH * feeBps) / BigInt(10_000);

      expect(previewMint).to.approximately(expPreview, BigInt(1));
    });
  });

  describe('#previewWithdraw', function () {
    it('should previewWithdraw return value equal to the $BOLD amount', async function () {
      const previewWithdraw = await sBold.previewWithdraw(ONE_ETH);

      // performs fee on total
      const expShares = ONE_ETH;

      expect(previewWithdraw).to.approximately(expShares, BigInt(1));
    });
  });

  describe('#previewRedeem', function () {
    it('should previewRedeem return value equal to the $BOLD amount', async function () {
      const previewRedeem = await sBold.previewRedeem(ONE_ETH);

      // performs fee on total
      const expAssets = ONE_ETH;

      expect(previewRedeem).to.approximately(expAssets, BigInt(1));
    });
  });

  describe('#convertToAssets', function () {
    it('should convertToAssets return value equal to the assets amount', async function () {
      const assets = await sBold.convertToAssets(ONE_ETH);

      // performs fee on total
      const expAssets = ONE_ETH;

      expect(assets).to.approximately(expAssets, BigInt(1));
    });

    it('should perform convertToShares with correct rounding', async function () {
      await bold.mintTo(sBold.target, ethers.parseEther('0.13000000000000037'));

      const assets = await sBold.convertToAssets(ONE_ETH);

      // performs fee on total
      const expAssets = '1130000000000000369';

      expect(assets).to.eq(expAssets);
    });
  });

  describe('#convertToShares', function () {
    it('should convertToShares return value equal to the correct share amount', async function () {
      const shares = await sBold.convertToShares(ONE_ETH);

      // performs fee on total
      const expShares = ONE_ETH;

      expect(shares).to.approximately(expShares, BigInt(1));
    });

    it('should perform convertToShares with correct rounding', async function () {
      await bold.mintTo(sBold.target, ethers.parseEther('0.13000000000000037'));

      const shares = await sBold.convertToShares(ONE_ETH);

      const expShares = '884955752212389090';

      expect(shares).to.equal(expShares);
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

        const previewDeposit = await sBold.previewDeposit(ONE_ETH);

        // deposit
        await sBold.deposit(ONE_ETH, ownerAddress);
        // performs fee on total
        const expPreview = ONE_ETH - (ONE_ETH * feeBps) / (BigInt(10_000) + feeBps);

        expect(previewDeposit).to.approximately(expPreview, BigInt(1));

        // update
        // one $BOLD * (1 - fee)
        await priceOracle.setQuote(bold.target, ONE_ETH);

        // deposit
        await sBold.deposit(ONE_ETH, ownerAddress);

        // 2 $BOLD * (1 - fee)
        const expSBoldBalance = depositAssetsAmount - (depositAssetsAmount * feeBps) / (BigInt(10_000) + feeBps);

        const sBoldBalanceOwner = await sBold.balanceOf(ownerAddress);
        expect(sBoldBalanceOwner).to.approximately(expSBoldBalance, 3);
      });
    });

    it('should create consecutive $BOLD deposits', async function () {
      const bobAddress = await bob.getAddress();

      // setup
      await bold.mint(ONE_ETH);
      await bold.approve(sBold.target, ONE_ETH);

      // 1st deposit
      const firstDepositorAmount = ONE_ETH;
      await sBold.deposit(firstDepositorAmount, await owner.getAddress());

      // Add yield gain of 0.1 $BOLD - 10% to eachSP + mint same bold amount
      const yieldGain0 = ethers.parseEther('0.1');
      let assetsInSPs = calcAssetsInSPs(yieldGain0);

      await sp0.setDepositorYieldGainWithPending(assetsInSPs[0]);
      await sp1.setDepositorYieldGainWithPending(assetsInSPs[1]);
      await sp2.setDepositorYieldGainWithPending(assetsInSPs[2]);

      await bold.mintTo(sp0.target, assetsInSPs[0]);
      await bold.mintTo(sp1.target, assetsInSPs[1]);
      await bold.mintTo(sp2.target, assetsInSPs[2]);

      await priceOracle.setQuote(bold.target, ONE_ETH);

      const rate0 = await sBold.getSBoldRate();
      const totalSupply0 = await sBold.totalSupply();
      // rate = 1.1 value / 1 $sBOLD total supply
      const expectedRate0 = ((firstDepositorAmount + yieldGain0 + initialDeposit) * ONE_ETH) / totalSupply0;

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

      expect(sBoldBalanceBob0).to.approximately(expectedsBoldBalanceBob0, 2);

      const yieldGain1 = ethers.parseEther('0.1');
      assetsInSPs = calcAssetsInSPs(yieldGain1);

      await bold.mintTo(sp0.target, assetsInSPs[0]);
      await bold.mintTo(sp1.target, assetsInSPs[1]);
      await bold.mintTo(sp2.target, assetsInSPs[2]);

      const yieldGainAll = ethers.parseEther('0.2');
      assetsInSPs = calcAssetsInSPs(yieldGainAll);

      await sp0.setDepositorYieldGainWithPending(assetsInSPs[0]);
      await sp1.setDepositorYieldGainWithPending(assetsInSPs[1]);
      await sp2.setDepositorYieldGainWithPending(assetsInSPs[2]);

      const updatedCompBold1 = firstDepositorAmount + secondDepositorAmount + yieldGain0 + yieldGain1;

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

    it('should revert if call to oracle for collateral fails', async function () {
      const ownerAddress = await owner.getAddress();

      const quote = 1000;
      await sp0.setDepositorCollGain(quote);

      await priceOracle.setQuote(bold.target, ONE_ETH);
      await priceOracle.setQuote(stETH.target, quote);

      await priceOracle.setRevert(stETH.target, true);

      // setup
      await expect(sBold.deposit(ONE_ETH, ownerAddress)).to.be.rejected;
    });

    it('should revert if call to oracle for $BOLD fails', async function () {
      const ownerAddress = await owner.getAddress();

      const quote = 1000;
      await sp0.setDepositorCollGain(quote);

      await priceOracle.setQuote(bold.target, ONE_ETH);
      await priceOracle.setQuote(stETH.target, quote);

      await priceOracle.setRevert(bold.target, true);

      // setup
      await expect(sBold.deposit(ONE_ETH, ownerAddress)).to.be.rejected;
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

        const previewMint = await sBold.previewMint(ONE_ETH);

        let vaultBalanceBefore = await bold.balanceOf(vault.getAddress());
        let ownerBalanceBefore = await bold.balanceOf(owner.getAddress());

        // mint
        await sBold.mint(ONE_ETH, ownerAddress);

        let vaultBalanceAfter = await bold.balanceOf(vault.getAddress());
        let ownerBalanceAfter = await bold.balanceOf(owner.getAddress());

        const expPreview = ONE_ETH + (ONE_ETH * feeBps) / BigInt(10_000);

        expect(previewMint).to.eq(expPreview);
        expect(vaultBalanceBefore + fee / BigInt(2)).to.eq(vaultBalanceAfter);
        expect(ownerBalanceBefore).to.eq(ownerBalanceAfter + ONE_ETH + fee / BigInt(2));

        // update
        await priceOracle.setQuote(bold.target, ONE_ETH);

        vaultBalanceBefore = await bold.balanceOf(vault.getAddress());
        ownerBalanceBefore = await bold.balanceOf(owner.getAddress());

        // mint
        await sBold.mint(ONE_ETH, ownerAddress);

        vaultBalanceAfter = await bold.balanceOf(vault.getAddress());
        ownerBalanceAfter = await bold.balanceOf(owner.getAddress());

        const sBoldBalanceOwner = await sBold.balanceOf(ownerAddress);
        expect(sBoldBalanceOwner).to.eq(mintShareAmount);
        expect(vaultBalanceBefore + fee / BigInt(2)).to.eq(vaultBalanceAfter);
        expect(ownerBalanceBefore).to.eq(ownerBalanceAfter + ONE_ETH + fee / BigInt(2));
      });
    });

    it('should create consecutive $sBOLD mints', async function () {
      const bobAddress = await bob.getAddress();

      // Mint one bold to owner and approve protocol.
      await bold.mint(ONE_ETH);
      await bold.approve(sBold.target, ONE_ETH);

      // 1st deposit - 1 $sBOLD in $BOLD value from owner.
      await sBold.mint(ONE_ETH, await owner.getAddress());

      // Add yield gain of 0.1 $BOLD - 10% to eachSP + mint same bold amount
      const yieldGain0 = ethers.parseEther('0.1');
      let assetsInSPs = calcAssetsInSPs(yieldGain0);

      await sp0.setDepositorYieldGainWithPending(assetsInSPs[0]);
      await sp1.setDepositorYieldGainWithPending(assetsInSPs[1]);
      await sp2.setDepositorYieldGainWithPending(assetsInSPs[2]);

      await bold.mintTo(sp0.target, assetsInSPs[0]);
      await bold.mintTo(sp1.target, assetsInSPs[1]);
      await bold.mintTo(sp2.target, assetsInSPs[2]);

      // Set oracle price
      await priceOracle.setQuote(bold.target, ONE_ETH);

      const totalSupply0 = await sBold.totalSupply();

      const rate0 = await sBold.getSBoldRate();

      // rate = 2.1 ( dead share + deposit + yield) value * 1 $sBOLD /total supply
      const expectedRate0 = ((ONE_ETH + ONE_ETH + yieldGain0) * ONE_ETH) / totalSupply0;

      expect(rate0).to.approximately(expectedRate0, 1);

      const contractSigner = sBold.connect(bob) as SBold;
      const boldSigner = bold.connect(bob) as MockERC20;

      // 2st deposit - 2 $sBOLD in $BOLD value from bob
      const secondDepositorShares = ethers.parseEther('2');
      const secondDepositorAmount = ethers.parseEther('2.1');

      await boldSigner.mint(secondDepositorAmount);
      await boldSigner.approve(sBold.target, secondDepositorAmount);

      await contractSigner.mint(secondDepositorShares, await bob.getAddress());

      const sBoldBalanceBob1 = await sBold.balanceOf(bobAddress);

      // deposited amount of $BOLD in the SPs
      const boldBalanceSP0 = await bold.balanceOf(sp0.target);
      const boldBalanceSP1 = await bold.balanceOf(sp1.target);
      const boldBalanceSP2 = await bold.balanceOf(sp2.target);

      // 1st deposit + 2nd deposit + yield.
      const total = ONE_ETH + secondDepositorAmount + yieldGain0;

      expect(sBoldBalanceBob1).to.eq(secondDepositorShares);

      const expBalanceInSPsTotal = calcAssetsInSPs(total);

      expect(boldBalanceSP0).to.eq(expBalanceInSPsTotal[0]);
      expect(boldBalanceSP1).to.eq(expBalanceInSPsTotal[1]);
      expect(boldBalanceSP2).to.eq(expBalanceInSPsTotal[2]);

      const totalSupply1 = await sBold.totalSupply();

      const rate1 = await sBold.getSBoldRate();

      // dead share + total deposit + yield * 1 $sBold / total supply
      const expectedRate1 = ((ONE_ETH + total) * ONE_ETH) / totalSupply1;

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

    it('should revert if call to oracle for collateral fails', async function () {
      const ownerAddress = await owner.getAddress();

      const quote = 1000;
      await sp0.setDepositorCollGain(quote);

      await priceOracle.setQuote(bold.target, ONE_ETH);
      await priceOracle.setQuote(stETH.target, quote);

      await priceOracle.setRevert(stETH.target, true);

      // setup
      await expect(sBold.mint(ONE_ETH, ownerAddress)).to.be.rejected;
    });

    it('should revert if call to oracle for $BOLD fails', async function () {
      const ownerAddress = await owner.getAddress();

      const quote = 1000;
      await sp0.setDepositorCollGain(quote);

      await priceOracle.setQuote(bold.target, ONE_ETH);
      await priceOracle.setQuote(stETH.target, quote);

      await priceOracle.setRevert(bold.target, true);

      // setup
      await expect(sBold.mint(ONE_ETH, ownerAddress)).to.be.rejected;
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
      const pendingGains = ethers.parseEther('0.1');
      const compBold = ONE_ETH;

      let compBoldInSps = calcAssetsInSPs(compBold);
      let pendingGainsInSPs = calcAssetsInSPs(pendingGains);

      // stub amounts
      await bold.mintTo(sp0.target, pendingGainsInSPs[0]);
      await bold.mintTo(sp1.target, pendingGainsInSPs[1]);
      await bold.mintTo(sp2.target, pendingGainsInSPs[2]);

      // set compounded yield
      await sp0.setCompoundedBoldDeposit(compBoldInSps[0]);
      await sp1.setCompoundedBoldDeposit(compBoldInSps[1]);
      await sp2.setCompoundedBoldDeposit(compBoldInSps[2]);

      // set pending yield
      await sp0.setDepositorYieldGainWithPending(pendingGainsInSPs[0]);
      await sp1.setDepositorYieldGainWithPending(pendingGainsInSPs[1]);
      await sp2.setDepositorYieldGainWithPending(pendingGainsInSPs[2]);

      const maxWithdraw = await sBold.maxWithdraw(ownerAddress);

      const sp0BalanceBefore = await bold.balanceOf(sp0.target);
      const sp1BalanceBefore = await bold.balanceOf(sp1.target);
      const sp2BalanceBefore = await bold.balanceOf(sp2.target);

      // withdraw
      await sBold.withdraw(maxWithdraw, ownerAddress, ownerAddress);

      const sp0BalanceAfter = await bold.balanceOf(sp0.target);
      const sp1BalanceAfter = await bold.balanceOf(sp1.target);
      const sp2BalanceAfter = await bold.balanceOf(sp2.target);

      const deltaSP0 = sp0BalanceBefore - sp0BalanceAfter;
      const deltaSP1 = sp1BalanceBefore - sp1BalanceAfter;
      const deltaSP2 = sp2BalanceBefore - sp2BalanceAfter;

      const expCompoundedBoldBalance = ONE_ETH + pendingGains / BigInt(2) - BigInt(1);
      const compoundedBoldBalance = await bold.balanceOf(ownerAddress);

      expect(compoundedBoldBalance).to.eq(expCompoundedBoldBalance);

      const expectedWithdrawnDistribution = calcAssetsInSPs(expCompoundedBoldBalance);

      expect(deltaSP0).to.approximately(expectedWithdrawnDistribution[0], 1);
      expect(deltaSP1).to.approximately(expectedWithdrawnDistribution[1], 1);
      expect(deltaSP2).to.approximately(expectedWithdrawnDistribution[2], 1);
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
      // Bob deposits and sets `owner` as receiver
      await sBoldSignerBob.deposit(ONE_ETH, ownerAddress);

      // appreciate
      const yieldGain = ethers.parseEther('0.1');
      const updatedCompBold = BigInt(2) * ONE_ETH + yieldGain;

      let assetsInSPs = calcAssetsInSPs(updatedCompBold);
      let yieldInSps = calcAssetsInSPs(yieldGain);

      // Get yield gains only from SP0
      await bold.mintTo(sp0.target, yieldInSps[0]);
      await bold.mintTo(sp1.target, yieldInSps[1]);
      await bold.mintTo(sp2.target, yieldInSps[2]);

      // set compounded yield
      await sp0.setCompoundedBoldDeposit(assetsInSPs[0]);
      await sp1.setCompoundedBoldDeposit(assetsInSPs[1]);
      await sp2.setCompoundedBoldDeposit(assetsInSPs[2]);

      // set quote
      await priceOracle.setQuote(bold.target, ONE_ETH);

      const maxWithdraw = await sBold.maxWithdraw(ownerAddress);
      const maxWithdrawBob = await sBold.maxWithdraw(bobAddress);

      expect(maxWithdrawBob).to.eq(0);

      // withdraw
      await sBold.withdraw(maxWithdraw, ownerAddress, ownerAddress);
      // 1 $BOLD from first deposit + decreased funds from consecutive deposits / total supply
      const expCompoundedBoldBalance = ((updatedCompBold + ONE_ETH) / BigInt(3)) * BigInt(2);
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

      await priceOracle.setQuote(bold.target, ONE_ETH);

      // deposit
      await contractSignerBob.deposit(ONE_ETH, bobAddress);

      // appreciate
      const yieldGain = ethers.parseEther('0.2');
      const updatedCompBold = BigInt(2) * ONE_ETH + yieldGain;
      const yieldInSPs = calcAssetsInSPs(yieldGain);

      // stub amounts
      await bold.mintTo(sp0.target, yieldInSPs[0]);
      await bold.mintTo(sp1.target, yieldInSPs[1]);
      await bold.mintTo(sp2.target, yieldInSPs[2]);

      let assetsInSPs = calcAssetsInSPs(updatedCompBold);

      await sp0.setCompoundedBoldDeposit(assetsInSPs[0]);
      await sp1.setCompoundedBoldDeposit(assetsInSPs[1]);
      await sp2.setCompoundedBoldDeposit(assetsInSPs[2]);

      await priceOracle.setQuote(bold.target, ONE_ETH);

      // get max amounts
      const maxWithdrawOwner = await sBold.maxWithdraw(ownerAddress);

      // withdraw
      await contractSignerOwner.withdraw(maxWithdrawOwner, ownerAddress, ownerAddress);

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

    it('should revert if call to oracle for collateral fails', async function () {
      const ownerAddress = await owner.getAddress();

      const quote = 1000;
      await sp0.setDepositorCollGain(quote);

      await priceOracle.setQuote(bold.target, ONE_ETH);
      await priceOracle.setQuote(stETH.target, quote);

      await priceOracle.setRevert(stETH.target, true);

      // setup
      await expect(sBold.withdraw(ONE_ETH, ownerAddress, ownerAddress)).to.be.rejected;
    });

    it('should revert if call to oracle for $BOLD fails', async function () {
      const ownerAddress = await owner.getAddress();

      const quote = 1000;
      await sp0.setDepositorCollGain(quote);

      await priceOracle.setQuote(bold.target, ONE_ETH);
      await priceOracle.setQuote(stETH.target, quote);

      await priceOracle.setRevert(bold.target, true);

      // setup
      await expect(sBold.withdraw(ONE_ETH, ownerAddress, ownerAddress)).to.be.rejected;
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

      let assetsInSPs = calcAssetsInSPs(ONE_ETH);
      // stub amounts
      await sp0.setCompoundedBoldDeposit(assetsInSPs[0]);
      await sp1.setCompoundedBoldDeposit(assetsInSPs[1]);
      await sp2.setCompoundedBoldDeposit(assetsInSPs[2]);

      // set $BOLD quote for 1 $BOLD
      await priceOracle.setQuote(bold.target, ONE_ETH);

      // 2nd deposit
      await contractSignerBob.deposit(ONE_ETH, bobAddress);

      assetsInSPs = calcAssetsInSPs(ONE_ETH * BigInt(2));
      // stub amounts
      await sp0.setCompoundedBoldDeposit(assetsInSPs[0]);
      await sp1.setCompoundedBoldDeposit(assetsInSPs[1]);
      await sp2.setCompoundedBoldDeposit(assetsInSPs[2]);

      let pendingGainsInSPs = calcAssetsInSPs(ONE_ETH);

      // set pending yield
      await sp0.setDepositorYieldGainWithPending(pendingGainsInSPs[0]);
      await sp1.setDepositorYieldGainWithPending(pendingGainsInSPs[1]);
      await sp2.setDepositorYieldGainWithPending(pendingGainsInSPs[2]);

      await bold.mintTo(sp0.target, pendingGainsInSPs[0]);
      await bold.mintTo(sp1.target, pendingGainsInSPs[1]);
      await bold.mintTo(sp2.target, pendingGainsInSPs[2]);

      const maxRedeemOwner = await sBold.maxRedeem(ownerAddress);

      // redeem
      await contractSignerOwner.redeem(maxRedeemOwner, ownerAddress, ownerAddress);

      const maxRedeemBob = await sBold.maxRedeem(bobAddress);

      // redeem
      await contractSignerBob.redeem(maxRedeemBob, bobAddress, bobAddress);

      // assert
      expect(await bold.balanceOf(ownerAddress)).to.approximately(ONE_ETH + ONE_ETH / BigInt(3), 1);
      expect(await bold.balanceOf(bobAddress)).to.approximately(ONE_ETH + ONE_ETH / BigInt(3), 1);
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

    it('should revert if call to oracle for collateral fails', async function () {
      const ownerAddress = await owner.getAddress();

      const quote = 1000;
      await sp0.setDepositorCollGain(quote);

      await priceOracle.setQuote(bold.target, ONE_ETH);
      await priceOracle.setQuote(stETH.target, quote);

      await priceOracle.setRevert(stETH.target, true);

      // setup
      await expect(sBold.redeem(ONE_ETH, ownerAddress, ownerAddress)).to.be.rejected;
    });

    it('should revert if call to oracle for $BOLD fails', async function () {
      const ownerAddress = await owner.getAddress();

      const quote = 1000;
      await sp0.setDepositorCollGain(quote);

      await priceOracle.setQuote(bold.target, ONE_ETH);
      await priceOracle.setQuote(stETH.target, quote);

      await priceOracle.setRevert(bold.target, true);

      // setup
      await expect(sBold.redeem(ONE_ETH, ownerAddress, ownerAddress)).to.be.rejected;
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
      // 0% fees in BPS, $BOLD price is 1e18
      [BigInt(0), BigInt(0), ONE_ETH],
      // 0% swap fee in BPS + 2.5% reward in BPS, $BOLD price is 2e18
      [BigInt(0), BigInt(250), ONE_ETH * BigInt(2)],
      // 2.5% swap fee in BPS + 2.5% reward in BPS, $BOLD price is 2e18
      [BigInt(250), BigInt(250), ONE_ETH * BigInt(2)],
      // 0% fees in BPS, $BOLD price is 5e17
      [BigInt(0), BigInt(0), ONE_ETH / BigInt(2)],
    ].forEach(([swapFeeBps, rewardBps, boldPrice]) => {
      it('should swap collateral to $sBOLD with fees and different quotes for $BOLD', async function () {
        const ownerAddress = await owner.getAddress();

        // setup
        await bold.mint(ONE_ETH);
        await bold.approve(sBold.target, ONE_ETH);

        // deposit
        await sBold.deposit(ONE_ETH, ownerAddress);

        // appreciate
        const yieldGain = ethers.parseEther('0.1');
        const accumulatedColl = ethers.parseEther('0.2');
        const accumulatedCollStashed = ethers.parseEther('0.2');
        const updatedCompBold = ONE_ETH + yieldGain;
        const ethUSDPrice = ethers.parseEther('2000');

        // stub amounts
        await bold.mintTo(sp0.target, updatedCompBold);

        let assetsInSPs = calcAssetsInSPs(updatedCompBold);
        let assetsInSPsColl = calcAssetsInSPs(accumulatedColl);
        let assetsInSPsStashedColl = calcAssetsInSPs(accumulatedCollStashed);

        // set yield gains
        await sp0.setCompoundedBoldDeposit(assetsInSPs[0]);
        await sp1.setCompoundedBoldDeposit(assetsInSPs[1]);
        await sp2.setCompoundedBoldDeposit(assetsInSPs[2]);

        // set collateral gains
        await sp0.setDepositorCollGain(assetsInSPsColl[0]);
        await sp1.setDepositorCollGain(assetsInSPsColl[1]);
        await sp2.setDepositorCollGain(assetsInSPsColl[2]);

        // set stashed collateral
        await sp0.setStashedColl(assetsInSPsStashedColl[0]);
        await sp1.setStashedColl(assetsInSPsStashedColl[1]);
        await sp2.setStashedColl(assetsInSPsStashedColl[2]);

        // set quotes
        await priceOracle.setQuote(bold.target, boldPrice);

        const quoteStETH = ((assetsInSPsColl[0] + assetsInSPsStashedColl[0]) * ethUSDPrice) / ONE_ETH; // 0.8 * 2000
        await priceOracle.setQuote(stETH.target, quoteStETH);

        const quoteWstETH = ((assetsInSPsColl[1] + assetsInSPsStashedColl[1]) * ethUSDPrice) / ONE_ETH; // 0.8 * 2000
        await priceOracle.setQuote(wstETH.target, quoteWstETH);

        const quoteRETH = ((assetsInSPsColl[2] + assetsInSPsStashedColl[2]) * ethUSDPrice) / ONE_ETH; // 0.4 * 2000
        await priceOracle.setQuote(rETH.target, quoteRETH);

        // Total collateral in USD = 4000 /2 * 2000/, so the swapped $BOLD should be 4000

        // mint $BOLD
        await bold.mintTo(sp0.target, assetsInSPs[0]);
        await bold.mintTo(sp1.target, assetsInSPs[1]);
        await bold.mintTo(sp2.target, assetsInSPs[2]);

        // mint Colls
        await stETH.mintTo(sp0.target, assetsInSPsColl[0] + assetsInSPsStashedColl[0]);
        await wstETH.mintTo(sp1.target, assetsInSPsColl[1] + assetsInSPsStashedColl[0]);
        await rETH.mintTo(sp2.target, assetsInSPsColl[2] + assetsInSPsStashedColl[0]);

        // set Colls to transfer
        await sp0.setTransferCollAmount(assetsInSPsColl[0] + assetsInSPsStashedColl[0]);
        await sp1.setTransferCollAmount(assetsInSPsColl[1] + assetsInSPsStashedColl[0]);
        await sp2.setTransferCollAmount(assetsInSPsColl[2] + assetsInSPsStashedColl[0]);

        // set collateral quotes
        await router.setQuotes(stETH.target, (quoteStETH * ONE_ETH) / boldPrice);
        await router.setQuotes(wstETH.target, (quoteWstETH * ONE_ETH) / boldPrice);
        await router.setQuotes(rETH.target, (quoteRETH * ONE_ETH) / boldPrice);

        await sBold.setSwapAdapter(router.target);

        // build calldata for swap adapter
        const callData0 = SWAP_INTERFACE.encodeFunctionData('swap', [
          stETH.target,
          bold.target,
          assetsInSPsColl[0] + assetsInSPsStashedColl[0],
          0,
          '0x',
        ]);
        const callData1 = SWAP_INTERFACE.encodeFunctionData('swap', [
          wstETH.target,
          bold.target,
          assetsInSPsColl[1] + assetsInSPsStashedColl[1],
          0,
          '0x',
        ]);
        const callData2 = SWAP_INTERFACE.encodeFunctionData('swap', [
          rETH.target,
          bold.target,
          assetsInSPsColl[2] + assetsInSPsStashedColl[2],
          0,
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
        await sBold.swap(
          [
            { sp: sp0.target, balance: MaxInt256, data: callData0 },
            { sp: sp1.target, balance: MaxInt256, data: callData1 },
            { sp: sp2.target, balance: MaxInt256, data: callData2 },
          ],
          ownerAddress,
        );

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

        expect(deltaSP0).to.eq((expNetSP0 * ONE_ETH) / boldPrice);
        expect(deltaSP1).to.eq((expNetSP1 * ONE_ETH) / boldPrice);
        expect(deltaSP2).to.eq((expNetSP2 * ONE_ETH) / boldPrice);
      });
    });

    [
      // 0% swap fee in BPS
      [0, 0],
      // 0% swap fee in BPS + 2.5% reward in BPS
      [0, BigInt(250)],
      // 2.5% swap fee in BPS + 2.5% reward in BPS
      [BigInt(250), BigInt(250)],
    ].forEach(([swapFeeBps, rewardBps]) => {
      it('should swap collateral to $sBOLD for 2/3 number of SPs', async function () {
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

        // set collateral gains
        await sp0.setDepositorCollGain(assetsInSPsColl[0]);
        await sp1.setDepositorCollGain(assetsInSPsColl[1]);

        // set quotes
        await priceOracle.setQuote(bold.target, ONE_ETH);

        const quoteStETH = (assetsInSPsColl[0] * ethUSDPrice) / ONE_ETH; // 0.8 * 2000
        await priceOracle.setQuote(stETH.target, quoteStETH);

        const quoteWstETH = (assetsInSPsColl[1] * ethUSDPrice) / ONE_ETH; // 0.8 * 2000
        await priceOracle.setQuote(wstETH.target, quoteWstETH);

        const quoteRETH = (assetsInSPsColl[2] * ethUSDPrice) / ONE_ETH; // 0.4 * 2000
        await priceOracle.setQuote(rETH.target, quoteRETH);

        // mint $BOLD
        await bold.mintTo(sp0.target, assetsInSPs[0]);
        await bold.mintTo(sp1.target, assetsInSPs[1]);

        // mint Colls
        await stETH.mintTo(sp0.target, assetsInSPsColl[0]);
        await wstETH.mintTo(sp1.target, assetsInSPsColl[1]);

        // set Colls to transfer
        await sp0.setTransferCollAmount(assetsInSPsColl[0]);
        await sp1.setTransferCollAmount(assetsInSPsColl[1]);

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
        await sBold.swap(
          [
            { sp: sp0.target, balance: MaxInt256, data: callData0 },
            { sp: sp1.target, balance: MaxInt256, data: callData1 },
          ],
          ownerAddress,
        );

        const bal1SP0 = await bold.balanceOf(sp0.target);
        const bal1SP1 = await bold.balanceOf(sp1.target);
        const bal1SP2 = await bold.balanceOf(sp2.target);

        const deltaSP0 = bal1SP0 - bal0SP0;
        const deltaSP1 = bal1SP1 - bal0SP1;
        const deltaSP2 = bal1SP2 - bal0SP2;

        const swapFeeSP0 = (quoteStETH * BigInt(swapFeeBps)) / BigInt(10_000);
        const swapFeeSP1 = (quoteWstETH * BigInt(swapFeeBps)) / BigInt(10_000);

        const rewardSP0 = (quoteStETH * BigInt(rewardBps)) / BigInt(10_000);
        const rewardSP1 = (quoteWstETH * BigInt(rewardBps)) / BigInt(10_000);

        const expNetSP0 =
          ((quoteStETH - swapFeeSP0 - rewardSP0) * BigInt(WEIGHTS[0])) / BigInt(10_000) +
          ((quoteWstETH - swapFeeSP1 - rewardSP1) * BigInt(WEIGHTS[0])) / BigInt(10_000);
        const expNetSP1 =
          ((quoteStETH - swapFeeSP0 - rewardSP0) * BigInt(WEIGHTS[1])) / BigInt(10_000) +
          ((quoteWstETH - swapFeeSP1 - rewardSP1) * BigInt(WEIGHTS[1])) / BigInt(10_000);
        const expNetSP2 =
          ((quoteStETH - swapFeeSP0 - rewardSP0) * BigInt(WEIGHTS[2])) / BigInt(10_000) +
          ((quoteWstETH - swapFeeSP1 - rewardSP1) * BigInt(WEIGHTS[2])) / BigInt(10_000);

        expect(deltaSP0).to.eq(expNetSP0);
        expect(deltaSP1).to.eq(expNetSP1);
        expect(deltaSP2).to.eq(expNetSP2);
      });
    });

    [
      // 0% swap fee in BPS
      [0, 0],
      // 0% swap fee in BPS + 2.5% reward in BPS
      [0, BigInt(250)],
      // 2.5% swap fee in BPS + 2.5% reward in BPS
      [BigInt(250), BigInt(250)],
    ].forEach(([swapFeeBps, rewardBps]) => {
      it('should partially swap collateral to $sBOLD for 1/3 number of SPs which should result in idle collateral in protocol', async function () {
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

        // set collateral gains
        await sp0.setDepositorCollGain(assetsInSPsColl[0]);

        // set quotes
        await priceOracle.setQuote(bold.target, ONE_ETH);

        const quoteStETH = (assetsInSPsColl[0] * ethUSDPrice) / ONE_ETH; // 0.8 * 2000
        await priceOracle.setQuote(stETH.target, quoteStETH);

        const quoteWstETH = (assetsInSPsColl[1] * ethUSDPrice) / ONE_ETH; // 0.8 * 2000
        await priceOracle.setQuote(wstETH.target, quoteWstETH);

        const quoteRETH = (assetsInSPsColl[2] * ethUSDPrice) / ONE_ETH; // 0.4 * 2000
        await priceOracle.setQuote(rETH.target, quoteRETH);

        // mint $BOLD
        await bold.mintTo(sp0.target, assetsInSPs[0]);

        // mint Colls
        await stETH.mintTo(sp0.target, assetsInSPsColl[0]);

        // set Colls to transfer
        await sp0.setTransferCollAmount(assetsInSPsColl[0]);

        // set collateral quotes
        await router.setQuotes(stETH.target, quoteStETH);
        await router.setQuotes(wstETH.target, quoteWstETH);
        await router.setQuotes(rETH.target, quoteRETH);

        await sBold.setSwapAdapter(router.target);

        // build calldata for swap adapter
        const callData0 = SWAP_INTERFACE.encodeFunctionData('swap', [
          stETH.target,
          bold.target,
          assetsInSPsColl[0] - BigInt(1),
          assetsInSPsColl[0],
          '0x',
        ]);

        const bal0SP0 = await bold.balanceOf(sp0.target);
        const bal0SP1 = await bold.balanceOf(sp1.target);
        const bal0SP2 = await bold.balanceOf(sp2.target);

        const collBalanceBefore = await stETH.balanceOf(sBold.target);

        // set fee
        if (swapFeeBps > 0) {
          await sBold.setFees(0, swapFeeBps);
        }

        // set reward
        if (rewardBps > 0) {
          await sBold.setReward(rewardBps);
        }

        const balanceToSwap = assetsInSPsColl[0] - BigInt(1);

        // execute swap
        await sBold.swap([{ sp: sp0.target, balance: balanceToSwap, data: callData0 }], ownerAddress);

        const bal1SP0 = await bold.balanceOf(sp0.target);
        const bal1SP1 = await bold.balanceOf(sp1.target);
        const bal1SP2 = await bold.balanceOf(sp2.target);

        const collBalanceAfter = await stETH.balanceOf(sBold.target);

        const deltaSP0 = bal1SP0 - bal0SP0;
        const deltaSP1 = bal1SP1 - bal0SP1;
        const deltaSP2 = bal1SP2 - bal0SP2;

        const deltaCollBalance = collBalanceAfter;

        const swapFeeSP0 = (quoteStETH * BigInt(swapFeeBps)) / BigInt(10_000);

        const rewardSP0 = (quoteStETH * BigInt(rewardBps)) / BigInt(10_000);

        const expNetSP0 = ((quoteStETH - swapFeeSP0 - rewardSP0) * BigInt(WEIGHTS[0])) / BigInt(10_000);
        const expNetSP1 = ((quoteStETH - swapFeeSP0 - rewardSP0) * BigInt(WEIGHTS[1])) / BigInt(10_000);
        const expNetSP2 = ((quoteStETH - swapFeeSP0 - rewardSP0) * BigInt(WEIGHTS[2])) / BigInt(10_000);

        const expCollBalance = collBalanceBefore + assetsInSPsColl[0] - balanceToSwap;

        expect(deltaSP0).to.eq(expNetSP0);
        expect(deltaSP1).to.eq(expNetSP1);
        expect(deltaSP2).to.eq(expNetSP2);
        expect(deltaCollBalance).to.eq(expCollBalance);
      });
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
      await expect(
        sBold.swap(
          [
            { sp: sp0.target, balance: MaxInt256, data: '0x' },
            { sp: sp1.target, balance: MaxInt256, data: '0x' },
            { sp: sp2.target, balance: MaxInt256, data: '0x' },
          ],
          ownerAddress,
        ),
      ).to.be.rejectedWith('ExecutionFailed');
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
      await expect(
        sBold.swap(
          [
            { sp: sp0.target, balance: MaxInt256, data: '0x' },
            { sp: sp1.target, balance: MaxInt256, data: callData1 },
            { sp: sp2.target, balance: MaxInt256, data: '0x' },
          ],
          ownerAddress,
        ),
      ).to.be.rejectedWith('InsufficientAmount');
    });

    it('should revert to swap if sBOLD is paused', async function () {
      const ownerAddress = await owner.getAddress();

      // setup
      await sBold.pause();

      // swap
      await expect(
        sBold.swap(
          [
            { sp: sp0.target, balance: MaxInt256, data: '0x' },
            { sp: sp1.target, balance: MaxInt256, data: '0x' },
            { sp: sp2.target, balance: MaxInt256, data: '0x' },
          ],
          ownerAddress,
        ),
      ).to.be.rejectedWith('EnforcedPause');
    });

    it('should revert swap if wrong SP address is passed', async function () {
      const ownerAddress = await owner.getAddress();

      // swap
      await expect(
        sBold.swap(
          [
            { sp: owner.getAddress(), balance: MaxInt256, data: '0x' },
            { sp: sp1.target, balance: MaxInt256, data: '0x' },
            { sp: sp2.target, balance: MaxInt256, data: '0x' },
          ],
          ownerAddress,
        ),
      ).to.be.rejectedWith('InvalidDataArray');
    });

    it('should revert swap if more than available SPs are passed', async function () {
      const ownerAddress = await owner.getAddress();

      // swap
      await expect(
        sBold.swap(
          [
            { sp: sp0.target, balance: MaxInt256, data: '0x' },
            { sp: sp1.target, balance: MaxInt256, data: '0x' },
            { sp: sp2.target, balance: MaxInt256, data: '0x' },
            { sp: sp2.target, balance: MaxInt256, data: '0x' },
          ],
          ownerAddress,
        ),
      ).to.be.rejectedWith('InvalidDataArray');
    });

    it(`should revert on read-only reenter`, async function () {
      const ownerAddress = await owner.getAddress();

      const testRouter = (await ethers.deployContract('TestRouter')).connect(owner) as TestRouter;

      // setup
      await testRouter.setSBold(sBold.target);
      await sBold.setSwapAdapter(testRouter.target);

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

      // set collateral gains
      await sp0.setDepositorCollGain(assetsInSPsColl[0]);
      await sp1.setDepositorCollGain(assetsInSPsColl[1]);

      // set quotes
      await priceOracle.setQuote(bold.target, ONE_ETH);

      const quoteStETH = (assetsInSPsColl[0] * ethUSDPrice) / ONE_ETH; // 0.8 * 2000
      await priceOracle.setQuote(stETH.target, quoteStETH);

      const quoteWstETH = (assetsInSPsColl[1] * ethUSDPrice) / ONE_ETH; // 0.8 * 2000
      await priceOracle.setQuote(wstETH.target, quoteWstETH);

      const quoteRETH = (assetsInSPsColl[2] * ethUSDPrice) / ONE_ETH; // 0.4 * 2000
      await priceOracle.setQuote(rETH.target, quoteRETH);

      // mint $BOLD
      await bold.mintTo(sp0.target, assetsInSPs[0]);
      await bold.mintTo(sp1.target, assetsInSPs[1]);

      // mint Colls
      await stETH.mintTo(sp0.target, assetsInSPsColl[0]);
      await wstETH.mintTo(sp1.target, assetsInSPsColl[1]);

      // set Colls to transfer
      await sp0.setTransferCollAmount(assetsInSPsColl[0]);
      await sp1.setTransferCollAmount(assetsInSPsColl[1]);

      // set collateral quotes
      await testRouter.setQuotes(stETH.target, quoteStETH);
      await testRouter.setQuotes(wstETH.target, quoteWstETH);
      await testRouter.setQuotes(rETH.target, quoteRETH);

      await testRouter.setReceiver(sBold.target);

      const expectations = [
        [sBold.interface.encodeFunctionData('deposit', ['0', random]), true],
        [sBold.interface.encodeFunctionData('mint', ['0', random]), true],
        [sBold.interface.encodeFunctionData('withdraw', ['0', random, random]), true],
        [sBold.interface.encodeFunctionData('redeem', ['0', random, random]), true],
        [sBold.interface.encodeFunctionData('maxDeposit', [random]), true],
        [sBold.interface.encodeFunctionData('maxMint', [random]), true],
        [sBold.interface.encodeFunctionData('maxWithdraw', [random]), true],
        [sBold.interface.encodeFunctionData('maxRedeem', [random]), true],
        [sBold.interface.encodeFunctionData('previewDeposit', [100]), true],
        [sBold.interface.encodeFunctionData('previewMint', [100]), true],
        [sBold.interface.encodeFunctionData('previewWithdraw', [100]), true],
        [sBold.interface.encodeFunctionData('previewRedeem', [100]), true],
        [sBold.interface.encodeFunctionData('convertToShares', [100]), true],
        [sBold.interface.encodeFunctionData('convertToAssets', [100]), true],
        [sBold.interface.encodeFunctionData('totalAssets'), true],
        [sBold.interface.encodeFunctionData('getSBoldRate'), true],
        [sBold.interface.encodeFunctionData('calcFragments'), true],
        [sBold.interface.encodeFunctionData('name'), false],
      ].map(async ([calldata, revert]) => {
        const callDataSwap = SWAP_INTERFACE.encodeFunctionData('swap', [
          stETH.target,
          bold.target,
          assetsInSPsColl[0],
          assetsInSPsColl[0],
          calldata,
        ]);

        if (revert) {
          return expect(
            sBold.swap([{ sp: sp0.target, balance: MaxInt256, data: callDataSwap }], ownerAddress),
          ).to.be.rejectedWith('ExecutionFailed');
        }

        return sBold.swap([{ sp: sp0.target, balance: MaxInt256, data: callDataSwap }], ownerAddress);
      });

      await Promise.all(expectations);
    });
  });

  describe('#rebalanceSPs', function () {
    it('should rabalance current SPs', async function () {
      const ownerAddress = await owner.getAddress();
      const boldPrice = ONE_ETH;

      // setup
      await bold.mint(ONE_ETH);
      await bold.approve(sBold.target, ONE_ETH);

      // deposit
      await sBold.deposit(ONE_ETH, ownerAddress);

      // appreciate
      const updatedCompBold = ONE_ETH;
      const accumulatedColl = ethers.parseEther('0.2');
      const accumulatedCollStashed = ethers.parseEther('0.2');
      const ethUSDPrice = ethers.parseEther('2000');

      // stub amounts
      let assetsInSPs = calcAssetsInSPs(updatedCompBold);
      let assetsInSPsColl = calcAssetsInSPs(accumulatedColl);
      let assetsInSPsStashedColl = calcAssetsInSPs(accumulatedCollStashed);

      await bold.mintTo(sp0.target, assetsInSPs[0]);
      await bold.mintTo(sp1.target, assetsInSPs[1]);
      await bold.mintTo(sp2.target, assetsInSPs[2]);

      // set yield gains
      await sp0.setCompoundedBoldDeposit(assetsInSPs[0]);
      await sp1.setCompoundedBoldDeposit(assetsInSPs[1]);
      await sp2.setCompoundedBoldDeposit(assetsInSPs[2]);

      // set collateral gains
      await sp0.setDepositorCollGain(assetsInSPsColl[0]);
      await sp1.setDepositorCollGain(assetsInSPsColl[1]);
      await sp2.setDepositorCollGain(assetsInSPsColl[2]);

      // set stashed collateral
      await sp0.setStashedColl(assetsInSPsStashedColl[0]);
      await sp1.setStashedColl(assetsInSPsStashedColl[1]);
      await sp2.setStashedColl(assetsInSPsStashedColl[2]);

      // set quotes
      await priceOracle.setQuote(bold.target, boldPrice);

      const quoteStETH = ((assetsInSPsColl[0] + assetsInSPsStashedColl[0]) * ethUSDPrice) / ONE_ETH;
      await priceOracle.setQuote(stETH.target, quoteStETH);

      const quoteWstETH = ((assetsInSPsColl[1] + assetsInSPsStashedColl[1]) * ethUSDPrice) / ONE_ETH;
      await priceOracle.setQuote(wstETH.target, quoteWstETH);

      const quoteRETH = ((assetsInSPsColl[2] + assetsInSPsStashedColl[2]) * ethUSDPrice) / ONE_ETH;
      await priceOracle.setQuote(rETH.target, quoteRETH);

      // mint $BOLD
      await bold.mintTo(sp0.target, assetsInSPs[0]);
      await bold.mintTo(sp1.target, assetsInSPs[1]);
      await bold.mintTo(sp2.target, assetsInSPs[2]);

      // mint Colls
      await stETH.mintTo(sp0.target, (assetsInSPsColl[0] + assetsInSPsStashedColl[0]) * BigInt(2));
      await wstETH.mintTo(sp1.target, (assetsInSPsColl[1] + assetsInSPsStashedColl[1]) * BigInt(2));
      await rETH.mintTo(sp2.target, (assetsInSPsColl[2] + assetsInSPsStashedColl[2]) * BigInt(2));

      // set Colls to transfer
      await sp0.setTransferCollAmount(assetsInSPsColl[0] + assetsInSPsStashedColl[0]);
      await sp1.setTransferCollAmount(assetsInSPsColl[1] + assetsInSPsStashedColl[1]);
      await sp2.setTransferCollAmount(assetsInSPsColl[2] + assetsInSPsStashedColl[2]);

      // set collateral quotes
      await router.setQuotes(stETH.target, (quoteStETH * ONE_ETH) / boldPrice);
      await router.setQuotes(wstETH.target, (quoteWstETH * ONE_ETH) / boldPrice);
      await router.setQuotes(rETH.target, (quoteRETH * ONE_ETH) / boldPrice);

      await sBold.setSwapAdapter(router.target);

      // build calldata for swap adapter
      const callData0 = SWAP_INTERFACE.encodeFunctionData('swap', [
        stETH.target,
        bold.target,
        assetsInSPsColl[0] + assetsInSPsStashedColl[0],
        0,
        '0x',
      ]);
      const callData1 = SWAP_INTERFACE.encodeFunctionData('swap', [
        wstETH.target,
        bold.target,
        assetsInSPsColl[1] + assetsInSPsStashedColl[1],
        0,
        '0x',
      ]);
      const callData2 = SWAP_INTERFACE.encodeFunctionData('swap', [
        rETH.target,
        bold.target,
        assetsInSPsColl[2] + assetsInSPsStashedColl[2],
        0,
        '0x',
      ]);

      const sp0BalanceBefore = await bold.balanceOf(sp0.target);
      const sp1BalanceBefore = await bold.balanceOf(sp1.target);
      const sp2BalanceBefore = await bold.balanceOf(sp2.target);

      await sBold.rebalanceSPs(
        [
          {
            addr: sp0.target,
            weight: 5000,
          },
          {
            addr: sp1.target,
            weight: 4000,
          },
          {
            addr: sp2.target,
            weight: 1000,
          },
        ],
        [
          { sp: sp0.target, balance: MaxInt256, data: callData0 },
          { sp: sp1.target, balance: MaxInt256, data: callData1 },
          { sp: sp2.target, balance: MaxInt256, data: callData2 },
        ],
      );

      // BOLD price = 1 USD
      // total collateral in BOLD = 800 -> 0.4 ETH * 2000 USD
      // deposited BOLD = 1
      // sBOLD address BOLD balance = 1 -> dead share
      const totalCollateralInBold = ((accumulatedColl + accumulatedCollStashed) * ethUSDPrice) / ONE_ETH + ONE_ETH;

      const sp0BalanceAfter = await bold.balanceOf(sp0.target);
      const sp1BalanceAfter = await bold.balanceOf(sp1.target);
      const sp2BalanceAfter = await bold.balanceOf(sp2.target);

      const deltaSP0 = sp0BalanceAfter - sp0BalanceBefore;
      const deltaSP1 = sp1BalanceAfter - sp1BalanceBefore;
      const deltaSP2 = sp2BalanceAfter - sp2BalanceBefore;

      const expDeltaSP0 = (totalCollateralInBold * BigInt(5000)) / BigInt(BPS_DENOMINATOR) - assetsInSPs[0];
      const expDeltaSP1 = (totalCollateralInBold * BigInt(4000)) / BigInt(BPS_DENOMINATOR) - assetsInSPs[1];
      const expDeltaSP2 = (totalCollateralInBold * BigInt(1000)) / BigInt(BPS_DENOMINATOR) - assetsInSPs[2];

      expect((await sBold.sps(0)).sp).to.eq(sp0.target);
      expect((await sBold.sps(0)).weight).to.eq(5000);
      expect((await sBold.sps(1)).sp).to.eq(sp1.target);
      expect((await sBold.sps(1)).weight).to.eq(4000);
      expect((await sBold.sps(2)).sp).to.eq(sp2.target);
      expect((await sBold.sps(2)).weight).to.eq(1000);

      expect(deltaSP0).to.be.eq(expDeltaSP0);
      expect(deltaSP1).to.be.eq(expDeltaSP1);
      expect(deltaSP2).to.be.eq(expDeltaSP2);
    });

    it('should rabalance weights current SPs with no collateral for swap', async function () {
      const ownerAddress = await owner.getAddress();

      // setup
      await bold.mint(ONE_ETH);
      await bold.approve(sBold.target, ONE_ETH);

      // deposit
      await sBold.deposit(ONE_ETH, ownerAddress);

      // appreciate
      const updatedCompBold = ONE_ETH;

      // stub amounts
      let assetsInSPs = calcAssetsInSPs(updatedCompBold);

      await bold.mintTo(sp0.target, assetsInSPs[0]);
      await bold.mintTo(sp1.target, assetsInSPs[1]);
      await bold.mintTo(sp2.target, assetsInSPs[2]);

      // set yield gains
      await sp0.setCompoundedBoldDeposit(assetsInSPs[0]);
      await sp1.setCompoundedBoldDeposit(assetsInSPs[1]);
      await sp2.setCompoundedBoldDeposit(assetsInSPs[2]);

      // mint $BOLD
      await bold.mintTo(sp0.target, assetsInSPs[0]);
      await bold.mintTo(sp1.target, assetsInSPs[1]);
      await bold.mintTo(sp2.target, assetsInSPs[2]);

      await sBold.setSwapAdapter(router.target);

      // build calldata for swap adapter
      const callData0 = SWAP_INTERFACE.encodeFunctionData('swap', [stETH.target, bold.target, 0, 0, '0x']);
      const callData1 = SWAP_INTERFACE.encodeFunctionData('swap', [wstETH.target, bold.target, 0, 0, '0x']);
      const callData2 = SWAP_INTERFACE.encodeFunctionData('swap', [rETH.target, bold.target, 0, 0, '0x']);

      const sp0BalanceBefore = await bold.balanceOf(sp0.target);
      const sp1BalanceBefore = await bold.balanceOf(sp1.target);
      const sp2BalanceBefore = await bold.balanceOf(sp2.target);

      await sBold.rebalanceSPs(
        [
          {
            addr: sp0.target,
            weight: 5000,
          },
          {
            addr: sp1.target,
            weight: 4000,
          },
          {
            addr: sp2.target,
            weight: 1000,
          },
        ],
        [
          { sp: sp0.target, balance: MaxInt256, data: callData0 },
          { sp: sp1.target, balance: MaxInt256, data: callData1 },
          { sp: sp2.target, balance: MaxInt256, data: callData2 },
        ],
      );

      const sp0BalanceAfter = await bold.balanceOf(sp0.target);
      const sp1BalanceAfter = await bold.balanceOf(sp1.target);
      const sp2BalanceAfter = await bold.balanceOf(sp2.target);

      const deltaSP0 = sp0BalanceAfter - sp0BalanceBefore;
      const deltaSP1 = sp1BalanceAfter - sp1BalanceBefore;
      const deltaSP2 = sp2BalanceAfter - sp2BalanceBefore;

      const totalBold = ONE_ETH;

      const expDeltaSP0 = (totalBold * BigInt(5000)) / BigInt(BPS_DENOMINATOR) - assetsInSPs[0];
      const expDeltaSP1 = (totalBold * BigInt(4000)) / BigInt(BPS_DENOMINATOR) - assetsInSPs[1];
      const expDeltaSP2 = (totalBold * BigInt(1000)) / BigInt(BPS_DENOMINATOR) - assetsInSPs[2];

      expect((await sBold.sps(0)).sp).to.eq(sp0.target);
      expect((await sBold.sps(0)).weight).to.eq(5000);
      expect((await sBold.sps(1)).sp).to.eq(sp1.target);
      expect((await sBold.sps(1)).weight).to.eq(4000);
      expect((await sBold.sps(2)).sp).to.eq(sp2.target);
      expect((await sBold.sps(2)).weight).to.eq(1000);

      expect(deltaSP0).to.be.eq(expDeltaSP0);
      expect(deltaSP1).to.be.eq(expDeltaSP1);
      expect(deltaSP2).to.be.eq(expDeltaSP2);
    });

    it('should fail if caller is not the owner', async function () {
      const callData0 = SWAP_INTERFACE.encodeFunctionData('swap', [stETH.target, bold.target, 0, 0, '0x']);
      const callData1 = SWAP_INTERFACE.encodeFunctionData('swap', [wstETH.target, bold.target, 0, 0, '0x']);
      const callData2 = SWAP_INTERFACE.encodeFunctionData('swap', [rETH.target, bold.target, 0, 0, '0x']);

      await expect(
        sBold.connect(bob).rebalanceSPs(
          [
            {
              addr: sp0.target,
              weight: 5000,
            },
            {
              addr: sp1.target,
              weight: 4000,
            },
            {
              addr: sp2.target,
              weight: 1000,
            },
          ],
          [
            { sp: sp0.target, balance: MaxInt256, data: callData0 },
            { sp: sp1.target, balance: MaxInt256, data: callData1 },
            { sp: sp2.target, balance: MaxInt256, data: callData2 },
          ],
        ),
      ).to.be.rejectedWith('OwnableUnauthorizedAccount');
    });

    it('should fail if collateral is over the limit', async function () {
      const ownerAddress = await owner.getAddress();
      const boldPrice = ONE_ETH;

      // setup
      await bold.mint(ONE_ETH);
      await bold.approve(sBold.target, ONE_ETH);

      // deposit
      await sBold.deposit(ONE_ETH, ownerAddress);

      // appreciate
      const updatedCompBold = ONE_ETH;
      const accumulatedColl = ethers.parseEther('0.2');
      const accumulatedCollStashed = ethers.parseEther('0.2');
      const ethUSDPrice = ethers.parseEther('2000');

      // stub amounts
      let assetsInSPs = calcAssetsInSPs(updatedCompBold);
      let assetsInSPsColl = calcAssetsInSPs(accumulatedColl);
      let assetsInSPsStashedColl = calcAssetsInSPs(accumulatedCollStashed);

      await bold.mintTo(sp0.target, assetsInSPs[0]);
      await bold.mintTo(sp1.target, assetsInSPs[1]);
      await bold.mintTo(sp2.target, assetsInSPs[2]);

      // set yield gains
      await sp0.setCompoundedBoldDeposit(assetsInSPs[0]);
      await sp1.setCompoundedBoldDeposit(assetsInSPs[1]);
      await sp2.setCompoundedBoldDeposit(assetsInSPs[2]);

      // set collateral gains
      await sp0.setDepositorCollGain(assetsInSPsColl[0]);
      await sp1.setDepositorCollGain(assetsInSPsColl[1]);
      await sp2.setDepositorCollGain(assetsInSPsColl[2]);

      // set stashed collateral
      await sp0.setStashedColl(assetsInSPsStashedColl[0]);
      await sp1.setStashedColl(assetsInSPsStashedColl[1]);
      await sp2.setStashedColl(assetsInSPsStashedColl[2]);

      // set quotes
      await priceOracle.setQuote(bold.target, boldPrice);

      const quoteStETH = ((assetsInSPsColl[0] + assetsInSPsStashedColl[0]) * ethUSDPrice) / ONE_ETH;
      await priceOracle.setQuote(stETH.target, quoteStETH);

      const quoteWstETH = ((assetsInSPsColl[1] + assetsInSPsStashedColl[1]) * ethUSDPrice) / ONE_ETH;
      await priceOracle.setQuote(wstETH.target, quoteWstETH);

      const quoteRETH = ((assetsInSPsColl[2] + assetsInSPsStashedColl[2]) * ethUSDPrice) / ONE_ETH;
      await priceOracle.setQuote(rETH.target, quoteRETH);

      // mint $BOLD
      await bold.mintTo(sp0.target, assetsInSPs[0]);
      await bold.mintTo(sp1.target, assetsInSPs[1]);
      await bold.mintTo(sp2.target, assetsInSPs[2]);

      // mint Colls
      await stETH.mintTo(sp0.target, (assetsInSPsColl[0] + assetsInSPsStashedColl[0]) * BigInt(2));
      await wstETH.mintTo(sp1.target, (assetsInSPsColl[1] + assetsInSPsStashedColl[1]) * BigInt(2));
      await rETH.mintTo(sp2.target, (assetsInSPsColl[2] + assetsInSPsStashedColl[2]) * BigInt(2));

      // set Colls to transfer
      await sp0.setTransferCollAmount(assetsInSPsColl[0] + assetsInSPsStashedColl[0]);
      await sp1.setTransferCollAmount(assetsInSPsColl[1] + assetsInSPsStashedColl[1]);
      await sp2.setTransferCollAmount(assetsInSPsColl[2] + assetsInSPsStashedColl[2]);

      // set collateral quotes
      await router.setQuotes(stETH.target, (quoteStETH * ONE_ETH) / boldPrice);
      await router.setQuotes(wstETH.target, (quoteWstETH * ONE_ETH) / boldPrice);
      await router.setQuotes(rETH.target, (quoteRETH * ONE_ETH) / boldPrice);

      await sBold.setSwapAdapter(router.target);

      // build calldata for swap adapter
      const callData0 = SWAP_INTERFACE.encodeFunctionData('swap', [stETH.target, bold.target, 0, 0, '0x']);
      const callData1 = SWAP_INTERFACE.encodeFunctionData('swap', [
        wstETH.target,
        bold.target,
        assetsInSPsColl[1] + assetsInSPsStashedColl[1],
        0,
        '0x',
      ]);
      const callData2 = SWAP_INTERFACE.encodeFunctionData('swap', [
        rETH.target,
        bold.target,
        assetsInSPsColl[2] + assetsInSPsStashedColl[2],
        0,
        '0x',
      ]);

      await expect(
        sBold.rebalanceSPs(
          [
            {
              addr: sp0.target,
              weight: 5000,
            },
            {
              addr: sp1.target,
              weight: 4000,
            },
            {
              addr: sp2.target,
              weight: 1000,
            },
          ],
          [
            { sp: sp0.target, balance: MaxInt256, data: callData0 },
            { sp: sp1.target, balance: MaxInt256, data: callData1 },
            { sp: sp2.target, balance: MaxInt256, data: callData2 },
          ],
        ),
      ).to.be.rejectedWith('CollOverLimit');
    });
  });
});
