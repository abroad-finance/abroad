// src/services/movii.ts

import { TargetCurrency } from '@prisma/client'
import axios from 'axios'
import { inject } from 'inversify'

import { IPaymentService } from '../../interfaces/IPaymentService'
import { ISecretManager } from '../../interfaces/ISecretManager'
import { TYPES } from '../../types'

const banks = [
  { bankCode: 1565, bankName: 'Superdigital', routerReference: '$superdigital_prd' },
  { bankCode: 1507, bankName: 'NEQUI', routerReference: '$nequi' },
  { bankCode: 1801, bankName: 'Movii', routerReference: '$movii' },
  { bankCode: 1006, bankName: 'Banco Itau', routerReference: '$itauproduccion' },
  { bankCode: 1062, bankName: 'Banco Falabella', routerReference: '$falabella_prd' },
  { bankCode: 1051, bankName: 'DAVIVIENDA', routerReference: '$daviviendaprd' },
  { bankCode: 1551, bankName: 'DAVIPLATA', routerReference: '$daviplataprd' },
  { bankCode: 1566, bankName: 'Banco Cooperativo Coopcentral Digital', routerReference: '$coopcentralbdigital' },
  { bankCode: 1069, bankName: 'Banco Serfinanza', routerReference: '$bancoserfinanza' },
  { bankCode: 1007, bankName: 'Bancolombia', routerReference: '$bancolombia' },
  { bankCode: 1063, bankName: 'BANCO FINANDINA', routerReference: '$bancofinandina' },
  { bankCode: 1013, bankName: 'bancobbva', routerReference: '$bancobbva' },
  { bankCode: 1032, bankName: 'Banco Caja Social', routerReference: '$bancocajasocial' },
  { bankCode: 1066, bankName: 'bancocoopcentral', routerReference: '$bancocoopcentral' },
  { bankCode: 1292, bankName: 'Confiar Cooperativa Financiera', routerReference: '$confiarcoopprd' },
  { bankCode: 1040, bankName: 'BANCO AGRARIO DE COLOMBIA', routerReference: '$bancoagrario' },
  { bankCode: 1059, bankName: 'Banco De Las Microfinanzas Bancamia SA', routerReference: '$bancamia' },
  { bankCode: 1816, bankName: 'Banco Crezcamos', routerReference: '$crezcamos' },
  { bankCode: 1283, bankName: 'CFA Cooperativa Financiera', routerReference: '$cfa' },
  { bankCode: 1803, bankName: 'Banco Powwi', routerReference: '$powwi' },
]

export class MoviiPaymentService implements IPaymentService {
  public readonly banks = banks
  public readonly currency = TargetCurrency.COP
  public readonly fixedFee = 0.0

  public readonly isAsync = false
  public readonly isEnabled = true
  public readonly MAX_TOTAL_AMOUNT_PER_DAY: number = 25_000_000
  public readonly MAX_USER_AMOUNT_PER_DAY: number = 25_000_000
  public readonly MAX_USER_AMOUNT_PER_TRANSACTION: number = 5_000_000

  public readonly MAX_USER_TRANSACTIONS_PER_DAY: number = 15

  public readonly percentageFee = 0.0
  public constructor(
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
  ) { }

  // Fetch current liquidity from Movii "traguatan" endpoint
  public getLiquidity: () => Promise<number> = async () => {
    try {
      const apiKey = await this.secretManager.getSecret('MOVII_BALANCE_API_KEY')
      const accountId = await this.secretManager.getSecret('MOVII_BALANCE_ACCOUNT_ID')

      const url = `https://apigw-data.movii.com.co/traguatan/?id=${encodeURIComponent(accountId)}`
      const headers = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      }

      const { data } = await axios.get(url, { headers })
      // Expected shape: { statusCode: 200, body: [{ saldo: "11027573.120000" }] }
      const saldoStr = data?.body?.[0]?.saldo
      const saldo = typeof saldoStr === 'string' ? parseFloat(saldoStr) : NaN
      return Number.isFinite(saldo) ? saldo : 0
    }
    catch (err) {
      console.error('Error fetching Movii liquidity:', err)
      return 0
    }
  }

  public onboardUser: IPaymentService['onboardUser'] = async ({
    account,
  }) => {
    const baseUrl = await this.secretManager.getSecret('MOVII_BASE_URL')
    const signerHandler = await this.secretManager.getSecret(
      'MOVII_SIGNER_HANDLER',
    )
    const apiKey = await this.secretManager.getSecret('MOVII_API_KEY')

    const token = await this.getToken()

    const url = `${baseUrl}/transfiya/v2/transfers`

    const data = {
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

    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    }

    try {
      const response = await axios.post(url, data, { headers })

      console.log('Response:', response.data)
      // Check if the transfer was created successfully
      if (response.data?.error?.code === 0) {
        return { message: 'Onboarding started successfully, please make sure the user completes the onboarding process', success: true }
      }
      else {
        console.error('API returned an error:', response.data)
        return { success: false }
      }
    }
    catch (error) {
      console.error('Error sending payment:', error)
      return { success: false }
    }
  }

  public sendPayment: IPaymentService['sendPayment'] = async ({
    account,
    bankCode,
    value,
  }) => {
    const baseUrl = await this.secretManager.getSecret('MOVII_BASE_URL')
    const signerHandler = await this.secretManager.getSecret(
      'MOVII_SIGNER_HANDLER',
    )
    const apiKey = await this.secretManager.getSecret('MOVII_API_KEY')

    const token = await this.getToken()

    const targetSigner = await this.getSignerHandle(account, bankCode)

    if (!targetSigner) {
      console.error(`No signer found for account ${account} and bankCode ${bankCode}`)
      return { success: false }
    }

    const url = `${baseUrl}/transfiya/v2/transfers`

    const data = {
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

    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    }

    try {
      const response = await axios.post(url, data, { headers })
      // Check if the transfer was created successfully
      if (response.data?.error?.code === 0) {
        const transferId = response.data.transferId
        // Wait for transaction to be accepted or rejected by polling the provided endpoint
        const finalTransaction = await this.waitForTransaction(transferId)
        if (finalTransaction.status === 'ACCEPTED' || finalTransaction.status === 'COMPLETED') {
          return { success: true, transactionId: transferId }
        }
        else {
          console.error('Transaction rejected:', finalTransaction)
          return { success: false }
        }
      }
      else {
        console.error('API returned an error:', response.data)
        return { success: false }
      }
    }
    catch (error) {
      console.error('Error sending payment:', error)
      return { success: false }
    }
  }

  public async verifyAccount({ account, bankCode }: {
    account: string
    bankCode: string
  }): Promise<boolean> {
    try {
      const signerHandler = await this.getSignerHandle(account, bankCode)
      return !!signerHandler
    }
    catch (error) {
      console.warn('Error verifying account:', error)
      return false
    }
  }

  /**
 * Retrieves the signer handle for a given wallet and bankCode.
 * @param wallet - The wallet identifier to be used in the API call.
 * @param bankCode - The bank code (bankBicfi) to search for.
 * @returns A promise that resolves with the signer handle or null if no match is found.
 */
  private async getSignerHandle(wallet: string, bankCode: string): Promise<null | string> {
    const baseUrl = await this.secretManager.getSecret('MOVII_BASE_URL')
    const apiKey = await this.secretManager.getSecret('MOVII_API_KEY')
    const token = await this.getToken()

    const parsedWallet = `$57${wallet}`

    const url = `${baseUrl}/transfiya/v1/wallet/${parsedWallet}/signers`

    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': 'Bearer ' + token,
          'x-api-key': apiKey,
        },
        method: 'GET',
      })

      const data = await response.json()

      // Check if the API response contains an error
      if (data.error && data.error.code !== 0) {
        throw new Error(data.error.message || 'Error fetching signers')
      }

      // Find the signer whose bankBicfi matches the bankCode parameter
      const signer = data.entities.find((entity: { bankBicfi: string, handle: string }) => entity.bankBicfi === bankCode)

      return signer ? signer.handle : null
    }
    catch (error) {
      console.error('Error retrieving signer handle:', error)
      throw error
    }
  }

  private async getToken(): Promise<string> {
    const baseUrl = await this.secretManager.getSecret('MOVII_BASE_URL')
    const clientId = await this.secretManager.getSecret('MOVII_CLIENT_ID')
    const clientSecret = await this.secretManager.getSecret(
      'MOVII_CLIENT_SECRET',
    )

    const url = `${baseUrl}/transfiya/oauth/token`

    // Build URL-encoded parameters
    const params = new URLSearchParams()
    params.append('client_id', clientId)
    params.append('client_secret', clientSecret)
    params.append('grand_type', 'client_credentials')

    try {
      const response = await axios.post(url, params, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })
      // Assuming the token is returned as access_token
      return response.data.access_token
    }
    catch (error) {
      console.error('Error fetching token:', error)
      throw error
    }
  }

  /**
   * Polls the transaction status until it is no longer pending.
   * @param transferId The transfer identifier.
   * @returns The final transaction object.
   */
  private async waitForTransaction(transferId: string): Promise<{ status: string }> {
    const baseUrl = await this.secretManager.getSecret('MOVII_BASE_URL')
    const apiKey = await this.secretManager.getSecret('MOVII_API_KEY')
    const token = await this.getToken()

    const pollingUrl = `${baseUrl}/transfiya/v2/transfers/${transferId}`
    // Headers as provided in the curl command
    const headers = {
      'Authorization': 'Bearer ' + token,
      'x-api-key': apiKey,
    }

    const startTime = Date.now()
    const timeout = 5 * 60_000 // 5 minutes in milliseconds
    while (true) {
      try {
        const response = await axios.get(pollingUrl, { headers })
        const transaction = response.data.entities[0]
        // If the status is no longer "PENDING", break out of the loop
        if (transaction && transaction.status !== 'PENDING' && transaction.status !== 'CREATED' && transaction.status !== 'INITIATED') {
          console.log('Transaction status:', transaction)
          return transaction
        }
      }
      catch (error) {
        console.error('Error polling transaction status:', error)
      }
      if (Date.now() - startTime > timeout) {
        throw new Error('Timeout waiting for transaction to complete')
      }
      // Wait 5 seconds before polling again
      await new Promise(resolve => setTimeout(resolve, 5000))
    }
  }
}
