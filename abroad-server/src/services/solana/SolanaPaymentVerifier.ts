import { BlockchainNetwork, CryptoCurrency, PrismaClient, TransactionStatus } from '@prisma/client'
import { getAssociatedTokenAddress, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import {
  Connection,
  ParsedInstruction,
  ParsedTransactionWithMeta,
  PartiallyDecodedInstruction,
  PublicKey,
} from '@solana/web3.js'

import { ILogger, ReceivedCryptoTransactionMessage } from '../../interfaces'
import { IDatabaseClientProvider } from '../../interfaces/IDatabaseClientProvider'
import { ISecretManager, Secrets } from '../../interfaces/ISecretManager'

export type SolanaPaymentVerificationResult = SolanaPaymentVerificationError | SolanaPaymentVerificationSuccess

type ParsedInstructionType = ParsedInstruction | PartiallyDecodedInstruction

type SolanaPaymentContext = {
  connection: Connection
  tokenAccounts: PublicKey[]
  usdcMint: PublicKey
}

type SolanaPaymentVerificationError = { outcome: 'error', reason: string, status: 400 | 404 }

type SolanaPaymentVerificationSuccess = { outcome: 'ok', queueMessage: ReceivedCryptoTransactionMessage }
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

export class SolanaPaymentVerifier {
  public constructor(
    private readonly secretManager: ISecretManager,
    private readonly dbClientProvider: IDatabaseClientProvider,
    private readonly logger: ILogger,
  ) {}

  public async buildPaymentContext(): Promise<SolanaPaymentContext> {
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

  public async ensureUniqueOnChainId(
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

  public async fetchOnChainTransaction(
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

  public findUsdcTransferToWallet(
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

  public async getPrismaClient(): Promise<PrismaClient> {
    return this.dbClientProvider.getClient()
  }

  public safePublicKey(key: null | string | undefined): null | PublicKey {
    if (!key) return null
    try {
      return new PublicKey(key)
    }
    catch (error) {
      this.logger.warn('[SolanaPaymentsController] Invalid public key string provided', { error, key })
      return null
    }
  }

  public validateTransaction(transaction: {
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

  public async verifyNotification(
    onChainSignature: string,
    transactionId: string,
  ): Promise<SolanaPaymentVerificationResult> {
    const prismaClient = await this.getPrismaClient()
    const transaction = await prismaClient.transaction.findUnique({
      include: { quote: true },
      where: { id: transactionId },
    })

    if (!transaction) {
      return { outcome: 'error', reason: 'Transaction not found', status: 404 }
    }

    const validationError = this.validateTransaction(transaction)
    if (validationError) {
      return { outcome: 'error', reason: validationError, status: 400 }
    }

    const duplicateReason = await this.ensureUniqueOnChainId(prismaClient, onChainSignature, transaction.id)
    if (duplicateReason) {
      return { outcome: 'error', reason: duplicateReason, status: 400 }
    }

    const { connection, tokenAccounts, usdcMint } = await this.buildPaymentContext()

    try {
      const txDetails = await this.fetchOnChainTransaction(connection, onChainSignature)
      const transfer = this.findUsdcTransferToWallet(txDetails, tokenAccounts, [usdcMint])

      if (!transfer) {
        return {
          outcome: 'error',
          reason: 'No USDC transfer to the configured wallet found in this transaction',
          status: 400,
        }
      }

      return {
        outcome: 'ok',
        queueMessage: {
          addressFrom: transfer.source,
          amount: transfer.amount,
          blockchain: BlockchainNetwork.SOLANA,
          cryptoCurrency: CryptoCurrency.USDC,
          onChainId: onChainSignature,
          transactionId: transaction.id,
        },
      }
    }
    catch (error) {
      this.logger.error('[SolanaPaymentVerifier] Failed to fetch transaction from Solana', error)
      const reason = error instanceof Error
        && (
          error.message === 'Transaction not found on Solana'
          || error.message === 'Transaction failed on-chain'
        )
        ? error.message
        : 'Failed to fetch transaction from Solana'

      return { outcome: 'error', reason, status: 400 }
    }
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
}
