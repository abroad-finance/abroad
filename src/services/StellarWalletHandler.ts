// src/services/StellarWalletHandler.ts
import { CryptoCurrency } from '@prisma/client'
import {
  Asset,
  Horizon,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk'
import { inject, injectable } from 'inversify'

import { ISecretManager } from '../interfaces/ISecretManager'
import { IWalletHandler } from '../interfaces/IWalletHandler'
import { TYPES } from '../types'

@injectable()
export class StellarWalletHandler implements IWalletHandler {
  constructor(
        @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
  ) { }

  async getAddressFromTransaction({
    onChainId,
  }: {
    onChainId?: string
  }): Promise<string> {
    if (!onChainId) {
      throw new Error('onChainId is required to get address from transaction')
    }

    const horizonUrl = await this.secretManager.getSecret('STELLAR_HORIZON_URL')
    const server = new Horizon.Server(horizonUrl)
    try {
      // Fetch the transaction details from the Stellar network
      const transaction = await server.operations().operation(onChainId).call()

      // Extract the source account address from the transaction
      return transaction.source_account || ''
    }
    catch (error) {
      console.error('Error fetching Stellar transaction:', error, onChainId)
      throw new Error(`Failed to fetch transaction with ID ${onChainId}`)
    }
  }

  /**
     * Send cryptocurrency to the specified address on the Stellar network
     * @param params The parameters for the transaction
     * @returns Object indicating success and transaction ID
     */
  async send({
    address,
        amount,
        cryptoCurrency,
        memo,
  }: {
    address: string
    amount: number
    cryptoCurrency: CryptoCurrency
    memo?: string
  }): Promise<{ success: boolean, transactionId?: string }> {
    try {
      // Validate that the cryptocurrency is supported
      if (cryptoCurrency !== CryptoCurrency.USDC) {
        throw new Error(`Unsupported cryptocurrency for Stellar: ${cryptoCurrency}`)
      }

      // Get the Horizon API URL from the secret manager
      const horizonUrl = await this.secretManager.getSecret('STELLAR_HORIZON_URL')

      // Get the private key from the secret manager
      const privateKey = await this.secretManager.getSecret('STELLAR_PRIVATE_KEY')

      // Create a connection to the Stellar Horizon API
      const server = new Horizon.Server(horizonUrl)

      // Create the keypair from the private key
      const sourceKeypair = Keypair.fromSecret(privateKey)
      const sourcePublicKey = sourceKeypair.publicKey()

      // Load the source account
      const sourceAccount = await server.loadAccount(sourcePublicKey)

      const fee = await server.fetchBaseFee()

      // Create the transaction builder
      const transaction = new TransactionBuilder(sourceAccount, {
        fee: fee.toString(),
        networkPassphrase: Networks.PUBLIC,
      })

      // Add memo if provided
      if (memo) {
        transaction.addMemo(Memo.text(memo))
      }

      // For USDC, we need to define the asset with issuer
      const usdcIssuer = await this.secretManager.getSecret('STELLAR_USDC_ISSUER')
      const usdcAsset = new Asset(cryptoCurrency, usdcIssuer)

      transaction.addOperation(
        Operation.payment({
          amount: amount.toString(),
          asset: usdcAsset,
          destination: address,
        }),
      )

      // Set transaction timeout and build
      const builtTransaction = transaction
        .setTimeout(30)
        .build()

      // Sign the transaction
      builtTransaction.sign(sourceKeypair)

      // Submit the transaction to the network
      const result = await server.submitTransaction(builtTransaction)

      return {
        success: true,
        transactionId: result.hash,
      }
    }
    catch (error) {
      console.error('Error sending Stellar transaction:', error)
      return { success: false }
    }
  }
}
