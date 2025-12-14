import type { Request as ExpressRequest } from 'express'

import { KycStatus, type PrismaClient } from '@prisma/client'

import type { PersonaStatus } from '../../../../modules/webhooks/application/personaSchema'
import type { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

import { PersonaWebhookService } from '../../../../modules/webhooks/application/PersonaWebhookService'
import { WEBHOOK_INTERNAL_ERROR, WEBHOOK_INVALID_PAYLOAD, WEBHOOK_PROCESSED } from '../../../../modules/webhooks/application/webhookMessages'
import { QueueName } from '../../../../platform/messaging/queues'
import { createMockLogger, createMockQueueHandler, MockLogger, MockQueueHandler } from '../../../setup/mockFactories'

type PartnerUserKycModel = PrismaClient['partnerUserKyc']

const buildPayload = (status: PersonaStatus) => ({
  data: {
    attributes: {
      payload: {
        data: {
          attributes: { status },
          id: 'inq-123',
        },
      },
    },
  },
})

const createDbProvider = () => {
  const partnerUserKyc: PartnerUserKycModel = {
    findFirst: jest.fn(),
    update: jest.fn(),
  } as unknown as PartnerUserKycModel

  const dbProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => ({
      partnerUserKyc,
    } as unknown as PrismaClient)),
  }

  return { dbProvider, partnerUserKyc }
}

describe('PersonaWebhookService', () => {
  let logger: MockLogger
  let queueHandler: MockQueueHandler

  beforeEach(() => {
    logger = createMockLogger()
    queueHandler = createMockQueueHandler()
  })

  it('returns bad_request for invalid payloads', async () => {
    const { dbProvider } = createDbProvider()
    const service = new PersonaWebhookService(dbProvider, logger, queueHandler)
    const result = await service.processWebhook(
      { data: {} },
      { headers: {} } as unknown as ExpressRequest,
    )

    expect(result).toEqual({
      payload: { message: WEBHOOK_INVALID_PAYLOAD, success: false },
      status: 'bad_request',
    })
    expect(logger.error).toHaveBeenCalledWith(
      'Invalid Persona webhook payload',
      expect.objectContaining({ payload: { data: {} } }),
    )
  })

  it('returns not_found when no matching KYC record exists', async () => {
    const { dbProvider, partnerUserKyc } = createDbProvider()
    partnerUserKyc.findFirst = jest.fn().mockResolvedValue(null)
    const service = new PersonaWebhookService(dbProvider, logger, queueHandler)
    const request = { headers: { 'x-test': '1' } } as unknown as ExpressRequest

    const result = await service.processWebhook(buildPayload('approved'), request)

    expect(result.status).toBe('not_found')
    expect(logger.warn).toHaveBeenCalledWith(
      'KYC record not found for Persona inquiry',
      expect.objectContaining({ inquiryId: 'inq-123' }),
    )
  })

  it('logs unchanged statuses without updating records', async () => {
    const { dbProvider, partnerUserKyc } = createDbProvider()
    const kycRecord = {
      id: 'kyc-1',
      partnerUser: { partner: { id: 'partner-1' } },
      partnerUserId: 'pu-1',
      status: KycStatus.APPROVED,
    }
    partnerUserKyc.findFirst = jest.fn().mockResolvedValue(kycRecord)
    const service = new PersonaWebhookService(dbProvider, logger, queueHandler)

    const result = await service.processWebhook(
      buildPayload('approved'),
      { headers: {} } as unknown as ExpressRequest,
    )

    expect(result.payload).toEqual({ message: WEBHOOK_PROCESSED, success: true })
    expect(partnerUserKyc.update).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(
      'Persona webhook: status unchanged',
      expect.objectContaining({ kycRecordId: 'kyc-1', status: KycStatus.APPROVED }),
    )
  })

  it('updates the KYC status and publishes user notifications', async () => {
    const { dbProvider, partnerUserKyc } = createDbProvider()
    const kycRecord = {
      id: 'kyc-2',
      partnerUser: { partner: { id: 'partner-2' }, userId: 'user-2' },
      partnerUserId: 'pu-2',
      status: KycStatus.PENDING,
    }
    partnerUserKyc.findFirst = jest.fn().mockResolvedValue(kycRecord)
    partnerUserKyc.update = jest.fn().mockResolvedValue({ ...kycRecord, status: KycStatus.APPROVED })
    const service = new PersonaWebhookService(dbProvider, logger, queueHandler)

    const result = await service.processWebhook(
      buildPayload('approved'),
      { headers: {} } as unknown as ExpressRequest,
    )

    expect(result.status).toBe('ok')
    expect(partnerUserKyc.update).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: KycStatus.APPROVED }),
      where: { id: 'kyc-2' },
    })
    expect(queueHandler.postMessage).toHaveBeenCalledWith(
      QueueName.USER_NOTIFICATION,
      expect.objectContaining({ type: 'kyc.updated', userId: kycRecord.partnerUser.userId }),
    )
  })

  it('warns when notifications fail but still returns ok', async () => {
    const { dbProvider, partnerUserKyc } = createDbProvider()
    const kycRecord = {
      id: 'kyc-3',
      partnerUser: { partner: { id: 'partner-3' }, userId: 'user-3' },
      partnerUserId: 'pu-3',
      status: KycStatus.PENDING,
    }
    partnerUserKyc.findFirst = jest.fn().mockResolvedValue(kycRecord)
    partnerUserKyc.update = jest.fn().mockResolvedValue({ ...kycRecord, status: KycStatus.REJECTED })
    queueHandler.postMessage.mockRejectedValueOnce('queue offline')
    const service = new PersonaWebhookService(dbProvider, logger, queueHandler)

    const result = await service.processWebhook(
      buildPayload('declined'),
      { headers: {} } as unknown as ExpressRequest,
    )

    expect(result.status).toBe('ok')
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to publish kyc.updated notification (persona)',
      expect.any(Error),
    )
  })

  it('surfaces processing failures as internal errors', async () => {
    const failingProvider: IDatabaseClientProvider = {
      getClient: jest.fn(async () => {
        throw new Error('db unavailable')
      }),
    }
    const service = new PersonaWebhookService(failingProvider, logger, queueHandler)
    const result = await service.processWebhook(
      buildPayload('failed'),
      { headers: {}, rawBody: '{}' } as unknown as ExpressRequest,
    )

    expect(result).toEqual({
      payload: { message: WEBHOOK_INTERNAL_ERROR, success: false },
      status: 'error',
    })
    expect(logger.error).toHaveBeenCalledWith(
      'Error processing Persona webhook',
      expect.objectContaining({ error: 'db unavailable' }),
    )
  })

  it('maps Persona statuses to internal KYC status values', () => {
    const { dbProvider } = createDbProvider()
    const service = new PersonaWebhookService(dbProvider, logger, queueHandler)
    const statusMapper = service as unknown as { mapPersonaToKycStatus: (status?: PersonaStatus) => KycStatus }

    expect(statusMapper.mapPersonaToKycStatus('approved')).toBe(KycStatus.APPROVED)
    expect(statusMapper.mapPersonaToKycStatus('declined')).toBe(KycStatus.REJECTED)
    expect(statusMapper.mapPersonaToKycStatus('expired')).toBe(KycStatus.REJECTED)
    expect(statusMapper.mapPersonaToKycStatus('failed')).toBe(KycStatus.REJECTED)
    expect(statusMapper.mapPersonaToKycStatus('needs_review')).toBe(KycStatus.PENDING_APPROVAL)
    expect(statusMapper.mapPersonaToKycStatus('completed')).toBe(KycStatus.PENDING)
    expect(statusMapper.mapPersonaToKycStatus('created')).toBe(KycStatus.PENDING)
    expect(statusMapper.mapPersonaToKycStatus('pending')).toBe(KycStatus.PENDING)
    expect(statusMapper.mapPersonaToKycStatus(undefined)).toBe(KycStatus.PENDING)
  })
})
