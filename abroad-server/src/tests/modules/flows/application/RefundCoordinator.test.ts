import { BlockchainNetwork, CryptoCurrency } from '@prisma/client'

import { RefundCoordinator } from '../../../../modules/flows/application/RefundCoordinator'
import { RefundService } from '../../../../modules/transactions/application/RefundService'
import { TransactionRepository } from '../../../../modules/transactions/application/TransactionRepository'
import { createMockLogger } from '../../../setup/mockFactories'

describe('RefundCoordinator', () => {
  const prismaClient = {}

  afterEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
  })

  it('passes stored deposit address to Solana refund path', async () => {
    jest.spyOn(TransactionRepository.prototype, 'getClient').mockResolvedValue(prismaClient as never)
    jest.spyOn(TransactionRepository.prototype, 'reserveRefund').mockResolvedValue({ attempts: 1, outcome: 'reserved' })
    jest.spyOn(TransactionRepository.prototype, 'findDepositAddressFrom').mockResolvedValue('sender-wallet')
    const recordRefundOutcome = jest.spyOn(TransactionRepository.prototype, 'recordRefundOutcome').mockResolvedValue(undefined)

    const refundByOnChainId = jest.spyOn(RefundService.prototype, 'refundByOnChainId').mockResolvedValue({
      success: true,
      transactionId: 'refund-1',
    })

    const coordinator = new RefundCoordinator(
      { getClient: jest.fn(async () => prismaClient) } as never,
      { getWalletHandler: jest.fn() } as never,
      createMockLogger(),
    )

    await coordinator.refundByOnChainId({
      amount: 10,
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.SOLANA,
      onChainId: 'on-chain-1',
      reason: 'provider_failed',
      transactionId: 'tx-1',
      trigger: 'test',
    })

    expect(refundByOnChainId).toHaveBeenCalledWith(expect.objectContaining({
      network: BlockchainNetwork.SOLANA,
      onChainId: 'on-chain-1',
      sourceAddress: 'sender-wallet',
    }))
    expect(recordRefundOutcome).toHaveBeenCalledWith(prismaClient, expect.objectContaining({
      refundResult: { success: true, transactionId: 'refund-1' },
      transactionId: 'tx-1',
    }))
  })

  it('records explicit failure when Solana source address is unavailable', async () => {
    jest.spyOn(TransactionRepository.prototype, 'getClient').mockResolvedValue(prismaClient as never)
    jest.spyOn(TransactionRepository.prototype, 'reserveRefund').mockResolvedValue({ attempts: 1, outcome: 'reserved' })
    jest.spyOn(TransactionRepository.prototype, 'findDepositAddressFrom').mockResolvedValue(null)
    const recordRefundOutcome = jest.spyOn(TransactionRepository.prototype, 'recordRefundOutcome').mockResolvedValue(undefined)

    jest.spyOn(RefundService.prototype, 'refundByOnChainId').mockRejectedValue(
      new Error('Unable to refund Solana transaction: missing source address (addressFrom) in transaction context'),
    )

    const coordinator = new RefundCoordinator(
      { getClient: jest.fn(async () => prismaClient) } as never,
      { getWalletHandler: jest.fn() } as never,
      createMockLogger(),
    )

    await coordinator.refundByOnChainId({
      amount: 10,
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.SOLANA,
      onChainId: 'on-chain-2',
      reason: 'provider_failed',
      transactionId: 'tx-2',
      trigger: 'test',
    })

    expect(recordRefundOutcome).toHaveBeenCalledWith(prismaClient, expect.objectContaining({
      refundResult: {
        reason: 'Unable to refund Solana transaction: missing source address (addressFrom) in transaction context',
        success: false,
        transactionId: undefined,
      },
      transactionId: 'tx-2',
    }))
  })
})
