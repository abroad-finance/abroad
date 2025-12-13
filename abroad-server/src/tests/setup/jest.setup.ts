const shouldSilenceConsole = process.env.SHOW_TEST_LOGS !== 'true'

type ConsoleMethod = 'error' | 'log' | 'warn'

const attachConsoleSpy = (method: ConsoleMethod): jest.SpyInstance<void, unknown[]> => {
  const spy = jest.spyOn(console, method)
  if (shouldSilenceConsole) {
    spy.mockImplementation(() => {})
  }
  return spy
}

const consoleSpies: Record<ConsoleMethod, jest.SpyInstance<void, unknown[]>> = {
  error: attachConsoleSpy('error'),
  log: attachConsoleSpy('log'),
  warn: attachConsoleSpy('warn'),
}

beforeEach(() => {
  Object.values(consoleSpies).forEach((spy) => {
    spy.mockClear()
  })
})

afterAll(() => {
  Object.values(consoleSpies).forEach((spy) => {
    spy.mockRestore()
  })
})

describe('jest setup utilities', () => {
  it('silences console output when configured', () => {
    expect(consoleSpies.error).toBeDefined()
    expect(consoleSpies.log).toBeDefined()
    expect(consoleSpies.warn).toBeDefined()
  })
})
