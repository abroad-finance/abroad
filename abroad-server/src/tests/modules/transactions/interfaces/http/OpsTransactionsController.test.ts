import 'reflect-metadata'
import type { TsoaResponse } from '@tsoa/runtime'
import type { Request } from 'express'

import { BlockchainNetwork, FlowDirection, OpsRole, TransactionStatus } from '@prisma/client'

import { OpsAuditService } from '../../../../../modules/operations/application/OpsAuditService'
import { OpsMutationService } from '../../../../../modules/operations/application/opsMutation'
import { OpsRefundRecoveryDto, OpsRefundRecoveryService } from '../../../../../modules/transactions/application/OpsRefundRecoveryService'
import { OpsTransactionDetailDto, OpsTransactionListResponse, OpsTransactionNotFoundError, OpsTransactionQueryService } from '../../../../../modules/transactions/application/OpsTransactionQueryService'
import { OpsTransactionReconciliationService } from '../../../../../modules/transactions/application/OpsTransactionReconciliationService'
import { PartnerPixReceiptService } from '../../../../../modules/transactions/application/PartnerPixReceiptService'
import { OpsTransactionsController } from '../../../../../modules/transactions/interfaces/http/OpsTransactionsController'

type QueryServiceMock = Pick<
  OpsTransactionQueryService,
  'getById' | 'getEvidenceExport' | 'getFilteredEvidenceExport' | 'search'
>
type ReconciliationServiceMock = Pick<OpsTransactionReconciliationService, 'reconcileHash'>

const request = {
  header: jest.fn(() => undefined),
  user: {
    authTime: new Date(),
    displayName: 'Test Operator',
    email: 'operator@abroad.finance',
    kind: 'ops_user' as const,
    permissions: ['transactions:reconcile', 'transactions:proof'] as const,
    role: OpsRole.OPERATIONS,
    sessionVersion: 1,
    userId: 'ops-user-1',
  },
} as unknown as Request

const buildRefundMutationRequest = (confirmation: string): Request => ({
  header: jest.fn((name: string) => ({
    'If-Match': '7',
    'X-Ops-Confirmation': confirmation,
    'X-Ops-Idempotency-Key': 'f9d3509f-784c-4fb1-ae2d-dc5e6b024a7c',
    'X-Ops-Reason': 'Original refund is absent after exact-hash reconciliation',
    'X-Ops-Reference': 'INC-42',
  }[name])),
  user: {
    authTime: new Date(),
    displayName: 'Finance Operator',
    email: 'finance@abroad.finance',
    kind: 'ops_user' as const,
    permissions: ['transactions:read', 'transactions:refund'] as const,
    role: OpsRole.FINANCE,
    sessionVersion: 1,
    userId: 'ops-user-finance',
  },
} as unknown as Request)

const mutationService = {
  execute: jest.fn(async (...parameters: unknown[]) => {
    const operation = parameters[4]
    if (typeof operation !== 'function') throw new Error('Operation callback is required')
    return operation()
  }),
} as unknown as OpsMutationService

const badRequestResponder = (): TsoaResponse<400, { reason: string }> => (
  jest.fn((_status: 400, payload: { reason: string }) => payload)
)

const notFoundResponder = (): TsoaResponse<404, { reason: string }> => (
  jest.fn((_status: 404, payload: { reason: string }) => payload)
)

const buildService = (): jest.Mocked<ReconciliationServiceMock> => ({
  reconcileHash: jest.fn(async input => ({
    blockchain: input.blockchain,
    onChainTx: input.onChainTx,
    reason: undefined,
    result: 'enqueued' as const,
    transactionId: input.transactionId ?? '11111111-1111-4111-8111-111111111111',
    transactionStatus: TransactionStatus.AWAITING_PAYMENT,
  })),
})

const buildQueryService = (): jest.Mocked<QueryServiceMock> => ({
  getById: jest.fn(),
  getEvidenceExport: jest.fn(),
  getFilteredEvidenceExport: jest.fn(),
  search: jest.fn(),
})

const receiptService = { getOpsReceipt: jest.fn() } as unknown as PartnerPixReceiptService
const refundRecoveryDto: OpsRefundRecoveryDto = {
  amount: 5.99,
  asset: 'USDC',
  attempts: 1,
  blockReason: null,
  candidateHashFingerprint: '••••abcd1234',
  canonicalRefundRecorded: false,
  lastFailureCategory: 'NETWORK_TIMEOUT',
  lastReconciliation: null,
  network: 'STELLAR',
  replacementEligible: false,
  status: 'NEEDS_RECONCILIATION',
  transactionId: 'tx-1',
  version: 1,
}
const refundRecoveryService = {
  getStatus: jest.fn(async () => refundRecoveryDto),
  issueReplacement: jest.fn(async () => refundRecoveryDto),
  reconcile: jest.fn(async () => refundRecoveryDto),
} as unknown as OpsRefundRecoveryService
const auditRecord = jest.fn()
const auditService = { record: auditRecord } as unknown as OpsAuditService

const buildController = (
  service: ReconciliationServiceMock,
  queryService: QueryServiceMock = buildQueryService(),
) => new OpsTransactionsController(
  service as unknown as OpsTransactionReconciliationService,
  queryService as unknown as OpsTransactionQueryService,
  refundRecoveryService,
  mutationService,
  receiptService,
  auditService,
)

describe('OpsTransactionsController.reconcileHash', () => {
  it('returns 400 for invalid payloads', async () => {
    const service = buildService()
    const controller = buildController(service)
    const badRequest = badRequestResponder()

    const response = await controller.reconcileHash({
      blockchain: BlockchainNetwork.STELLAR,
      on_chain_tx: '',
    }, request, badRequest)

    expect(service.reconcileHash).not.toHaveBeenCalled()
    expect(response).toEqual(expect.objectContaining({ reason: expect.any(String) }))
  })

  it('maps service response to the public Ops response shape', async () => {
    const service = buildService()
    const controller = buildController(service)
    const response = await controller.reconcileHash({
      blockchain: BlockchainNetwork.SOLANA,
      on_chain_tx: 'solana-signature',
      transaction_id: '22222222-2222-4222-8222-222222222222',
    }, request, badRequestResponder())

    expect(service.reconcileHash).toHaveBeenCalledWith({
      blockchain: BlockchainNetwork.SOLANA,
      onChainTx: 'solana-signature',
      transactionId: '22222222-2222-4222-8222-222222222222',
    })
    expect(response).toEqual(expect.objectContaining({ result: 'enqueued' }))
  })
})

describe('OpsTransactionsController.search', () => {
  it('forwards applied URL filters to the query service', async () => {
    const queryService = buildQueryService()
    const listResponse: OpsTransactionListResponse = {
      items: [], page: 2, pageSize: 10, statusCounts: [], total: 0,
    }
    queryService.search.mockResolvedValue(listResponse)
    const controller = buildController(buildService(), queryService)

    const result = await controller.search(
      badRequestResponder(),
      'identifier',
      TransactionStatus.PAYMENT_COMPLETED,
      'partner-1',
      '2026-08-01',
      '2026-08-02',
      undefined,
      undefined,
      undefined,
      undefined,
      FlowDirection.FIAT_TO_CRYPTO,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'PROOF_MISSING',
      2,
      10,
    )

    expect(queryService.search).toHaveBeenCalledWith(expect.objectContaining({
      attention: 'PROOF_MISSING',
      createdFrom: '2026-08-01',
      createdTo: '2026-08-02',
      direction: FlowDirection.FIAT_TO_CRYPTO,
      page: 2,
      pageSize: 10,
      partnerId: 'partner-1',
      query: 'identifier',
      status: TransactionStatus.PAYMENT_COMPLETED,
    }))
    expect(result).toBe(listResponse)
  })

  it('audits a filtered evidence export without placing the query value in audit metadata', async () => {
    const queryService = buildQueryService()
    queryService.getFilteredEvidenceExport.mockResolvedValue({
      exportedAt: new Date('2026-08-02T12:00:00Z'),
      filterDimensions: ['partnerId', 'query'],
      items: [],
      total: 0,
      truncated: false,
    })
    const controller = buildController(buildService(), queryService)
    auditRecord.mockClear()

    await controller.exportFilteredEvidence(
      request,
      badRequestResponder(),
      'sensitive-search-value',
      undefined,
      'partner-1',
    )

    expect(queryService.getFilteredEvidenceExport).toHaveBeenCalledWith(expect.objectContaining({
      partnerId: 'partner-1',
      query: 'sensitive-search-value',
    }))
    expect(auditRecord).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'transaction.filtered_evidence.exported',
      metadata: expect.objectContaining({ filterDimensions: ['partnerId', 'query'] }),
    }))
    expect(JSON.stringify(auditRecord.mock.calls)).not.toContain('sensitive-search-value')
  })
})

describe('OpsTransactionsController.getById', () => {
  it('returns the transaction detail when found', async () => {
    const queryService = buildQueryService()
    const detail = { id: 'tx-1' } as OpsTransactionDetailDto
    queryService.getById.mockResolvedValue(detail)
    const controller = buildController(buildService(), queryService)
    const notFound = notFoundResponder()

    const result = await controller.getById('tx-1', notFound)

    expect(queryService.getById).toHaveBeenCalledWith('tx-1')
    expect(notFound).not.toHaveBeenCalled()
    expect(result).toBe(detail)
  })

  it('returns 404 when the transaction is missing', async () => {
    const queryService = buildQueryService()
    queryService.getById.mockRejectedValue(new OpsTransactionNotFoundError())
    const controller = buildController(buildService(), queryService)
    const notFound = notFoundResponder()

    const response = await controller.getById('missing', notFound)

    expect(notFound).toHaveBeenCalledWith(404, { reason: 'Transaction not found' })
    expect(response).toEqual({ reason: 'Transaction not found' })
  })
})

describe('OpsTransactionsController refund recovery', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('maps the read-only recovery status to the external snake-case contract', async () => {
    const controller = buildController(buildService())

    const response = await controller.getRefundRecovery('tx-1')

    expect(refundRecoveryService.getStatus).toHaveBeenCalledWith('tx-1')
    expect(response).toEqual({
      amount: 5.99,
      asset: 'USDC',
      attempts: 1,
      block_reason: null,
      candidate_hash_fingerprint: '••••abcd1234',
      canonical_refund_recorded: false,
      last_failure_category: 'NETWORK_TIMEOUT',
      last_reconciliation: null,
      network: 'STELLAR',
      replacement_eligible: false,
      status: 'NEEDS_RECONCILIATION',
      transaction_id: 'tx-1',
      version: 1,
    })
  })

  it('passes the guarded reconciliation envelope and expected version to the recovery service', async () => {
    const controller = buildController(buildService())

    await controller.reconcileRefundRecovery('tx-1', buildRefundMutationRequest('RECONCILE REFUND'))

    expect(mutationService.execute).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ops_user', userId: 'ops-user-finance' }),
      'transaction.refund.reconcile',
      { id: 'tx-1', type: 'transaction_refund' },
      expect.objectContaining({
        expectedVersion: 7,
        idempotencyKey: 'f9d3509f-784c-4fb1-ae2d-dc5e6b024a7c',
        reference: 'INC-42',
      }),
      expect.any(Function),
      expect.any(Function),
    )
    expect(refundRecoveryService.reconcile).toHaveBeenCalledWith({
      expectedVersion: 7,
      transactionId: 'tx-1',
    })
  })

  it('derives the replacement actor and operation identity from the named Ops session', async () => {
    const controller = buildController(buildService())

    await controller.issueReplacementRefund('tx-1', buildRefundMutationRequest('ISSUE REPLACEMENT REFUND'))

    expect(refundRecoveryService.issueReplacement).toHaveBeenCalledWith({
      expectedVersion: 7,
      initiatedByOpsUserId: 'ops-user-finance',
      mutationIdempotencyKey: 'f9d3509f-784c-4fb1-ae2d-dc5e6b024a7c',
      transactionId: 'tx-1',
    })
  })
})
