import { PaymentMethod, TransactionStatus } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { TransferoUltraClient, TransferoUltraError } from '../../transfero/infrastructure/TransferoUltraClient'

export type PartnerPixReceiptDto = {
  contentBase64: string
  contentType: 'application/pdf'
  fileName: string
  sizeBytes: number
}

export type PartnerPixReceiptLanguage = 'en' | 'pt-BR'

export class PartnerPixReceiptNotFoundError extends Error {
  public constructor() {
    super('PIX receipt not found')
    this.name = 'PartnerPixReceiptNotFoundError'
  }
}

export class PartnerPixReceiptProviderError extends Error {
  public constructor() {
    super('The PIX receipt provider is temporarily unavailable')
    this.name = 'PartnerPixReceiptProviderError'
  }
}

export class PartnerPixReceiptUnavailableError extends Error {
  public constructor() {
    super('The PIX receipt is not available yet')
    this.name = 'PartnerPixReceiptUnavailableError'
  }
}

@injectable()
export class PartnerPixReceiptService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
    @inject(TransferoUltraClient)
    private readonly transferoUltraClient: TransferoUltraClient,
  ) {}

  /**
   * Ops-only cross-partner receipt lookup. The caller cannot provide a partner
   * scope, which prevents accidental reuse from tenant-facing routes. HTTP
   * authorization and immutable proof-access auditing remain controller-owned.
   */
  public async getOpsReceipt(
    transactionId: string,
    language: PartnerPixReceiptLanguage,
  ): Promise<PartnerPixReceiptDto> {
    return this.getReceiptForWhere(transactionId, language, {
      id: transactionId,
      quote: { paymentMethod: PaymentMethod.PIX },
    })
  }

  public async getReceipt(
    partnerId: string,
    transactionId: string,
    language: PartnerPixReceiptLanguage,
  ): Promise<PartnerPixReceiptDto> {
    return this.getReceiptForWhere(transactionId, language, {
      id: transactionId,
      partnerUser: { partnerId },
      quote: { paymentMethod: PaymentMethod.PIX },
    })
  }

  private async getReceiptForWhere(
    transactionId: string,
    language: PartnerPixReceiptLanguage,
    where: import('@prisma/client').Prisma.TransactionWhereInput,
  ): Promise<PartnerPixReceiptDto> {
    const prismaClient = await this.databaseClientProvider.getClient()
    const transaction = await prismaClient.transaction.findFirst({
      select: {
        externalId: true,
        status: true,
      },
      where,
    })
    if (!transaction?.externalId) {
      throw new PartnerPixReceiptNotFoundError()
    }
    if (transaction.status !== TransactionStatus.PAYMENT_COMPLETED) {
      throw new PartnerPixReceiptUnavailableError()
    }

    try {
      const receipt = await this.transferoUltraClient.getPdf(
        `/api/v1/pix/withdrawals/${encodeURIComponent(transaction.externalId)}/receipt`,
        { lang: language },
      )
      return {
        contentBase64: receipt.data.toString('base64'),
        contentType: receipt.contentType,
        fileName: `abroad-pix-receipt-${transactionId}.pdf`,
        sizeBytes: receipt.data.length,
      }
    }
    catch (error) {
      if (
        error instanceof TransferoUltraError
        && (error.status === 404 || error.status === 409)
      ) {
        throw new PartnerPixReceiptUnavailableError()
      }
      throw new PartnerPixReceiptProviderError()
    }
  }
}
