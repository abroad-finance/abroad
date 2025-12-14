import 'reflect-metadata'
import { KycStatus, TargetCurrency } from '@prisma/client'

import type { IDatabaseClientProvider } from '../../../../../platform/persistence/IDatabaseClientProvider'

import { PersonaWebhookService } from '../../../../../modules/webhooks/application/PersonaWebhookService'
import { WebhookController } from '../../../../../modules/webhooks/interfaces/http/WebhookController'
import { QueueName } from '../../../../../platform/messaging/queues'
import {
  createMockLogger,
  createMockQueueHandler,
  createResponder,
  MockLogger,
  MockQueueHandler,
} from '../../../../setup/mockFactories'

type PrismaLike = {
  partnerUserKyc: {
    findFirst: jest.Mock
    update: jest.Mock
  }
}

const buildPersonaPayload = (status: string) => ({
  data: {
    attributes: {
      payload: {
        data: {
          attributes: { status },
          id: 'inquiry-1',
        },
      },
    },
  },
})

describe('WebhookController webhooks', () => {
  let prisma: PrismaLike
  let dbProvider: IDatabaseClientProvider
  let queueHandler: MockQueueHandler
  let logger: MockLogger
  let personaWebhookService: PersonaWebhookService

  const buildRequest = (rawBody?: string) => (
    {
      headers: { 'x-test': 'true' },
      rawBody,
    } as unknown as import('express').Request & { rawBody?: string }
  )

  beforeEach(() => {
    prisma = {
      partnerUserKyc: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    }
    dbProvider = {
      getClient: jest.fn(async () => prisma as unknown as import('@prisma/client').PrismaClient),
    } as unknown as IDatabaseClientProvider
    queueHandler = createMockQueueHandler()
    logger = createMockLogger()
    personaWebhookService = new PersonaWebhookService(dbProvider, logger, queueHandler)
  })

  describe('Persona webhook', () => {
    it('returns not found when no matching inquiry exists', async () => {
      prisma.partnerUserKyc.findFirst.mockResolvedValue(null)
      const controller = new WebhookController(dbProvider, logger, queueHandler, personaWebhookService)
      const badRequest = createResponder<400, { message: string, success: false }>()
      const notFound = createResponder<404, { message: string, success: false }>()
      const serverError = createResponder<500, { message: string, success: false }>()

      const payload = buildPersonaPayload('approved')
      const response = await controller.handlePersonaWebhook(
        payload,
        buildRequest(JSON.stringify(payload)),
        badRequest,
        notFound,
        serverError,
      )

      expect(response).toEqual({ message: 'KYC session not found', success: false })
      expect(notFound).toHaveBeenCalledWith(404, expect.objectContaining({ success: false }))
    })

    it('acknowledges unchanged Persona statuses without writing or notifying', async () => {
      prisma.partnerUserKyc.findFirst.mockResolvedValue({
        id: 'kyc-unchanged',
        partnerUser: { partner: { id: 'partner-1' }, userId: 'user-1' },
        partnerUserId: 'user-1',
        status: KycStatus.APPROVED,
      })
      const controller = new WebhookController(dbProvider, logger, queueHandler, personaWebhookService)
      const setStatus = jest.spyOn(controller, 'setStatus')
      const response = await controller.handlePersonaWebhook(
        buildPersonaPayload('approved'),
        buildRequest('{}'),
        createResponder<400, { message: string, success: false }>(),
        createResponder<404, { message: string, success: false }>(),
        createResponder<500, { message: string, success: false }>(),
      )

      expect(response).toEqual({ message: 'Webhook processed successfully', success: true })
      expect(prisma.partnerUserKyc.update).not.toHaveBeenCalled()
      expect(queueHandler.postMessage).not.toHaveBeenCalled()
      expect(setStatus).toHaveBeenCalledWith(200)
    })

    it('updates status changes and publishes notifications', async () => {
      prisma.partnerUserKyc.findFirst.mockResolvedValue({
        id: 'kyc-to-update',
        partnerUser: { partner: { id: 'partner-1' }, userId: 'user-1' },
        partnerUserId: 'user-1',
        status: KycStatus.PENDING,
      })
      const controller = new WebhookController(dbProvider, logger, queueHandler, personaWebhookService)
      const setStatus = jest.spyOn(controller, 'setStatus')
      const payload = buildPersonaPayload('declined')

      const response = await controller.handlePersonaWebhook(
        payload,
        buildRequest(JSON.stringify(payload)),
        createResponder<400, { message: string, success: false }>(),
        createResponder<404, { message: string, success: false }>(),
        createResponder<500, { message: string, success: false }>(),
      )

      expect(response).toEqual({ message: 'Webhook processed successfully', success: true })
      expect(prisma.partnerUserKyc.update).toHaveBeenCalledWith({
        data: { status: KycStatus.REJECTED, updatedAt: expect.any(Date) },
        where: { id: 'kyc-to-update' },
      })
      expect(queueHandler.postMessage).toHaveBeenCalledWith(
        QueueName.USER_NOTIFICATION,
        expect.objectContaining({ type: 'kyc.updated', userId: 'user-1' }),
      )
      const [, notification] = (queueHandler.postMessage as jest.Mock).mock.calls[0]
      const parsed = JSON.parse((notification as { payload: string }).payload)
      expect(parsed).toMatchObject({
        externalId: 'inquiry-1',
        kycId: 'kyc-to-update',
        newStatus: KycStatus.REJECTED,
        oldStatus: KycStatus.PENDING,
        provider: 'persona',
      })
      expect(setStatus).toHaveBeenCalledWith(200)
    })
  })

  describe('Transfero webhook', () => {
    it('rejects invalid payloads', async () => {
      const controller = new WebhookController(dbProvider, logger, queueHandler, personaWebhookService)
      const badRequest = createResponder<400, { message: string, success: false }>()

      const response = await controller.handleTransferoWebhook(
        { Currency: TargetCurrency.BRL },
        buildRequest(),
        badRequest,
        createResponder<500, { message: string, success: false }>(),
      )

      expect(response).toEqual({ message: 'Invalid webhook payload', success: false })
      expect(badRequest).toHaveBeenCalledWith(400, { message: 'Invalid webhook payload', success: false })
      expect(queueHandler.postMessage).not.toHaveBeenCalled()
    })

    it('publishes normalized payment status updates', async () => {
      const controller = new WebhookController(dbProvider, logger, queueHandler, personaWebhookService)
      const serverError = createResponder<500, { message: string, success: false }>()
      const setStatus = jest.spyOn(controller, 'setStatus')

      const response = await controller.handleTransferoWebhook(
        {
          Amount: 12.5,
          Currency: TargetCurrency.BRL,
          PaymentId: 'payment-1',
          PaymentStatus: 'COMPLETED',
        },
        buildRequest(),
        createResponder<400, { message: string, success: false }>(),
        serverError,
      )

      expect(response).toEqual({ message: 'Webhook processed successfully', success: true })
      expect(queueHandler.postMessage).toHaveBeenCalledWith(
        QueueName.PAYMENT_STATUS_UPDATED,
        {
          amount: 12.5,
          currency: TargetCurrency.BRL,
          externalId: 'payment-1',
          provider: 'transfero',
          status: 'COMPLETED',
        },
      )
      expect(setStatus).toHaveBeenCalledWith(200)
      expect(serverError).not.toHaveBeenCalled()
    })
  })
})
