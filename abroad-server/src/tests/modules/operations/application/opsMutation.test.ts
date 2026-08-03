import type { Prisma, PrismaClient } from '@prisma/client'

import { OpsMutationStatus, OpsRole } from '@prisma/client'

import type { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

import { OpsAuditService } from '../../../../modules/operations/application/OpsAuditService'
import { OpsPrincipal } from '../../../../modules/operations/application/opsIdentity'
import {
  OpsMutationAuthorizationError,
  OpsMutationReplayError,
  OpsMutationService,
  OpsMutationStepUpError,
  OpsMutationValidationError,
} from '../../../../modules/operations/application/opsMutation'

const envelope = {
  confirmation: 'RETRY STEP',
  idempotencyKey: 'e5083f1f-3500-4888-b9c3-5d9bd38b6749',
  reason: 'Provider recovery approved in incident INC-42',
  reference: 'INC-42',
}

const principal: OpsPrincipal = {
  authTime: new Date(Date.now() - 60_000),
  displayName: 'Ana Operator',
  email: 'ana@abroad.finance',
  kind: 'ops_user',
  permissions: ['flows:recover'],
  role: OpsRole.OPERATIONS,
  sessionVersion: 1,
  userId: 'ops-user-1',
}

type Harness = {
  auditRecord: jest.Mock
  create: jest.Mock
  findUnique: jest.Mock
  service: OpsMutationService
  transactionRunner: jest.Mock
  updateMany: jest.Mock
}

const buildHarness = (): Harness => {
  const findUnique = jest.fn().mockResolvedValue(null)
  const create = jest.fn().mockResolvedValue({
    action: 'flow.step.retry',
    id: 'mutation-1',
    status: OpsMutationStatus.REQUESTED,
  })
  const updateMany = jest.fn().mockResolvedValue({ count: 1 })
  const opsMutationExecution = { create, findUnique, updateMany }
  const transaction = { opsMutationExecution } as unknown as Prisma.TransactionClient
  const transactionRunner = jest.fn(async (
    operation: (client: Prisma.TransactionClient) => Promise<unknown>,
  ) => operation(transaction))
  const prismaClient = {
    $transaction: transactionRunner,
    opsMutationExecution,
  } as unknown as PrismaClient
  const databaseClientProvider: IDatabaseClientProvider = {
    getClient: jest.fn().mockResolvedValue(prismaClient),
  }
  const auditRecord = jest.fn().mockResolvedValue({})
  const auditService = { record: auditRecord } as unknown as OpsAuditService

  return {
    auditRecord,
    create,
    findUnique,
    service: new OpsMutationService(databaseClientProvider, auditService),
    transactionRunner,
    updateMany,
  }
}

describe('OpsMutationService', () => {
  it('durably records a requested and successful named-user operation', async () => {
    const harness = buildHarness()
    const operation = jest.fn(async (): Promise<{ stepId: string }> => ({
      stepId: 'step-1',
    }))

    const result = await harness.service.execute(
      principal,
      'flow.step.retry',
      { id: 'step-1', type: 'flow_step' },
      envelope,
      operation,
      value => ({ resourceId: value.stepId }),
    )

    expect(result).toEqual({ stepId: 'step-1' })
    expect(harness.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: principal.userId,
        idempotencyKey: envelope.idempotencyKey,
        reason: envelope.reason,
      }),
    })
    expect(harness.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: OpsMutationStatus.SUCCEEDED }),
      where: { id: 'mutation-1', status: OpsMutationStatus.REQUESTED },
    }))
    expect(harness.auditRecord).toHaveBeenNthCalledWith(
      1,
      principal,
      expect.objectContaining({ action: 'flow.step.retry.requested' }),
      expect.any(Object),
    )
    expect(harness.auditRecord).toHaveBeenNthCalledWith(
      2,
      principal,
      expect.objectContaining({ action: 'flow.step.retry.succeeded' }),
      undefined,
    )
  })

  it('records a safe failure code without storing the error message', async () => {
    const harness = buildHarness()
    const operation = jest.fn().mockRejectedValue(new Error('sensitive provider body'))

    await expect(harness.service.execute(
      principal,
      'flow.step.retry',
      { id: 'step-1', type: 'flow_step' },
      envelope,
      operation,
    )).rejects.toThrow('sensitive provider body')

    expect(harness.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        failureCode: 'Error',
        status: OpsMutationStatus.FAILED,
      }),
    }))
    expect(JSON.stringify(harness.updateMany.mock.calls)).not.toContain('sensitive provider body')
    expect(harness.auditRecord).toHaveBeenLastCalledWith(
      principal,
      expect.objectContaining({
        action: 'flow.step.retry.failed',
        metadata: expect.objectContaining({ failureCode: 'Error' }),
      }),
      expect.any(Object),
    )
  })

  it('rejects a legacy principal, absent permission, and expired step-up', async () => {
    const harness = buildHarness()
    const legacy: OpsPrincipal = {
      authTime: null,
      displayName: 'Legacy Ops key',
      email: null,
      kind: 'ops_legacy',
      permissions: ['flows:recover'],
      role: null,
      sessionVersion: null,
      userId: null,
    }

    await expect(harness.service.execute(
      legacy,
      'flow.step.retry',
      { type: 'flow_step' },
      envelope,
      async () => undefined,
    )).rejects.toBeInstanceOf(OpsMutationAuthorizationError)

    await expect(harness.service.execute(
      { ...principal, permissions: [] },
      'flow.step.retry',
      { type: 'flow_step' },
      envelope,
      async () => undefined,
    )).rejects.toBeInstanceOf(OpsMutationAuthorizationError)

    await expect(harness.service.execute(
      { ...principal, authTime: new Date('2000-01-01T00:00:00.000Z') },
      'flow.step.retry',
      { type: 'flow_step' },
      envelope,
      async () => undefined,
    )).rejects.toBeInstanceOf(OpsMutationStepUpError)
    expect(harness.create).not.toHaveBeenCalled()
  })

  it('enforces reason, typed confirmation, and expected resource version', async () => {
    const harness = buildHarness()

    await expect(harness.service.execute(
      principal,
      'flow.step.retry',
      { type: 'flow_step' },
      { ...envelope, reason: 'short' },
      async () => undefined,
    )).rejects.toBeInstanceOf(OpsMutationValidationError)

    await expect(harness.service.execute(
      principal,
      'flow.step.retry',
      { type: 'flow_step' },
      { ...envelope, confirmation: 'retry' },
      async () => undefined,
    )).rejects.toThrow('Type “RETRY STEP”')

    await expect(harness.service.execute(
      {
        ...principal,
        permissions: ['configuration:manage'],
      },
      'configuration.asset.update',
      { type: 'crypto_asset' },
      { ...envelope, confirmation: 'UPDATE ASSET' },
      async () => undefined,
    )).rejects.toThrow('current resource version')
  })

  it('rejects a replay before executing the operation', async () => {
    const harness = buildHarness()
    harness.findUnique.mockResolvedValueOnce({
      id: 'existing-mutation',
      status: OpsMutationStatus.SUCCEEDED,
    })
    const operation = jest.fn()

    await expect(harness.service.execute(
      principal,
      'flow.step.retry',
      { type: 'flow_step' },
      envelope,
      operation,
    )).rejects.toBeInstanceOf(OpsMutationReplayError)
    expect(operation).not.toHaveBeenCalled()
  })

  it('requires fresh step-up, exact confirmation, permission, and version for replacement refunds', async () => {
    const refundEnvelope = {
      ...envelope,
      confirmation: 'ISSUE REPLACEMENT REFUND',
      expectedVersion: 3,
    }
    const refundPrincipal: OpsPrincipal = {
      ...principal,
      permissions: ['transactions:refund'],
    }

    const missingVersionHarness = buildHarness()
    await expect(missingVersionHarness.service.execute(
      refundPrincipal,
      'transaction.refund.replace',
      { id: 'transaction-1', type: 'transaction_refund' },
      { ...refundEnvelope, expectedVersion: undefined },
      async () => undefined,
    )).rejects.toThrow('current resource version')

    const wrongConfirmationHarness = buildHarness()
    await expect(wrongConfirmationHarness.service.execute(
      refundPrincipal,
      'transaction.refund.replace',
      { id: 'transaction-1', type: 'transaction_refund' },
      { ...refundEnvelope, confirmation: 'REFUND' },
      async () => undefined,
    )).rejects.toThrow('Type “ISSUE REPLACEMENT REFUND”')

    const authorizedHarness = buildHarness()
    const operation = jest.fn(async () => ({ transactionId: 'transaction-1' }))
    await expect(authorizedHarness.service.execute(
      refundPrincipal,
      'transaction.refund.replace',
      { id: 'transaction-1', type: 'transaction_refund' },
      refundEnvelope,
      operation,
    )).resolves.toEqual({ transactionId: 'transaction-1' })
    expect(operation).toHaveBeenCalledTimes(1)
  })
})
