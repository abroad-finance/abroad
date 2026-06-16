import { BlockchainNetwork } from '@prisma/client'

/**
 * Binance network token for a blockchain, used for BOTH deposit-address lookup
 * and withdrawals so the two can never refer to different chains. Returns
 * undefined for unsupported chains so callers fail deterministically instead of
 * letting Binance default-route a withdrawal to the wrong network.
 */
export function mapBlockchainToBinanceNetwork(blockchain: BlockchainNetwork): string | undefined {
  switch (blockchain) {
    case BlockchainNetwork.CELO:
      return 'CELO'
    case BlockchainNetwork.SOLANA:
      return 'SOL'
    case BlockchainNetwork.STELLAR:
      return 'XLM'
    default:
      return undefined
  }
}
