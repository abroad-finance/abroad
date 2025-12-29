import { OutboxDispatcher } from '../../../src/platform/outbox/OutboxDispatcher'
import { OutboxRecord } from '../../../src/platform/outbox/OutboxRepository'

describe('OutboxDispatcher', () => {
  const baseRecord: OutboxRecord = {
    attempts: 0,
    availableAt: new Date(),
    createdAt: new Date(),
    id: 'rec-1',
    lastError: null,
    payload: { kind: 'slack', message: 'hello' },
    status: 'PENDING',
    type: 'slack',
    updatedAt: new Date(),
  }

  const buildMocks = () => {
    const repository = {
      create: jest.fn(async () => baseRecord),
      markDelivered: jest.fn(async () => {}),
      markFailed: jest.fn(async () => {}),
      nextBatch: jest.fn(async () => [baseRecord]),
      reschedule: jest.fn(async () => {}),
    }
    const slackNotifier = { sendMessage: jest.fn(async () => {}) }
    const webhookNotifier = { notifyWebhook: jest.fn(async () => {}) }
    const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
    const dispatcher = new OutboxDispatcher(repository as never, webhookNotifier as never, slackNotifier as never, logger as never)
    return { dispatcher, logger, repository, slackNotifier, webhookNotifier }
  }

  it('delivers slack messages immediately', async () => {
    const { dispatcher, repository, slackNotifier } = buildMocks()
    await dispatcher.enqueueSlack('hello', 'test')
    expect(repository.create).toHaveBeenCalledWith('slack', { kind: 'slack', message: 'hello' })
    expect(slackNotifier.sendMessage).toHaveBeenCalledWith('hello')
    expect(repository.markDelivered).toHaveBeenCalledWith(baseRecord.id)
  })

  it('delivers webhook payloads', async () => {
    const { dispatcher, repository, webhookNotifier } = buildMocks()
    await dispatcher.enqueueWebhook('https://example.com', { data: { ok: true }, event: 'TRANSACTION_CREATED' as never }, 'ctx')
    expect(repository.create).toHaveBeenCalledWith('webhook', {
      kind: 'webhook',
      payload: { data: { ok: true }, event: 'TRANSACTION_CREATED' },
      target: 'https://example.com',
    })
    expect(webhookNotifier.notifyWebhook).toHaveBeenCalledWith('https://example.com', {
      data: { ok: true },
      event: 'TRANSACTION_CREATED',
    })
  })
})
