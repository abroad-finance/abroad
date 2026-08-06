import { BlockchainNetwork, CryptoCurrency } from '@prisma/client'

import { StellarConfidentialListener } from '../../../../../modules/treasury/interfaces/listeners/StellarConfidentialListener'
import { QueueName } from '../../../../../platform/messaging/queues'

type FakeRpcServer = {
  getEvents: jest.Mock
  getLatestLedger: jest.Mock
}

let currentRpcServer: FakeRpcServer

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk')
  return {
    ...actual,
    rpc: { ...actual.rpc, Server: jest.fn(() => currentRpcServer) },
  }
})

const CONTRACT = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWXH'
const TRANSACTION_ID = '3f2b1a90-8c4d-4e21-9b77-5a1c2d3e4f50'

const queueMessage = {
  addressFrom: 'sender',
  amount: 12.5,
  blockchain: BlockchainNetwork.STELLAR,
  cryptoCurrency: CryptoCurrency.USDC,
  onChainId: 'tx-1',
  transactionId: TRANSACTION_ID,
}

const buildListener = (overrides: { contracts?: string[] } = {}) => {
  const listenerState = {
    findUnique: jest.fn(async () => null as null | { lastCursor: string }),
    upsert: jest.fn(async () => undefined),
  }
  const outboxDispatcher = { enqueueQueue: jest.fn(async () => undefined) }
  const verifier = {
    resolveTransactionId: jest.fn(async () => TRANSACTION_ID as null | string),
    verifyNotification: jest.fn(async () => ({ outcome: 'ok', queueMessage })),
  }
  const assetConfigService = {
    listEnabledConfidentialContracts: jest.fn(async () => overrides.contracts ?? [CONTRACT]),
  }
  const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }

  const listener = new StellarConfidentialListener(
    outboxDispatcher as never,
    { getSecret: jest.fn(async () => 'https://soroban.test') } as never,
    { getClient: jest.fn(async () => ({ stellarConfidentialListenerState: listenerState })) } as never,
    verifier as never,
    assetConfigService as never,
    logger as never,
  )

  return { listener, listenerState, logger, outboxDispatcher, verifier }
}

const setEvents = (events: Array<{ txHash: string }>, cursor = 'cursor-1') => {
  currentRpcServer = {
    getEvents: jest.fn(async () => ({ cursor, events, latestLedger: 100 })),
    getLatestLedger: jest.fn(async () => ({ sequence: 42 })),
  }
}

describe('StellarConfidentialListener', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    setEvents([{ txHash: 'tx-1' }])
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('stays idle when no confidential asset is enabled', async () => {
    const { listener, logger, outboxDispatcher } = buildListener({ contracts: [] })

    await listener.start()

    expect(currentRpcServer.getEvents).not.toHaveBeenCalled()
    expect(outboxDispatcher.enqueueQueue).not.toHaveBeenCalled()
    expect(logger.info).toHaveBeenCalledWith(
      '[StellarConfidentialListener] No confidential assets enabled; listener idle',
      { context: { queue: QueueName.RECEIVED_CRYPTO_TRANSACTION } },
    )
    listener.stop()
  })

  it('enqueues a verified deposit through the outbox', async () => {
    const { listener, outboxDispatcher, verifier } = buildListener()

    await listener.start()
    listener.stop()

    expect(verifier.verifyNotification).toHaveBeenCalledWith('tx-1', TRANSACTION_ID)
    expect(outboxDispatcher.enqueueQueue).toHaveBeenCalledWith(
      QueueName.RECEIVED_CRYPTO_TRANSACTION,
      queueMessage,
      'stellar.confidential.listener',
      { deliverNow: true },
    )
  })

  it('starts from the current ledger when it has no cursor, then pages by cursor', async () => {
    const { listener, listenerState } = buildListener()

    await listener.start()
    expect(currentRpcServer.getEvents).toHaveBeenCalledWith(expect.objectContaining({ startLedger: 42 }))
    expect(listenerState.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { lastCursor: 'cursor-1' },
    }))

    listenerState.findUnique.mockResolvedValue({ lastCursor: 'cursor-1' })
    await jest.advanceTimersByTimeAsync(10_000)
    listener.stop()

    expect(currentRpcServer.getEvents).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'cursor-1' }))
  })

  it('asks for each transaction once even when a transaction emits several events', async () => {
    setEvents([{ txHash: 'tx-1' }, { txHash: 'tx-1' }, { txHash: 'tx-2' }])
    const { listener, verifier } = buildListener()

    await listener.start()
    listener.stop()

    expect(verifier.resolveTransactionId).toHaveBeenCalledTimes(2)
  })

  it('skips an event that carries no Abroad reference', async () => {
    const { listener, outboxDispatcher, verifier } = buildListener()
    verifier.resolveTransactionId.mockResolvedValueOnce(null)

    await listener.start()
    listener.stop()

    expect(verifier.verifyNotification).not.toHaveBeenCalled()
    expect(outboxDispatcher.enqueueQueue).not.toHaveBeenCalled()
  })

  it('advances past a transfer the verifier refuses', async () => {
    const { listener, listenerState, outboxDispatcher, verifier } = buildListener()
    verifier.verifyNotification.mockResolvedValueOnce({
      outcome: 'error',
      reason: 'Disclosed amount does not match the on-chain commitment',
      status: 400,
    } as never)

    await listener.start()
    listener.stop()

    expect(outboxDispatcher.enqueueQueue).not.toHaveBeenCalled()
    // A rejected deposit is a decided outcome, so the cursor still moves on.
    expect(listenerState.upsert).toHaveBeenCalled()
  })

  it('leaves the cursor untouched when the page fails, so the page is retried', async () => {
    const { listener, listenerState } = buildListener()
    currentRpcServer.getEvents.mockRejectedValueOnce(new Error('rpc down'))

    await listener.start()
    listener.stop()

    expect(listenerState.upsert).not.toHaveBeenCalled()
  })

  it('leaves the cursor untouched when enqueueing fails mid-page', async () => {
    // Re-delivery is safe: the deposit journal is keyed on the on-chain id.
    const { listener, listenerState, outboxDispatcher } = buildListener()
    outboxDispatcher.enqueueQueue.mockRejectedValueOnce(new Error('outbox down'))

    await listener.start()
    listener.stop()

    expect(listenerState.upsert).not.toHaveBeenCalled()
  })

  it('does not overlap two polls', async () => {
    const { listener } = buildListener()
    let release: () => void = () => undefined
    currentRpcServer.getEvents.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return { cursor: 'cursor-1', events: [], latestLedger: 100 }
    })

    const started = listener.start()
    await jest.advanceTimersByTimeAsync(30_000)
    expect(currentRpcServer.getEvents).toHaveBeenCalledTimes(1)

    release()
    await started
    listener.stop()
  })

  it('stops polling once stopped', async () => {
    const { listener } = buildListener()

    await listener.start()
    listener.stop()
    await jest.advanceTimersByTimeAsync(60_000)

    expect(currentRpcServer.getEvents).toHaveBeenCalledTimes(1)
  })
})
