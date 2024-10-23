import { expect } from 'chai';
import { ethers } from 'hardhat';
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers';
import { Contract, ZeroAddress, ZeroHash } from 'ethers';
import { Signer } from 'ethers';
import { MAX_CONFID_WIDTH, MAX_STALENESS, ONE_MIN } from '../utils/constants';
import { PythOracle } from '../../../types';
import { getPriceStruct } from '../utils/helpers';

const base = '0x3333333333333333333333333333333333333333';
const feedId = '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43';
const value = Math.random();
const amount = ethers.parseEther(value.toString());

describe('PythOracle', async function () {
  let owner: Signer;
  let random: Signer;

  let pyth: Contract;
  let pythOracle: PythOracle;

  async function fixture() {
    [owner, random] = await ethers.getSigners();

    pyth = await ethers.deployContract('MockPyth');
    pythOracle = (
      await ethers.deployContract('PythOracle', [pyth.target, base, feedId, MAX_STALENESS, MAX_CONFID_WIDTH])
    ).connect(owner) as PythOracle;
  }

  beforeEach(async function () {
    await loadFixture(fixture);
  });

  describe('#constructor', function () {
    it('should deploy PythOracle contract', async function () {
      const pythOracle = await ethers.deployContract('PythOracle', [
        pyth.target,
        base,
        feedId,
        MAX_STALENESS,
        MAX_CONFID_WIDTH,
      ]);

      expect(pythOracle.target).to.not.eq(ZeroAddress);
      expect(await pythOracle.owner()).to.eq(await owner.getAddress());
      expect(await pythOracle.maxStaleness()).to.eq(MAX_STALENESS);
      expect(await pythOracle.maxConfWidth()).to.eq(MAX_CONFID_WIDTH);
      expect(await pythOracle.isBaseSupported(base)).to.eq(true);
    });

    it('should fail deploy PythOracle contract if maxStaleness is higher than max', async function () {
      await expect(
        ethers.deployContract('PythOracle', [pyth.target, base, feedId, ONE_MIN * 20, ONE_MIN * 10]),
      ).to.be.rejectedWith('InvalidMaxStalenessUpperBound');
    });

    it('should fail deploy PythOracle contract if maxConfidWidth is lower than min', async function () {
      await expect(
        ethers.deployContract('PythOracle', [pyth.target, base, feedId, MAX_STALENESS, 9]),
      ).to.be.rejectedWith('InvalidMaxConfWidthLowerBound');
    });

    it('should fail deploy PythOracle contract if maxConfidWidth is higher than max', async function () {
      await expect(
        ethers.deployContract('PythOracle', [pyth.target, base, feedId, MAX_STALENESS, 501]),
      ).to.be.rejectedWith('InvalidMaxConfWidthLowerBound');
    });
  });

  describe('#getQuote', function () {
    Array.from({ length: 17 }, (_, i) => i + 2).forEach(expo => {
      it(`should get quote and amount out for negative exponent of ${-expo}`, async function () {
        // construct price struct
        const priceStruct = await getPriceStruct({
          price: ethers.parseUnits('1', expo),
          expo: -expo,
          conf: expo,
        });

        // set price struct
        await pyth.setPrice(priceStruct);

        // the returned quote should be scaled to 18 decimals precision
        const amountOut = await pythOracle.getQuote(amount, base);
        // value * 1e18
        const expectedAmountOut = ethers.parseEther(value.toString());

        expect(amountOut).to.eq(expectedAmountOut);
      });
    });

    Array.from({ length: 11 }, (_, i) => i + 2).forEach(expo => {
      it(`should get quote and amount out for positive exponent of ${expo}`, async function () {
        // construct price struct
        const priceStruct = await getPriceStruct({
          price: BigInt(1000),
          expo,
          conf: expo,
        });

        // set price struct
        await pyth.setPrice(priceStruct);

        // the returned quote should be scaled to 18 decimals precision
        const amountOut = await pythOracle.getQuote(amount, base);
        // value * 10 ** (18 + exponent)
        const expectedAmountOut = ethers.parseUnits((1000 * value).toString(), 18 + expo);

        const delta = amount * ethers.parseUnits('1', expo);

        expect(amountOut).to.be.approximately(expectedAmountOut, delta);
      });
    });

    it('should fail to get quote if timestamp is stale', async function () {
      // construct price struct
      const priceStruct = await getPriceStruct({ publishTime: 1 });

      // set price struct
      await pyth.setPrice(priceStruct);

      // the returned quote should be scaled to 18 decimals precision
      await expect(pythOracle.getQuote(amount, base)).to.be.rejectedWith('TooStalePrice');
    });

    it('should fail to get quote if timestamp is too ahead', async function () {
      // construct price struct
      const priceStruct = await getPriceStruct({
        publishTime: 1000000000000000,
      });

      // set price struct
      await pyth.setPrice(priceStruct);

      // the returned quote should be scaled to 18 decimals precision
      await expect(pythOracle.getQuote(amount, base)).to.be.rejectedWith('TooAheadPrice');
    });

    it('should fail to get quote if price is negative', async function () {
      // construct price struct
      const priceStruct = await getPriceStruct({ price: BigInt(-1) });

      // set price struct
      await pyth.setPrice(priceStruct);

      // the returned quote should be scaled to 18 decimals precision
      await expect(pythOracle.getQuote(amount, base)).to.be.rejectedWith('InvalidPrice');
    });

    it('should fail to get quote if price is 0', async function () {
      // construct price struct
      const priceStruct = await getPriceStruct({ price: BigInt(0) });

      // set price struct
      await pyth.setPrice(priceStruct);

      // the returned quote should be scaled to 18 decimals precision
      await expect(pythOracle.getQuote(amount, base)).to.be.rejectedWith('InvalidPrice');
    });

    it('should fail to get quote if price is out of the confidence width', async function () {
      // construct price struct
      const priceStruct = await getPriceStruct({
        conf: BigInt('18446744073709551615'),
      });

      // set price struct
      await pyth.setPrice(priceStruct);

      // the returned quote should be scaled to 18 decimals precision
      await expect(pythOracle.getQuote(amount, base)).to.be.rejectedWith('InvalidPrice');
    });

    it('should fail to get quote if exponent is too low', async function () {
      // construct price struct
      const priceStruct = await getPriceStruct({ expo: -21 });

      // set price struct
      await pyth.setPrice(priceStruct);

      // the returned quote should be scaled to 18 decimals precision
      await expect(pythOracle.getQuote(amount, base)).to.be.rejectedWith('InvalidPriceExponent');
    });

    it('should fail to get quote if exponent is too high', async function () {
      // construct price struct
      const priceStruct = await getPriceStruct({ expo: 13 });

      // set price struct
      await pyth.setPrice(priceStruct);

      // the returned quote should be scaled to 18 decimals precision
      await expect(pythOracle.getQuote(amount, base)).to.be.rejectedWith('InvalidPriceExponent');
    });
  });
});
