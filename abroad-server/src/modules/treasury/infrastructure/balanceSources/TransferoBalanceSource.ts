import axios from 'axios'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { ISecretManager } from '../../../../platform/secrets/ISecretManager'
import { ITreasuryBalanceSource, TreasuryBalance } from '../../application/contracts/ITreasuryBalanceSource'

type TransferoAccount = {
  accountId?: string
  currency?: string
  depositAddress?: null | Record<string, string>
}

type TransferoBalancePayload = {
  balance?: {
    amount?: number | string
    currency?: string
  }
}

const REQUEST_TIMEOUT_MS = 8_000

/**
 * Balances of every Transfero account: the BRL payment account plus the
 * per-currency crypto deposit accounts (the same set TransferoCallbackRegistrar
 * enumerates). One entry per account so the dashboard can tell the BRL float
 * apart from USDC/USDT sitting at Transfero awaiting conversion.
 */
@injectable()
export class TransferoBalanceSource implements ITreasuryBalanceSource {
  public readonly venue = 'TRANSFERO' as const
  private cachedToken?: { exp: number, value: string }
  private readonly logger: ScopedLogger

  constructor(
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'TransferoBalanceSource' })
  }

  public async getBalances(): Promise<TreasuryBalance[]> {
    const [token, baseUrl] = await Promise.all([
      this.getAccessToken(),
      this.secretManager.getSecret('TRANSFERO_BASE_URL'),
    ])
    const headers = { Accept: 'application/json', Authorization: `Bearer ${token}` }

    const { data: accounts } = await axios.get<TransferoAccount[]>(
      `${baseUrl}/api/v2.0/accounts`,
      { headers, timeout: REQUEST_TIMEOUT_MS },
    )

    if (!Array.isArray(accounts)) {
      // A silent [] here would render the venue as "no balances" instead of
      // "errored" — throw so the aggregator surfaces the failure.
      throw new Error('Transfero /accounts returned a non-array payload')
    }

    const usable = accounts
      .filter((account): account is TransferoAccount & { accountId: string } =>
        typeof account.accountId === 'string' && account.accountId.length > 0)

    // Deliberately atomic: if any account read fails the whole venue errors.
    // Per-account isolation would let captureSnapshot persist a partial venue
    // sum, which charts as a fake balance dip in the history series.
    const balances = await Promise.all(usable.map(async (account): Promise<null | TreasuryBalance> => {
      const { data } = await axios.get<TransferoBalancePayload>(
        `${baseUrl}/api/v2.0/accounts/${account.accountId}/balance`,
        { headers, timeout: REQUEST_TIMEOUT_MS },
      )
      const amount = this.parseAmount(data?.balance?.amount)
      const currency = (data?.balance?.currency ?? account.currency ?? '').toUpperCase()
      if (amount === null || !currency) {
        this.logger.warn('Transfero balance payload unusable; skipping account', {
          accountId: account.accountId,
          currency,
        })
        return null
      }
      return {
        account: account.accountId,
        amount,
        currency,
        venue: this.venue,
      }
    }))

    return balances.filter((balance): balance is TreasuryBalance => balance !== null)
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now()
    if (this.cachedToken && now < this.cachedToken.exp - 60_000) {
      return this.cachedToken.value
    }

    const {
      TRANSFERO_BASE_URL,
      TRANSFERO_CLIENT_ID,
      TRANSFERO_CLIENT_SCOPE,
      TRANSFERO_CLIENT_SECRET,
    } = await this.secretManager.getSecrets([
      'TRANSFERO_BASE_URL',
      'TRANSFERO_CLIENT_ID',
      'TRANSFERO_CLIENT_SECRET',
      'TRANSFERO_CLIENT_SCOPE',
    ])

    const { data } = await axios.post(`${TRANSFERO_BASE_URL}/auth/token`, {
      client_id: TRANSFERO_CLIENT_ID,
      client_secret: TRANSFERO_CLIENT_SECRET,
      grant_type: 'client_credentials',
      scope: TRANSFERO_CLIENT_SCOPE,
    }, {
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    })

    const value = data.access_token ?? data
    const seconds = Number(data.expires_in ?? 900)
    this.cachedToken = { exp: now + seconds * 1000, value }

    return value
  }

  private parseAmount(raw: number | string | undefined): null | number {
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw
    if (typeof raw === 'string') {
      const direct = Number(raw.trim())
      if (Number.isFinite(direct)) return direct
      const normalised = Number(raw.trim().replace(/\./g, '').replace(',', '.'))
      if (Number.isFinite(normalised)) return normalised
    }
    return null
  }
}
