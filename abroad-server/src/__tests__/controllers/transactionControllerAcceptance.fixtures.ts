import { Country, PaymentMethod } from '@prisma/client'

import type { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'
import type { IKycService } from '../../interfaces/IKycService'
import type { IPaymentService } from '../../interfaces/IPaymentService'
import type { IPaymentServiceFactory } from '../../interfaces/IPaymentServiceFactory'
import type { IWebhookNotifier } from '../../interfaces/IWebhookNotifier'

import { TransactionController } from '../../controllers/TransactionController'
import { TransactionAcceptanceService } from '../../services/TransactionAcceptanceService'
import { TransactionStatusService } from '../../services/TransactionStatusService'
import { createMockLogger, createMockQueueHandler } from '../setup/mockFactories'
import { buildPaymentService } from './transactionControllerTestUtils'

export const partner = {
  id: 'partner-1',
  isKybApproved: true,
  needsKyc: false,
  webhookUrl: 'https://webhook.test',
}

export const baseQuote = {
  country: Country.CO,
  id: 'quote-1',
  partnerId: partner.id,
  paymentMethod: PaymentMethod.PIX,
  sourceAmount: 25,
  targetAmount: 50,
}

export const requestBody = {
  account_number: '123',
  bank_code: '001',
  quote_id: baseQuote.id,
  user_id: 'user-1',
}

export const buildAcceptController = (
  overrides?: Partial<{
    kycLink: null | string
    paymentService: Partial<jest.Mocked<IPaymentService>>
    quote: unknown
    transactionCreate: () => Promise<unknown>
    transactionFindMany: unknown[][]
    transactionFindUnique: () => Promise<unknown>
  }>,
) => {
  const quoteValue = overrides?.quote === undefined ? baseQuote : overrides.quote
  const transactionId = '11111111-2222-3333-4444-555555555555'
  const prisma = {
    partnerUser: { upsert: jest.fn().mockResolvedValue({ id: 'pu-1', partnerId: partner.id, userId: 'user-1' }) },
    partnerUserKyc: { findFirst: jest.fn().mockResolvedValue({ link: 'kyc-link', status: 'PENDING' }) },
    quote: { findUnique: jest.fn().mockResolvedValue(quoteValue) },
    transaction: {
      create: jest.fn(overrides?.transactionCreate ?? (async () => ({ id: transactionId }))),
      findMany: jest.fn(),
      findUnique: jest.fn(overrides?.transactionFindUnique ?? (async () => ({ id: transactionId, partnerUser: { partnerId: partner.id, userId: 'user-1' }, quote: baseQuote }))),
    },
  }

  const paymentService = buildPaymentService(overrides?.paymentService)

  const paymentServiceFactory: IPaymentServiceFactory = {
    getPaymentService: jest.fn().mockReturnValue(paymentService as unknown as IPaymentService),
  }
  const kycService: IKycService = {
    getKycLink: jest.fn().mockResolvedValue(overrides?.kycLink ?? null),
  }
  const webhookNotifier: IWebhookNotifier = {
    notifyWebhook: jest.fn(),
  }
  const queueHandler = createMockQueueHandler()
  const dbProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prisma as unknown as import('@prisma/client').PrismaClient),
  }
  const logger = createMockLogger()

  const acceptanceService = new TransactionAcceptanceService(
    dbProvider,
    paymentServiceFactory,
    kycService,
    webhookNotifier,
    queueHandler,
    logger,
  )
  const statusService = new TransactionStatusService(dbProvider)

  const transactionsPerCall = overrides?.transactionFindMany ?? [[], [], [], []]
  prisma.transaction.findMany.mockImplementation(async () => transactionsPerCall.shift() ?? [])

  const controller = new TransactionController(acceptanceService, statusService)

  return {
    controller,
    kycService,
    paymentService,
    prisma,
    queueHandler,
    webhookNotifier,
  }
}
