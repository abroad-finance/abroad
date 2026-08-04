import { TransactionStatus } from '@prisma/client'
import { NotFound } from 'http-errors'
import { inject, injectable } from 'inversify'

import { isKycTemporarilyDisabled } from '../../../app/config/kyc'
import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { uuidToBase64 } from '../infrastructure/transactionEncoding'

interface TransactionStatusResult {
  id: string
  kycRequired: boolean
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

  public async getStatus(
    transactionId: string,
    partnerId: string,
    authenticatedSubject?: string,
  ): Promise<TransactionStatusResult> {
    const prismaClient = await this.prismaClientProvider.getClient()
    const transaction = await prismaClient.transaction.findUnique({
      include: {
        partnerUser: true,
        quote: true,
      },
      where: { id: transactionId },
    })

    if (
      !transaction
      || transaction.quote.partnerId !== partnerId
      || (authenticatedSubject !== undefined && transaction.partnerUser.userId !== authenticatedSubject)
    ) {
      throw new NotFound('Transaction not found')
    }

    const transactionReference = uuidToBase64(transaction.id)
    const kyc = isKycTemporarilyDisabled()
      ? null
      : await prismaClient.partnerUserKyc.findFirst({
          orderBy: { createdAt: 'desc' },
          where: { partnerUserId: transaction.partnerUserId },
        })

    return {
      id: transaction.id,
      kycRequired: kyc !== null && kyc.status !== 'APPROVED',
      onChainTxHash: transaction.onChainId,
      status: transaction.status,
      transactionReference,
      userId: transaction.partnerUser.userId,
    }
  }
}
