import 'reflect-metadata'
import { NotFound } from 'http-errors'

import type { IQueueHandler } from '../../interfaces'
import type { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'
import type { IKycService } from '../../interfaces/IKycService'
import type { IPaymentServiceFactory } from '../../interfaces/IPaymentServiceFactory'
import type { IWebhookNotifier } from '../../interfaces/IWebhookNotifier'

import { TransactionController } from '../../controllers/TransactionController'

const buildController = () => {
  const prisma = {
    transaction: {
      findUnique: jest.fn(),
    },
  }
  const dbProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prisma as unknown as import('@prisma/client').PrismaClient),
  }
  const paymentServiceFactory: IPaymentServiceFactory = {
    getPaymentService: jest.fn(),
  }
  const kycService: IKycService = {
    getKycLink: jest.fn(),
  }
  const webhookNotifier: IWebhookNotifier = {
    notifyWebhook: jest.fn(),
  }
  const queueHandler: IQueueHandler = {
    postMessage: jest.fn(),
    subscribeToQueue: jest.fn(),
  }

  return {
    controller: new TransactionController(dbProvider, paymentServiceFactory, kycService, webhookNotifier, queueHandler),
    prisma,
  }
}

const badRequest = jest.fn((status: number, payload: { reason: string }) => payload)
const authRequest = (partnerId: string) => ({ user: { id: partnerId } } as unknown as import('express').Request)

describe('TransactionController minimal branches', () => {
  it('rejects invalid acceptTransaction payloads', async () => {
    const { controller } = buildController()

    const response = await controller.acceptTransaction(
      { account_number: '', bank_code: '', quote_id: '', user_id: '' },
      authRequest('partner-1'),
      badRequest,
    )

    expect(badRequest).toHaveBeenCalled()
    expect(response).toEqual(expect.objectContaining({ reason: expect.any(String) }))
  })

  it('throws when transaction is not found', async () => {
    const { controller, prisma } = buildController()
    prisma.transaction.findUnique.mockResolvedValueOnce(null)

    await expect(controller.getTransactionStatus('missing-tx', authRequest('partner-1'))).rejects.toBeInstanceOf(NotFound)
  })

  it('throws when transaction belongs to another partner', async () => {
    const { controller, prisma } = buildController()
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
