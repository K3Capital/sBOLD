import { ethers } from 'hardhat';
import { BPS_DENOMINATOR, WEIGHTS } from './constants';

interface PriceStruct {
  price: bigint;
  conf: bigint;
  expo: number;
  publishTime?: number;
}

export async function getBlockTimestamp(): Promise<number> {
  const blockNumber = await ethers.provider.getBlockNumber();

  const block = await ethers.provider.getBlock(blockNumber);

  return block?.timestamp ?? 0;
}

export async function getPriceStruct({
  price,
  conf,
  expo,
  publishTime,
}: {
  price?: bigint;
  conf?: bigint;
  expo?: number;
  publishTime?: number;
}): Promise<PriceStruct> {
  return {
    price: price ?? BigInt(6304543037500),
    conf: conf ?? BigInt(2821216744),
    expo: expo ?? -8,
    publishTime: publishTime ?? (await getBlockTimestamp()),
  };
}

export function calcAssetsInSPs(assets: bigint): bigint[] {
  const assetsInSPs = [] as bigint[];

  for (let i = 0; i < WEIGHTS.length; i++) {
    assetsInSPs[i] = (assets * BigInt(WEIGHTS[i])) / BigInt(BPS_DENOMINATOR);
  }

  return assetsInSPs;
}
