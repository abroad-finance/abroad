import { getAssociatedTokenAddress } from '@solana/spl-token'
import { Connection, PublicKey } from '@solana/web3.js'
import {
  Contract, formatUnits, getAddress, JsonRpcProvider,
} from 'ethers'

import { getChainBalanceConfig } from './chainBalanceConfig'
import {
  EMPTY_STABLECOIN_BALANCES,
  formatStablecoinBalance,
  type StablecoinBalances,
} from './stablecoinPortfolio'

const ERC20_ABI = ['function balanceOf(address account) view returns (uint256)'] as const

export async function fetchNonStellarBalances(
  address: string,
  chainId: string,
  family: 'evm' | 'solana',
): Promise<StablecoinBalances> {
  const config = getChainBalanceConfig(chainId)
  if (!config) {
    return EMPTY_STABLECOIN_BALANCES
  }

  if (family === 'solana') {
    try {
      const connection = new Connection(config.rpcUrl)
      const owner = new PublicKey(address)
      const usdcMint = new PublicKey(config.usdcAddress)
      const usdtMint = new PublicKey(config.usdtAddress)
      const [usdcAta, usdtAta] = await Promise.all([getAssociatedTokenAddress(usdcMint, owner), getAssociatedTokenAddress(usdtMint, owner)])
      const [usdcAccount, usdtAccount] = await Promise.all([connection.getAccountInfo(usdcAta), connection.getAccountInfo(usdtAta)])
      const parseTokenAccount = (info: null | { data: Uint8Array }): number => {
        if (!info?.data || info.data.length < 72) return 0
        const view = new DataView(info.data.buffer, info.data.byteOffset + 64, 8)
        const raw = view.getBigUint64(0, true)
        return Number(raw) / (10 ** config.decimals)
      }
      return {
        cUSD: '0.00',
        USDC: formatStablecoinBalance(parseTokenAccount(usdcAccount)),
        USDT: formatStablecoinBalance(parseTokenAccount(usdtAccount)),
      }
    }
    catch {
      return EMPTY_STABLECOIN_BALANCES
    }
  }

  if (family === 'evm') {
    try {
      const provider = new JsonRpcProvider(config.rpcUrl)
      const ownerAddress = getAddress(address)
      const usdc = new Contract(getAddress(config.usdcAddress), ERC20_ABI, provider)
      const usdt = new Contract(getAddress(config.usdtAddress), ERC20_ABI, provider)
      const cUsd = config.cUsdAddress
        ? new Contract(getAddress(config.cUsdAddress), ERC20_ABI, provider)
        : null
      const [
        usdcRaw,
        usdtRaw,
        cUsdRaw,
      ] = await Promise.all([
        usdc.balanceOf(ownerAddress),
        usdt.balanceOf(ownerAddress),
        cUsd ? cUsd.balanceOf(ownerAddress) : Promise.resolve(0n),
      ])
      const usdcNum = parseFloat(formatUnits(usdcRaw, config.decimals))
      const usdtNum = parseFloat(formatUnits(usdtRaw, config.decimals))
      const cUsdNum = parseFloat(formatUnits(cUsdRaw, config.cUsdDecimals ?? config.decimals))
      return {
        cUSD: formatStablecoinBalance(cUsdNum),
        USDC: formatStablecoinBalance(usdcNum),
        USDT: formatStablecoinBalance(usdtNum),
      }
    }
    catch {
      return EMPTY_STABLECOIN_BALANCES
    }
  }

  return EMPTY_STABLECOIN_BALANCES
}
