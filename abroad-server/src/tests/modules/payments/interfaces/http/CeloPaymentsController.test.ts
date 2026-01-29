import { BlockchainNetwork, CryptoCurrency } from '@prisma/client'
import { TsoaResponse } from 'tsoa'

import { IDepositVerifierRegistry } from '../../../../../modules/payments/application/contracts/IDepositVerifier'
import { CeloPaymentsController } from '../../../../../modules/payments/interfaces/http/CeloPaymentsController'
import { QueueName, ReceivedCryptoTransactionMessage } from '../../../../../platform/messaging/queues'
import { OutboxDispatcher } from '../../../../../platform/outbox/OutboxDispatcher'

describe('CeloPaymentsController', () => {
  const buildController = (params?: {
    verifierOutcome?: { outcome: 'error', reason: string, status: 400 | 404 } | { outcome: 'ok', queueMessage: ReceivedCryptoTransactionMessage }
  }) => {
    const verifierOutcome = params?.verifierOutcome ?? {
      outcome: 'ok' as const,
      queueMessage: {
        addressFrom: '0xsender',
        amount: 10,
        blockchain: BlockchainNetwork.CELO,
        cryptoCurrency: CryptoCurrency.USDC,
        onChainId: '0xhash',
        transactionId: 'tx-id',
      },
    }

    const verifier = {
      verifyNotification: jest.fn().mockResolvedValue(verifierOutcome),
    }
    const verifierRegistry: IDepositVerifierRegistry = {
      getVerifier: jest.fn().mockReturnValue(verifier),
    }

    const outboxDispatcher = {
      enqueueQueue: jest.fn().mockResolvedValue(undefined),
    } as unknown as OutboxDispatcher

    return { controller: new CeloPaymentsController(verifierRegistry, outboxDispatcher), outboxDispatcher, verifier }
  }

  it('enqueues valid payments', async () => {
    const { controller, outboxDispatcher, verifier } = buildController()

    const badRequest = jest.fn() as unknown as TsoaResponse<400, { reason: string }>
    const notFound = jest.fn() as unknown as TsoaResponse<404, { reason: string }>

    const response = await controller.notifyPayment(
      { on_chain_tx: '0xhash', transaction_id: '6a83f2f4-1b07-4c3a-8c0f-5b0a54f1b5a4' },
      badRequest,
      notFound,
    )

    expect(response).toEqual({ enqueued: true })
    expect(verifier.verifyNotification).toHaveBeenCalledWith('0xhash', expect.any(String))
    expect(outboxDispatcher.enqueueQueue).toHaveBeenCalledWith(
      QueueName.RECEIVED_CRYPTO_TRANSACTION,
      expect.objectContaining({ onChainId: '0xhash' }),
      'celo.notify',
      { deliverNow: true },
    )
  })

  it('rejects invalid payloads', async () => {
    const { controller } = buildController()
    const badRequest = jest.fn().mockReturnValue({ enqueued: false }) as unknown as TsoaResponse<400, { reason: string }>
    const notFound = jest.fn() as unknown as TsoaResponse<404, { reason: string }>

    const response = await controller.notifyPayment(
      { on_chain_tx: '', transaction_id: 'invalid' } as unknown as { on_chain_tx: string, transaction_id: string },
      badRequest,
      notFound,
    )

    expect(badRequest).toHaveBeenCalled()
    expect(response).toEqual({ enqueued: false })
  })
})
