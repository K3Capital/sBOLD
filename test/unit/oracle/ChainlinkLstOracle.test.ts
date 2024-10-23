import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { Contract, ZeroAddress } from 'ethers';
import { Signer } from 'ethers';
import { MAX_STALENESS, ONE_ETH, ONE_MIN } from '../utils/constants';
import { ChainlinkLstOracle } from '../../../types';
import { getBlockTimestamp } from '../utils/helpers';

const base = '0x3333333333333333333333333333333333333333';
const unsupportedBase = '0x3333333333333333333333333333333333333334';
const value = Math.random();
const amount = ethers.parseEther(value.toString());

describe('ChainlinkLstOracle', async function () {
  let owner: Signer;
  let random: Signer;

  let aggregatorEthUsdFeed: Contract;
  let aggregatorLstEthFeed: Contract;

  let chainlinkOracle: ChainlinkLstOracle;

  async function fixture() {
    [owner, random] = await ethers.getSigners();

    aggregatorEthUsdFeed = await ethers.deployContract('MockChainlinkFeed');
    aggregatorLstEthFeed = await ethers.deployContract('MockChainlinkFeed');

    chainlinkOracle = (
      await ethers.deployContract('ChainlinkLstOracle', [
        base,
        { addr: aggregatorEthUsdFeed, maxStaleness: MAX_STALENESS },
        { addr: aggregatorLstEthFeed, maxStaleness: MAX_STALENESS },
      ])
    ).connect(owner) as ChainlinkLstOracle;
  }

  beforeEach(async function () {
    await loadFixture(fixture);
  });

  describe('#constructor', function () {
    it('should deploy ChainlinkLstOracle contract', async function () {
      const chainlinkOracle = await ethers.deployContract('ChainlinkLstOracle', [
        base,
        { addr: aggregatorEthUsdFeed, maxStaleness: MAX_STALENESS },
        { addr: aggregatorLstEthFeed, maxStaleness: MAX_STALENESS },
      ]);

      const ethUsdFeedSet = await chainlinkOracle.ethUsdFeed();
      const lstEthFeedSet = await chainlinkOracle.lstEthFeed();

      expect(chainlinkOracle.target).to.not.eq(ZeroAddress);
      expect(await ethUsdFeedSet.addr).to.eq(aggregatorEthUsdFeed.target);
      expect(await lstEthFeedSet.addr).to.eq(aggregatorLstEthFeed.target);

      expect(await ethUsdFeedSet.maxStaleness).to.eq(MAX_STALENESS);
      expect(await lstEthFeedSet.maxStaleness).to.eq(MAX_STALENESS);

      expect(await chainlinkOracle.isBaseSupported(base)).to.eq(true);
      expect(await chainlinkOracle.isBaseSupported(unsupportedBase)).to.eq(false);
    });

    it('should fail deploy ChainlinkLstOracle contract if EthUsd feed maxStaleness is higher than max', async function () {
      await expect(
        ethers.deployContract('ChainlinkLstOracle', [
          base,
          { addr: aggregatorEthUsdFeed, maxStaleness: ONE_MIN * 60 * 73 },
          { addr: aggregatorLstEthFeed, maxStaleness: MAX_STALENESS },
        ]),
      ).to.be.rejectedWith('InvalidMaxStaleness');
    });

    it('should fail deploy ChainlinkLstOracle contract if LstEth feed maxStaleness is higher than max', async function () {
      await expect(
        ethers.deployContract('ChainlinkLstOracle', [
          base,
          { addr: aggregatorEthUsdFeed, maxStaleness: MAX_STALENESS },
          { addr: aggregatorLstEthFeed, maxStaleness: ONE_MIN * 60 * 73 },
        ]),
      ).to.be.rejectedWith('InvalidMaxStaleness');
    });

    it('should fail deploy ChainlinkLstOracle contract if EthUsd feed maxStaleness is lower than min', async function () {
      await expect(
        ethers.deployContract('ChainlinkLstOracle', [
          base,
          { addr: aggregatorEthUsdFeed, maxStaleness: 59 },
          { addr: aggregatorLstEthFeed, maxStaleness: MAX_STALENESS },
        ]),
      ).to.be.rejectedWith('InvalidMaxStaleness');
    });

    it('should fail deploy ChainlinkLstOracle contract if LstEth feed maxStaleness is lower than min', async function () {
      await expect(
        ethers.deployContract('ChainlinkLstOracle', [
          base,
          { addr: aggregatorEthUsdFeed, maxStaleness: MAX_STALENESS },
          { addr: aggregatorLstEthFeed, maxStaleness: 59 },
        ]),
      ).to.be.rejectedWith('InvalidMaxStaleness');
    });

    it('should fail deploy ChainlinkLstOracle contract if base is zero address', async function () {
      await expect(
        ethers.deployContract('ChainlinkLstOracle', [
          ZeroAddress,
          { addr: aggregatorEthUsdFeed, maxStaleness: MAX_STALENESS },
          { addr: aggregatorLstEthFeed, maxStaleness: MAX_STALENESS },
        ]),
      ).to.be.rejectedWith('InvalidAddress');
    });

    it('should fail deploy ChainlinkLstOracle contract if EthUsd feed addr is zero address', async function () {
      await expect(
        ethers.deployContract('ChainlinkLstOracle', [
          base,
          { addr: ZeroAddress, maxStaleness: MAX_STALENESS },
          { addr: aggregatorLstEthFeed, maxStaleness: MAX_STALENESS },
        ]),
      ).to.be.rejectedWith('InvalidAddress');
    });

    it('should fail deploy ChainlinkLstOracle contract if LstEth feed addr is zero address', async function () {
      await expect(
        ethers.deployContract('ChainlinkLstOracle', [
          base,
          { addr: aggregatorEthUsdFeed, maxStaleness: MAX_STALENESS },
          { addr: ZeroAddress, maxStaleness: MAX_STALENESS },
        ]),
      ).to.be.rejectedWith('InvalidAddress');
    });
  });

  describe('#getQuote', function () {
    it('should get a quote', async function () {
      // set price EthUsd feed
      await aggregatorEthUsdFeed.setLatestRoundData({
        roundId: 0,
        answer: ethers.parseUnits('1', 8),
        timestamp: (await getBlockTimestamp()) - 10,
        success: true,
      });

      // set price LstEth feed
      await aggregatorLstEthFeed.setLatestRoundData({
        roundId: 0,
        answer: ethers.parseUnits('1', 8),
        timestamp: (await getBlockTimestamp()) - 10,
        success: true,
      });

      await aggregatorEthUsdFeed.setDecimals(8);
      await aggregatorLstEthFeed.setDecimals(8);

      const expAmount = (amount * ethers.parseEther('1')) / ONE_ETH;

      // the returned quote should be scaled to 18 decimals precision
      expect(await chainlinkOracle.getQuote(amount, base)).to.eq(expAmount);
    });

    it('should fail to get quote if EthUsd price is stale', async function () {
      // set price EthUsd feed
      await aggregatorEthUsdFeed.setLatestRoundData({
        roundId: 0,
        answer: ethers.parseUnits('1', 8),
        timestamp: (await getBlockTimestamp()) - ONE_MIN * 3,
        success: true,
      });
      // set price LstEth feed
      await aggregatorLstEthFeed.setLatestRoundData({
        roundId: 0,
        answer: ethers.parseUnits('1', 8),
        timestamp: (await getBlockTimestamp()) - 10,
        success: true,
      });

      await aggregatorEthUsdFeed.setDecimals(8);

      await expect(chainlinkOracle.getQuote(amount, base)).to.be.rejectedWith('TooStalePrice');
    });

    it('should fail to get quote if LstEth price is stale', async function () {
      // set price EthUsd feed
      await aggregatorEthUsdFeed.setLatestRoundData({
        roundId: 0,
        answer: ethers.parseUnits('1', 8),
        timestamp: (await getBlockTimestamp()) - 10,
        success: true,
      });
      // set price LstEth feed
      await aggregatorLstEthFeed.setLatestRoundData({
        roundId: 0,
        answer: ethers.parseUnits('1', 8),
        timestamp: (await getBlockTimestamp()) - ONE_MIN * 3,
        success: true,
      });

      await aggregatorEthUsdFeed.setDecimals(8);

      await expect(chainlinkOracle.getQuote(amount, base)).to.be.rejectedWith('TooStalePrice');
    });

    it('should fail to get quote if EthUsd price is negative', async function () {
      // set price EthUsd feed
      await aggregatorEthUsdFeed.setLatestRoundData({
        roundId: 0,
        answer: -1,
        timestamp: await getBlockTimestamp(),
        success: true,
      });
      // set price LstEth feed
      await aggregatorLstEthFeed.setLatestRoundData({
        roundId: 0,
        answer: ethers.parseUnits('1', 8),
        timestamp: await getBlockTimestamp(),
        success: true,
      });

      await aggregatorEthUsdFeed.setDecimals(8);

      await expect(chainlinkOracle.getQuote(amount, base)).to.be.rejectedWith('InvalidPrice');
    });

    it('should fail to get quote if LstEth price is negative', async function () {
      // set price EthUsd feed
      await aggregatorEthUsdFeed.setLatestRoundData({
        roundId: 0,
        answer: ethers.parseUnits('1', 8),
        timestamp: await getBlockTimestamp(),
        success: true,
      });
      // set price LstEth feed
      await aggregatorLstEthFeed.setLatestRoundData({
        roundId: 0,
        answer: -1,
        timestamp: await getBlockTimestamp(),
        success: true,
      });

      await aggregatorEthUsdFeed.setDecimals(8);

      await expect(chainlinkOracle.getQuote(amount, base)).to.be.rejectedWith('InvalidPrice');
    });

    it('should fail to get quote if EthUsd price is 0', async function () {
      // set price EthUsd feed
      await aggregatorEthUsdFeed.setLatestRoundData({
        roundId: 0,
        answer: -1,
        timestamp: await getBlockTimestamp(),
        success: true,
      });
      // set price LstEth feed
      await aggregatorLstEthFeed.setLatestRoundData({
        roundId: 0,
        answer: ethers.parseUnits('1', 8),
        timestamp: await getBlockTimestamp(),
        success: true,
      });

      await aggregatorEthUsdFeed.setDecimals(8);

      await expect(chainlinkOracle.getQuote(amount, base)).to.be.rejectedWith('InvalidPrice');
    });

    it('should fail to get quote if LstEth price is 0', async function () {
      // set price EthUsd feed
      await aggregatorEthUsdFeed.setLatestRoundData({
        roundId: 0,
        answer: ethers.parseUnits('1', 8),
        timestamp: await getBlockTimestamp(),
        success: true,
      });
      // set price LstEth feed
      await aggregatorLstEthFeed.setLatestRoundData({
        roundId: 0,
        answer: -1,
        timestamp: await getBlockTimestamp(),
        success: true,
      });

      await aggregatorEthUsdFeed.setDecimals(8);

      await expect(chainlinkOracle.getQuote(amount, base)).to.be.rejectedWith('InvalidPrice');
    });
  });
});
