import 'reflect-metadata'
import type { TsoaResponse } from '@tsoa/runtime'

import { BlockchainNetwork, TransactionStatus } from '@prisma/client'

import { OpsTransactionReconciliationService } from '../../../../../modules/transactions/application/OpsTransactionReconciliationService'
import { OpsTransactionsController } from '../../../../../modules/transactions/interfaces/http/OpsTransactionsController'

type ReconciliationServiceMock = Pick<OpsTransactionReconciliationService, 'reconcileHash'>

const badRequestResponder = (): TsoaResponse<400, { reason: string }> => (
  jest.fn((_status: 400, payload: { reason: string }) => payload)
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

describe('OpsTransactionsController', () => {
  it('returns 400 for invalid payloads', async () => {
    const service = buildService()
    const controller = new OpsTransactionsController(
      service as unknown as OpsTransactionReconciliationService,
    )
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
    const controller = new OpsTransactionsController(
      service as unknown as OpsTransactionReconciliationService,
    )
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
