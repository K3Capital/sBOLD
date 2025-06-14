import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { Contract, ZeroAddress } from 'ethers';
import { Signer } from 'ethers';
import { MAX_STALENESS, ONE_ETH, ONE_MIN } from '../utils/constants';
import { ChainlinkOracle } from '../../../types';
import { getBlockTimestamp } from '../utils/helpers';

const base = '0x3333333333333333333333333333333333333333';
const unsupportedBase = '0x3333333333333333333333333333333333333334';
const value = Math.random();
const amount = ethers.parseEther(value.toString());

describe('ChainlinkOracle', async function () {
  let owner: Signer;
  let random: Signer;

  let chainlinkAggregator: Contract;
  let chainlinkOracle: ChainlinkOracle;

  async function fixture() {
    [owner, random] = await ethers.getSigners();

    chainlinkAggregator = await ethers.deployContract('MockChainlinkFeed');
    chainlinkOracle = (
      await ethers.deployContract('ChainlinkOracle', [base, { addr: chainlinkAggregator, maxStaleness: MAX_STALENESS }])
    ).connect(owner) as ChainlinkOracle;
  }

  beforeEach(async function () {
    await loadFixture(fixture);
  });

  describe('#constructor', function () {
    it('should deploy ChainlinkOracle contract', async function () {
      const chainlinkOracle = await ethers.deployContract('ChainlinkOracle', [
        base,
        { addr: chainlinkAggregator, maxStaleness: MAX_STALENESS },
      ]);
      const feedSet = await chainlinkOracle.feed();

      expect(chainlinkOracle.target).to.not.eq(ZeroAddress);
      expect(await feedSet.addr).to.eq(chainlinkAggregator.target);
      expect(await feedSet.maxStaleness).to.eq(MAX_STALENESS);

      expect(await chainlinkOracle.isBaseSupported(base)).to.eq(true);
      expect(await chainlinkOracle.isBaseSupported(unsupportedBase)).to.eq(false);
    });

    it('should fail deploy ChainlinkOracle contract if maxStaleness is higher than max', async function () {
      await expect(
        ethers.deployContract('ChainlinkOracle', [
          base,
          { addr: chainlinkAggregator, maxStaleness: ONE_MIN * 60 * 73 },
        ]),
      ).to.be.rejectedWith('InvalidMaxStaleness');
    });

    it('should fail deploy ChainlinkOracle contract if maxStaleness is lower than min', async function () {
      await expect(
        ethers.deployContract('ChainlinkOracle', [base, { addr: chainlinkAggregator, maxStaleness: 59 }]),
      ).to.be.rejectedWith('InvalidMaxStaleness');
    });

    it('should fail deploy ChainlinkOracle contract if base is zero address', async function () {
      await expect(
        ethers.deployContract('ChainlinkOracle', [ZeroAddress, { addr: chainlinkAggregator, maxStaleness: 61 }]),
      ).to.be.rejectedWith('InvalidAddress');
    });

    it('should fail deploy ChainlinkOracle contract if addr is zero address', async function () {
      await expect(
        ethers.deployContract('ChainlinkOracle', [base, { addr: ZeroAddress, maxStaleness: 61 }]),
      ).to.be.rejectedWith('InvalidAddress');
    });
  });

  describe('#getQuote', function () {
    it('should get a quote', async function () {
      // set price
      await chainlinkAggregator.setLatestRoundData({
        roundId: 0,
        answer: ethers.parseUnits('1', 8),
        timestamp: (await getBlockTimestamp()) - 10,
        success: true,
      });

      await chainlinkAggregator.setDecimals(8);

      const expAmount = (amount * ethers.parseEther('1')) / ONE_ETH;

      // the returned quote should be scaled to 18 decimals precision
      expect(await chainlinkOracle.getQuote(amount, base)).to.eq(expAmount);
    });

    it('should fail to get quote if timestamp is stale', async function () {
      // set price
      await chainlinkAggregator.setLatestRoundData({
        roundId: 0,
        answer: ethers.parseUnits('1', 8),
        timestamp: (await getBlockTimestamp()) - ONE_MIN * 3,
        success: true,
      });

      await chainlinkAggregator.setDecimals(8);

      await expect(chainlinkOracle.getQuote(amount, base)).to.be.rejectedWith('TooStalePrice');
    });

    it('should fail to get quote if price is negative', async function () {
      // set price
      await chainlinkAggregator.setLatestRoundData({
        roundId: 0,
        answer: -1,
        timestamp: await getBlockTimestamp(),
        success: true,
      });

      await chainlinkAggregator.setDecimals(8);

      await expect(chainlinkOracle.getQuote(amount, base)).to.be.rejectedWith('InvalidPrice');
    });

    it('should fail to get quote if price is 0', async function () {
      // set price
      await chainlinkAggregator.setLatestRoundData({
        roundId: 0,
        answer: 0,
        timestamp: await getBlockTimestamp(),
        success: true,
      });

      await chainlinkAggregator.setDecimals(8);

      await expect(chainlinkOracle.getQuote(amount, base)).to.be.rejectedWith('InvalidPrice');
    });
  });
});
