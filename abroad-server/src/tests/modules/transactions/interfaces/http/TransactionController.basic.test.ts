import 'reflect-metadata'
import { NotFound } from 'http-errors'

import { authRequest, buildMinimalController, createBadRequestResponder, walletAuthRequest } from './transactionControllerTestUtils'

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

  it('requires either an account number or QR code', async () => {
    const { controller } = buildMinimalController()

    const response = await controller.acceptTransaction(
      { quote_id: 'quote-1', user_id: 'user-1' },
      authRequest('partner-1'),
      badRequest,
    )

    expect(response).toEqual(expect.objectContaining({
      reason: expect.stringContaining('Account number, QR code, or destination address is required'),
    }))
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

  it('returns the same not-found response when a wallet requests another wallet transaction', async () => {
    const { controller, prisma } = buildMinimalController()
    prisma.transaction.findUnique.mockResolvedValueOnce({
      id: 'tx-2',
      onChainId: null,
      partnerUser: { id: 'pu-1', userId: 'stellar:pubnet:GOTHER' },
      partnerUserId: 'pu-1',
      quote: { partnerId: 'partner-1' },
      status: 'PAYMENT_COMPLETED',
    })

    await expect(controller.getTransactionStatus(
      'tx-2',
      walletAuthRequest('partner-1', 'stellar:pubnet:GREQUESTER'),
    )).rejects.toBeInstanceOf(NotFound)
    expect(prisma.partnerUserKyc.findFirst).not.toHaveBeenCalled()
  })
})
