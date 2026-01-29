import { BlockchainNetwork, CryptoCurrency, PrismaClient, TransactionStatus } from '@prisma/client'
import { ethers } from 'ethers'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { ILogger } from '../../../../core/logging/types'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager, Secrets } from '../../../../platform/secrets/ISecretManager'
import { DepositVerificationError, DepositVerificationSuccess, IDepositVerifier } from '../../application/contracts/IDepositVerifier'
import { parseErc20Transfers, safeNormalizeAddress, sumTransfers, toDecimalAmount } from './celoErc20'

type CeloReceiptContext = {
  depositAddress: string
  provider: ethers.providers.JsonRpcProvider
  usdcAddress: string
}

@injectable()
export class CeloPaymentVerifier implements IDepositVerifier {
  public readonly supportedNetwork = BlockchainNetwork.CELO
  private cachedProvider?: { provider: ethers.providers.JsonRpcProvider, rpcUrl: string }

  public constructor(
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
    @inject(TYPES.IDatabaseClientProvider) private readonly dbClientProvider: IDatabaseClientProvider,
    @inject(TYPES.ILogger) private readonly logger: ILogger,
  ) {}

  public async verifyNotification(
    onChainSignature: string,
    transactionId: string,
  ): Promise<DepositVerificationError | DepositVerificationSuccess> {
    const prismaClient = await this.dbClientProvider.getClient()
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

    let receipt: ethers.providers.TransactionReceipt | null
    let context: CeloReceiptContext
    try {
      context = await this.buildReceiptContext()
      receipt = await context.provider.getTransactionReceipt(onChainSignature)
    }
    catch (error) {
      this.logger.error('[CeloPaymentVerifier] Failed to fetch receipt', error)
      return { outcome: 'error', reason: 'Failed to fetch Celo transaction', status: 400 }
    }

    if (!receipt) {
      return { outcome: 'error', reason: 'Transaction not found on Celo', status: 404 }
    }

    if (receipt.status !== 1) {
      return { outcome: 'error', reason: 'Transaction failed on-chain', status: 400 }
    }

    const transferResult = this.extractDepositTransfer(receipt, context.usdcAddress, context.depositAddress)
    if (!transferResult.success) {
      return { outcome: 'error', reason: transferResult.reason, status: 400 }
    }

    return {
      outcome: 'ok',
      queueMessage: {
        addressFrom: transferResult.addressFrom,
        amount: transferResult.amount,
        blockchain: BlockchainNetwork.CELO,
        cryptoCurrency: CryptoCurrency.USDC,
        onChainId: onChainSignature,
        transactionId: transaction.id,
      },
    }
  }

  private async buildReceiptContext(): Promise<CeloReceiptContext> {
    const {
      CELO_CHAIN_ID: chainIdRaw,
      CELO_DEPOSIT_ADDRESS: depositAddressRaw,
      CELO_RPC_URL: rpcUrl,
      CELO_USDC_ADDRESS: usdcAddressRaw,
    } = await this.secretManager.getSecrets([
      Secrets.CELO_RPC_URL,
      Secrets.CELO_DEPOSIT_ADDRESS,
      Secrets.CELO_USDC_ADDRESS,
      Secrets.CELO_CHAIN_ID,
    ])

    const depositAddress = safeNormalizeAddress(depositAddressRaw)
    const usdcAddress = safeNormalizeAddress(usdcAddressRaw)

    if (!depositAddress || !usdcAddress) {
      this.logger.error('[CeloPaymentVerifier] Invalid Celo addresses', {
        depositAddressRaw,
        usdcAddressRaw,
      })
      throw new Error('Invalid Celo configuration')
    }

    const chainId = this.parseChainId(chainIdRaw)
    const provider = this.getOrCreateProvider(rpcUrl, chainId)

    return {
      depositAddress,
      provider,
      usdcAddress,
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

  private extractDepositTransfer(
    receipt: ethers.providers.TransactionReceipt,
    usdcAddress: string,
    depositAddress: string,
  ): { addressFrom: string, amount: number, success: true } | { reason: string, success: false } {
    const transfers = parseErc20Transfers(receipt, usdcAddress)
      .filter(transfer => transfer.to === depositAddress)

    if (transfers.length === 0) {
      return { reason: 'No USDC transfer to the configured wallet found in this transaction', success: false }
    }

    const uniqueSenders = new Set(transfers.map(transfer => transfer.from))
    if (uniqueSenders.size > 1) {
      return { reason: 'Multiple senders found for USDC transfers', success: false }
    }

    const addressFrom = transfers[0]?.from
    if (!addressFrom) {
      return { reason: 'Missing sender address in transfer logs', success: false }
    }

    const totalAmount = sumTransfers(transfers)
    const amount = toDecimalAmount(totalAmount, 6)

    if (amount <= 0) {
      return { reason: 'Invalid USDC transfer amount', success: false }
    }

    return { addressFrom, amount, success: true }
  }

  private getOrCreateProvider(
    rpcUrl: string,
    chainId?: number,
  ): ethers.providers.JsonRpcProvider {
    if (this.cachedProvider && this.cachedProvider.rpcUrl === rpcUrl) {
      return this.cachedProvider.provider
    }

    const provider = chainId
      ? new ethers.providers.JsonRpcProvider(rpcUrl, chainId)
      : new ethers.providers.JsonRpcProvider(rpcUrl)

    this.cachedProvider = { provider, rpcUrl }
    return provider
  }

  private parseChainId(raw: string | undefined): number | undefined {
    if (!raw) return undefined
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined
    return parsed
  }

  private validateTransaction(transaction: {
    quote: { cryptoCurrency: CryptoCurrency, network: BlockchainNetwork }
    status: TransactionStatus
  }): string | undefined {
    if (transaction.status !== TransactionStatus.AWAITING_PAYMENT) {
      return 'Transaction is not awaiting payment'
    }

    if (transaction.quote.network !== BlockchainNetwork.CELO) {
      return 'Transaction is not set for Celo'
    }

    if (transaction.quote.cryptoCurrency !== CryptoCurrency.USDC) {
      return 'Unsupported currency for Celo payments'
    }

    return undefined
  }
}
