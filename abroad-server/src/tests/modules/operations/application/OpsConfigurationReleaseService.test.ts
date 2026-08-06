import 'reflect-metadata'

import type { OpsConfigurationRelease, Prisma, PrismaClient } from '@prisma/client'

import {
  BlockchainNetwork,
  CryptoCurrency,
  FlowDirection,
  OpsConfigurationReleaseStatus,
  OpsRole,
  TargetCurrency,
} from '@prisma/client'

import type { OpsUserPrincipal } from '../../../../modules/operations/application/opsIdentity'
import type { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

import { OpsConfigurationReleaseService, OpsConfigurationReleaseValidationError } from '../../../../modules/operations/application/OpsConfigurationReleaseService'
import { CryptoAssetConfigConflictError } from '../../../../modules/payments/application/CryptoAssetConfigService'

const NOW = new Date('2026-08-02T18:00:00.000Z')

const requester: OpsUserPrincipal = {
  authTime: NOW,
  displayName: 'Configuration Owner',
  email: 'owner@abroad.finance',
  kind: 'ops_user',
  permissions: ['configuration:manage'],
  role: OpsRole.ADMINISTRATOR,
  sessionVersion: 1,
  userId: 'user-owner',
}

const reviewer: OpsUserPrincipal = {
  ...requester,
  displayName: 'Independent Reviewer',
  email: 'reviewer@abroad.finance',
  permissions: ['configuration:approve'],
  userId: 'user-reviewer',
}

const users = new Map([
  [requester.userId, { displayName: requester.displayName, id: requester.userId }],
  [reviewer.userId, { displayName: reviewer.displayName, id: reviewer.userId }],
])

const envelope = (idempotencyKey: string) => ({
  confirmation: 'CREATE CONFIG DRAFT',
  idempotencyKey,
  reason: 'Required to validate governed configuration releases.',
  reference: 'OPS-UX-2026',
})

const statusValue = (
  value: OpsConfigurationReleaseStatus | Prisma.EnumOpsConfigurationReleaseStatusFieldUpdateOperationsInput | undefined,
): OpsConfigurationReleaseStatus | undefined => typeof value === 'string' ? value : value?.set

const dateValue = (
  value: Date | null | Prisma.NullableDateTimeFieldUpdateOperationsInput | string | undefined,
): Date | null | undefined => {
  if (value === null || value === undefined) return value
  if (value instanceof Date) return value
  if (typeof value === 'string') return new Date(value)
  if (value.set === null || value.set === undefined) return value.set
  return value.set instanceof Date ? value.set : new Date(value.set)
}

const stringValue = (
  value: null | Prisma.NullableStringFieldUpdateOperationsInput | string | undefined,
): null | string | undefined => {
  if (value === null || value === undefined || typeof value === 'string') return value
  return value.set
}

const integerValue = (
  value: null | number | Prisma.NullableIntFieldUpdateOperationsInput | undefined,
): null | number | undefined => {
  if (value === null || value === undefined || typeof value === 'number') return value
  return value.set
}

type HarnessOptions = {
  enabledAdministratorCount?: number
}

const buildHarness = (options: HarnessOptions = {}) => {
  const records = new Map<string, OpsConfigurationRelease>()
  let enabledAdministratorCount = options.enabledAdministratorCount ?? 2
  let sequence = 0
  const asset = {
    blockchain: BlockchainNetwork.STELLAR,
    cryptoCurrency: CryptoCurrency.USDC,
    decimals: 7 as null | number,
    enabled: true,
    mintAddress: 'GA-ISSUER' as null | string,
    status: 'CONFIGURED' as const,
    updatedAt: NOW as Date | null,
    version: 3,
  }

  const hydrate = (record: OpsConfigurationRelease) => ({
    ...record,
    appliedBy: record.appliedByUserId ? users.get(record.appliedByUserId) ?? null : null,
    approvedBy: record.approvedByUserId ? users.get(record.approvedByUserId) ?? null : null,
    requestedBy: users.get(record.requestedByUserId) ?? { displayName: 'Unknown', id: record.requestedByUserId },
  })

  const findUnique = jest.fn(async (args: { where: { id: string } }) => {
    const record = records.get(args.where.id)
    return record ? hydrate(record) : null
  })

  const create = jest.fn(async (args: { data: Prisma.OpsConfigurationReleaseUncheckedCreateInput }) => {
    sequence += 1
    const id = typeof args.data.id === 'string' ? args.data.id : `release-${sequence}`
    const record: OpsConfigurationRelease = {
      appliedAt: null,
      appliedByUserId: null,
      appliedVersion: null,
      approvedAt: null,
      approvedByUserId: null,
      baseVersion: args.data.baseVersion,
      createdAt: NOW,
      diff: args.data.diff as Prisma.JsonValue,
      effectiveAt: args.data.effectiveAt instanceof Date ? args.data.effectiveAt : null,
      id,
      idempotencyKey: args.data.idempotencyKey,
      impact: args.data.impact as Prisma.JsonValue,
      payload: args.data.payload as Prisma.JsonValue,
      reason: args.data.reason,
      reference: args.data.reference ?? null,
      rejectionReason: null,
      requestedByUserId: args.data.requestedByUserId,
      rollbackOfId: args.data.rollbackOfId ?? null,
      status: OpsConfigurationReleaseStatus.DRAFT,
      targetKey: args.data.targetKey,
      targetType: args.data.targetType,
      title: args.data.title,
      updatedAt: NOW,
      version: 1,
    }
    records.set(id, record)
    return record
  })

  const updateMany = jest.fn(async (args: Prisma.OpsConfigurationReleaseUpdateManyArgs) => {
    const id = typeof args.where?.id === 'string' ? args.where.id : null
    const record = id ? records.get(id) : undefined
    if (!record) return { count: 0 }
    const expectedStatus = typeof args.where?.status === 'string' ? args.where.status : undefined
    const expectedVersion = typeof args.where?.version === 'number' ? args.where.version : undefined
    const expectedOwner = typeof args.where?.requestedByUserId === 'string' ? args.where.requestedByUserId : undefined
    if (
      (expectedStatus && record.status !== expectedStatus)
      || (expectedVersion !== undefined && record.version !== expectedVersion)
      || (expectedOwner && record.requestedByUserId !== expectedOwner)
    ) return { count: 0 }

    const data = args.data
    const nextStatus = statusValue(data.status)
    if (nextStatus) record.status = nextStatus
    const appliedAt = dateValue(data.appliedAt)
    if (appliedAt !== undefined) record.appliedAt = appliedAt
    const approvedAt = dateValue(data.approvedAt)
    if (approvedAt !== undefined) record.approvedAt = approvedAt
    const appliedByUserId = stringValue(data.appliedByUserId)
    if (appliedByUserId !== undefined) record.appliedByUserId = appliedByUserId
    const approvedByUserId = stringValue(data.approvedByUserId)
    if (approvedByUserId !== undefined) record.approvedByUserId = approvedByUserId
    const rejectionReason = stringValue(data.rejectionReason)
    if (rejectionReason !== undefined) record.rejectionReason = rejectionReason
    const appliedVersion = integerValue(data.appliedVersion)
    if (appliedVersion !== undefined) record.appliedVersion = appliedVersion
    const targetKey = stringValue(data.targetKey)
    if (targetKey !== undefined && targetKey !== null) record.targetKey = targetKey
    if (typeof data.version === 'number') record.version = data.version
    else if (data.version?.increment) record.version += data.version.increment
    record.updatedAt = new Date()
    return { count: 1 }
  })

  const findMany = jest.fn(async () => [...records.values()]
    .filter(record => record.status === OpsConfigurationReleaseStatus.APPROVED)
    .filter(record => Boolean(record.effectiveAt && record.effectiveAt <= new Date()))
    .map(record => ({ id: record.id, version: record.version })))

  const opsConfigurationRelease = {
    count: jest.fn(async () => records.size),
    create,
    findMany,
    findUnique,
    updateMany,
  }
  const opsUser = {
    count: jest.fn(async () => enabledAdministratorCount),
  }
  const transactionClient = {
    opsConfigurationRelease,
    opsUser,
  } as unknown as Prisma.TransactionClient
  const runTransaction = jest.fn(async (
    callback: (transaction: Prisma.TransactionClient) => Promise<unknown>,
  ): Promise<unknown> => callback(transactionClient))
  const prisma = {
    $transaction: runTransaction,
    opsConfigurationRelease,
    opsUser,
  }
  const databaseClientProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => prisma as unknown as PrismaClient),
  }
  const cryptoAssetService = {
    listCoverage: jest.fn(async () => ({
      assets: [{ ...asset }],
      summary: {
        configured: 1, enabled: asset.enabled ? 1 : 0, missing: 0, total: 1,
      },
    })),
    upsertInTransaction: jest.fn(async (
      _transaction: Prisma.TransactionClient,
      input: {
        blockchain: BlockchainNetwork
        cryptoCurrency: CryptoCurrency
        decimals?: null | number
        enabled: boolean
        mintAddress?: null | string
      },
      expectedVersion: number,
    ) => {
      if (expectedVersion !== asset.version) throw new CryptoAssetConfigConflictError()
      asset.decimals = input.decimals ?? null
      asset.enabled = input.enabled
      asset.mintAddress = input.mintAddress ?? null
      asset.version += 1
      return { ...asset }
    }),
  }
  const auditService = {
    record: jest.fn(async () => undefined),
    recordSystem: jest.fn(async () => undefined),
  }
  // One asset pair, both directions: the two corridors are distinguishable
  // only by direction, which is exactly what the release path has to carry.
  const corridors = [
    {
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: CryptoCurrency.USDC,
      direction: FlowDirection.CRYPTO_TO_FIAT,
      status: 'DEFINED' as const,
      targetCurrency: TargetCurrency.BRL,
      unsupportedReason: null as null | string,
      version: 5,
    },
    {
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: CryptoCurrency.USDC,
      direction: FlowDirection.FIAT_TO_CRYPTO,
      status: 'DEFINED' as const,
      targetCurrency: TargetCurrency.BRL,
      unsupportedReason: null as null | string,
      version: 9,
    },
  ]
  const flowCorridorService = {
    list: jest.fn(async () => ({ corridors, summary: { defined: 2, missing: 0, total: 2, unsupported: 0 } })),
    updateStatusInTransaction: jest.fn(async () => corridors[1]),
  }
  const service = new OpsConfigurationReleaseService(
    databaseClientProvider,
    {} as never,
    flowCorridorService as never,
    cryptoAssetService as never,
    auditService as never,
  )
  return {
    asset,
    auditService,
    cryptoAssetService,
    flowCorridorService,
    opsUser,
    records,
    runTransaction,
    service,
    setEnabledAdministratorCount: (count: number) => {
      enabledAdministratorCount = count
    },
  }
}

const assetDraft = (effectiveAt?: Date) => ({
  effectiveAt,
  payload: {
    kind: 'CRYPTO_ASSET' as const,
    value: {
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: CryptoCurrency.USDC,
      decimals: 7,
      enabled: false,
      mintAddress: 'GA-ISSUER',
    },
  },
  title: 'Pause USDC on Stellar',
})

describe('OpsConfigurationReleaseService', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(NOW)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('targets the corridor direction the operator selected instead of the other side of the pair', async () => {
    const harness = buildHarness()

    const draft = await harness.service.createDraft(requester, {
      payload: {
        kind: 'FLOW_CORRIDOR' as const,
        value: {
          blockchain: BlockchainNetwork.STELLAR,
          cryptoCurrency: CryptoCurrency.USDC,
          direction: FlowDirection.FIAT_TO_CRYPTO,
          reason: 'Delivery float exhausted',
          status: 'UNSUPPORTED' as const,
          targetCurrency: TargetCurrency.BRL,
        },
      },
      title: 'Pause the USDC onramp corridor',
    }, envelope('00000000-0000-4000-8000-0000000000c1'))

    // Version 9 is the onramp corridor; 5 would mean the payout was resolved.
    expect(draft.baseVersion).toBe(9)
    expect(draft.targetKey).toBe('USDC:STELLAR:BRL:FIAT_TO_CRYPTO')
  })

  it('keeps a corridor release without a stated direction on the payout corridor', async () => {
    const harness = buildHarness()

    const draft = await harness.service.createDraft(requester, {
      payload: {
        kind: 'FLOW_CORRIDOR' as const,
        value: {
          blockchain: BlockchainNetwork.STELLAR,
          cryptoCurrency: CryptoCurrency.USDC,
          status: 'UNSUPPORTED' as const,
          targetCurrency: TargetCurrency.BRL,
        },
      },
      title: 'Pause the legacy corridor',
    }, envelope('00000000-0000-4000-8000-0000000000c2'))

    expect(draft.baseVersion).toBe(5)
    expect(draft.targetKey).toBe('USDC:STELLAR:BRL:CRYPTO_TO_FIAT')
  })

  it('requires a different reviewer and applies a due release atomically', async () => {
    const harness = buildHarness()
    const draft = await harness.service.createDraft(requester, assetDraft(), envelope('00000000-0000-4000-8000-000000000001'))
    expect(draft).toMatchObject({
      approvalPolicy: 'DIFFERENT_ADMIN_REQUIRED',
      baseVersion: 3,
      status: 'DRAFT',
      version: 1,
    })
    expect(draft.diff).toEqual(expect.arrayContaining([
      expect.objectContaining({ after: 'false', before: 'true', field: 'value.enabled' }),
    ]))

    const submitted = await harness.service.submit(draft.id, requester, draft.version)
    await expect(harness.service.approve(submitted.id, requester, submitted.version)).rejects.toBeInstanceOf(
      OpsConfigurationReleaseValidationError,
    )

    const applied = await harness.service.approve(submitted.id, reviewer, submitted.version)
    expect(applied).toMatchObject({ appliedVersion: 4, status: 'APPLIED', version: 3 })
    expect(applied.approvedBy?.id).toBe(reviewer.userId)
    expect(harness.asset.enabled).toBe(false)
    expect(harness.cryptoAssetService.upsertInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: false }),
      3,
    )
  })

  it('allows the sole enabled administrator to self-approve with explicit audit evidence', async () => {
    const harness = buildHarness({ enabledAdministratorCount: 1 })
    const draft = await harness.service.createDraft(
      requester,
      assetDraft(),
      envelope('00000000-0000-4000-8000-000000000006'),
    )
    expect(draft.approvalPolicy).toBe('SOLE_ADMIN_SELF_APPROVAL_ALLOWED')

    const submitted = await harness.service.submit(draft.id, requester, draft.version)
    const applied = await harness.service.approve(submitted.id, requester, submitted.version)

    expect(applied).toMatchObject({
      appliedVersion: 4,
      approvalPolicy: 'SOLE_ADMIN_SELF_APPROVAL_ALLOWED',
      status: 'APPLIED',
      version: 3,
    })
    expect(applied.approvedBy?.id).toBe(requester.userId)
    expect(harness.asset.enabled).toBe(false)
    expect(harness.auditService.record).toHaveBeenCalledWith(
      requester,
      expect.objectContaining({
        action: 'configuration.release.sole_admin_approved',
        metadata: { approvalPolicy: 'SOLE_ADMIN_SELF_APPROVAL_ALLOWED' },
        resourceId: draft.id,
      }),
      expect.anything(),
    )
    expect(harness.runTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' },
    )
  })

  it('fails closed when another administrator becomes enabled before self-approval', async () => {
    const harness = buildHarness({ enabledAdministratorCount: 1 })
    const draft = await harness.service.createDraft(
      requester,
      assetDraft(),
      envelope('00000000-0000-4000-8000-000000000007'),
    )
    expect(draft.approvalPolicy).toBe('SOLE_ADMIN_SELF_APPROVAL_ALLOWED')
    const submitted = await harness.service.submit(draft.id, requester, draft.version)

    harness.setEnabledAdministratorCount(2)

    await expect(harness.service.approve(submitted.id, requester, submitted.version)).rejects.toThrow(
      'Another enabled administrator is available',
    )
    expect(harness.asset.enabled).toBe(true)
    expect(harness.auditService.record).not.toHaveBeenCalledWith(
      requester,
      expect.objectContaining({ action: 'configuration.release.sole_admin_approved' }),
      expect.anything(),
    )
  })

  it('keeps a future approval queued until the scheduled worker applies it', async () => {
    const harness = buildHarness()
    const effectiveAt = new Date(NOW.getTime() + 60_000)
    const draft = await harness.service.createDraft(requester, assetDraft(effectiveAt), envelope('00000000-0000-4000-8000-000000000002'))
    const submitted = await harness.service.submit(draft.id, requester, draft.version)
    const approved = await harness.service.approve(submitted.id, reviewer, submitted.version)
    expect(approved.status).toBe('APPROVED')
    expect(harness.asset.enabled).toBe(true)

    jest.setSystemTime(new Date(effectiveAt.getTime() + 1_000))
    await expect(harness.service.applyDue()).resolves.toBe(1)
    expect((await harness.service.get(draft.id)).status).toBe('APPLIED')
    expect(harness.asset.enabled).toBe(false)
    expect(harness.auditService.recordSystem).toHaveBeenCalledWith(expect.objectContaining({
      action: 'configuration.release.applied',
    }))
  })

  it('rejects stale target versions rather than overwriting a newer configuration', async () => {
    const harness = buildHarness()
    const draft = await harness.service.createDraft(requester, assetDraft(), envelope('00000000-0000-4000-8000-000000000003'))
    const submitted = await harness.service.submit(draft.id, requester, draft.version)
    harness.asset.version = 4

    await expect(harness.service.approve(submitted.id, reviewer, submitted.version)).rejects.toBeInstanceOf(
      CryptoAssetConfigConflictError,
    )
    expect(harness.asset.enabled).toBe(true)
  })

  it('creates a reviewed rollback draft and marks the original only after rollback approval', async () => {
    const harness = buildHarness()
    const draft = await harness.service.createDraft(requester, assetDraft(), envelope('00000000-0000-4000-8000-000000000004'))
    const submitted = await harness.service.submit(draft.id, requester, draft.version)
    const applied = await harness.service.approve(submitted.id, reviewer, submitted.version)

    const rollback = await harness.service.createRollbackDraft(
      requester,
      applied.id,
      applied.version,
      envelope('00000000-0000-4000-8000-000000000005'),
    )
    expect(rollback).toMatchObject({ rollbackOfId: applied.id, status: 'DRAFT' })
    expect(rollback.payload).toMatchObject({ value: { enabled: true } })
    expect((await harness.service.get(applied.id)).status).toBe('APPLIED')

    const rollbackSubmitted = await harness.service.submit(rollback.id, requester, rollback.version)
    const rollbackApplied = await harness.service.approve(rollbackSubmitted.id, reviewer, rollbackSubmitted.version)
    expect(rollbackApplied.status).toBe('APPLIED')
    expect((await harness.service.get(applied.id)).status).toBe('ROLLED_BACK')
    expect(harness.asset.enabled).toBe(true)
  })
})
