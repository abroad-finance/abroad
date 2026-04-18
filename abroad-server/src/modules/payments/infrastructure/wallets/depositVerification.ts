import { BlockchainNetwork, PrismaClient, TransactionStatus } from '@prisma/client'

const PAYABLE_STATUSES: ReadonlySet<TransactionStatus> = new Set([
  TransactionStatus.AWAITING_PAYMENT,
  TransactionStatus.PAYMENT_EXPIRED,
])

export function validateDepositTransaction(
  transaction: {
    quote: { network: BlockchainNetwork }
    status: TransactionStatus
  },
  expectedNetwork: BlockchainNetwork,
): string | undefined {
  if (!PAYABLE_STATUSES.has(transaction.status)) {
    return 'Transaction is not awaiting payment'
  }

  if (transaction.quote.network !== expectedNetwork) {
    return `Transaction is not set for ${expectedNetwork.charAt(0)}${expectedNetwork.slice(1).toLowerCase()}`
  }

  return undefined
}

export async function ensureUniqueOnChainId(
  prismaClient: PrismaClient,
  onChainSignature: string,
  transactionId: string,
): Promise<string | undefined> {
  const duplicateOnChain = await prismaClient.transaction.findFirst({
    select: { id: true },
    where: { onChainId: onChainSignature },
  })

  if (duplicateOnChain && duplicateOnChain.id !== transactionId) {
    return 'On-chain transaction already linked to another transaction'
  }

  return undefined
}
