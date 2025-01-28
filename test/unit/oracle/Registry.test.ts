import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { Contract, ZeroAddress } from 'ethers';
import { Signer } from 'ethers';
import { MAX_STALENESS, ONE_ETH, ONE_MIN } from '../utils/constants';
import { ChainlinkOracle, Registry } from '../../../types';
import { getBlockTimestamp } from '../utils/helpers';

const base = '0x3333333333333333333333333333333333333333';
const unsupportedBase = '0x3333333333333333333333333333333333333334';
const value = Math.random();
const amount = ethers.parseEther(value.toString());

describe('Registry', async function () {
  let owner: Signer;
  let random: Signer;

  let chainlinkAggregator: Contract;
  let chainlinkOracle: ChainlinkOracle;
  let registry: Registry;

  async function fixture() {
    [owner, random] = await ethers.getSigners();

    chainlinkAggregator = await ethers.deployContract('MockChainlinkFeed');
    chainlinkOracle = (
      await ethers.deployContract('ChainlinkOracle', [base, { addr: chainlinkAggregator, maxStaleness: MAX_STALENESS }])
    ).connect(owner) as ChainlinkOracle;

    registry = (await ethers.deployContract('Registry')).connect(owner) as Registry;

    await registry.setOracles([{ base, addr: chainlinkOracle.target }]);
  }

  beforeEach(async function () {
    await loadFixture(fixture);
  });

  describe('#constructor', function () {
    it('should deploy ChainlinkOracle contract', async function () {
      const registry = (await ethers.deployContract('Registry')).connect(owner) as Registry;

      expect(registry.target).to.not.eq(ZeroAddress);
      expect(await registry.owner()).to.eq(await owner.getAddress());
      expect(await registry.isBaseSupported(base)).to.not.eq(true);
    });
  });

  describe('#setOracles', function () {
    it('should set oracles', async function () {
      await expect(registry.setOracles([{ base, addr: chainlinkOracle.target }])).to.emit(registry, 'OraclesSet');
    });

    it('should detach oracle ', async function () {
      await registry.setOracles([{ base, addr: chainlinkOracle.target }]);

      expect(await registry.baseToOracle(base)).to.eq(chainlinkOracle.target);

      await registry.setOracles([{ base, addr: ZeroAddress }]);

      expect(await registry.baseToOracle(base)).to.eq(ZeroAddress);
    });

    it('should fail to set oracles if base is zero address', async function () {
      await expect(registry.setOracles([{ base: ZeroAddress, addr: chainlinkOracle.target }])).to.be.rejectedWith(
        'InvalidAddress',
      );
    });

    it('should fail to set oracles if oracle does not support base', async function () {
      await expect(registry.setOracles([{ base: unsupportedBase, addr: chainlinkOracle.target }])).to.be.rejectedWith(
        'InvalidFeed',
      );
    });

    it('should fail to set oracles if oracle does not support base', async function () {
      await expect(registry.connect(random).setOracles([{ base, addr: chainlinkOracle.target }])).to.be.rejectedWith(
        'OwnableUnauthorizedAccount',
      );
    });
  });

  describe('#getQuote', function () {
    it('should get a quote through registry', async function () {
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
      expect(await registry.getQuote(amount, base)).to.eq(expAmount);
    });

    it('should fail if base is not supported', async function () {
      await expect(chainlinkOracle.getQuote(amount, unsupportedBase)).to.be.rejectedWith('InvalidFeed');
    });
  });

  describe('#isBaseSupported', function () {
    it('should check base address to oracle address', async function () {
      expect(await chainlinkOracle.isBaseSupported(base)).to.equal(true);
      expect(await chainlinkOracle.isBaseSupported(unsupportedBase)).to.equal(false);
    });
  });
});
