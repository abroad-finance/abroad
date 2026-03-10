/**
 * RPC and token addresses for non-Stellar chains.
 * Stellar uses USDC only (handled in useWalletDetails).
 * Solana and EVM (e.g. Celo) show USDC + USDT.
 */
export interface ChainBalanceConfig {
  cUsdAddress?: null | string
  decimals: number
  rpcUrl: string
  usdcAddress: string
  usdtAddress: string
}

const SOLANA_MAINNET: ChainBalanceConfig = {
  cUsdAddress: null,
  decimals: 6,
  rpcUrl: 'https://api.mainnet-beta.solana.com',
  usdcAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  usdtAddress: '9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E',
}

const CELO_MAINNET: ChainBalanceConfig = {
  // MiniPay docs currently point developers to these Celo stablecoin contracts.
  cUsdAddress: '0x765DE816845861e75A25fCA122bb6898B8B1282a',
  decimals: 6,
  rpcUrl: 'https://forno.celo.org',
  usdcAddress: '0x37f750B7Cc259a2f741Af45294f6a16572CF5cAd',
  usdtAddress: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e',
}

const EVM_CHAINS: Record<string, ChainBalanceConfig> = {
  42220: CELO_MAINNET,
  // Add more eip155 chainIds as needed (e.g. 1 for Ethereum mainnet).
}

export function getChainBalanceConfig(chainId: string): ChainBalanceConfig | null {
  if (chainId.startsWith('solana:')) return SOLANA_MAINNET
  if (chainId.startsWith('eip155:')) {
    const numericId = chainId.replace(/^eip155:/, '')
    return EVM_CHAINS[numericId] ?? null
  }
  return null
}
