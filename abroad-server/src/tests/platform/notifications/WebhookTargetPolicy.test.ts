import { promises as dns } from 'node:dns'

import { WebhookTargetPolicy, WebhookTargetValidationError } from '../../../platform/notifications/WebhookTargetPolicy'

jest.mock('node:dns', () => ({
  promises: { lookup: jest.fn() },
}))

type LookupResult = Array<{ address: string, family: 4 | 6 }>

const lookup = dns.lookup as unknown as jest.Mock<Promise<LookupResult>, [string, unknown]>

describe('WebhookTargetPolicy', () => {
  const policy = new WebhookTargetPolicy()

  beforeEach(() => {
    jest.clearAllMocks()
    lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  })

  it('canonicalizes a resolvable HTTPS target and creates a non-keepalive pinned agent', async () => {
    const result = await policy.validate(' HTTPS://Hooks.Example.COM./events?source=portal ')

    expect(result.url).toBe('https://hooks.example.com/events?source=portal')
    expect(lookup).toHaveBeenCalledWith('hooks.example.com', { all: true, verbatim: true })
    expect(result.httpsAgent.options.keepAlive).toBe(false)
    result.httpsAgent.destroy()
  })

  it.each([
    ['http://hooks.example.com/events', 'HTTPS'],
    ['https://user:password@hooks.example.com/events', 'HTTPS'],
    ['https://hooks.example.com/events#fragment', 'HTTPS'],
    ['https://localhost/events', 'public address'],
    ['https://service.internal/events', 'public address'],
    ['https://service.local/events', 'public address'],
  ])('rejects unsafe URL %s', async (target, message) => {
    await expect(policy.validate(target)).rejects.toThrow(message)
    expect(lookup).not.toHaveBeenCalled()
  })

  it.each([
    'https://127.0.0.1/events',
    'https://10.20.30.40/events',
    'https://169.254.169.254/latest/meta-data',
    'https://192.168.1.10/events',
    'https://[::1]/events',
    'https://[fc00::1]/events',
    'https://[::ffff:127.0.0.1]/events',
  ])('rejects blocked literal address %s', async (target) => {
    await expect(policy.validate(target)).rejects.toThrow(
      new WebhookTargetValidationError('Webhook URL must resolve only to public addresses'),
    )
    expect(lookup).not.toHaveBeenCalled()
  })

  it('rejects DNS answers if any resolved address is non-public', async () => {
    lookup.mockResolvedValueOnce([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ])

    await expect(policy.validate('https://hooks.example.com/events')).rejects.toThrow(
      'Webhook URL must resolve only to public addresses',
    )
  })

  it('maps DNS errors and empty answers to bounded validation failures', async () => {
    lookup.mockRejectedValueOnce(new Error('resolver details'))
    await expect(policy.validate('https://hooks.example.com/events')).rejects.toThrow(
      'Webhook URL could not be resolved',
    )

    lookup.mockResolvedValueOnce([])
    await expect(policy.validate('https://hooks.example.com/events')).rejects.toThrow(
      'Webhook URL must resolve only to public addresses',
    )
  })
})
