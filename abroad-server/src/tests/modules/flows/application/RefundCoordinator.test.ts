import { BlockchainNetwork, CryptoCurrency, PaymentMethod, TargetCurrency } from '@prisma/client'

import type { ILockManager } from '../../../../platform/cacheLock/ILockManager'

import { RefundCoordinator } from '../../../../modules/flows/application/RefundCoordinator'
import { RefundService } from '../../../../modules/transactions/application/RefundService'
import { TransactionRepository } from '../../../../modules/transactions/application/TransactionRepository'
import { createMockLogger } from '../../../setup/mockFactories'

describe('RefundCoordinator', () => {
  const prismaClient = {}
  const lockManager = {
    withLock: jest.fn(async (_key: string, _timeout: number, operation: () => Promise<void>) => operation()),
  }

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
      lockManager as unknown as ILockManager,
      createMockLogger(),
      { getForCapability: jest.fn() } as never,
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
      lockManager as unknown as ILockManager,
      createMockLogger(),
      { getForCapability: jest.fn() } as never,
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

  it('keeps an indeterminate Stellar refund reserved for exact-hash reconciliation', async () => {
    jest.spyOn(TransactionRepository.prototype, 'getClient').mockResolvedValue(prismaClient as never)
    jest.spyOn(TransactionRepository.prototype, 'reserveRefund').mockResolvedValue({ attempts: 1, outcome: 'reserved' })
    const recordRefundOutcome = jest.spyOn(TransactionRepository.prototype, 'recordRefundOutcome').mockResolvedValue(undefined)
    jest.spyOn(RefundService.prototype, 'refundByOnChainId').mockResolvedValue({
      code: 'retriable',
      reason: 'stellar_submission_timeout',
      reconciliationRequired: true,
      success: false,
      transactionId: 'prepared-refund-hash',
    })

    const coordinator = new RefundCoordinator(
      { getClient: jest.fn(async () => prismaClient) } as never,
      { getWalletHandler: jest.fn() } as never,
      lockManager as unknown as ILockManager,
      createMockLogger(),
      { getForCapability: jest.fn() } as never,
    )

    await coordinator.refundByOnChainId({
      amount: 5.99,
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      onChainId: 'deposit-hash',
      reason: 'provider_failed',
      transactionId: 'tx-ambiguous',
      trigger: 'provider_status',
    })

    expect(recordRefundOutcome).toHaveBeenCalledWith(prismaClient, expect.objectContaining({
      refundResult: {
        reason: 'stellar_submission_timeout',
        reconciliationRequired: true,
        success: false,
        transactionId: 'prepared-refund-hash',
      },
      transactionId: 'tx-ambiguous',
    }))
  })

  it('captures a confirmed refund fee under one deterministic reconciliation key', async () => {
    const costUpsert = jest.fn().mockResolvedValue({})
    const client = {
      transaction: {
        findUnique: jest.fn().mockResolvedValue({
          quote: {
            cryptoCurrency: CryptoCurrency.USDC,
            sourceAmount: 10,
            targetAmount: 50,
            targetCurrency: 'BRL',
          },
        }),
      },
      transactionEconomicCost: { upsert: costUpsert },
      transactionEconomics: { upsert: jest.fn().mockResolvedValue({}) },
    }
    jest.spyOn(TransactionRepository.prototype, 'getClient').mockResolvedValue(client as never)
    jest.spyOn(TransactionRepository.prototype, 'reserveRefund').mockResolvedValue({ attempts: 1, outcome: 'reserved' })
    jest.spyOn(TransactionRepository.prototype, 'findDepositAddressFrom').mockResolvedValue('sender-wallet')
    jest.spyOn(TransactionRepository.prototype, 'recordRefundOutcome').mockResolvedValue(undefined)
    jest.spyOn(RefundService.prototype, 'refundByOnChainId').mockResolvedValue({
      networkFee: { amount: '0.000005', currency: 'SOL' },
      success: true,
      transactionId: 'refund-1',
    })
    const coordinator = new RefundCoordinator(
      { getClient: jest.fn(async () => client) } as never,
      { getWalletHandler: jest.fn() } as never,
      lockManager as unknown as ILockManager,
      createMockLogger(),
      { getForCapability: jest.fn() } as never,
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

    expect(costUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        transactionId_kind_operationKey: {
          kind: 'REFUND_FEE',
          operationKey: 'refund_fee',
          transactionId: 'tx-1',
        },
      },
    }))
  })

  describe('refundFiatDeposit', () => {
    const buildCoordinator = (refundDeposit: jest.Mock) => new RefundCoordinator(
      { getClient: jest.fn(async () => prismaClient) } as never,
      { getWalletHandler: jest.fn() } as never,
      lockManager as unknown as ILockManager,
      createMockLogger(),
      { getForCapability: jest.fn(() => ({ refundDeposit })) } as never,
    )

    const params = {
      paymentMethod: PaymentMethod.PIX,
      providerDepositId: 'dep-1',
      reason: 'delivery_failed',
      targetCurrency: TargetCurrency.BRL,
      transactionId: 'tx-1',
      trigger: 'flow_crypto_send',
    }

    it('returns the deposit to its payer and records the outcome', async () => {
      jest.spyOn(TransactionRepository.prototype, 'getClient').mockResolvedValue(prismaClient as never)
      jest.spyOn(TransactionRepository.prototype, 'reserveRefund').mockResolvedValue({ attempts: 1, outcome: 'reserved' })
      const record = jest.spyOn(TransactionRepository.prototype, 'recordRefundOutcome').mockResolvedValue(undefined)
      const refundDeposit = jest.fn(async () => ({ providerRefundId: 'rf-1', success: true }))

      await buildCoordinator(refundDeposit).refundFiatDeposit(params)

      expect(refundDeposit).toHaveBeenCalledWith({ providerDepositId: 'dep-1', transactionId: 'tx-1' })
      expect(record).toHaveBeenCalledWith(prismaClient, expect.objectContaining({
        refundResult: { success: true, transactionId: 'rf-1' },
        transactionId: 'tx-1',
      }))
    })

    // The reservation is what stops a retried step refunding the same deposit
    // twice; it is shared with the payout path so both directions contend.
    it('does not refund twice when the reservation is already held', async () => {
      jest.spyOn(TransactionRepository.prototype, 'getClient').mockResolvedValue(prismaClient as never)
      jest.spyOn(TransactionRepository.prototype, 'reserveRefund').mockResolvedValue({ outcome: 'already_refunded', refundOnChainId: 'rf-0' })
      const refundDeposit = jest.fn()

      await buildCoordinator(refundDeposit).refundFiatDeposit(params)

      expect(refundDeposit).not.toHaveBeenCalled()
    })

    it('takes the shared refund lock so a payout refund cannot run beside it', async () => {
      jest.spyOn(TransactionRepository.prototype, 'getClient').mockResolvedValue(prismaClient as never)
      jest.spyOn(TransactionRepository.prototype, 'reserveRefund').mockResolvedValue({ attempts: 1, outcome: 'reserved' })
      jest.spyOn(TransactionRepository.prototype, 'recordRefundOutcome').mockResolvedValue(undefined)

      await buildCoordinator(jest.fn(async () => ({ providerRefundId: 'rf-1', success: true }))).refundFiatDeposit(params)

      expect(lockManager.withLock).toHaveBeenCalledWith(
        expect.stringContaining('tx-1'), expect.any(Number), expect.any(Function),
      )
    })

    // Money that may still be moving must not be written off as refused.
    it('flags a retriable provider failure for reconciliation', async () => {
      jest.spyOn(TransactionRepository.prototype, 'getClient').mockResolvedValue(prismaClient as never)
      jest.spyOn(TransactionRepository.prototype, 'reserveRefund').mockResolvedValue({ attempts: 1, outcome: 'reserved' })
      const record = jest.spyOn(TransactionRepository.prototype, 'recordRefundOutcome').mockResolvedValue(undefined)
      const refundDeposit = jest.fn(async () => ({ code: 'retriable', reason: 'desk_unavailable', success: false }))

      await buildCoordinator(refundDeposit).refundFiatDeposit(params)

      expect(record).toHaveBeenCalledWith(prismaClient, expect.objectContaining({
        refundResult: expect.objectContaining({ reconciliationRequired: true, success: false }),
      }))
    })
  })
})
