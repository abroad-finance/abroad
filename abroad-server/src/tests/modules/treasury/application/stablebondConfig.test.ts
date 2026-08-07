import { readStablebondConfig } from '../../../../modules/treasury/application/stablebondConfig'

const ISSUER = 'GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC'

describe('readStablebondConfig', () => {
  // The ship-dark contract. Every other suite in the repo depends on this
  // returning disabled by default, because that is what keeps the admission
  // gate a no-op until the position is intentionally rolled out.
  it('is disabled when no JIT unwind cap is configured', () => {
    expect(readStablebondConfig({})).toEqual({
      enabled: false,
      reason: 'STABLEBOND_JIT_UNWIND_CAP_USDC is not set',
    })
  })

  it('is disabled when the cap is not a positive number', () => {
    expect(readStablebondConfig({ STABLEBOND_JIT_UNWIND_CAP_USDC: '0' }).enabled).toBe(false)
    expect(readStablebondConfig({ STABLEBOND_JIT_UNWIND_CAP_USDC: '-5' }).enabled).toBe(false)
    expect(readStablebondConfig({ STABLEBOND_JIT_UNWIND_CAP_USDC: 'lots' }).enabled).toBe(false)
  })

  // Etherfuse warns that the Stellar issuer differs between sandbox and
  // production and can change. Defaulting it would point real money at whatever
  // asset happened to share the code.
  it('refuses to guess an issuer, even with a cap configured', () => {
    expect(readStablebondConfig({ STABLEBOND_JIT_UNWIND_CAP_USDC: '5000' })).toEqual({
      enabled: false,
      reason: 'STABLEBOND_ISSUER is required when a JIT unwind cap is configured',
    })
  })

  it('enables with TESOURO/BRL defaults once the cap and issuer are set', () => {
    const result = readStablebondConfig({
      STABLEBOND_ISSUER: ISSUER,
      STABLEBOND_JIT_UNWIND_CAP_USDC: '5000',
    })

    expect(result).toEqual({
      config: {
        assetCode: 'TESOURO',
        fiatCurrency: 'BRL',
        issuer: ISSUER,
        jitUnwindCapUsdc: 5000,
        maxSlippageBps: 50,
        receiveAsset: 'USDC',
        symbol: 'TESOURO',
        venue: 'STABLEBOND_POSITION',
      },
      enabled: true,
    })
  })

  it('lets another Stablebond in the line be configured without code changes', () => {
    const result = readStablebondConfig({
      STABLEBOND_FIAT_CURRENCY: 'MXN',
      STABLEBOND_ISSUER: ISSUER,
      STABLEBOND_JIT_UNWIND_CAP_USDC: '1000',
      STABLEBOND_SYMBOL: 'CETES',
    })

    expect(result.enabled && result.config).toEqual(expect.objectContaining({
      assetCode: 'CETES',
      fiatCurrency: 'MXN',
      symbol: 'CETES',
    }))
  })

  it('refuses a slippage tolerance beyond the hard ceiling instead of clamping it', () => {
    const result = readStablebondConfig({
      STABLEBOND_ISSUER: ISSUER,
      STABLEBOND_JIT_UNWIND_CAP_USDC: '5000',
      STABLEBOND_MAX_SLIPPAGE_BPS: '501',
    })

    // Silently clamping would let a typo look like it took effect.
    expect(result).toEqual({
      enabled: false,
      reason: 'STABLEBOND_MAX_SLIPPAGE_BPS exceeds the 500 bps ceiling',
    })
  })

  it('accepts a tighter slippage tolerance', () => {
    const result = readStablebondConfig({
      STABLEBOND_ISSUER: ISSUER,
      STABLEBOND_JIT_UNWIND_CAP_USDC: '5000',
      STABLEBOND_MAX_SLIPPAGE_BPS: '10',
    })

    expect(result.enabled && result.config.maxSlippageBps).toBe(10)
  })

  it('ignores a blank issuer rather than treating whitespace as configured', () => {
    expect(readStablebondConfig({
      STABLEBOND_ISSUER: '   ',
      STABLEBOND_JIT_UNWIND_CAP_USDC: '5000',
    }).enabled).toBe(false)
  })
})
