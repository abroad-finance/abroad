import 'reflect-metadata'
import {
  BlockchainNetwork,
  CryptoCurrency,
  PaymentMethod,
  TargetCurrency,
  TransactionStatus,
} from '@prisma/client'

import type { FlowStepRuntimeContext } from '../../../../../modules/flows/application/flowTypes'
import type { RefundCoordinator } from '../../../../../modules/flows/application/RefundCoordinator'
import type { IWalletHandler } from '../../../../../modules/payments/application/contracts/IWalletHandler'
import type { IWalletHandlerFactory } from '../../../../../modules/payments/application/contracts/IWalletHandlerFactory'
import type { TransactionWebhookRouter } from '../../../../../modules/transactions/application/TransactionWebhookRouter'
import type { OutboxDispatcher } from '../../../../../platform/outbox/OutboxDispatcher'
import type { IDatabaseClientProvider } from '../../../../../platform/persistence/IDatabaseClientProvider'

import { CryptoSendStepExecutor } from '../../../../../modules/flows/application/steps/CryptoSendStepExecutor'
import { createMockLogger } from '../../../../setup/mockFactories'

const TRANSACTION_ID = 'dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb'
const WALLET = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'

const buildHarness = (opts?: {
  send?: jest.Mock
  transaction?: null | Record<string, unknown>
}) => {
  const transaction = opts?.transaction === undefined
    ? {
        destinationAddress: WALLET,
        id: TRANSACTION_ID,
        onChainId: null,
        pixDepositId: 'dep-1',
        quote: {
          cryptoCurrency: CryptoCurrency.USDC,
          network: BlockchainNetwork.CELO,
          paymentMethod: PaymentMethod.PIX,
          sourceAmount: 100,
          targetCurrency: TargetCurrency.BRL,
        },
        status: TransactionStatus.PROCESSING_PAYMENT,
      }
    : opts.transaction

  const prisma = { transaction: { findUnique: jest.fn(async () => transaction) } }
  const refundFiatDeposit = jest.fn(async () => undefined)
  const enqueueSlack = jest.fn() as jest.Mock<Promise<void>, [string, string]>
  enqueueSlack.mockResolvedValue(undefined)
  const refundCoordinator = { refundFiatDeposit } as unknown as RefundCoordinator

  const send = opts?.send ?? jest.fn(async () => ({ success: true, transactionId: '0xdelivery' }))
  const walletHandlerFactory = {
    getWalletHandler: jest.fn(() => ({ send } as unknown as IWalletHandler)),
  } as unknown as IWalletHandlerFactory

  const executor = new CryptoSendStepExecutor(
    { getClient: jest.fn(async () => prisma) } as unknown as IDatabaseClientProvider,
    walletHandlerFactory,
    createMockLogger(),
    { enqueueQueue: jest.fn(), enqueueSlack, enqueueWebhook: jest.fn() } as unknown as OutboxDispatcher,
    {
      enqueueTargets: jest.fn(async () => undefined),
      resolveTargets: jest.fn(async () => []),
    } as unknown as TransactionWebhookRouter,
    refundCoordinator,
  )

  const applyTransition = jest.fn(async () => ({
    createdAt: new Date('2026-08-05T12:00:00.000Z'),
    id: TRANSACTION_ID,
    partnerUser: { partner: { name: 'Partner' }, userId: 'user-1' },
    quote: {
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.CELO,
      sourceAmount: 100,
      targetAmount: 500,
      targetCurrency: TargetCurrency.BRL,
    },
    status: TransactionStatus.PAYMENT_COMPLETED,
  }))
  const recordOnChainIdIfMissing = jest.fn(async () => undefined)
  Object.assign(
    (executor as unknown as { repository: Record<string, unknown> }).repository,
    { applyTransition, recordOnChainIdIfMissing },
  )

  const run = () => executor.execute({
    attempt: 1,
    config: {},
    maxAttempts: 3,
    runtime: { context: { transactionId: TRANSACTION_ID } } as unknown as FlowStepRuntimeContext,
    stepOrder: 1,
  })

  return { applyTransition, enqueueSlack, executor, recordOnChainIdIfMissing, refundFiatDeposit, run, send, walletHandlerFactory }
}

describe('CryptoSendStepExecutor', () => {
  it('delivers the quoted crypto to the stored destination and completes', async () => {
    const { applyTransition, recordOnChainIdIfMissing, run, send } = buildHarness()

    const result = await run()

    expect(send).toHaveBeenCalledWith({
      address: WALLET,
      amount: 100,
      attempt: 1,
      cryptoCurrency: CryptoCurrency.USDC,
    })
    expect(recordOnChainIdIfMissing).toHaveBeenCalledWith(expect.anything(), TRANSACTION_ID, '0xdelivery')
    expect(applyTransition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        idempotencyKey: 'flow:crypto-send:completed:0xdelivery',
        name: 'payment_completed',
      }),
    )
    expect(result).toEqual({ outcome: 'succeeded', output: { onChainId: '0xdelivery' } })
  })

  it('sends on the chain the quote was priced for', async () => {
    const { run, walletHandlerFactory } = buildHarness()

    await run()

    expect(walletHandlerFactory.getWalletHandler).toHaveBeenCalledWith(BlockchainNetwork.CELO)
  })

  // Paying a customer twice is the worst outcome available here, so a delivery
  // already recorded on chain short-circuits before the wallet is touched.
  it('never sends again once a delivery hash is recorded', async () => {
    const { run, send } = buildHarness({
      transaction: {
        destinationAddress: WALLET,
        id: TRANSACTION_ID,
        onChainId: '0xalready',
        quote: {
          cryptoCurrency: CryptoCurrency.USDC,
          network: BlockchainNetwork.CELO,
          sourceAmount: 100,
        },
        status: TransactionStatus.PROCESSING_PAYMENT,
      },
    })

    const result = await run()

    expect(send).not.toHaveBeenCalled()
    expect(result).toEqual({
      outcome: 'succeeded',
      output: { onChainId: '0xalready', replayed: true },
    })
  })

  // An ambiguous send may or may not have landed. Retrying it blind could pay
  // twice, so the hash is persisted and the step fails for reconciliation.
  it('records the hash and stops when a send is ambiguous', async () => {
    const send = jest.fn(async () => ({
      reason: 'timeout',
      reconciliationRequired: true as const,
      success: false as const,
      transactionId: '0xambiguous',
    }))
    const { applyTransition, recordOnChainIdIfMissing, run } = buildHarness({ send })

    const result = await run()

    expect(recordOnChainIdIfMissing).toHaveBeenCalledWith(expect.anything(), TRANSACTION_ID, '0xambiguous')
    expect(applyTransition).not.toHaveBeenCalled()
    expect(result).toEqual(expect.objectContaining({
      error: 'crypto_send_ambiguous',
      outcome: 'failed',
    }))
  })

  it('does not settle anything when the wallet throws', async () => {
    const send = jest.fn(async () => {
      throw new Error('rpc exploded')
    })
    const { applyTransition, run } = buildHarness({ send })

    const result = await run()

    expect(applyTransition).not.toHaveBeenCalled()
    expect(result).toEqual(expect.objectContaining({
      error: 'crypto_send_indeterminate',
      outcome: 'failed',
    }))
  })

  it('schedules a retry for a retriable wallet failure within the attempt budget', async () => {
    const send = jest.fn(async () => ({
      code: 'retriable' as const,
      reason: 'congested',
      success: false as const,
    }))
    const { applyTransition, run } = buildHarness({ send })

    const result = await run()

    expect(applyTransition).not.toHaveBeenCalled()
    expect(result).toEqual(expect.objectContaining({ outcome: 'waiting' }))
  })

  it('fails the delivery for a permanent wallet rejection', async () => {
    const send = jest.fn(async () => ({
      code: 'permanent' as const,
      reason: 'destination rejected',
      success: false as const,
    }))
    const { applyTransition, run } = buildHarness({ send })

    const result = await run()

    expect(applyTransition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'payment_failed' }),
    )
    expect(result).toEqual(expect.objectContaining({ outcome: 'failed' }))
  })

  /*
   * An onramp collects the customer's money before it delivers anything, so a
   * failed delivery without this leaves them paid-up and empty-handed — which
   * is exactly what happened to the first real purchase.
   */
  it('returns the customer fiat when delivery fails for good', async () => {
    const send = jest.fn(async () => ({
      code: 'permanent' as const,
      reason: 'destination rejected',
      success: false as const,
    }))
    const { refundFiatDeposit, run } = buildHarness({ send })

    await run()

    expect(refundFiatDeposit).toHaveBeenCalledWith({
      paymentMethod: PaymentMethod.PIX,
      providerDepositId: 'dep-1',
      reason: 'delivery_failed',
      targetCurrency: TargetCurrency.BRL,
      transactionId: TRANSACTION_ID,
      trigger: 'flow_crypto_send',
    })
  })

  // A retriable failure still has attempts left; refunding here would return
  // money for a delivery that is about to be tried again.
  it('does not refund while a retry is still pending', async () => {
    const send = jest.fn(async () => ({
      code: 'retriable' as const,
      reason: 'congested',
      success: false as const,
    }))
    const { refundFiatDeposit, run } = buildHarness({ send })

    await run()

    expect(refundFiatDeposit).not.toHaveBeenCalled()
  })

  // A successful delivery must never also hand the money back.
  it('does not refund when the delivery succeeds', async () => {
    const { refundFiatDeposit, run } = buildHarness()

    await run()

    expect(refundFiatDeposit).not.toHaveBeenCalled()
  })

  /*
   * Both of these leave a customer who has paid and holds nothing. On
   * 2026-08-05 two deliveries timed out this way, were logged at ERROR, and
   * went unnoticed until someone read the logs by hand.
   */
  it('raises an alert when a delivery is left unresolved', async () => {
    const send = jest.fn(async () => ({
      reason: 'stellar_submission_timeout',
      reconciliationRequired: true as const,
      success: false as const,
      transactionId: '0xambiguous',
    }))
    const { enqueueSlack, run } = buildHarness({ send })

    await run()

    expect(enqueueSlack).toHaveBeenCalledWith(
      expect.stringContaining(TRANSACTION_ID),
      'crypto_send_alert',
    )
    expect(enqueueSlack.mock.calls[0][0]).toContain('stellar_submission_timeout')
  })

  it('raises an alert when a delivery fails for good', async () => {
    const send = jest.fn(async () => ({
      code: 'permanent' as const,
      reason: 'destination rejected',
      success: false as const,
    }))
    const { enqueueSlack, run } = buildHarness({ send })

    await run()

    expect(enqueueSlack).toHaveBeenCalledWith(expect.stringContaining(TRANSACTION_ID), 'crypto_send_alert')
  })

  // The routine "payment completed" notice goes out on the same channel, so
  // this asserts on the alert context rather than on silence.
  it('does not alert on a successful delivery', async () => {
    const { enqueueSlack, run } = buildHarness()

    await run()

    expect(enqueueSlack).not.toHaveBeenCalledWith(expect.anything(), 'crypto_send_alert')
  })

  // A page that fails must not take the delivery down with it.
  it('completes the step even when the alert cannot be sent', async () => {
    const send = jest.fn(async () => ({
      code: 'permanent' as const, reason: 'destination rejected', success: false as const,
    }))
    const harness = buildHarness({ send })
    harness.enqueueSlack.mockRejectedValue(new Error('slack down'))

    await expect(harness.run()).resolves.toEqual(expect.objectContaining({ outcome: 'failed' }))
  })

  it('fails when the transaction carries no destination address', async () => {
    const { run, send } = buildHarness({
      transaction: {
        destinationAddress: null,
        id: TRANSACTION_ID,
        onChainId: null,
        quote: {
          cryptoCurrency: CryptoCurrency.USDC,
          network: BlockchainNetwork.CELO,
          sourceAmount: 100,
        },
        status: TransactionStatus.PROCESSING_PAYMENT,
      },
    })

    const result = await run()

    expect(send).not.toHaveBeenCalled()
    expect(result).toEqual({
      error: 'Transaction has no destination address',
      outcome: 'failed',
    })
  })

  it('fails when the wallet reports success without a transaction hash', async () => {
    const send = jest.fn(async () => ({ success: true as const }))
    const { applyTransition, run } = buildHarness({ send })

    const result = await run()

    expect(applyTransition).not.toHaveBeenCalled()
    expect(result).toEqual({
      error: 'Wallet did not return an on-chain transaction id',
      outcome: 'failed',
    })
  })
})
