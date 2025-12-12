import 'reflect-metadata'
import { BlockchainNetwork, CryptoCurrency, TransactionStatus } from '.prisma/client'
import { Connection } from '@solana/web3.js'

import { Secret } from '../../interfaces/ISecretManager'
import {
  buildTransaction,
  createControllerContext,
  onChainSignature,
  resetSolanaTestState,
  secrets,
  transactionId,
  type TransactionRecord,
} from './solanaPaymentTestUtils'

describe('SolanaPaymentsController notifyPayment validation', () => {
  beforeEach(() => {
    resetSolanaTestState()
  })

  it('rejects invalid request payloads', async () => {
    const { badRequest, controller, prismaClient } = createControllerContext()
    badRequest.mockImplementation((_code: number, payload: { reason: string }) => payload)

    const response = await controller.notifyPayment(
      { on_chain_tx: '', transaction_id: 'invalid-uuid' },
      badRequest,
      jest.fn(),
    ) as unknown as { reason: string }

    expect(response.reason).toContain('On-chain transaction signature is required')
    expect(prismaClient.transaction.findUnique).not.toHaveBeenCalled()
  })

  it('returns not found when the transaction does not exist', async () => {
    const { controller, notFound, prismaClient } = createControllerContext()
    prismaClient.transaction.findUnique.mockResolvedValueOnce(null)
    notFound.mockImplementation((_code: number, payload: { reason: string }) => payload)

    const response = await controller.notifyPayment(
      { on_chain_tx: onChainSignature, transaction_id: transactionId },
      jest.fn(),
      notFound,
    )

    expect(response).toEqual({ reason: 'Transaction not found' })
  })

  it('validates transaction status and network before hitting Solana', async () => {
    const { badRequest, controller, prismaClient } = createControllerContext()
    prismaClient.transaction.findUnique.mockResolvedValueOnce(
      buildTransaction({ status: TransactionStatus.PROCESSING_PAYMENT }),
    )

    badRequest.mockImplementation((_code: number, payload: { reason: string }) => payload)

    const wrongStatus = await controller.notifyPayment(
      { on_chain_tx: onChainSignature, transaction_id: transactionId },
      badRequest,
      jest.fn(),
    ) as unknown as { reason: string }
    expect(wrongStatus.reason).toBe('Transaction is not awaiting payment')

    prismaClient.transaction.findUnique.mockResolvedValueOnce(
      buildTransaction({ quote: { network: BlockchainNetwork.STELLAR } as unknown as TransactionRecord['quote'] }),
    )
    const wrongNetwork = await controller.notifyPayment(
      { on_chain_tx: onChainSignature, transaction_id: transactionId },
      badRequest,
      jest.fn(),
    ) as unknown as { reason: string }
    expect(wrongNetwork.reason).toBe('Transaction is not set for Solana')

    prismaClient.transaction.findUnique.mockResolvedValueOnce(
      buildTransaction({ quote: { cryptoCurrency: 'BTC' as CryptoCurrency } as unknown as TransactionRecord['quote'] }),
    )
    const wrongCurrency = await controller.notifyPayment(
      { on_chain_tx: onChainSignature, transaction_id: transactionId },
      badRequest,
      jest.fn(),
    ) as unknown as { reason: string }
    expect(wrongCurrency.reason).toBe('Unsupported currency for Solana payments')
  })

  it('prevents linking an on-chain transaction that is already associated', async () => {
    const { badRequest, controller, prismaClient } = createControllerContext()
    prismaClient.transaction.findUnique.mockResolvedValueOnce(buildTransaction())
    prismaClient.transaction.findFirst.mockResolvedValueOnce({ id: 'other-transaction' })

    badRequest.mockImplementation((_code: number, payload: { reason: string }) => payload)

    const duplicate = await controller.notifyPayment(
      { on_chain_tx: onChainSignature, transaction_id: transactionId },
      badRequest,
      jest.fn(),
    ) as unknown as { reason: string }

    expect(duplicate.reason).toBe('On-chain transaction already linked to another transaction')
  })

  it('throws when Solana configuration is invalid', async () => {
    const { badRequest, controller, logger, prismaClient, secretManager } = createControllerContext()
    prismaClient.transaction.findUnique.mockResolvedValueOnce(buildTransaction())

    const getSecretMock = secretManager.getSecret as unknown as jest.Mock
    getSecretMock.mockImplementation(async (secret: Secret) => {
      if (secret === 'SOLANA_ADDRESS' || secret === 'SOLANA_USDC_MINT') {
        return ''
      }
      return secrets[secret] ?? ''
    })

    await expect(
      controller.notifyPayment(
        { on_chain_tx: onChainSignature, transaction_id: transactionId },
        badRequest,
        jest.fn(),
      ),
    ).rejects.toThrow('Solana configuration is invalid')
    expect(logger.error).toHaveBeenCalledWith(
      '[SolanaPaymentsController] Invalid Solana configuration',
      { depositWalletAddress: '', usdcMintAddress: '' },
    )
  })

  it('handles RPC failures when fetching the on-chain transaction', async () => {
    const { badRequest, controller, logger, prismaClient } = createControllerContext()
    prismaClient.transaction.findUnique.mockResolvedValueOnce(buildTransaction())

    const rpcSpy = jest.spyOn(Connection.prototype, 'getParsedTransaction').mockRejectedValueOnce(new Error('rpc down'))
    badRequest.mockImplementation((_code: number, payload: { reason: string }) => payload)

    const response = await controller.notifyPayment(
      { on_chain_tx: onChainSignature, transaction_id: transactionId },
      badRequest,
      jest.fn(),
    )

    expect(response).toEqual({ reason: 'Transaction not found on Solana' })
    expect(logger.error).toHaveBeenCalledWith(
      '[SolanaPaymentVerifier] Failed to fetch transaction from Solana',
      expect.any(Error),
    )
    rpcSpy.mockRestore()
  })
})
