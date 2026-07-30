import { AwaitExchangeBalanceStepExecutor } from '../../../../../modules/flows/application/steps/AwaitExchangeBalanceStepExecutor'

describe('AwaitExchangeBalanceStepExecutor', () => {
  const runtime = { context: {} } as never

  it('requires the venue identity instead of silently defaulting to Binance', async () => {
    const executor = new AwaitExchangeBalanceStepExecutor()

    const result = await executor.execute({
      config: {},
      runtime,
      stepOrder: 1,
    })

    expect(result.outcome).toBe('failed')
  })

  it('correlates only the explicitly configured venue', async () => {
    const executor = new AwaitExchangeBalanceStepExecutor()

    await expect(executor.execute({
      config: { provider: 'binance' },
      runtime,
      stepOrder: 1,
    })).resolves.toEqual({
      correlation: { provider: 'binance' },
      outcome: 'waiting',
      output: { provider: 'binance' },
    })

    await expect(executor.handleSignal({
      config: { provider: 'binance' },
      runtime,
      signal: {
        correlationKeys: { provider: 'transfero' },
        eventType: 'EXCHANGE_BALANCE_UPDATED',
        payload: {},
      },
      stepOrder: 1,
    })).resolves.toEqual({
      correlation: { provider: 'binance' },
      outcome: 'waiting',
    })
  })
})
