import { BlockchainNetwork, CryptoCurrency, PrismaClient, TransactionStatus } from '@prisma/client'
import { getAssociatedTokenAddress, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import {
  Connection,
  ParsedInstruction,
  ParsedTransactionWithMeta,
  PartiallyDecodedInstruction,
  PublicKey,
} from '@solana/web3.js'
import { inject } from 'inversify'
import {
  Body,
  Controller,
  Post,
  Res,
  Response,
  Route,
  Security,
  SuccessResponse,
  TsoaResponse,
} from 'tsoa'
import z from 'zod'

import { ILogger, IQueueHandler, QueueName, ReceivedCryptoTransactionMessage } from '../interfaces'
import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
import { ISecretManager, Secrets } from '../interfaces/ISecretManager'
import { TYPES } from '../types'

const solanaPaymentNotificationSchema = z.object({
  on_chain_tx: z.string().min(1, 'On-chain transaction signature is required'),
  transaction_id: z.string().uuid(),
})

type ParsedInstructionType = ParsedInstruction | PartiallyDecodedInstruction

type SolanaPaymentContext = {
  connection: Connection
  tokenAccounts: PublicKey[]
  usdcMint: PublicKey
}

interface SolanaPaymentNotificationRequest {
  on_chain_tx: string
  transaction_id: string
}

type TokenAmountInfo = {
  amount: string
  decimals: number
  uiAmount: null | number
  uiAmountString?: string
}

type TransferCheckedInfo = {
  destination: string
  mint: string
  source: string
  tokenAmount: TokenAmountInfo
}

@Route('solana/payments')
@Security('ApiKeyAuth')
@Security('BearerAuth')
export class SolanaPaymentsController extends Controller {
  public constructor(
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
    @inject(TYPES.IQueueHandler) private queueHandler: IQueueHandler,
    @inject(TYPES.IDatabaseClientProvider) private dbClientProvider: IDatabaseClientProvider,
    @inject(TYPES.ILogger) private logger: ILogger,
  ) {
    super()
  }

  /**
   * Partners call this endpoint after sending a Solana payment so we can match it.
   * It verifies the on-chain transaction and enqueues the same workflow used by the Stellar listener.
   */
  @Post('notify')
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<404, { reason: string }>(404, 'Not Found')
  @SuccessResponse('202', 'Payment enqueued')
  public async notifyPayment(
    @Body() requestBody: SolanaPaymentNotificationRequest,
    @Res() badRequestResponse: TsoaResponse<400, { reason: string }>,
    @Res() notFoundResponse: TsoaResponse<404, { reason: string }>,
  ): Promise<{ enqueued: boolean }> {
    const parsed = solanaPaymentNotificationSchema.safeParse(requestBody)
    if (!parsed.success) {
      return badRequestResponse(400, { reason: parsed.error.message })
    }
    const { on_chain_tx: onChainSignature, transaction_id: transactionId } = parsed.data

    const prismaClient = await this.dbClientProvider.getClient()
    const transaction = await prismaClient.transaction.findUnique({
      include: { quote: true },
      where: { id: transactionId },
    })

    if (!transaction) {
      return notFoundResponse(404, { reason: 'Transaction not found' })
    }

    const validationError = this.validateTransaction(transaction)
    if (validationError) {
      return badRequestResponse(400, { reason: validationError })
    }

    const duplicateReason = await this.ensureUniqueOnChainId(prismaClient, onChainSignature, transaction.id)
    if (duplicateReason) {
      return badRequestResponse(400, { reason: duplicateReason })
    }

    const { connection, tokenAccounts, usdcMint } = await this.buildPaymentContext()

    let txDetails: ParsedTransactionWithMeta
    try {
      txDetails = await this.fetchOnChainTransaction(connection, onChainSignature)
    }
    catch (error) {
      this.logger.error('[SolanaPaymentsController] Failed to fetch transaction from Solana', error)
      const reason = error instanceof Error
        && (
          error.message === 'Transaction not found on Solana'
          || error.message === 'Transaction failed on-chain'
        )
        ? error.message
        : 'Failed to fetch transaction from Solana'

      return badRequestResponse(400, { reason })
    }

    const transfer = this.findUsdcTransferToWallet(txDetails, tokenAccounts, [usdcMint])

    if (!transfer) {
      return badRequestResponse(400, { reason: 'No USDC transfer to the configured wallet found in this transaction' })
    }

    const queueMessage: ReceivedCryptoTransactionMessage = {
      addressFrom: transfer.source,
      amount: transfer.amount,
      blockchain: BlockchainNetwork.SOLANA,
      cryptoCurrency: CryptoCurrency.USDC,
      onChainId: onChainSignature,
      transactionId: transaction.id,
    }

    try {
      await this.queueHandler.postMessage(QueueName.RECEIVED_CRYPTO_TRANSACTION, queueMessage)
    }
    catch (error) {
      this.logger.error('[SolanaPaymentsController] Failed to enqueue Solana payment', error)
      throw error
    }

    this.setStatus(202)
    return { enqueued: true }
  }

  private async buildPaymentContext(): Promise<SolanaPaymentContext> {
    const [rpcUrl, depositWalletAddress, usdcMintAddress] = await Promise.all([
      this.secretManager.getSecret(Secrets.SOLANA_RPC_URL),
      this.secretManager.getSecret(Secrets.SOLANA_ADDRESS),
      this.secretManager.getSecret(Secrets.SOLANA_USDC_MINT),
    ])

    const depositWallet = this.safePublicKey(depositWalletAddress)
    const usdcMint = this.safePublicKey(usdcMintAddress)

    if (!depositWallet || !usdcMint) {
      this.logger.error('[SolanaPaymentsController] Invalid Solana configuration', {
        depositWalletAddress,
        usdcMintAddress,
      })
      throw new Error('Solana configuration is invalid')
    }

    const depositTokenAccounts = await Promise.all([
      getAssociatedTokenAddress(usdcMint, depositWallet, false, TOKEN_PROGRAM_ID),
      getAssociatedTokenAddress(usdcMint, depositWallet, false, TOKEN_2022_PROGRAM_ID),
    ])

    return {
      connection: new Connection(rpcUrl, 'confirmed'),
      tokenAccounts: [depositWallet, ...depositTokenAccounts],
      usdcMint,
    }
  }

  private async ensureUniqueOnChainId(
    prismaClient: PrismaClient,
    onChainSignature: string,
    transactionId: string,
  ): Promise<string | undefined> {
    const duplicateOnChain = await prismaClient.transaction.findFirst({
      select: { id: true },
      where: { onChainId: onChainSignature },
    })

    if (duplicateOnChain && duplicateOnChain.id !== transactionId) {
      return 'On-chain transaction already linked to another transaction'
    }

    return undefined
  }

  private extractTransferInfo(instruction: ParsedInstructionType): null | TransferCheckedInfo {
    if (!('parsed' in instruction)) return null

    const parsed = instruction.parsed
    if (!parsed || typeof parsed !== 'object') return null
    if ((parsed as { type?: unknown }).type !== 'transferChecked') return null

    const info = (parsed as { info?: unknown }).info
    if (!info || typeof info !== 'object') return null

    const destination = (info as { destination?: unknown }).destination
    const mint = (info as { mint?: unknown }).mint
    const source = (info as { source?: unknown }).source
    const tokenAmount = (info as { tokenAmount?: unknown }).tokenAmount

    if (
      typeof destination !== 'string'
      || typeof mint !== 'string'
      || typeof source !== 'string'
      || !tokenAmount
      || typeof tokenAmount !== 'object'
    ) {
      return null
    }

    const amount = (tokenAmount as { amount?: unknown }).amount
    const decimals = (tokenAmount as { decimals?: unknown }).decimals
    const uiAmount = (tokenAmount as { uiAmount?: unknown }).uiAmount
    const uiAmountString = (tokenAmount as { uiAmountString?: unknown }).uiAmountString

    if (typeof amount !== 'string' || typeof decimals !== 'number') {
      return null
    }

    return {
      destination,
      mint,
      source,
      tokenAmount: {
        amount,
        decimals,
        uiAmount: typeof uiAmount === 'number' ? uiAmount : null,
        uiAmountString: typeof uiAmountString === 'string' ? uiAmountString : undefined,
      },
    }
  }

  private async fetchOnChainTransaction(
    connection: Connection,
    onChainSignature: string,
  ): Promise<ParsedTransactionWithMeta> {
    const txDetails = await connection.getParsedTransaction(onChainSignature, {
      maxSupportedTransactionVersion: 0, // support legacy + v0 txs
    })

    if (!txDetails) {
      throw new Error('Transaction not found on Solana')
    }

    if (txDetails.meta?.err) {
      throw new Error('Transaction failed on-chain')
    }

    return txDetails
  }

  private findUsdcTransferToWallet(
    txDetails: ParsedTransactionWithMeta,
    walletTokenAccounts: PublicKey[],
    allowedMints: PublicKey[],
  ): null | { amount: number, source: string } {
    const outerInstructions = txDetails.transaction?.message.instructions ?? []
    const innerInstructions = (txDetails.meta?.innerInstructions ?? []).reduce<ParsedInstructionType[]>(
      (all, ix) => all.concat(ix.instructions as ParsedInstructionType[]),
      [],
    )

    const allInstructions: ParsedInstructionType[] = [...outerInstructions, ...innerInstructions]

    const tokenPrograms = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]

    for (const instruction of allInstructions) {
      if (!('programId' in instruction)) {
        continue
      }

      const programId = instruction.programId
      if (!tokenPrograms.some(p => p.equals(programId))) {
        continue
      }

      const transferInfo = this.extractTransferInfo(instruction)
      if (!transferInfo) continue

      const destination = this.safePublicKey(transferInfo.destination)
      const mint = this.safePublicKey(transferInfo.mint)

      if (!destination || !walletTokenAccounts.some(account => account.equals(destination))) {
        continue
      }

      if (!mint || !allowedMints.some(allowedMint => allowedMint.equals(mint))) {
        continue
      }

      const amount = this.parseTokenAmount(transferInfo.tokenAmount)
      if (amount <= 0) {
        continue
      }

      return { amount, source: transferInfo.source }
    }

    return null
  }

  private parseTokenAmount(tokenAmount: TokenAmountInfo): number {
    if (tokenAmount.uiAmountString) {
      const parsed = parseFloat(tokenAmount.uiAmountString)
      if (!Number.isNaN(parsed)) {
        return parsed
      }
    }

    if (typeof tokenAmount.uiAmount === 'number' && !Number.isNaN(tokenAmount.uiAmount)) {
      return tokenAmount.uiAmount
    }

    const rawAmount = Number.parseFloat(tokenAmount.amount)
    if (!Number.isFinite(rawAmount)) {
      return 0
    }

    return rawAmount / Math.pow(10, tokenAmount.decimals)
  }

  private safePublicKey(key: null | string | undefined): null | PublicKey {
    if (!key) return null
    try {
      return new PublicKey(key)
    }
    catch (error) {
      this.logger.warn('[SolanaPaymentsController] Invalid public key string provided', { error, key })
      return null
    }
  }

  private validateTransaction(transaction: {
    quote: { cryptoCurrency: CryptoCurrency, network: BlockchainNetwork }
    status: TransactionStatus
  }): string | undefined {
    if (transaction.status !== TransactionStatus.AWAITING_PAYMENT) {
      return 'Transaction is not awaiting payment'
    }

    if (transaction.quote.network !== BlockchainNetwork.SOLANA) {
      return 'Transaction is not set for Solana'
    }

    if (transaction.quote.cryptoCurrency !== CryptoCurrency.USDC) {
      return 'Unsupported currency for Solana payments'
    }

    return undefined
  }
}
