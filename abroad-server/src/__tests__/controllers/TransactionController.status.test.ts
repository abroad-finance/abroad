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
    prisma.partnerUserKyc.findFirst.mockResolvedValue({ link: 'kyc-link', status: 'PENDING' })

    const response = await controller.getTransactionStatus(
      'tx-1111-2222-3333-444455556666',
      authRequest('partner-1'),
    )

    expect(prisma.transaction.findUnique).toHaveBeenCalled()
    expect(response.transaction_reference).toBe(expectedReference)
    expect(response.kycLink).toBe('kyc-link')
  })
})
