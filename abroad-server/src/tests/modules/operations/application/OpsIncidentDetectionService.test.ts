import 'reflect-metadata'

import type { Prisma, PrismaClient } from '@prisma/client'

import {
  BlockchainNetwork,
  CryptoCurrency,
  DeliveryAttemptStatus,
  FlowDirection,
  FlowInstanceStatus,
  OpsIncidentSeverity,
  PaymentMethod,
} from '@prisma/client'

import { OpsIncidentDetectionService } from '../../../../modules/operations/application/OpsIncidentDetectionService'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

const NOW = new Date('2026-08-02T16:00:00.000Z')

const buildHarness = (flowCount: number) => {
  const flows = Array.from({ length: flowCount }, (_, index) => ({
    createdAt: new Date(NOW.getTime() - 60_000),
    // Real snapshots nest the definition; a flat fixture would let a detector
    // that reads the root pass while every production incident says UNKNOWN.
    flowSnapshot: { definition: { payoutProvider: 'PIX' }, steps: [] },
    id: `flow-${String(index).padStart(2, '0')}`,
    status: FlowInstanceStatus.FAILED,
    steps: [{ error: { message: 'provider rate limit 429' }, stepType: 'CREATE_PAYOUT', updatedAt: NOW }],
    transactionId: `transaction-${index}`,
    updatedAt: new Date(NOW.getTime() - index * 1_000),
  }))
  const prisma = {
    $transaction: jest.fn(async <T>(callback: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> => (
      callback(prisma as unknown as Prisma.TransactionClient)
    )),
    bridgeBatch: { findMany: jest.fn(async () => []) },
    bridgePendingTransfer: { findMany: jest.fn(async () => []) },
    deliveryAttempt: { findMany: jest.fn(async () => []) },
    flowInstance: { findMany: jest.fn(async () => flows) },
    opsIncident: {
      findMany: jest.fn(async () => []),
      update: jest.fn(async () => ({ id: 'resolved-incident' })),
      upsert: jest.fn(async () => ({ id: 'incident-1' })),
    },
    opsRunbook: { findMany: jest.fn(async () => []) },
    outboxEvent: { findMany: jest.fn(async () => []) },
    transaction: { findMany: jest.fn(async () => []) },
  }
  const databaseClientProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prisma as unknown as PrismaClient),
  }
  const treasuryService = {
    getBalances: jest.fn(async () => ({
      capturedAt: NOW,
      cells: [],
      errors: [],
    })),
  }
  const auditService = { recordSystem: jest.fn(async () => undefined) }
  return {
    auditService,
    prisma,
    service: new OpsIncidentDetectionService(
      databaseClientProvider,
      treasuryService as never,
      auditService as never,
    ),
    treasuryService,
  }
}

describe('OpsIncidentDetectionService', () => {
  it('groups failures under a stable fingerprint without truncating the true affected count', async () => {
    const harness = buildHarness(25)

    const detections = await harness.service.detect(NOW)

    expect(detections).toHaveLength(1)
    expect(detections[0]).toMatchObject({
      affectedCount: 25,
      fingerprint: 'flow:RATE_LIMIT:PIX',
      kind: 'RATE_LIMIT',
      occurrenceCount: 25,
      severity: OpsIncidentSeverity.CRITICAL,
    })
    expect(detections[0].context.affected).toHaveLength(20)
    expect(detections[0].context.filters).toEqual([{
      label: 'Open affected flows',
      path: '/ops/flows?failure=FAILED_FLOW&payoutProvider=PIX',
    }])
    expect(JSON.stringify(detections[0])).not.toContain('provider rate limit 429')
  })

  it('persists the deterministic incident and attributes the created ID in system audit evidence', async () => {
    const harness = buildHarness(1)

    await expect(harness.service.sync(NOW)).resolves.toEqual({
      active: 1,
      created: 1,
      reopened: 0,
      resolved: 0,
    })

    expect(harness.prisma.opsIncident.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        fingerprint: 'ops-auto:v1:flow:RATE_LIMIT:PIX',
      }),
      where: { fingerprint: 'ops-auto:v1:flow:RATE_LIMIT:PIX' },
    }))
    expect(harness.auditService.recordSystem).toHaveBeenCalledWith(expect.objectContaining({
      action: 'incident.detected',
      resourceId: 'incident-1',
      resourceType: 'ops_incident',
    }), expect.anything())
  })

  it('reports a failed onramp as a delivery failure rather than a payout failure on the same rail', async () => {
    const harness = buildHarness(0)
    harness.prisma.transaction.findMany.mockResolvedValueOnce([{
      createdAt: NOW,
      id: 'transaction-onramp',
      quote: { direction: FlowDirection.FIAT_TO_CRYPTO, paymentMethod: PaymentMethod.PIX },
    }] as never)

    const detections = await harness.service.detect(NOW)

    expect(detections).toHaveLength(1)
    expect(detections[0]).toMatchObject({
      fingerprint: 'payment:FIAT_TO_CRYPTO:PIX',
      title: 'Failed PIX onramp deliveries',
    })
    expect(detections[0].summary).toContain('failed to deliver')
    expect(detections[0].summary).not.toContain('payout')
    expect(detections[0].context.filters[0].path).toContain('direction=FIAT_TO_CRYPTO')
  })

  it('raises a critical incident for a delivery stranded past its envelope expiry', async () => {
    const harness = buildHarness(0)
    harness.prisma.deliveryAttempt.findMany.mockResolvedValueOnce([{
      asset: CryptoCurrency.USDC,
      expiresAt: new Date(NOW.getTime() - 60_000),
      failureCode: null,
      id: 'attempt-1',
      network: BlockchainNetwork.STELLAR,
      preparedAt: new Date(NOW.getTime() - 120_000),
      status: DeliveryAttemptStatus.SUBMITTED,
      transactionId: 'transaction-onramp',
    }] as never)

    const detections = await harness.service.detect(NOW)

    expect(detections).toHaveLength(1)
    expect(detections[0]).toMatchObject({
      fingerprint: 'delivery:STRANDED:STELLAR:USDC',
      kind: 'DELIVERY',
      severity: OpsIncidentSeverity.CRITICAL,
      title: 'Stranded USDC onramp deliveries · STELLAR',
    })
  })

  it('flags accepted onramps that the hot wallet can no longer cover', async () => {
    const harness = buildHarness(0)
    harness.prisma.transaction.findMany
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{
        id: 'transaction-owed',
        quote: {
          cryptoCurrency: CryptoCurrency.USDC,
          network: BlockchainNetwork.STELLAR,
          sourceAmount: 40,
        },
      }] as never)
    harness.treasuryService.getBalances.mockResolvedValueOnce({
      capturedAt: NOW,
      cells: [{
        amount: 5,
        availableAmount: 5,
        currency: 'USDC',
        posture: { alertPath: '/ops/treasury', averageDailyOutflow: null, ownerTeam: null, runwayHours: null, state: 'OK' },
        venue: 'STELLAR_HOT_WALLET',
      }],
      errors: [],
    } as never)

    const detections = await harness.service.detect(NOW)

    expect(detections).toHaveLength(1)
    expect(detections[0]).toMatchObject({
      fingerprint: 'onramp-inventory:STELLAR:USDC',
      kind: 'TREASURY',
      severity: OpsIncidentSeverity.CRITICAL,
    })
  })

  it('does not claim a shortfall when the venue balance could not be read', async () => {
    const harness = buildHarness(0)
    harness.prisma.transaction.findMany
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{
        id: 'transaction-owed',
        quote: {
          cryptoCurrency: CryptoCurrency.USDC,
          network: BlockchainNetwork.STELLAR,
          sourceAmount: 40,
        },
      }] as never)

    const detections = await harness.service.detect(NOW)

    expect(detections.filter(item => item.kind === 'TREASURY')).toHaveLength(0)
  })
})
