import { getAssociatedTokenAddress } from '@solana/spl-token'
import { Connection, PublicKey } from '@solana/web3.js'
import {
  Contract, formatUnits, getAddress, JsonRpcProvider,
} from 'ethers'

import { getChainBalanceConfig } from './chainBalanceConfig'

const ERC20_ABI = ['function balanceOf(address account) view returns (uint256)'] as const

export async function fetchNonStellarBalances(
  address: string,
  chainId: string,
  family: 'evm' | 'solana',
): Promise<{ usdc: string, usdt: string }> {
  const config = getChainBalanceConfig(chainId)
  if (!config) return { usdc: '0.00', usdt: '0.00' }

  const format = (n: number): string => (
    Number.isFinite(n)
      ? n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })
      : '0.00'
  )

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
        usdc: format(parseTokenAccount(usdcAccount)),
        usdt: format(parseTokenAccount(usdtAccount)),
      }
    }
    catch {
      return { usdc: '0.00', usdt: '0.00' }
    }
  }

  if (family === 'evm') {
    try {
      const provider = new JsonRpcProvider(config.rpcUrl)
      const usdc = new Contract(getAddress(config.usdcAddress), ERC20_ABI, provider)
      const usdt = new Contract(getAddress(config.usdtAddress), ERC20_ABI, provider)
      const [usdcRaw, usdtRaw] = await Promise.all([usdc.balanceOf(getAddress(address)), usdt.balanceOf(getAddress(address))])
      const usdcNum = parseFloat(formatUnits(usdcRaw, config.decimals))
      const usdtNum = parseFloat(formatUnits(usdtRaw, config.decimals))
      return { usdc: format(usdcNum), usdt: format(usdtNum) }
    }
    catch {
      return { usdc: '0.00', usdt: '0.00' }
    }
  }

  return { usdc: '0.00', usdt: '0.00' }
}
