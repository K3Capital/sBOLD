import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { Contract, ZeroAddress } from 'ethers';
import { Signer } from 'ethers';
import { MAX_STALENESS, ONE_ETH, ONE_MIN } from '../utils/constants';
import { getBlockTimestamp } from '../utils/helpers';

const base = '0x3333333333333333333333333333333333333333';
const unsupportedBase = '0x3333333333333333333333333333333333333334';
const stEthAddress = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84';

describe('WstEthOracle', function () {
  let owner: Signer;
  let random: Signer;
  let chainlinkAggregator: Contract;
  let wstEthOracle: Contract;
  let stEth: Contract;

  const amount = ONE_ETH;

  async function fixture() {
    [owner, random] = await ethers.getSigners();

    chainlinkAggregator = await ethers.deployContract('MockChainlinkFeed');

    const MockStEth = await ethers.getContractFactory('MockStEth');
    const mockStEth = await MockStEth.deploy();

    const mockStEthAddress = await mockStEth.getAddress();
    const code = await ethers.provider.getCode(mockStEthAddress);

    await ethers.provider.send('hardhat_setCode', [stEthAddress, code]);

    stEth = await ethers.getContractAt('MockStEth', stEthAddress);
    await stEth.setPooledEthByShares(ONE_ETH);

    wstEthOracle = await ethers.deployContract('WstEthOracle', [
      base,
      { addr: chainlinkAggregator, maxStaleness: MAX_STALENESS },
    ]);

    await chainlinkAggregator.setDecimals(8);
  }

  beforeEach(async function () {
    await loadFixture(fixture);
  });

  describe('#constructor', function () {
    it('should deploy WstEthOracle successfully', async function () {
      const feedStored = await wstEthOracle.feed();

      expect(feedStored.addr).to.equal(chainlinkAggregator.target);
      expect(feedStored.maxStaleness).to.equal(MAX_STALENESS);
      expect(await wstEthOracle.isBaseSupported(base)).to.be.true;
      expect(await wstEthOracle.isBaseSupported(unsupportedBase)).to.be.false;
    });

    it('should revert if feed address is zero', async function () {
      await expect(
        ethers.deployContract('WstEthOracle', [base, { addr: ZeroAddress, maxStaleness: ONE_MIN * 60 }]),
      ).to.be.rejectedWith('InvalidAddress');
    });

    it('should revert if maxStaleness is below minimum', async function () {
      await expect(
        ethers.deployContract('WstEthOracle', [base, { addr: chainlinkAggregator, maxStaleness: ONE_MIN - 5 }]),
      ).to.be.rejectedWith('InvalidMaxStaleness');
    });

    it('should revert if maxStaleness is above maximum', async function () {
      await expect(
        ethers.deployContract('WstEthOracle', [base, { addr: chainlinkAggregator, maxStaleness: ONE_MIN * 60 * 73 }]),
      ).to.be.rejectedWith('InvalidMaxStaleness');
    });
  });

  describe('#getQuote', function () {
    it('should return correct quote when feeds are valid', async function () {
      await chainlinkAggregator.setLatestRoundData({
        roundId: 1,
        answer: ethers.parseUnits('2500', 8),
        timestamp: (await getBlockTimestamp()) - 10,
        success: true,
      });

      const quote = await wstEthOracle.getQuote(amount, base);

      expect(quote).to.equal(ethers.parseEther('2500'));
    });

    it('should revert if base is unsupported', async function () {
      await expect(wstEthOracle.getQuote(amount, unsupportedBase)).to.be.rejectedWith('InvalidFeed');
    });

    it('should revert if STETH/USD price is stale', async function () {
      const now = await getBlockTimestamp();

      await chainlinkAggregator.setLatestRoundData({
        roundId: 2,
        answer: ethers.parseUnits('2', 8),
        timestamp: now - ONE_MIN * 3,
        success: true,
      });

      await expect(wstEthOracle.getQuote(amount, base)).to.be.rejectedWith('TooStalePrice');
    });

    it('should revert if STETH/USD price is negative', async function () {
      const now = await getBlockTimestamp();

      await chainlinkAggregator.setLatestRoundData({
        roundId: 3,
        answer: -1,
        timestamp: now,
        success: true,
      });

      await expect(wstEthOracle.getQuote(amount, base)).to.be.rejectedWith('InvalidPrice');
    });

    it('should revert if STETH/USD price is zero', async function () {
      const now = await getBlockTimestamp();

      await chainlinkAggregator.setLatestRoundData({
        roundId: 4,
        answer: 0,
        timestamp: now,
        success: true,
      });

      await expect(wstEthOracle.getQuote(amount, base)).to.be.rejectedWith('InvalidPrice');
    });

    it('should revert if getPooledEthByShares returns zero', async function () {
      await stEth.setPooledEthByShares(0);

      await expect(wstEthOracle.getQuote(amount, base)).to.be.rejectedWith('InvalidPrice');
    });
  });
});
