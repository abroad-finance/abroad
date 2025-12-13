import { TransactionStatus } from '@prisma/client'
import { NotFound } from 'http-errors'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { uuidToBase64 } from '../infrastructure/transactionEncoding'

interface TransactionStatusResult {
  id: string
  kycLink: null | string
  onChainTxHash: null | string
  status: TransactionStatus
  transactionReference: string
  userId: string
}

@injectable()
export class TransactionStatusService {
  constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly prismaClientProvider: IDatabaseClientProvider,
  ) {}

  public async getStatus(transactionId: string, partnerId: string): Promise<TransactionStatusResult> {
    const prismaClient = await this.prismaClientProvider.getClient()
    const transaction = await prismaClient.transaction.findUnique({
      include: {
        partnerUser: true,
        quote: true,
      },
      where: { id: transactionId },
    })

    if (!transaction || transaction.quote.partnerId !== partnerId) {
      throw new NotFound('Transaction not found')
    }

    const transactionReference = uuidToBase64(transaction.id)
    const kyc = await prismaClient.partnerUserKyc.findFirst({
      orderBy: { createdAt: 'desc' },
      where: { partnerUserId: transaction.partnerUserId },
    })

    return {
      id: transaction.id,
      kycLink: kyc?.status !== 'APPROVED' ? kyc?.link ?? null : null,
      onChainTxHash: transaction.onChainId,
      status: transaction.status,
      transactionReference,
      userId: transaction.partnerUser.userId,
    }
  }
}
