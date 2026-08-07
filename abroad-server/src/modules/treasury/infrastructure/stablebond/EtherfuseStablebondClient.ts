import { Prisma } from '@prisma/client'
import { inject, injectable } from 'inversify'
import { z } from 'zod'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { IStablebondOracle, StablebondValuation } from '../../application/contracts/IStablebondOracle'

const DEFAULT_BASE_URL = 'https://api.etherfuse.com'
const REQUEST_TIMEOUT_MS = 8_000

/**
 * Etherfuse publishes every amount as a base-10 decimal string. Parsing these
 * through `Number` would quietly lose precision on a value that ends up in a
 * ledger, so the wire type is a string and it stays one until `Prisma.Decimal`
 * takes it.
 */
const decimalStringSchema = z.string().regex(
  /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/,
  'Expected a base-10 decimal string',
)

/**
 * `GET /lookup/bonds/cost/{symbol}`.
 *
 * Passthrough is deliberate: the endpoint carries per-source FX breakdowns that
 * change shape as Etherfuse adds providers, and a strict schema would start
 * failing on a field we do not read.
 */
const bondCostSchema = z.object({
  bond_cost_in_fiat: decimalStringSchema,
  bond_cost_in_usd: decimalStringSchema,
  bond_symbol: z.string().min(1),
  currency: z.string().min(1),
  current_basis_points: z.number().int().nonnegative(),
  current_time: z.string().min(1),
}).passthrough()

/**
 * Net asset value and yield for an Etherfuse Stablebond, read from their public
 * lookup API.
 *
 * This endpoint needs no API key and no account, which is the point: the
 * position's valuation cannot be gated by a credential anyone could withhold.
 * Etherfuse's authenticated `/ramp/*` swap endpoints are the documented second
 * route and are deliberately not used here — see EVENT.md.
 *
 * Reads only. Nothing in this client can move a token.
 */
@injectable()
export class EtherfuseStablebondClient implements IStablebondOracle {
  private readonly baseUrl: string
  private readonly logger: ScopedLogger

  constructor(@inject(TYPES.ILogger) baseLogger: ILogger) {
    this.logger = createScopedLogger(baseLogger, { scope: 'EtherfuseStablebond' })
    this.baseUrl = this.readBaseUrl()
  }

  public async getValuation(symbol: string): Promise<StablebondValuation> {
    const payload = await this.get(`/lookup/bonds/cost/${encodeURIComponent(symbol)}`)
    const parsed = bondCostSchema.safeParse(payload)
    if (!parsed.success) {
      // A shape we do not recognise is not a valuation. Refusing here is what
      // stops a malformed response from becoming a zero NAV downstream.
      this.logger.error('Etherfuse returned an unrecognised bond cost payload', {
        issues: parsed.error.issues.map(issue => issue.path.join('.')).slice(0, 5),
        symbol,
      })
      throw new Error(`Etherfuse bond cost response for ${symbol} did not match the expected shape`)
    }

    const observedAt = new Date(parsed.data.current_time)
    if (Number.isNaN(observedAt.getTime())) {
      throw new Error(`Etherfuse bond cost response for ${symbol} carried an unparseable timestamp`)
    }

    const navFiat = new Prisma.Decimal(parsed.data.bond_cost_in_fiat)
    const navUsd = new Prisma.Decimal(parsed.data.bond_cost_in_usd)
    if (navFiat.lessThanOrEqualTo(0) || navUsd.lessThanOrEqualTo(0)) {
      throw new Error(`Etherfuse quoted a non-positive NAV for ${symbol}`)
    }

    return {
      annualYieldBps: parsed.data.current_basis_points,
      fiatCurrency: parsed.data.currency,
      navFiat,
      navUsd,
      observedAt,
      symbol: parsed.data.bond_symbol,
    }
  }

  private async get(path: string): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      })
      if (!response.ok) {
        throw new Error(`Etherfuse lookup responded ${response.status}`)
      }
      return await response.json()
    }
    finally {
      clearTimeout(timer)
    }
  }

  /**
   * The lookup host. Overridable so a test or a staging environment can point
   * elsewhere, but only over https — this response sets the price at which real
   * money is valued, and a plaintext hop would let it be rewritten.
   */
  private readBaseUrl(): string {
    const raw = process.env.ETHERFUSE_API_BASE_URL?.trim()
    if (!raw) return DEFAULT_BASE_URL
    let parsed: URL
    try {
      parsed = new URL(raw)
    }
    catch {
      this.logger.warn('ETHERFUSE_API_BASE_URL is not a valid URL; using the default host')
      return DEFAULT_BASE_URL
    }
    if (parsed.protocol !== 'https:') {
      this.logger.warn('ETHERFUSE_API_BASE_URL must be https; using the default host')
      return DEFAULT_BASE_URL
    }
    return raw.replace(/\/+$/, '')
  }
}
