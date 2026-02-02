import { BlockchainNetwork, CryptoCurrency, PrismaClient, TransactionStatus } from '@prisma/client'
import { ethers } from 'ethers'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { ILogger } from '../../../../core/logging/types'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager, Secrets } from '../../../../platform/secrets/ISecretManager'
import { DepositVerificationError, DepositVerificationSuccess, IDepositVerifier } from '../../application/contracts/IDepositVerifier'
import { CryptoAssetConfigService } from '../../application/CryptoAssetConfigService'
import {
  fetchErc20Decimals,
  parseErc20Transfers,
  safeNormalizeAddress,
  sumTransfers,
  toDecimalAmount,
} from './celoErc20'

type CeloReceiptContext = {
  depositAddress: string
  provider: ethers.providers.JsonRpcProvider
  tokenAddress: string
}

@injectable()
export class CeloPaymentVerifier implements IDepositVerifier {
  public readonly supportedNetwork = BlockchainNetwork.CELO
  private cachedProvider?: { provider: ethers.providers.JsonRpcProvider, rpcUrl: string }
  private readonly tokenDecimalsCache = new Map<string, number>()

  public constructor(
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
    @inject(TYPES.IDatabaseClientProvider) private readonly dbClientProvider: IDatabaseClientProvider,
    @inject(CryptoAssetConfigService) private readonly assetConfigService: CryptoAssetConfigService,
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

    const assetConfig = await this.assetConfigService.getActiveMint({
      blockchain: BlockchainNetwork.CELO,
      cryptoCurrency: transaction.quote.cryptoCurrency,
    })
    if (!assetConfig) {
      return { outcome: 'error', reason: 'Unsupported currency for Celo payments', status: 400 }
    }

    const duplicateReason = await this.ensureUniqueOnChainId(prismaClient, onChainSignature, transaction.id)
    if (duplicateReason) {
      return { outcome: 'error', reason: duplicateReason, status: 400 }
    }

    let receipt: ethers.providers.TransactionReceipt | null
    let context: CeloReceiptContext
    try {
      context = await this.buildReceiptContext(assetConfig.mintAddress)
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

    const decimals = await this.resolveTokenDecimals(context.provider, context.tokenAddress, assetConfig.decimals)
    const transferResult = this.extractDepositTransfer(receipt, context.tokenAddress, context.depositAddress, decimals)
    if (!transferResult.success) {
      return { outcome: 'error', reason: transferResult.reason, status: 400 }
    }

    return {
      outcome: 'ok',
      queueMessage: {
        addressFrom: transferResult.addressFrom,
        amount: transferResult.amount,
        blockchain: BlockchainNetwork.CELO,
        cryptoCurrency: transaction.quote.cryptoCurrency,
        onChainId: onChainSignature,
        transactionId: transaction.id,
      },
    }
  }

  private async buildReceiptContext(tokenAddressRaw: string): Promise<CeloReceiptContext> {
    const {
      CELO_DEPOSIT_ADDRESS: depositAddressRaw,
      CELO_RPC_URL: rpcUrl,
    } = await this.secretManager.getSecrets([
      Secrets.CELO_RPC_URL,
      Secrets.CELO_DEPOSIT_ADDRESS,
    ])

    const depositAddress = safeNormalizeAddress(depositAddressRaw)
    const tokenAddress = safeNormalizeAddress(tokenAddressRaw)

    if (!depositAddress || !tokenAddress) {
      this.logger.error('[CeloPaymentVerifier] Invalid Celo addresses', {
        depositAddressRaw,
        tokenAddressRaw,
      })
      throw new Error('Invalid Celo configuration')
    }

    const provider = this.getOrCreateProvider(rpcUrl)

    return {
      depositAddress,
      provider,
      tokenAddress,
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
    tokenAddress: string,
    depositAddress: string,
    decimals: number,
  ): { addressFrom: string, amount: number, success: true } | { reason: string, success: false } {
    const transfers = parseErc20Transfers(receipt, tokenAddress)
      .filter(transfer => transfer.to === depositAddress)

    if (transfers.length === 0) {
      return { reason: 'No token transfer to the configured wallet found in this transaction', success: false }
    }

    const uniqueSenders = new Set(transfers.map(transfer => transfer.from))
    if (uniqueSenders.size > 1) {
      return { reason: 'Multiple senders found for token transfers', success: false }
    }

    const addressFrom = transfers[0]?.from
    if (!addressFrom) {
      return { reason: 'Missing sender address in transfer logs', success: false }
    }

    const totalAmount = sumTransfers(transfers)
    const amount = toDecimalAmount(totalAmount, decimals)

    if (amount <= 0) {
      return { reason: 'Invalid token transfer amount', success: false }
    }

    return { addressFrom, amount, success: true }
  }

  private getOrCreateProvider(rpcUrl: string): ethers.providers.JsonRpcProvider {
    if (this.cachedProvider && this.cachedProvider.rpcUrl === rpcUrl) {
      return this.cachedProvider.provider
    }

    const provider = new ethers.providers.JsonRpcProvider(rpcUrl)

    this.cachedProvider = { provider, rpcUrl }
    return provider
  }

  private async resolveTokenDecimals(
    provider: ethers.providers.JsonRpcProvider,
    tokenAddress: string,
    configuredDecimals: null | number,
  ): Promise<number> {
    if (typeof configuredDecimals === 'number' && Number.isInteger(configuredDecimals) && configuredDecimals >= 0) {
      return configuredDecimals
    }

    const cached = this.tokenDecimalsCache.get(tokenAddress)
    if (cached !== undefined) {
      return cached
    }

    const decimals = await fetchErc20Decimals(provider, tokenAddress)
    this.tokenDecimalsCache.set(tokenAddress, decimals)
    return decimals
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

    return undefined
  }
}
