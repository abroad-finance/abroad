import 'reflect-metadata'
import { TransactionStatus } from '@prisma/client'

import { authRequest, buildMinimalController, createBadRequestResponder } from './transactionControllerTestUtils'

describe('TransactionController status lookup', () => {
  const badRequest = createBadRequestResponder()

  beforeEach(() => {
    badRequest.mockClear()
  })

  it('returns transaction status for matching partner', async () => {
    const transactionId = '11111111-2222-3333-4444-555555555555'
    const expectedReference = Buffer.from(transactionId.replace(/-/g, ''), 'hex').toString('base64')
    const { controller, prisma } = buildMinimalController()
    prisma.transaction.findUnique.mockResolvedValue({
      id: transactionId,
      onChainId: 'on-chain-id',
      partnerUser: { id: 'pu-1', partnerId: 'partner-1', userId: 'user-1' },
      partnerUserId: 'pu-1',
      quote: { partnerId: 'partner-1' },
      status: TransactionStatus.PAYMENT_COMPLETED,
    })
    prisma.partnerUserKyc.findFirst.mockResolvedValue({ status: 'PENDING' })

    const response = await controller.getTransactionStatus(
      'tx-1111-2222-3333-444455556666',
      authRequest('partner-1'),
    )

    expect(prisma.transaction.findUnique).toHaveBeenCalled()
    expect(response.transaction_reference).toBe(expectedReference)
    expect(response.kycRequired).toBe(true)
  })

  it('reports kycRequired false when the latest KYC is approved', async () => {
    const transactionId = '11111111-2222-3333-4444-555555555555'
    const { controller, prisma } = buildMinimalController()
    prisma.transaction.findUnique.mockResolvedValue({
      id: transactionId,
      onChainId: 'on-chain-id',
      partnerUser: { id: 'pu-1', partnerId: 'partner-1', userId: 'user-1' },
      partnerUserId: 'pu-1',
      quote: { partnerId: 'partner-1' },
      status: TransactionStatus.PAYMENT_COMPLETED,
    })
    prisma.partnerUserKyc.findFirst.mockResolvedValue({ status: 'APPROVED' })

    const response = await controller.getTransactionStatus(
      'tx-1111-2222-3333-444455556666',
      authRequest('partner-1'),
    )

    expect(response.kycRequired).toBe(false)
  })

  it('reports kycRequired false when the user has no KYC record', async () => {
    const transactionId = '11111111-2222-3333-4444-555555555555'
    const { controller, prisma } = buildMinimalController()
    prisma.transaction.findUnique.mockResolvedValue({
      id: transactionId,
      onChainId: null,
      partnerUser: { id: 'pu-1', partnerId: 'partner-1', userId: 'user-1' },
      partnerUserId: 'pu-1',
      quote: { partnerId: 'partner-1' },
      status: TransactionStatus.AWAITING_PAYMENT,
    })
    prisma.partnerUserKyc.findFirst.mockResolvedValue(null)

    const response = await controller.getTransactionStatus(
      'tx-1111-2222-3333-444455556666',
      authRequest('partner-1'),
    )

    expect(response.kycRequired).toBe(false)
  })
})
