// src/services/movii.ts

import { TargetCurrency } from '@prisma/client'
import axios from 'axios'
import { inject, injectable } from 'inversify'

import { ILogger } from '../../interfaces'
import { IPaymentService } from '../../interfaces/IPaymentService'
import { ISecretManager } from '../../interfaces/ISecretManager'
import { createScopedLogger, ScopedLogger } from '../../shared/logging'
import { TYPES } from '../../types'

type MoviiBank = { bankCode: number, bankName: string }

const BANKS: MoviiBank[] = [
  { bankCode: 1565, bankName: 'Superdigital' },
  { bankCode: 1507, bankName: 'NEQUI' },
  { bankCode: 1801, bankName: 'Movii' },
  { bankCode: 1006, bankName: 'Banco Itau' },
  { bankCode: 1062, bankName: 'Banco Falabella' },
  { bankCode: 1051, bankName: 'DAVIVIENDA' },
  { bankCode: 1551, bankName: 'DAVIPLATA' },
  { bankCode: 1566, bankName: 'Banco Cooperativo Coopcentral Digital' },
  { bankCode: 1069, bankName: 'Banco Serfinanza' },
  { bankCode: 1007, bankName: 'Bancolombia' },
  { bankCode: 1063, bankName: 'BANCO FINANDINA' },
  { bankCode: 1013, bankName: 'bancobbva' },
  { bankCode: 1032, bankName: 'Banco Caja Social' },
  { bankCode: 1066, bankName: 'bancocoopcentral' },
  { bankCode: 1292, bankName: 'Confiar Cooperativa Financiera' },
  { bankCode: 1040, bankName: 'BANCO AGRARIO DE COLOMBIA' },
  { bankCode: 1059, bankName: 'Banco De Las Microfinanzas Bancamia SA' },
  { bankCode: 1816, bankName: 'Banco Crezcamos' },
  { bankCode: 1283, bankName: 'CFA Cooperativa Financiera' },
  { bankCode: 1803, bankName: 'Banco Powwi' },
]

const MOVII_TRANSFER_ENDPOINT = '/transfiya/v2/transfers'
const MOVII_SIGNERS_ENDPOINT = '/transfiya/v1/wallet'
const MOVII_POLL_INTERVAL_MS = 5_000
const MOVII_POLL_TIMEOUT_MS = 5 * 60_000
const PENDING_STATUSES = new Set(['CREATED', 'INITIATED', 'PENDING'])
const TERMINAL_SUCCESS_STATUSES = new Set(['ACCEPTED', 'COMPLETED'])

type MoviiAuthConfig = {
  baseUrl: string
  clientId: string
  clientSecret: string
}

type MoviiAuthorizedClient = MoviiCoreConfig & { token: string }

type MoviiCoreConfig = {
  apiKey: string
  baseUrl: string
  signerHandler: string
}

type MoviiErrorPayload = {
  code?: number
  message?: string
}

type MoviiLiquidityResponse = {
  body?: Array<{ saldo: string }>
  statusCode?: number
}

type MoviiSignerEntity = { bankBicfi: string, handle: string }

type MoviiSignersResponse = {
  entities?: MoviiSignerEntity[]
  error?: MoviiErrorPayload
}

type MoviiTransferEntity = { status: string }

type MoviiTransferRequest = {
  amount: string
  labels: Record<string, string>
  source: string
  symbol: string
  target: string
}

type MoviiTransferResponse = {
  error?: MoviiErrorPayload
  message?: string
  transferId?: string
}

type MoviiTransferStatusResponse = {
  entities?: MoviiTransferEntity[]
  error?: MoviiErrorPayload
}

@injectable()
export class MoviiPaymentService implements IPaymentService {
  public readonly banks = BANKS
  public readonly currency = TargetCurrency.COP
  public readonly fixedFee = 0.0

  public readonly isAsync = false
  public readonly isEnabled = true
  public readonly MAX_TOTAL_AMOUNT_PER_DAY: number = 25_000_000
  public readonly MAX_USER_AMOUNT_PER_DAY: number = 25_000_000
  public readonly MAX_USER_AMOUNT_PER_TRANSACTION: number = 5_000_000

  public readonly MAX_USER_TRANSACTIONS_PER_DAY: number = 15

  public readonly percentageFee = 0.0
  private readonly logger: ScopedLogger

  public constructor(
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'MoviiPaymentService' })
  }

  public getLiquidity: () => Promise<number> = async () => {
    try {
      const { MOVII_BALANCE_ACCOUNT_ID: accountId, MOVII_BALANCE_API_KEY: apiKey } = await this.secretManager.getSecrets([
        'MOVII_BALANCE_API_KEY',
        'MOVII_BALANCE_ACCOUNT_ID',
      ])

      const url = `https://apigw-data.movii.com.co/traguatan/?id=${encodeURIComponent(accountId)}`
      const headers = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      }

      const { data } = await axios.get<MoviiLiquidityResponse>(url, { headers })
      const saldoStr = data?.body?.[0]?.saldo
      const saldo = typeof saldoStr === 'string' ? Number.parseFloat(saldoStr) : Number.NaN
      return Number.isFinite(saldo) ? saldo : 0
    }
    catch (err) {
      this.logger.error('Error fetching Movii liquidity', err)
      return 0
    }
  }

  public onboardUser: IPaymentService['onboardUser'] = async ({ account }) => {
    try {
      const client = await this.getAuthorizedClient()

      const response = await this.postTransfer(this.buildOnboardingRequest(account, client.signerHandler), client)
      if (!this.isSuccessfulResponse(response)) {
        this.logger.error('API returned an error during onboarding', response)
        return { success: false }
      }

      this.logger.info('Onboard response received', { message: response.message })
      return {
        message: 'Onboarding started successfully, please make sure the user completes the onboarding process',
        success: true,
      }
    }
    catch (error) {
      this.logger.error('Error sending onboarding payment', error)
      return { success: false }
    }
  }

  public sendPayment: IPaymentService['sendPayment'] = async ({
    account,
    bankCode,
    value,
  }) => {
    try {
      const client = await this.getAuthorizedClient()

      const targetSigner = await this.getSignerHandle(account, bankCode, client)
      if (!targetSigner) {
        this.logger.warn('No signer found for payment', { account, bankCode })
        return { success: false }
      }

      const response = await this.postTransfer(
        this.buildTransferRequest(value, targetSigner, client.signerHandler),
        client,
      )

      if (!this.isSuccessfulTransfer(response)) {
        this.logger.error('API returned an error', response)
        return { success: false }
      }

      const transferId = response.transferId
      const finalTransaction = await this.waitForTransaction(transferId, client)
      if (TERMINAL_SUCCESS_STATUSES.has(finalTransaction.status)) {
        return { success: true, transactionId: transferId }
      }

      this.logger.warn('Transaction rejected', finalTransaction)
      return { success: false }
    }
    catch (error) {
      this.logger.error('Error sending payment', error)
      return { success: false }
    }
  }

  public async verifyAccount({ account, bankCode }: {
    account: string
    bankCode: string
  }): Promise<boolean> {
    try {
      const client = await this.getAuthorizedClient()
      const signerHandler = await this.getSignerHandle(account, bankCode, client)
      return Boolean(signerHandler)
    }
    catch (error) {
      this.logger.warn('Error verifying account', error)
      return false
    }
  }

  private buildAuthHeaders(apiKey: string, token: string): Record<string, string> {
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    }
  }

  private buildOnboardingRequest(account: string, signerHandler: string): MoviiTransferRequest {
    return {
      amount: '1000',
      labels: {
        acceptSms: 'Vincula tu cuenta banacaria con transfiya para recibir tus transferencias.',
        description: 'Send ',
        domain: 'tin',
        numberOfTransactions: '1',
        sourceChannel: 'APP',
        transactionPurpose: 'ONBOARDING',
        tx_id: '',
        type: 'SEND',
      },
      source: signerHandler,
      symbol: '$tin',
      target: `$57${account}`,
    }
  }

  private buildTransferRequest(value: number, targetSigner: string, signerHandler: string): MoviiTransferRequest {
    return {
      amount: value.toString(),
      labels: {
        description: 'Abroad transfer',
        domain: 'tin',
        numberOfTransactions: '1',
        sourceChannel: 'OTR',
        transactionPurpose: 'TRANSFER',
        tx_id: '',
        type: 'SEND',
      },
      source: signerHandler,
      symbol: '$tin',
      target: targetSigner,
    }
  }

  private async fetchTransactionStatus(
    transferId: string,
    client?: MoviiAuthorizedClient,
  ): Promise<MoviiTransferStatusResponse> {
    const resolvedClient = client ?? await this.getAuthorizedClient()
    const url = `${resolvedClient.baseUrl}${MOVII_TRANSFER_ENDPOINT}/${transferId}`
    const headers = this.buildAuthHeaders(resolvedClient.apiKey, resolvedClient.token)
    const { data } = await axios.get<MoviiTransferStatusResponse>(url, { headers })
    return data
  }

  private async getAuthConfig(): Promise<MoviiAuthConfig> {
    const {
      MOVII_BASE_URL,
      MOVII_CLIENT_ID,
      MOVII_CLIENT_SECRET,
    } = await this.secretManager.getSecrets([
      'MOVII_BASE_URL',
      'MOVII_CLIENT_ID',
      'MOVII_CLIENT_SECRET',
    ])
    return {
      baseUrl: MOVII_BASE_URL,
      clientId: MOVII_CLIENT_ID,
      clientSecret: MOVII_CLIENT_SECRET,
    }
  }

  private async getAuthorizedClient(): Promise<MoviiAuthorizedClient> {
    const [coreConfig, token] = await Promise.all([
      this.getCoreConfig(),
      this.getToken(),
    ])

    return { ...coreConfig, token }
  }

  private async getCoreConfig(): Promise<MoviiCoreConfig> {
    const {
      MOVII_API_KEY,
      MOVII_BASE_URL,
      MOVII_SIGNER_HANDLER,
    } = await this.secretManager.getSecrets([
      'MOVII_API_KEY',
      'MOVII_BASE_URL',
      'MOVII_SIGNER_HANDLER',
    ])
    return {
      apiKey: MOVII_API_KEY,
      baseUrl: MOVII_BASE_URL,
      signerHandler: MOVII_SIGNER_HANDLER,
    }
  }

  private async getSignerHandle(wallet: string, bankCode: string, client?: MoviiAuthorizedClient): Promise<null | string> {
    const parsedWallet = `$57${wallet}`
    const resolvedClient = client ?? await this.getAuthorizedClient()
    const url = `${resolvedClient.baseUrl}${MOVII_SIGNERS_ENDPOINT}/${parsedWallet}/signers`
    const response = await fetch(url, {
      headers: this.buildAuthHeaders(resolvedClient.apiKey, resolvedClient.token),
      method: 'GET',
    })
    const data = await response.json() as MoviiSignersResponse

    if (data.error && data.error.code !== 0) {
      throw new Error(data.error.message || 'Error fetching signers')
    }

    const signer = data.entities?.find(entity => entity.bankBicfi === bankCode)
    return signer ? signer.handle : null
  }

  private async getToken(): Promise<string> {
    const { baseUrl, clientId, clientSecret } = await this.getAuthConfig()

    const url = `${baseUrl}/transfiya/oauth/token`
    const params = new URLSearchParams()
    params.append('client_id', clientId)
    params.append('client_secret', clientSecret)
    params.append('grant_type', 'client_credentials')

    const { data } = await axios.post<{ access_token: string }>(url, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })
    return data.access_token
  }

  private isSuccessfulResponse(response: MoviiTransferResponse): boolean {
    return response.error?.code === 0
  }

  private isSuccessfulTransfer(response: MoviiTransferResponse): response is MoviiTransferResponse & { transferId: string } {
    return response.error?.code === 0 && typeof response.transferId === 'string' && response.transferId.length > 0
  }

  private async postTransfer(
    request: MoviiTransferRequest,
    client: MoviiAuthorizedClient,
  ): Promise<MoviiTransferResponse> {
    const url = `${client.baseUrl}${MOVII_TRANSFER_ENDPOINT}`
    const headers = this.buildAuthHeaders(client.apiKey, client.token)
    const { data } = await axios.post<MoviiTransferResponse>(url, request, { headers })
    return data
  }

  private async sleep(durationMs: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, durationMs))
  }

  private async waitForTransaction(transferId: string, client?: MoviiAuthorizedClient): Promise<MoviiTransferEntity> {
    const resolvedClient = client ?? await this.getAuthorizedClient()
    const deadline = Date.now() + MOVII_POLL_TIMEOUT_MS
    while (true) {
      try {
        const statusResponse = await this.fetchTransactionStatus(transferId, resolvedClient)
        const transaction = statusResponse.entities?.[0]
        if (transaction && !PENDING_STATUSES.has(transaction.status)) {
          this.logger.info('Transaction status updated', transaction)
          return transaction
        }
      }
      catch (error) {
        this.logger.error('Error polling transaction status', error)
      }

      if (Date.now() > deadline) {
        throw new Error('Timeout waiting for transaction to complete')
      }

      await this.sleep(MOVII_POLL_INTERVAL_MS)
    }
  }
}
