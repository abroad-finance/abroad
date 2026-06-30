import 'reflect-metadata'
import type { TsoaResponse } from '@tsoa/runtime'

import { BlockchainNetwork, TransactionStatus } from '@prisma/client'

import { OpsTransactionDetailDto, OpsTransactionListResponse, OpsTransactionNotFoundError, OpsTransactionQueryService } from '../../../../../modules/transactions/application/OpsTransactionQueryService'
import { OpsTransactionReconciliationService } from '../../../../../modules/transactions/application/OpsTransactionReconciliationService'
import { OpsTransactionsController } from '../../../../../modules/transactions/interfaces/http/OpsTransactionsController'

type QueryServiceMock = Pick<OpsTransactionQueryService, 'getById' | 'search'>
type ReconciliationServiceMock = Pick<OpsTransactionReconciliationService, 'reconcileHash'>

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
  search: jest.fn(),
})

const buildController = (
  service: ReconciliationServiceMock,
  queryService: QueryServiceMock = buildQueryService(),
) => new OpsTransactionsController(
  service as unknown as OpsTransactionReconciliationService,
  queryService as unknown as OpsTransactionQueryService,
)

describe('OpsTransactionsController.reconcileHash', () => {
  it('returns 400 for invalid payloads', async () => {
    const service = buildService()
    const controller = buildController(service)
    const badRequest = badRequestResponder()

    const response = await controller.reconcileHash(
      {
        blockchain: BlockchainNetwork.STELLAR,
        on_chain_tx: '',
      },
      badRequest,
    )

    expect(service.reconcileHash).not.toHaveBeenCalled()
    expect(response).toEqual(expect.objectContaining({ reason: expect.any(String) }))
  })

  it('maps service response to API response shape', async () => {
    const service = buildService()
    const controller = buildController(service)
    const badRequest = badRequestResponder()

    const response = await controller.reconcileHash(
      {
        blockchain: BlockchainNetwork.SOLANA,
        on_chain_tx: 'solana-signature',
        transaction_id: '22222222-2222-4222-8222-222222222222',
      },
      badRequest,
    )

    expect(service.reconcileHash).toHaveBeenCalledWith({
      blockchain: BlockchainNetwork.SOLANA,
      onChainTx: 'solana-signature',
      transactionId: '22222222-2222-4222-8222-222222222222',
    })
    expect(response).toEqual({
      blockchain: BlockchainNetwork.SOLANA,
      on_chain_tx: 'solana-signature',
      reason: undefined,
      result: 'enqueued',
      transaction_id: '22222222-2222-4222-8222-222222222222',
      transaction_status: TransactionStatus.AWAITING_PAYMENT,
    })
  })
})

describe('OpsTransactionsController.search', () => {
  it('forwards filters to the query service', async () => {
    const queryService = buildQueryService()
    const listResponse: OpsTransactionListResponse = { items: [], page: 1, pageSize: 25, total: 0 }
    queryService.search.mockResolvedValue(listResponse)
    const controller = buildController(buildService(), queryService)

    const result = await controller.search(TransactionStatus.PAYMENT_COMPLETED, 'p1', 'u1', '0xabc', 'ext-1', 2, 10)

    expect(queryService.search).toHaveBeenCalledWith({
      externalId: 'ext-1',
      onChainId: '0xabc',
      page: 2,
      pageSize: 10,
      partnerId: 'p1',
      status: TransactionStatus.PAYMENT_COMPLETED,
      userId: 'u1',
    })
    expect(result).toBe(listResponse)
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
    queryService.getById.mockRejectedValue(new OpsTransactionNotFoundError('Transaction not found'))
    const controller = buildController(buildService(), queryService)
    const notFound = notFoundResponder()

    const response = await controller.getById('missing', notFound)

    expect(notFound).toHaveBeenCalledWith(404, { reason: 'Transaction not found' })
    expect(response).toEqual({ reason: 'Transaction not found' })
  })
})
