import 'reflect-metadata'
import { NotFound } from 'http-errors'

import { authRequest, buildMinimalController, createBadRequestResponder } from './transactionControllerTestUtils'

const badRequest = createBadRequestResponder()

beforeEach(() => {
  badRequest.mockClear()
})

describe('TransactionController minimal branches', () => {
  it('rejects invalid acceptTransaction payloads', async () => {
    const { controller } = buildMinimalController()

    const response = await controller.acceptTransaction(
      { account_number: '', quote_id: '', user_id: '' },
      authRequest('partner-1'),
      badRequest,
    )

    expect(badRequest).toHaveBeenCalled()
    expect(response).toEqual(expect.objectContaining({ reason: expect.any(String) }))
  })

  it('throws when transaction is not found', async () => {
    const { controller, prisma } = buildMinimalController()
    prisma.transaction.findUnique.mockResolvedValueOnce(null)

    await expect(controller.getTransactionStatus('missing-tx', authRequest('partner-1'))).rejects.toBeInstanceOf(NotFound)
  })

  it('throws when transaction belongs to another partner', async () => {
    const { controller, prisma } = buildMinimalController()
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-2',
      onChainId: null,
      partnerUser: { id: 'pu-1', userId: 'user-1' },
      partnerUserId: 'pu-1',
      quote: { partnerId: 'other-partner' },
      status: 'PAYMENT_COMPLETED',
    })

    await expect(controller.getTransactionStatus('tx-2', authRequest('partner-1'))).rejects.toBeInstanceOf(NotFound)
  })
})
