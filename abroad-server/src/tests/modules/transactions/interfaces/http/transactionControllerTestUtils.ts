import { TargetCurrency } from '@prisma/client'

import type { IKycService } from '../../../../../modules/kyc/application/contracts/IKycService'
import type { IPaymentService } from '../../../../../modules/payments/application/contracts/IPaymentService'
import type { IPaymentServiceFactory } from '../../../../../modules/payments/application/contracts/IPaymentServiceFactory'
import type { IWebhookNotifier } from '../../../../../platform/notifications/IWebhookNotifier'
import type { IDatabaseClientProvider } from '../../../../../platform/persistence/IDatabaseClientProvider'

import { TransactionAcceptanceService } from '../../../../../modules/transactions/application/TransactionAcceptanceService'
import { TransactionStatusService } from '../../../../../modules/transactions/application/TransactionStatusService'
import { TransactionController } from '../../../../../modules/transactions/interfaces/http/TransactionController'
import { createMockLogger, createMockQueueHandler } from '../../../../setup/mockFactories'

export const createBadRequestResponder = () =>
  jest.fn((status: number, payload: { reason: string }) => {
    return payload
  })

export const authRequest = (partnerId: string) => ({ user: { id: partnerId } } as unknown as import('express').Request)

export const buildPaymentService = (overrides?: Partial<jest.Mocked<IPaymentService>>): jest.Mocked<IPaymentService> => ({
  banks: [],
  currency: TargetCurrency.COP,
  fixedFee: 0,
  getLiquidity: jest.fn(async () => 1_000),
  isAsync: false,
  isEnabled: true,
  MAX_TOTAL_AMOUNT_PER_DAY: 500,
  MAX_USER_AMOUNT_PER_DAY: 500,
  MAX_USER_AMOUNT_PER_TRANSACTION: 500,
  MAX_USER_TRANSACTIONS_PER_DAY: 3,
  MIN_USER_AMOUNT_PER_TRANSACTION: 0,
  onboardUser: jest.fn(async ({ account }: { account: string }) => ({ message: undefined, success: Boolean(account) })),
  percentageFee: 0,
  sendPayment: jest.fn(async (params: {
    account: string
    bankCode: string
    id: string
    qrCode?: null | string
    value: number
  }) => ({ success: Boolean(params.account && params.bankCode && params.value), transactionId: 'tx-id' })),
  verifyAccount: jest.fn(async ({ account, bankCode }: { account: string, bankCode: string }) => Boolean(account && bankCode)),
  ...(overrides ?? {}),
})

export const buildMinimalController = () => {
  const prisma = {
    partnerUserKyc: { findFirst: jest.fn() },
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
  const queueHandler = createMockQueueHandler()
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

  return {
    controller: new TransactionController(acceptanceService, statusService),
    prisma,
  }
}
