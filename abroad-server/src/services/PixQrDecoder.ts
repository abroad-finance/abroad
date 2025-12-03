import axios from 'axios'
import { inject, injectable } from 'inversify'

import { ILogger } from '../interfaces'
import { IPixQrDecoder, PixDecoded } from '../interfaces/IQrDecoder'
import { ISecretManager } from '../interfaces/ISecretManager'
import { TYPES } from '../types'

export interface BrCode {
  accountType: string
  bankCode: string
  description: string
  keyId: string
  nominalAmount: number
  reconciliationId: string
  reductionAmount: number
}

export interface TransferoQrResponse {
  amount: number
  brCode: BrCode
  discountAmount: number
  fineAmount: number
  id: string
  interestAmount: number
  name: string
  scheduled: null
  status: string
  taxId: string
  type: string
}

@injectable()
export class PixQrDecoder implements IPixQrDecoder {
  private cachedToken?: { exp: number, value: string }

  public constructor(
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
    @inject(TYPES.ILogger) private readonly logger: ILogger,
  ) { }

  decode = async (qrCode: string): Promise<null | PixDecoded> => {
    try {
      const token = await this.getAccessToken()

      const { TRANSFERO_ACCOUNT_ID, TRANSFERO_BASE_URL } = await this.secretManager.getSecrets([
        'TRANSFERO_ACCOUNT_ID',
        'TRANSFERO_BASE_URL',
      ])

      const { data } = await axios.post(
        `${TRANSFERO_BASE_URL}/api/v2.0/accounts/${TRANSFERO_ACCOUNT_ID}/paymentpreview`,
        {
          Id: qrCode,
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      ) as { data: TransferoQrResponse }

      const taxId = data.taxId?.includes('*') ? null : data.taxId

      return {
        account: data.brCode.keyId,
        amount: data.amount.toFixed(2),
        currency: 'BRL',
        name: data.name,
        taxId,
      }
    }
    catch (err: unknown) {
      const reason = this.describeError(err)
      this.logger.error('Transfero Pix QR decode failed', reason)
      return null
    }
  }

  /** OAuth2 client-credentials flow */
  private async getAccessToken(): Promise<string> {
    const now = Date.now()
    if (this.cachedToken && now < this.cachedToken.exp - 60_000) {
      return this.cachedToken.value
    }

    const apiUrl = await this.secretManager.getSecret('TRANSFERO_BASE_URL')
    const clientId = await this.secretManager.getSecret('TRANSFERO_CLIENT_ID')
    const clientSecret = await this.secretManager.getSecret(
      'TRANSFERO_CLIENT_SECRET',
    )
    const clientScope = await this.secretManager.getSecret('TRANSFERO_CLIENT_SCOPE')

    const { data } = await axios.post(`${apiUrl}/auth/token`, {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
      scope: clientScope,
    }, {
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    })

    const value = data.access_token ?? data
    const seconds = Number(data.expires_in ?? 900) // default 15 min
    this.cachedToken = { exp: now + seconds * 1000, value }

    return value
  }

  private describeError(err: unknown): string {
    if (axios.isAxiosError(err)) {
      const responseData = err.response?.data
      if (typeof responseData === 'string') {
        return responseData
      }

      if (responseData && typeof responseData === 'object') {
        try {
          return JSON.stringify(responseData)
        }
        catch {
          return err.message
        }
      }

      return err.message
    }

    if (err instanceof Error) {
      return err.message
    }

    if (typeof err === 'string') {
      return err
    }

    try {
      return JSON.stringify(err)
    }
    catch {
      return String(err)
    }
  }
}
