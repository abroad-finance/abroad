import { BlockchainNetwork, CryptoCurrency, PaymentMethod, TargetCurrency } from '@prisma/client'

import type { ILockManager } from '../../../../platform/cacheLock/ILockManager'

import { RefundCoordinator } from '../../../../modules/flows/application/RefundCoordinator'
import { RefundService } from '../../../../modules/transactions/application/RefundService'
import { TransactionRepository } from '../../../../modules/transactions/application/TransactionRepository'
import { createMockLogger } from '../../../setup/mockFactories'

describe('RefundCoordinator', () => {
  // Shaped like the row the notification reads back: the refund's on-chain id is
  // the field a partner has no other push-based way of learning.
  const refundedTransaction = {
    bankCode: 'internal-only',
    id: 'tx-1',
    origin: 'DIRECT',
    partnerUser: { partner: { id: 'partner-1', webhookUrl: 'https://partner.test/hook' }, userId: 'user-1' },
    quote: { cryptoCurrency: CryptoCurrency.USDC, sourceAmount: 10, targetAmount: 50, targetCurrency: 'BRL' },
    refundOnChainId: 'refund-1',
    status: 'PAYMENT_EXPIRED',
  }
  const prismaClient = { transaction: { findUnique: jest.fn(async () => refundedTransaction) } }
  const lockManager = {
    withLock: jest.fn(async (_key: string, _timeout: number, operation: () => Promise<void>) => operation()),
  }
  const enqueueWebhook = jest.fn()
  const enqueueUserNotification = jest.fn()
  const outboxDispatcher = { enqueueQueue: enqueueUserNotification } as never
  const webhookRouter = { enqueue: enqueueWebhook } as never

  const buildCoordinator = (overrides: { client?: unknown, refundDeposit?: jest.Mock } = {}) => new RefundCoordinator(
    { getClient: jest.fn(async () => overrides.client ?? prismaClient) } as never,
    { getWalletHandler: jest.fn() } as never,
    lockManager as unknown as ILockManager,
    createMockLogger(),
    { getForCapability: jest.fn(() => ({ refundDeposit: overrides.refundDeposit })) } as never,
    outboxDispatcher,
    webhookRouter,
  )

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

    const coordinator = buildCoordinator()

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

    const coordinator = buildCoordinator()

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

    const coordinator = buildCoordinator()

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
      transaction: { findUnique: jest.fn().mockResolvedValue(refundedTransaction) },
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
    const coordinator = buildCoordinator({ client })

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

  /*
   * The failure's own `transaction.updated` is enqueued before the refund is
   * attempted, so it carries `refundOnChainId: null`. These pin the second
   * notification — without it a completed refund is never pushed to the partner
   * at all and can only be found by polling.
   */
  describe('refund notifications', () => {
    const refundToSender = {
      addressFrom: 'sender-wallet',
      amount: 10,
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: CryptoCurrency.USDC,
      reason: 'expired_transaction',
      transactionId: 'tx-1',
      trigger: 'non_awaiting_deposit',
    }

    beforeEach(() => {
      jest.spyOn(TransactionRepository.prototype, 'getClient').mockResolvedValue(prismaClient as never)
      jest.spyOn(TransactionRepository.prototype, 'reserveRefund').mockResolvedValue({ attempts: 1, outcome: 'reserved' })
      jest.spyOn(TransactionRepository.prototype, 'recordRefundOutcome').mockResolvedValue(undefined)
    })

    it('announces a completed refund with its on-chain id', async () => {
      jest.spyOn(RefundService.prototype, 'refundToSender').mockResolvedValue({ success: true, transactionId: 'refund-1' })

      await buildCoordinator().refundToSender(refundToSender)

      expect(enqueueWebhook).toHaveBeenCalledWith(
        'https://partner.test/hook',
        'DIRECT',
        { data: expect.objectContaining({ refundOnChainId: 'refund-1' }), event: 'transaction.updated' },
        'flow_refund',
        expect.objectContaining({ partnerId: 'partner-1', transactionId: 'tx-1' }),
      )
    })

    it('stays silent when the refund did not go through', async () => {
      jest.spyOn(RefundService.prototype, 'refundToSender').mockResolvedValue({ reason: 'horizon_unavailable', success: false })

      await buildCoordinator().refundToSender(refundToSender)

      expect(enqueueWebhook).not.toHaveBeenCalled()
    })

    // An onramp took the customer's money up front, so its refund is the one
    // they are most anxious about; it reaches the partner the same way.
    it('announces a returned fiat deposit', async () => {
      const refundDeposit = jest.fn(async () => ({ providerRefundId: 'rf-1', success: true }))

      await buildCoordinator({ refundDeposit }).refundFiatDeposit({
        paymentMethod: PaymentMethod.PIX,
        providerDepositId: 'dep-1',
        reason: 'delivery_failed',
        targetCurrency: TargetCurrency.BRL,
        transactionId: 'tx-1',
        trigger: 'flow_crypto_send',
      })

      expect(enqueueWebhook).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ event: 'transaction.updated' }),
        'flow_fiat_refund',
        expect.anything(),
      )
    })

    // A refund that already moved money must not be reported as failed because
    // the announcement of it broke.
    it('keeps the refund when the notification cannot be built', async () => {
      jest.spyOn(RefundService.prototype, 'refundToSender').mockResolvedValue({ success: true, transactionId: 'refund-1' })
      prismaClient.transaction.findUnique.mockRejectedValueOnce(new Error('database unavailable'))

      await expect(buildCoordinator().refundToSender(refundToSender)).resolves.toBeUndefined()
      expect(enqueueWebhook).not.toHaveBeenCalled()
    })
  })

  describe('refundFiatDeposit', () => {
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

      await buildCoordinator({ refundDeposit }).refundFiatDeposit(params)

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

      await buildCoordinator({ refundDeposit }).refundFiatDeposit(params)

      expect(refundDeposit).not.toHaveBeenCalled()
    })

    it('takes the shared refund lock so a payout refund cannot run beside it', async () => {
      jest.spyOn(TransactionRepository.prototype, 'getClient').mockResolvedValue(prismaClient as never)
      jest.spyOn(TransactionRepository.prototype, 'reserveRefund').mockResolvedValue({ attempts: 1, outcome: 'reserved' })
      jest.spyOn(TransactionRepository.prototype, 'recordRefundOutcome').mockResolvedValue(undefined)

      await buildCoordinator({ refundDeposit: jest.fn(async () => ({ providerRefundId: 'rf-1', success: true })) }).refundFiatDeposit(params)

      expect(lockManager.withLock).toHaveBeenCalledWith(
        expect.stringContaining('tx-1'), expect.any(Number), expect.any(Function),
      )
    })

    /*
     * A reservation left pending is never picked up again: reserveRefund
     * reports it as in-flight and every later attempt skips. Recording a
     * failure as awaiting-reconciliation therefore strands the customer's
     * money silently, which is exactly what a provider rate-limit did on the
     * first real refund. Failures must stay plainly failed so the next attempt
     * re-reserves; the provider call is idempotency-keyed, so retrying one that
     * did reach the provider still cannot refund twice.
     */
    it.each([
      ['retriable', 'rate_limited'],
      ['permanent', 'deposit_not_refundable'],
    ])('records a %s failure as retryable, never as pending reconciliation', async (code, reason) => {
      jest.spyOn(TransactionRepository.prototype, 'getClient').mockResolvedValue(prismaClient as never)
      jest.spyOn(TransactionRepository.prototype, 'reserveRefund').mockResolvedValue({ attempts: 1, outcome: 'reserved' })
      const record = jest.spyOn(TransactionRepository.prototype, 'recordRefundOutcome').mockResolvedValue(undefined)
      const refundDeposit = jest.fn(async () => ({ code, reason, success: false }))

      await buildCoordinator({ refundDeposit }).refundFiatDeposit(params)

      const recorded = record.mock.calls[0][1].refundResult
      expect(recorded).toEqual({ reason, success: false })
      expect(recorded).not.toHaveProperty('reconciliationRequired')
    })

    // The skip that stranded the first refund, pinned: once a reservation is
    // pending nothing retries it, so nothing may leave one behind.
    it('does not act on a reservation another attempt already holds', async () => {
      jest.spyOn(TransactionRepository.prototype, 'getClient').mockResolvedValue(prismaClient as never)
      jest.spyOn(TransactionRepository.prototype, 'reserveRefund').mockResolvedValue({ attempts: 1, outcome: 'in_flight' })
      const refundDeposit = jest.fn()

      await buildCoordinator({ refundDeposit }).refundFiatDeposit(params)

      expect(refundDeposit).not.toHaveBeenCalled()
    })
  })
})
