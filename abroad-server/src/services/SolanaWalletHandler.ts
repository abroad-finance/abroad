// src/services/SolanaWalletHandler.ts
import { CryptoCurrency } from '@prisma/client'
import { createTransferInstruction, getOrCreateAssociatedTokenAccount } from '@solana/spl-token'
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionConfirmationStrategy,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import bs58 from 'bs58'
import { inject, injectable } from 'inversify'

import { ISecretManager, Secrets } from '../interfaces/ISecretManager'
import { IWalletHandler } from '../interfaces/IWalletHandler'
import { TYPES } from '../types'

@injectable()
export class SolanaWalletHandler implements IWalletHandler {
  constructor(
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
  ) {}

  async getAddressFromTransaction({
  }: {
    onChainId?: string
  }): Promise<string> {
    throw new Error('Solana does not support fetching address from transaction ID')
  }

  /**
   * Send cryptocurrency to the specified address on the Solana network
   * @param params The parameters for the transaction
   * @returns Object indicating success and transaction ID
   */
  async send({
    address,
    amount,
    cryptoCurrency,
  }: {
    address: string
    amount: number
    cryptoCurrency: CryptoCurrency
    memo?: string
  }): Promise<{ success: boolean, transactionId?: string }> {
    try {
      // Validate that the cryptocurrency is supported
      if (cryptoCurrency !== CryptoCurrency.USDC) {
        throw new Error(`Unsupported cryptocurrency for Solana: ${cryptoCurrency}`)
      }

      // Get the RPC URL from the secret manager
      const rpcUrl = await this.secretManager.getSecret(Secrets.SOLANA_RPC_URL)

      // Get the private key from the secret manager
      const privateKeyBase58 = await this.secretManager.getSecret(Secrets.SOLANA_PRIVATE_KEY)

      // Create a connection to the Solana cluster
      const connection = new Connection(rpcUrl, 'confirmed')
      // Create the wallet keypair from the private key
      const senderKeypair = Keypair.fromSecretKey(
        bs58.decode(privateKeyBase58),
      )

      // Get the destination public key
      const destinationPubkey = new PublicKey(address)

      // Get the latest blockhash
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()

      let signature: string

      if (cryptoCurrency === CryptoCurrency.USDC) {
        // Get USDC mint address
        const usdcMintAddress = await this.secretManager.getSecret(Secrets.SOLANA_USDC_MINT)
        const usdcMint = new PublicKey(usdcMintAddress)

        // Get the sender's token account
        const senderTokenAccount = await getOrCreateAssociatedTokenAccount(
          connection,
          senderKeypair,
          usdcMint,
          senderKeypair.publicKey,
        )

        // Make sure the destination has a token account
        // If not, this will create one
        const destinationTokenAccount = await getOrCreateAssociatedTokenAccount(
          connection,
          senderKeypair,
          usdcMint,
          destinationPubkey,
        )

        // The amount needs to be adjusted for decimals (USDC has 6 decimals on Solana)
        const adjustedAmount = amount * Math.pow(10, 6)

        // Create the transfer instruction
        const transferInstruction = createTransferInstruction(
          senderTokenAccount.address,
          destinationTokenAccount.address,
          senderKeypair.publicKey,
          BigInt(Math.floor(adjustedAmount)),
          [],
        )

        // Create a message with the instructions
        const message = new TransactionMessage({
          instructions: [transferInstruction],
          payerKey: senderKeypair.publicKey,
          recentBlockhash: blockhash,
        }).compileToV0Message()

        // Create a versioned transaction from the message
        const versionedTransaction = new VersionedTransaction(message)

        // Sign the transaction
        versionedTransaction.sign([senderKeypair])

        // Send the transaction
        signature = await connection.sendTransaction(versionedTransaction)
      }
      else {
        throw new Error(`Unsupported cryptocurrency: ${cryptoCurrency}`)
      }

      // Wait for the transaction to be confirmed
      const confirmationStrategy: TransactionConfirmationStrategy = {
        blockhash: blockhash,
        lastValidBlockHeight: lastValidBlockHeight,
        signature,
      }
      await connection.confirmTransaction(confirmationStrategy, 'confirmed')

      return { success: true, transactionId: signature }
    }
    catch (error) {
      console.error('Error sending Solana transaction:', error)
      return { success: false }
    }
  }
}
