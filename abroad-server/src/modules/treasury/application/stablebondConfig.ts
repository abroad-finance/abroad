import { CryptoCurrency } from '@prisma/client'

import { TreasuryVenue } from './contracts/ITreasuryBalanceSource'

export type StablebondConfig = {
  /** Stellar asset code of the bond. */
  assetCode: string
  /** The bond's sovereign currency; yield accrues in it. */
  fiatCurrency: string
  /**
   * Stellar issuer account.
   *
   * Deliberately has no default. Etherfuse's own documentation warns that the
   * Stellar issuer differs between sandbox and production and can change, so an
   * operator has to say which issuer they mean. A wrong default here would read
   * a different asset's balance and call it our position.
   */
  issuer: string
  /**
   * The most USDC of payout capacity the position may be relied upon to raise.
   * Doubles as the feature's on switch — see `readStablebondConfig`.
   */
  jitUnwindCapUsdc: number
  /** Refuse rather than execute an unwind that would fill worse than this against NAV. */
  maxSlippageBps: number
  /** Asset the unwind sells into. USDC is the denomination the bridge float already uses. */
  receiveAsset: CryptoCurrency
  /** Etherfuse bond symbol, e.g. TESOURO. */
  symbol: string
  /** Venue whose trustline holds the position. */
  venue: TreasuryVenue
}

type StablebondConfigResult
  = | { config: StablebondConfig, enabled: true }
    | { enabled: false, reason: string }

/**
 * Slippage the unwind will tolerate against NAV before refusing, in basis points.
 *
 * 50 bps is roughly ten times the spread actually observed on the TESOURO/USDC
 * market (a 25,000-token strict-send quoted 3.6 bps below NAV on 2026-08-06), so
 * it is loose enough not to trip on ordinary movement and tight enough that a
 * genuinely dislocated book refuses instead of selling into it.
 */
const DEFAULT_MAX_SLIPPAGE_BPS = 50
const MAX_ALLOWED_SLIPPAGE_BPS = 500

/**
 * How the Stablebond position is configured, or why it is off.
 *
 * DISABLED unless `STABLEBOND_JIT_UNWIND_CAP_USDC` is set, following
 * `BRIDGE_FLOAT_CAP_USDC`: the code ships dark and the admission gate stays a
 * no-op until the position is intentionally rolled out. An unset cap is not a
 * misconfiguration, it is the default posture.
 *
 * When the cap IS set but the rest of the configuration is incomplete, the
 * feature stays off and says why. It never falls back to a partial position:
 * guessing an issuer or a symbol would point real money at the wrong asset.
 */
export function readStablebondConfig(env: NodeJS.ProcessEnv = process.env): StablebondConfigResult {
  const jitUnwindCapUsdc = readPositiveNumber(env.STABLEBOND_JIT_UNWIND_CAP_USDC)
  if (jitUnwindCapUsdc === undefined) {
    return { enabled: false, reason: 'STABLEBOND_JIT_UNWIND_CAP_USDC is not set' }
  }

  const issuer = env.STABLEBOND_ISSUER?.trim()
  if (!issuer) {
    return { enabled: false, reason: 'STABLEBOND_ISSUER is required when a JIT unwind cap is configured' }
  }

  const symbol = env.STABLEBOND_SYMBOL?.trim() || 'TESOURO'
  const requestedSlippage = readPositiveNumber(env.STABLEBOND_MAX_SLIPPAGE_BPS)
  if (requestedSlippage !== undefined && requestedSlippage > MAX_ALLOWED_SLIPPAGE_BPS) {
    return {
      enabled: false,
      reason: `STABLEBOND_MAX_SLIPPAGE_BPS exceeds the ${MAX_ALLOWED_SLIPPAGE_BPS} bps ceiling`,
    }
  }

  return {
    config: {
      assetCode: env.STABLEBOND_ASSET_CODE?.trim() || symbol,
      fiatCurrency: env.STABLEBOND_FIAT_CURRENCY?.trim() || 'BRL',
      issuer,
      jitUnwindCapUsdc,
      maxSlippageBps: requestedSlippage ?? DEFAULT_MAX_SLIPPAGE_BPS,
      receiveAsset: CryptoCurrency.USDC,
      symbol,
      venue: 'STABLEBOND_POSITION',
    },
    enabled: true,
  }
}

function readPositiveNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}
