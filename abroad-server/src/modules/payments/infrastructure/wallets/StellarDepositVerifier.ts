import { BlockchainNetwork, CryptoCurrency, TransactionStatus } from '@prisma/client'
import { Horizon } from '@stellar/stellar-sdk'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { ReceivedCryptoTransactionMessage } from '../../../../platform/messaging/queueSchema'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager, Secrets } from '../../../../platform/secrets/ISecretManager'
import { CryptoAssetConfigService } from '../../application/CryptoAssetConfigService'
import { DepositVerificationError, DepositVerificationSuccess, IDepositVerifier } from '../../application/contracts/IDepositVerifier'

@injectable()
export class StellarDepositVerifier implements IDepositVerifier {
  public readonly supportedNetwork = BlockchainNetwork.STELLAR
  private readonly logger: ScopedLogger

  constructor(
    @inject(TYPES.IDatabaseClientProvider) private readonly dbProvider: IDatabaseClientProvider,
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
    @inject(CryptoAssetConfigService) private readonly assetConfigService: CryptoAssetConfigService,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'StellarDepositVerifier' })
  }

  public async verifyNotification(
    onChainSignature: string,
    transactionId: string,
  ): Promise<DepositVerificationError | DepositVerificationSuccess> {
    const prisma = await this.dbProvider.getClient()
    const transaction = await prisma.transaction.findUnique({
      include: { quote: true },
      where: { id: transactionId },
    })

    if (!transaction) {
      return { outcome: 'error', reason: 'Transaction not found', status: 404 }
    }

    if (transaction.status !== TransactionStatus.AWAITING_PAYMENT) {
      return { outcome: 'error', reason: 'Transaction is not awaiting payment', status: 400 }
    }

    if (transaction.quote.network !== BlockchainNetwork.STELLAR) {
      return { outcome: 'error', reason: 'Transaction is not set for Stellar', status: 400 }
    }

    const assetConfig = await this.assetConfigService.getActiveMint({
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: transaction.quote.cryptoCurrency,
    })
    if (!assetConfig) {
      return { outcome: 'error', reason: 'Unsupported currency for Stellar payments', status: 400 }
    }

    const { accountId, horizonUrl } = await this.getStellarSecrets()
    const server = new Horizon.Server(horizonUrl)

    let transactionRecord: Horizon.ServerApi.TransactionRecord
    try {
      transactionRecord = await server.transactions().transaction(onChainSignature).call()
    }
    catch (error) {
      const status = this.extractErrorStatus(error) ?? 400
      const reason = error instanceof Error ? error.message : 'Failed to fetch transaction'
      return { outcome: 'error', reason, status: status === 404 ? 404 : 400 }
    }

    let payment: Horizon.ServerApi.PaymentOperationRecord | undefined
    try {
      const operations = await server.operations().forTransaction(onChainSignature).call()
      const paymentOps = operations.records.filter(
        (op): op is Horizon.ServerApi.PaymentOperationRecord => this.isPayment(op),
      )
      if (paymentOps.length === 0) {
        return { outcome: 'error', reason: 'Transaction does not include a payment operation', status: 400 }
      }
      payment = paymentOps.find(op => (
        this.isPaymentToWallet(op, accountId, transaction.quote.cryptoCurrency, assetConfig.mintAddress)
      ))
      if (!payment) {
        return { outcome: 'error', reason: 'Payment does not target the configured wallet', status: 400 }
      }
    }
    catch (error) {
      const status = this.extractErrorStatus(error) ?? 400
      const reason = error instanceof Error ? error.message : 'Failed to fetch transaction operations'
      return { outcome: 'error', reason, status: status === 404 ? 404 : 400 }
    }

    const memo = transactionRecord.memo?.trim() ?? null
    if (!memo) {
      return { outcome: 'error', reason: 'Payment is missing memo', status: 400 }
    }

    const decodedTransactionId = this.decodeMemo(memo)
    if (decodedTransactionId !== transactionId) {
      return { outcome: 'error', reason: 'Payment memo does not match transaction', status: 400 }
    }

    const queueMessage: ReceivedCryptoTransactionMessage = {
      addressFrom: payment.from,
      amount: parseFloat(payment.amount),
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: transaction.quote.cryptoCurrency,
      onChainId: onChainSignature,
      transactionId: decodedTransactionId,
    }

    return { outcome: 'ok', queueMessage }
  }

  private decodeMemo(memo: string): string {
    const buffer = Buffer.from(memo, 'base64')
    const hex = buffer.toString('hex')
    return [
      hex.substring(0, 8),
      hex.substring(8, 12),
      hex.substring(12, 16),
      hex.substring(16, 20),
      hex.substring(20),
    ].join('-')
  }

  private extractErrorStatus(error: unknown): number | undefined {
    if (typeof error !== 'object' || !error) return undefined
    if ('response' in error) {
      const status = (error as { response?: { status?: number } }).response?.status
      if (typeof status === 'number') return status
    }
    if ('status' in error && typeof (error as { status?: unknown }).status === 'number') {
      return (error as { status: number }).status
    }
    return undefined
  }

  private async getStellarSecrets(): Promise<{ accountId: string, horizonUrl: string }> {
    const [accountId, horizonUrl] = await Promise.all([
      this.secretManager.getSecret(Secrets.STELLAR_ACCOUNT_ID),
      this.secretManager.getSecret(Secrets.STELLAR_HORIZON_URL),
    ])

    return { accountId, horizonUrl }
  }

  private isPayment(record: Horizon.ServerApi.OperationRecord): record is Horizon.ServerApi.PaymentOperationRecord {
    return record.type === 'payment'
  }

  private isPaymentToWallet(
    payment: Horizon.ServerApi.PaymentOperationRecord,
    accountId: string,
    cryptoCurrency: CryptoCurrency,
    issuer: string,
  ): boolean {
    const isTokenAsset = (payment.asset_type === 'credit_alphanum4' || payment.asset_type === 'credit_alphanum12')
      && payment.asset_code === cryptoCurrency
      && payment.asset_issuer === issuer

    return payment.to === accountId && isTokenAsset
  }
}
