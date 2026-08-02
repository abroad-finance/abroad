import 'reflect-metadata'

import type { PrismaClient } from '@prisma/client'

import { TransactionStatus } from '@prisma/client'

import { PartnerPixReceiptNotFoundError, PartnerPixReceiptProviderError, PartnerPixReceiptService, PartnerPixReceiptUnavailableError } from '../../../../modules/transactions/application/PartnerPixReceiptService'
import { TransferoUltraClient, TransferoUltraError } from '../../../../modules/transfero/infrastructure/TransferoUltraClient'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

const transactionId = '11111111-1111-4111-8111-111111111111'
const withdrawalId = '22222222-2222-4222-8222-222222222222'

type ReceiptTransactionRow = {
  externalId: null | string
  status: TransactionStatus
}

const buildHarness = () => {
  const transactionFindFirst = jest.fn<Promise<null | ReceiptTransactionRow>, [unknown]>(async () => ({
    externalId: withdrawalId,
    status: TransactionStatus.PAYMENT_COMPLETED,
  }))
  const databaseClientProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => ({
      transaction: { findFirst: transactionFindFirst },
    }) as unknown as PrismaClient),
  }
  const getPdf = jest.fn<Promise<{
    contentType: 'application/pdf'
    data: Buffer
  }>, [string, unknown?]>(async () => ({
    contentType: 'application/pdf' as const,
    data: Buffer.from('%PDF-1.7 receipt'),
  }))
  const transferoUltraClient = { getPdf } as unknown as TransferoUltraClient
  return {
    getPdf,
    service: new PartnerPixReceiptService(
      databaseClientProvider,
      transferoUltraClient,
    ),
    transactionFindFirst,
  }
}

describe('PartnerPixReceiptService', () => {
  it('uses a distinct cross-partner lookup for authorized Ops receipt access', async () => {
    const harness = buildHarness()

    await harness.service.getOpsReceipt(transactionId, 'pt-BR')

    expect(harness.transactionFindFirst).toHaveBeenCalledWith({
      select: { externalId: true, status: true },
      where: {
        id: transactionId,
        quote: { paymentMethod: 'PIX' },
      },
    })
  })

  it('returns a tenant-scoped bounded receipt envelope', async () => {
    const harness = buildHarness()

    const result = await harness.service.getReceipt('partner-1', transactionId, 'en')

    expect(harness.transactionFindFirst).toHaveBeenCalledWith({
      select: { externalId: true, status: true },
      where: {
        id: transactionId,
        partnerUser: { partnerId: 'partner-1' },
        quote: { paymentMethod: 'PIX' },
      },
    })
    expect(harness.getPdf).toHaveBeenCalledWith(
      `/api/v1/pix/withdrawals/${withdrawalId}/receipt`,
      { lang: 'en' },
    )
    expect(result).toEqual({
      contentBase64: Buffer.from('%PDF-1.7 receipt').toString('base64'),
      contentType: 'application/pdf',
      fileName: `abroad-pix-receipt-${transactionId}.pdf`,
      sizeBytes: Buffer.byteLength('%PDF-1.7 receipt'),
    })
  })

  it('uses the same not-found response for another tenant, a non-PIX transaction, or no provider id', async () => {
    const harness = buildHarness()
    harness.transactionFindFirst.mockResolvedValueOnce(null)

    await expect(harness.service.getReceipt(
      'other-partner',
      transactionId,
      'pt-BR',
    )).rejects.toThrow(new PartnerPixReceiptNotFoundError())
    expect(harness.getPdf).not.toHaveBeenCalled()

    harness.transactionFindFirst.mockResolvedValueOnce({
      externalId: null,
      status: TransactionStatus.PAYMENT_COMPLETED,
    })
    await expect(harness.service.getReceipt(
      'partner-1',
      transactionId,
      'pt-BR',
    )).rejects.toThrow(new PartnerPixReceiptNotFoundError())
    expect(harness.getPdf).not.toHaveBeenCalled()
  })

  it('does not call Ultra until the local transaction is complete', async () => {
    const harness = buildHarness()
    harness.transactionFindFirst.mockResolvedValueOnce({
      externalId: withdrawalId,
      status: TransactionStatus.PROCESSING_PAYMENT,
    })

    await expect(harness.service.getReceipt(
      'partner-1',
      transactionId,
      'pt-BR',
    )).rejects.toThrow(new PartnerPixReceiptUnavailableError())
    expect(harness.getPdf).not.toHaveBeenCalled()
  })

  it('maps provider 404/409 to unavailable and other failures to a sanitized gateway error', async () => {
    const harness = buildHarness()
    harness.getPdf.mockRejectedValueOnce(new TransferoUltraError({
      code: 'validation',
      message: 'provider response detail',
      providerCode: 'RECEIPT_NOT_AVAILABLE',
      status: 409,
    }))

    await expect(harness.service.getReceipt(
      'partner-1',
      transactionId,
      'pt-BR',
    )).rejects.toThrow(new PartnerPixReceiptUnavailableError())

    harness.getPdf.mockRejectedValueOnce(new Error('secret provider detail'))
    await expect(harness.service.getReceipt(
      'partner-1',
      transactionId,
      'pt-BR',
    )).rejects.toThrow(new PartnerPixReceiptProviderError())
  })
})
