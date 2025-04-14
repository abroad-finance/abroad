#!/usr/bin/env -S npx tsx

import { BlockchainNetwork, CryptoCurrency } from '@prisma/client'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import {
  Connection,
  Finality,
  Logs,
  ParsedTransactionWithMeta,
  PublicKey,
} from '@solana/web3.js'
import { Buffer } from 'buffer'
import { inject } from 'inversify'

import { TransactionQueueMessage } from '../controllers/queue/ReceivedCryptoTransactionController'
import { IQueueHandler, QueueName } from '../interfaces'
import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
import { ISecretManager } from '../interfaces/ISecretManager'
import { iocContainer } from '../ioc'
import { TYPES } from '../types'

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')
const USDC_MINT_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const ALLOWED_USDC_MINTS = [USDC_MINT_ADDRESS]

class SolanaListener {
  private commitment: Finality = 'confirmed'
  private connection!: Connection
  private queueName = QueueName.RECEIVED_CRYPTO_TRANSACTION
  private rpcUrl!: string
  private walletAddress!: PublicKey
  private wsRpcUrl!: string

  constructor(
    @inject(TYPES.IQueueHandler) private queueHandler: IQueueHandler,
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
    @inject(TYPES.IDatabaseClientProvider)
    private dbClientProvider: IDatabaseClientProvider,
  ) { }

  private static safePublicKey(key: null | string | undefined): null | PublicKey {
    if (!key) return null
    try {
      return new PublicKey(key)
    }
    catch (e) {
      console.warn(`[SolanaListener] Invalid public key string: ${key}`, e)
      return null
    }
  }

  public async start(): Promise<void> {
    console.log(`[SolanaListener] Initializing listener`)

    const walletAddressString = await this.secretManager.getSecret('SOLANA_ADDRESS')
    this.rpcUrl = await this.secretManager.getSecret('SOLANA_RPC_URL')
    this.wsRpcUrl = this.rpcUrl.replace(/^http/, 'ws')

    try {
      this.walletAddress = new PublicKey(walletAddressString)
    }
    catch (error) {
      console.error(`[SolanaListener] Invalid Solana wallet address provided: ${walletAddressString}`, error)
      return
    }

    console.log(`[SolanaListener] Initializing Solana connection to: ${this.rpcUrl} (WS: ${this.wsRpcUrl})`)
    console.log(`[SolanaListener] Listening for transactions involving wallet: ${this.walletAddress.toBase58()}`)

    this.connection = new Connection(this.rpcUrl, {
      commitment: this.commitment,
      wsEndpoint: this.wsRpcUrl,
    })

    const prismaClient = await this.dbClientProvider.getClient()
    const state = await prismaClient.solanaListenerState.findUnique({ where: { id: this.walletAddress.toBase58() } })
    console.log(`[SolanaListener] Retrieved listener state:`, state)
    const lastProcessedSignature = state?.lastSignature
    if (lastProcessedSignature) {
      console.log(`[SolanaListener] Attempting to catch up from signature: ${lastProcessedSignature}`)
      await this.catchUpTransactions(lastProcessedSignature)
    }

    console.log(`[SolanaListener] Starting WebSocket subscription for logs mentioning ${this.walletAddress.toBase58()}`)

    this.connection.onLogs(
      this.walletAddress,
      async (logs: Logs, context) => {
        const { signature } = logs

        console.log(`[SolanaListener] Received log notification for signature: ${signature} in slot ${context.slot}`)

        try {
          const txDetails = await this.connection.getParsedTransaction(signature, {
            maxSupportedTransactionVersion: 0,
          })

          if (!txDetails) {
            console.warn(`[SolanaListener] Failed to fetch transaction details for signature: ${signature}. Skipping.`)
            return
          }

          if (txDetails.meta?.err) {
            console.log(`[SolanaListener] Skipping failed transaction: ${signature}`, txDetails.meta.err)
            return
          }

          await this.updateListenerState(signature, context.slot)

          this.processTransaction(txDetails, signature, context.slot)
        }
        catch (error) {
          console.error(`[SolanaListener] Error processing log for signature ${signature}:`, error)
        }
      },
      this.commitment,
    )

    console.log(`[SolanaListener] WebSocket subscription active.`)
  }

  private async catchUpTransactions(lastProcessedSignature: string): Promise<void> {
    console.log(`[SolanaListener] Catch-up: Fetching signatures since ${lastProcessedSignature}`)
    let signatures: Array<{ blockTime?: null | number, signature: string, slot: number }> = []
    let currentBatch = await this.connection.getSignaturesForAddress(
      this.walletAddress,
      { limit: 1000, until: lastProcessedSignature },
      this.commitment,
    )
    signatures = signatures.concat(currentBatch)

    while (currentBatch.length === 1000) {
      const oldestSig = currentBatch[currentBatch.length - 1].signature
      currentBatch = await this.connection.getSignaturesForAddress(
        this.walletAddress,
        { before: oldestSig, limit: 1000, until: lastProcessedSignature },
        this.commitment,
      )
      signatures = signatures.concat(currentBatch)
    }

    signatures.reverse()
    console.log(`[SolanaListener] Catch-up: Found ${signatures.length} signatures to process.`)

    for (const sigInfo of signatures) {
      try {
        const txDetails = await this.connection.getParsedTransaction(sigInfo.signature, {
          commitment: this.commitment,
          maxSupportedTransactionVersion: 0,
        })
        if (txDetails && !txDetails.meta?.err) {
          await this.processTransaction(txDetails, sigInfo.signature, sigInfo.slot)
        }
        else if (txDetails?.meta?.err) {
          console.log(`[SolanaListener] Catch-up: Skipping failed transaction ${sigInfo.signature}`)
          await this.updateListenerState(sigInfo.signature, sigInfo.slot)
        }
        else {
          console.warn(`[SolanaListener] Catch-up: Failed to fetch details for ${sigInfo.signature}`)
        }
      }
      catch (error) {
        console.error(`[SolanaListener] Catch-up: Error processing transaction ${sigInfo.signature}:`, error)
      }
    }
    console.log(`[SolanaListener] Catch-up finished.`)
  }

  private async processTransaction(txDetails: ParsedTransactionWithMeta, signature: string, slot: number): Promise<void> {
    console.log(`[SolanaListener] Processing transaction: ${signature}`)

    const { meta, transaction } = txDetails
    if (!transaction || !meta) {
      console.log(`[SolanaListener] Transaction or meta is missing for ${signature}. Skipping.`)
      return
    }

    let usdcPaymentFound = false
    let transactionId: null | string = null
    let paymentAmount = 0

    for (const instruction of transaction.message.instructions) {
      if ('programId' in instruction && instruction.programId.equals(MEMO_PROGRAM_ID)) {
        if (!('parsed' in instruction) && 'data' in instruction) {
          try {
            transactionId = Buffer.from(instruction.data, 'base64').toString('utf8')
            console.log(`[SolanaListener] Found Memo (raw data): ${transactionId}`)
          }
          catch (e) {
            console.warn(`[SolanaListener] Could not decode memo data for ${signature}: ${instruction.data}`, e)
          }
        }
        else if ('parsed' in instruction && typeof instruction.parsed === 'string') {
          transactionId = instruction.parsed
          console.log(`[SolanaListener] Found Memo (parsed): ${transactionId}`)
        }
      }
    }

    if (!transactionId) {
      console.log(`[SolanaListener] Skipping transaction ${signature} (no memo found).`)
      return
    }
    else {
      console.log(`[SolanaListener] Using Transaction ID (from memo): ${transactionId}`)
    }

    for (const instruction of transaction.message.instructions) {
      if ('programId' in instruction && instruction.programId.equals(TOKEN_PROGRAM_ID)) {
        if ('parsed' in instruction && instruction.parsed.type === 'transferChecked') {
          const transferInfo = instruction.parsed.info

          const destination = SolanaListener.safePublicKey(transferInfo.destination)
          const mint = SolanaListener.safePublicKey(transferInfo.mint)

          if (destination && destination.equals(this.walletAddress)) {
            console.log(`[SolanaListener] Found potential transferChecked TO our wallet in ${signature}`)

            let isAllowedUSDC = false
            let decimals = 0

            if (mint && ALLOWED_USDC_MINTS.includes(mint.toBase58())) {
              isAllowedUSDC = true
              decimals = transferInfo.tokenAmount.decimals
              paymentAmount = parseFloat(transferInfo.tokenAmount.uiAmountString ?? transferInfo.tokenAmount.amount) / Math.pow(10, decimals)

              if (isAllowedUSDC && paymentAmount > 0) {
                console.log(`[SolanaListener] Confirmed USDC transfer of ${paymentAmount} (decimals: ${decimals}) in ${signature}.`)
                usdcPaymentFound = true
                break
              }
              else {
                console.log(`[SolanaListener] Transfer in ${signature} was not an allowed USDC token or amount was zero.`)
              }
            }
          }
        }
      }
    }

    if (usdcPaymentFound && transactionId) {
      const queueMessage: TransactionQueueMessage = {
        amount: paymentAmount,
        blockchain: BlockchainNetwork.SOLANA,
        cryptoCurrency: CryptoCurrency.USDC,
        onChainId: signature,
        transactionId: transactionId,
      }

      try {
        this.queueHandler.postMessage(this.queueName, queueMessage)
        console.log(
          `[SolanaListener] Sent message to RabbitMQ queue '${this.queueName}':`,
          queueMessage,
        )

        await this.updateListenerState(signature, slot)
      }
      catch (error) {
        console.error(
          `[SolanaListener] Error sending message to RabbitMQ for tx ${signature}:`,
          error,
        )
      }
    }
    else if (!usdcPaymentFound) {
      console.log(`[SolanaListener] No relevant USDC transferChecked found for wallet ${this.walletAddress.toBase58()} in transaction ${signature}. Skipping.`)
    }
    else if (!transactionId) {
      console.log(`[SolanaListener] Relevant USDC transferChecked found for wallet ${this.walletAddress.toBase58()} in transaction ${signature}, but no memo/transactionId. Skipping.`)
    }
  }

  private async updateListenerState(signature: string, slot: number): Promise<void> {
    try {
      const prismaClient = await this.dbClientProvider.getClient()
      await prismaClient.solanaListenerState.upsert({
        create: {
          id: this.walletAddress.toBase58(),
          lastProcessedSlot: slot,
          lastSignature: signature,
        },
        update: {
          lastProcessedSlot: slot,
          lastSignature: signature,
        },
        where: { id: this.walletAddress.toBase58() },
      })
      console.log(
        `[SolanaListener] State updated (simulation): Last processed signature: ${signature}, Slot: ${slot}`,
      )
    }
    catch (error) {
      console.error(
        `[SolanaListener] Error updating listener state for signature ${signature}:`,
        error,
      )
    }
  }
}

if (require.main === module) {
  iocContainer.bind<SolanaListener>('SolanaListener').to(SolanaListener)
  const solanaListener = iocContainer.get<SolanaListener>('SolanaListener')
  solanaListener.start().catch((error) => {
    console.error('[SolanaListener] Failed to start listener:', error)
    process.exit(1)
  })
}
