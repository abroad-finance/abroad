import 'reflect-metadata'

import type { PrismaClient } from '@prisma/client'

import { TransactionStatus } from '@prisma/client'

import { IPartnerPixProvider, PixReceiptResult } from '../../../../modules/transactions/application/contracts/IPartnerPixProvider'
import { PartnerPixReceiptNotFoundError, PartnerPixReceiptProviderError, PartnerPixReceiptService, PartnerPixReceiptUnavailableError } from '../../../../modules/transactions/application/PartnerPixReceiptService'
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
  const fetchWithdrawalReceipt = jest.fn<Promise<PixReceiptResult>, [{
    language: string
    withdrawalId: string
  }]>(async () => ({
    contentType: 'application/pdf',
    data: Buffer.from('%PDF-1.7 receipt'),
    success: true,
  }))
  const pixProvider: IPartnerPixProvider = {
    fetchWithdrawalReceipt,
    readWithdrawalDetail: jest.fn(),
  }
  return {
    fetchWithdrawalReceipt,
    service: new PartnerPixReceiptService(
      databaseClientProvider,
      pixProvider,
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
    expect(harness.fetchWithdrawalReceipt).toHaveBeenCalledWith(
      { language: 'en', withdrawalId },
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
    expect(harness.fetchWithdrawalReceipt).not.toHaveBeenCalled()

    harness.transactionFindFirst.mockResolvedValueOnce({
      externalId: null,
      status: TransactionStatus.PAYMENT_COMPLETED,
    })
    await expect(harness.service.getReceipt(
      'partner-1',
      transactionId,
      'pt-BR',
    )).rejects.toThrow(new PartnerPixReceiptNotFoundError())
    expect(harness.fetchWithdrawalReceipt).not.toHaveBeenCalled()
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
    expect(harness.fetchWithdrawalReceipt).not.toHaveBeenCalled()
  })

  // Which provider status maps to which reason is the adapter's job and is
  // covered in TransferoPartnerPixProvider.test.ts. What matters here is that
  // the service turns each reason into the right partner-facing error and never
  // leaks provider detail into the message.
  it('maps an unavailable receipt and a provider failure to distinct sanitized errors', async () => {
    const harness = buildHarness()
    harness.fetchWithdrawalReceipt.mockResolvedValueOnce({ reason: 'unavailable', success: false })

    await expect(harness.service.getReceipt(
      'partner-1',
      transactionId,
      'pt-BR',
    )).rejects.toThrow(new PartnerPixReceiptUnavailableError())

    harness.fetchWithdrawalReceipt.mockResolvedValueOnce({ reason: 'provider_error', success: false })
    await expect(harness.service.getReceipt(
      'partner-1',
      transactionId,
      'pt-BR',
    )).rejects.toThrow(new PartnerPixReceiptProviderError())
  })
})
