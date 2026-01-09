import { TargetCurrency } from '@prisma/client'

import type { IKycService } from '../../../../../modules/kyc/application/contracts/IKycService'
import type { IPaymentService } from '../../../../../modules/payments/application/contracts/IPaymentService'
import type { IPaymentServiceFactory } from '../../../../../modules/payments/application/contracts/IPaymentServiceFactory'
import type { IDatabaseClientProvider } from '../../../../../platform/persistence/IDatabaseClientProvider'

import { TransactionAcceptanceService } from '../../../../../modules/transactions/application/TransactionAcceptanceService'
import { TransactionStatusService } from '../../../../../modules/transactions/application/TransactionStatusService'
import { TransactionController } from '../../../../../modules/transactions/interfaces/http/TransactionController'
import { createMockLogger } from '../../../../setup/mockFactories'

export const createBadRequestResponder = () =>
  jest.fn((status: number, payload: { reason: string }) => {
    return payload
  })

export const authRequest = (partnerId: string) => ({ user: { id: partnerId } } as unknown as import('express').Request)

export const buildPaymentService = (overrides?: Partial<jest.Mocked<IPaymentService>>): jest.Mocked<IPaymentService> => ({
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
    id: string
    qrCode?: null | string
    value: number
  }) => ({ success: Boolean(params.account && params.value), transactionId: 'tx-id' })),
  verifyAccount: jest.fn(async ({ account }: { account: string }) => Boolean(account)),
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
    getPaymentServiceForCapability: jest.fn(),
  }
  const kycService: IKycService = {
    getKycLink: jest.fn(),
  }
  const outboxDispatcher = {
    enqueueQueue: jest.fn(),
    enqueueWebhook: jest.fn(),
  }
  const logger = createMockLogger()

  const acceptanceService = new TransactionAcceptanceService(
    dbProvider,
    paymentServiceFactory,
    kycService,
    outboxDispatcher as never,
    logger,
  )
  const statusService = new TransactionStatusService(dbProvider)

  return {
    controller: new TransactionController(acceptanceService, statusService),
    prisma,
  }
}
