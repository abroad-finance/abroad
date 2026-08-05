import 'reflect-metadata'
import { FlowDirection } from '@prisma/client'

import type { FlowOrchestrator } from '../../../../modules/flows/application/FlowOrchestrator'
import type { TransactionWebhookRouter } from '../../../../modules/transactions/application/TransactionWebhookRouter'
import type { OutboxDispatcher } from '../../../../platform/outbox/OutboxDispatcher'
import type { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

import { ValidationError } from '../../../../core/errors'
import { FiatDepositReceivedUseCase } from '../../../../modules/transactions/application/fiatDepositReceivedUseCase'
import { createMockLogger } from '../../../setup/mockFactories'

const TRANSACTION_ID = 'dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb'
const DEPOSIT_ID = 'dep-9001'

const message = (overrides: Record<string, unknown> = {}) => ({
  amount: 100,
  currency: 'BRL',
  endToEndId: 'E123',
  payerTaxId: '12345678901',
  provider: 'transfero',
  providerDepositId: DEPOSIT_ID,
  transactionId: TRANSACTION_ID,
  ...overrides,
})

const buildHarness = (opts?: {
  transaction?: null | Record<string, unknown>
  transitionApplied?: boolean
}) => {
  const transaction = opts?.transaction === undefined
    ? {
        id: TRANSACTION_ID,
        pixDepositId: DEPOSIT_ID,
        quote: {
          direction: FlowDirection.FIAT_TO_CRYPTO,
          targetAmount: 100,
        },
        taxId: '12345678901',
      }
    : opts.transaction

  const prisma = {
    transaction: { findUnique: jest.fn(async () => transaction) },
    transactionTransition: { findUnique: jest.fn(async () => null) },
  }

  const applyFiatDepositReceived = jest.fn(async () => ({
    transaction: { id: TRANSACTION_ID, partnerUser: { partner: {} }, quote: {} },
    transitionApplied: opts?.transitionApplied ?? true,
  }))

  const orchestrator = { startFlow: jest.fn(async () => undefined) } as unknown as FlowOrchestrator

  const useCase = new FiatDepositReceivedUseCase(
    { getClient: jest.fn(async () => prisma) } as unknown as IDatabaseClientProvider,
    orchestrator,
    { enqueueQueue: jest.fn(), enqueueWebhook: jest.fn() } as unknown as OutboxDispatcher,
    {
      enqueueTargets: jest.fn(async () => undefined),
      resolveTargets: jest.fn(async () => []),
    } as unknown as TransactionWebhookRouter,
    createMockLogger(),
  )

  // The repository is constructed internally; swap its transition method so the
  // test asserts on the decision, not on Prisma mechanics.
  Object.assign(
    (useCase as unknown as { repository: { applyFiatDepositReceived: unknown } }).repository,
    { applyFiatDepositReceived },
  )

  return { applyFiatDepositReceived, orchestrator, prisma, useCase }
}

describe('FiatDepositReceivedUseCase', () => {
  it('starts the delivery flow once the PIX has credited', async () => {
    const { applyFiatDepositReceived, orchestrator, useCase } = buildHarness()

    await useCase.process(message())

    expect(applyFiatDepositReceived).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        idempotencyKey: `flow:fiat-deposit:${DEPOSIT_ID}`,
        providerDepositId: DEPOSIT_ID,
        transactionId: TRANSACTION_ID,
      }),
    )
    expect(orchestrator.startFlow).toHaveBeenCalledWith(TRANSACTION_ID)
  })

  it('rejects a message that does not match the queue contract', async () => {
    const { useCase } = buildHarness()

    await expect(useCase.process({ transactionId: 'nope' })).rejects.toThrow(ValidationError)
  })

  // Anyone may fund the PIX: the payer does not have to be the person
  // receiving the crypto, so a different tax id is not a reason to withhold it.
  it('delivers when the payer tax id differs from the one on the transaction', async () => {
    const { orchestrator, useCase } = buildHarness()

    await useCase.process(message({ payerTaxId: '99999999999' }))

    expect(orchestrator.startFlow).toHaveBeenCalledWith(TRANSACTION_ID)
  })

  it('delivers when the deposit carries no payer tax id at all', async () => {
    const { orchestrator, useCase } = buildHarness()

    await useCase.process(message({ payerTaxId: null }))

    expect(orchestrator.startFlow).toHaveBeenCalledWith(TRANSACTION_ID)
  })

  it('delivers when the transaction never captured a tax id', async () => {
    const { orchestrator, useCase } = buildHarness({
      transaction: {
        id: TRANSACTION_ID,
        pixDepositId: DEPOSIT_ID,
        quote: { direction: FlowDirection.FIAT_TO_CRYPTO, targetAmount: 100 },
        taxId: null,
      },
    })

    await useCase.process(message({ payerTaxId: '99999999999' }))

    expect(orchestrator.startFlow).toHaveBeenCalledWith(TRANSACTION_ID)
  })

  // Still recorded for reconciliation, just never used as a gate.
  it('records whatever payer tax id the deposit carried', async () => {
    const { applyFiatDepositReceived, useCase } = buildHarness()

    await useCase.process(message({ payerTaxId: '99999999999' }))

    expect(applyFiatDepositReceived).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ payerTaxId: '99999999999' }),
    )
  })

  it('does not deliver when the credited amount is below the quote', async () => {
    const { orchestrator, useCase } = buildHarness()

    await useCase.process(message({ amount: 99.5 }))

    expect(orchestrator.startFlow).not.toHaveBeenCalled()
  })

  it('tolerates sub-cent float noise on the credited amount', async () => {
    const { orchestrator, useCase } = buildHarness()

    await useCase.process(message({ amount: 99.999 }))

    expect(orchestrator.startFlow).toHaveBeenCalled()
  })

  it('delivers when the customer overpaid', async () => {
    const { orchestrator, useCase } = buildHarness()

    await useCase.process(message({ amount: 150 }))

    expect(orchestrator.startFlow).toHaveBeenCalled()
  })

  // A replayed provider delivery must not start a second delivery flow.
  it('does not restart the flow when the deposit was already applied', async () => {
    const { orchestrator, useCase } = buildHarness({ transitionApplied: false })

    await useCase.process(message())

    expect(orchestrator.startFlow).not.toHaveBeenCalled()
  })

  it('ignores a credit against a transaction we do not know', async () => {
    const { applyFiatDepositReceived, orchestrator, useCase } = buildHarness({ transaction: null })

    await useCase.process(message())

    expect(applyFiatDepositReceived).not.toHaveBeenCalled()
    expect(orchestrator.startFlow).not.toHaveBeenCalled()
  })

  it('ignores a credit against a payout transaction', async () => {
    const { orchestrator, useCase } = buildHarness({
      transaction: {
        id: TRANSACTION_ID,
        pixDepositId: null,
        quote: { direction: FlowDirection.CRYPTO_TO_FIAT, targetAmount: 100 },
        taxId: '12345678901',
      },
    })

    await useCase.process(message())

    expect(orchestrator.startFlow).not.toHaveBeenCalled()
  })

  // The deposit opened for this transaction is the only one that may credit it.
  it('ignores a deposit id that is not the one opened for the transaction', async () => {
    const { orchestrator, useCase } = buildHarness()

    await useCase.process(message({ providerDepositId: 'dep-other' }))

    expect(orchestrator.startFlow).not.toHaveBeenCalled()
  })
})
