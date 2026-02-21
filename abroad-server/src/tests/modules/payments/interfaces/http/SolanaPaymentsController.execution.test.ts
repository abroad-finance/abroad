import 'reflect-metadata'
import { BlockchainNetwork, CryptoCurrency, PaymentMethod, TransactionStatus } from '.prisma/client'
import { type ParsedTransactionWithMeta } from '@solana/web3.js'

import {
  buildTransferInstruction,
  createControllerContext,
  expectEnqueuedMessage,
  onChainSignature,
  resetSolanaTestState,
  setParsedTransaction,
  transactionId,
} from './solanaPaymentTestUtils'

describe('SolanaPaymentsController notifyPayment execution', () => {
  beforeEach(() => {
    resetSolanaTestState()
  })

  it('enqueues a verified Solana USDC transfer to the configured wallet', async () => {
    const { badRequest, controller, notFound, outboxDispatcher, prismaClient } = createControllerContext()

    prismaClient.transaction.findUnique.mockResolvedValueOnce({
      accountNumber: 'acc',
      id: transactionId,
      partnerUser: { partner: { webhookUrl: 'http://webhook' } },
      quote: {
        cryptoCurrency: CryptoCurrency.USDC,
        network: BlockchainNetwork.SOLANA,
        paymentMethod: PaymentMethod.BREB,
        targetAmount: 0,
        targetCurrency: 'COP',
      },
      status: TransactionStatus.AWAITING_PAYMENT,
    })

    setParsedTransaction(onChainSignature, {
      meta: { err: null },
      transaction: {
        message: {
          instructions: [buildTransferInstruction()],
        },
      },
    } as unknown as ParsedTransactionWithMeta)

    const result = await controller.notifyPayment(
      { on_chain_tx: onChainSignature, transaction_id: transactionId },
      badRequest,
      notFound,
    )

    expect(result).toEqual({ enqueued: true })
    expect(badRequest).not.toHaveBeenCalled()
    expect(notFound).not.toHaveBeenCalled()
    expectEnqueuedMessage(outboxDispatcher, 2.5)
  })

  it('returns bad request when the on-chain transaction is missing', async () => {
    const { badRequest, controller, prismaClient } = createControllerContext()
    prismaClient.transaction.findUnique.mockResolvedValueOnce({
      accountNumber: 'acc',
      id: transactionId,
      partnerUser: { partner: { webhookUrl: 'http://webhook' } },
      quote: {
        cryptoCurrency: CryptoCurrency.USDC,
        network: BlockchainNetwork.SOLANA,
        paymentMethod: PaymentMethod.BREB,
        targetAmount: 0,
        targetCurrency: 'COP',
      },
      status: TransactionStatus.AWAITING_PAYMENT,
    })

    const reason = 'Transaction not found on Solana'
    badRequest.mockImplementation((code: number, payload: { reason: string }) => {
      expect(code).toBe(400)
      expect(payload.reason).toBe(reason)
      return payload
    })

    const response = await controller.notifyPayment(
      { on_chain_tx: onChainSignature, transaction_id: transactionId },
      badRequest,
      jest.fn(),
    )

    expect(response).toEqual({ reason })
  })

  it('rejects failed on-chain transactions and missing transfers', async () => {
    const { badRequest, controller, prismaClient } = createControllerContext()
    prismaClient.transaction.findUnique.mockResolvedValue({
      accountNumber: 'acc',
      id: transactionId,
      partnerUser: { partner: { webhookUrl: 'http://webhook' } },
      quote: {
        cryptoCurrency: CryptoCurrency.USDC,
        network: BlockchainNetwork.SOLANA,
        paymentMethod: PaymentMethod.BREB,
        targetAmount: 0,
        targetCurrency: 'COP',
      },
      status: TransactionStatus.AWAITING_PAYMENT,
    })

    badRequest.mockImplementation((_code: number, payload: { reason: string }) => payload)

    setParsedTransaction(onChainSignature, {
      meta: { err: { InstructionError: ['0', 'error'] } },
      transaction: {
        message: { instructions: [] },
      },
    } as unknown as ParsedTransactionWithMeta)

    const failed = await controller.notifyPayment(
      { on_chain_tx: onChainSignature, transaction_id: transactionId },
      badRequest,
      jest.fn(),
    ) as unknown as { reason: string }
    expect(failed.reason).toBe('Transaction failed on-chain')

    setParsedTransaction(onChainSignature, {
      meta: { err: null },
      transaction: {
        message: { instructions: [] },
      },
    } as unknown as ParsedTransactionWithMeta)

    const missingTransfer = await controller.notifyPayment(
      { on_chain_tx: onChainSignature, transaction_id: transactionId },
      badRequest,
      jest.fn(),
    ) as unknown as { reason: string }
    expect(missingTransfer.reason).toBe('No transfer to the configured wallet found in this transaction')
  })

  it('propagates queue errors when enqueuing verified payments', async () => {
    const { badRequest, controller, outboxDispatcher, prismaClient } = createControllerContext()
    prismaClient.transaction.findUnique.mockResolvedValueOnce({
      accountNumber: 'acc',
      id: transactionId,
      partnerUser: { partner: { webhookUrl: 'http://webhook' } },
      quote: {
        cryptoCurrency: CryptoCurrency.USDC,
        network: BlockchainNetwork.SOLANA,
        paymentMethod: PaymentMethod.BREB,
        targetAmount: 0,
        targetCurrency: 'COP',
      },
      status: TransactionStatus.AWAITING_PAYMENT,
    })

    setParsedTransaction(onChainSignature, {
      meta: { err: null },
      transaction: {
        message: {
          instructions: [buildTransferInstruction({
            parsed: {
              info: {
                destination: 'deposit-wallet',
                mint: 'usdc-mint',
                source: 'sender-wallet',
                tokenAmount: {
                  amount: '1000000',
                  decimals: 6,
                  uiAmount: null,
                  uiAmountString: '1',
                },
              },
              type: 'transferChecked',
            },
          })],
        },
      },
    } as unknown as ParsedTransactionWithMeta)

    const enqueueMock = outboxDispatcher.enqueueQueue as unknown as jest.Mock
    enqueueMock.mockRejectedValueOnce(new Error('queue down'))

    await expect(
      controller.notifyPayment(
        { on_chain_tx: onChainSignature, transaction_id: transactionId },
        badRequest,
        jest.fn(),
      ),
    ).rejects.toThrow()
  })
})
