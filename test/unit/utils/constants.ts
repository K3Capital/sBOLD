import { ethers } from 'hardhat';

export const ONE_ETH = ethers.parseEther('1');
export const ONE_MIN = 60;
export const MAX_STALENESS = 2 * ONE_MIN;
export const MAX_CONFID_WIDTH = 500;
export const WEIGHTS = [4000, 4000, 2000];
export const BPS_DENOMINATOR = 10000;
export const SWAP_INTERFACE = new ethers.Interface([
  'function swap(address src, address dst, uint256 inAmount, uint256 minOut, bytes data) external returns (uint256)',
]);
