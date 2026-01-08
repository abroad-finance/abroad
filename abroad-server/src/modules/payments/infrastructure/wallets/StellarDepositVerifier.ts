import { BlockchainNetwork, CryptoCurrency, TransactionStatus } from '@prisma/client'
import { Horizon } from '@stellar/stellar-sdk'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { ReceivedCryptoTransactionMessage } from '../../../../platform/messaging/queueSchema'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager, Secrets } from '../../../../platform/secrets/ISecretManager'
import { DepositVerificationError, DepositVerificationSuccess, IDepositVerifier } from '../../application/contracts/IDepositVerifier'

@injectable()
export class StellarDepositVerifier implements IDepositVerifier {
  public readonly supportedNetwork = BlockchainNetwork.STELLAR
  private readonly logger: ScopedLogger

  constructor(
    @inject(TYPES.IDatabaseClientProvider) private readonly dbProvider: IDatabaseClientProvider,
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
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

    if (transaction.quote.cryptoCurrency !== CryptoCurrency.USDC) {
      return { outcome: 'error', reason: 'Unsupported currency for Stellar payments', status: 400 }
    }

    const { accountId, horizonUrl, usdcIssuer } = await this.getStellarSecrets()
    const server = new Horizon.Server(horizonUrl)

    let payment: Horizon.ServerApi.PaymentOperationRecord
    try {
      const op = await server.operations().operation(onChainSignature).call()
      if (!this.isPayment(op)) {
        return { outcome: 'error', reason: 'Operation is not a payment', status: 400 }
      }
      payment = op
    }
    catch (error) {
      const status = this.extractErrorStatus(error) ?? 400
      const reason = error instanceof Error ? error.message : 'Failed to fetch payment'
      return { outcome: 'error', reason, status: status === 404 ? 404 : 400 }
    }

    if (!this.isUsdcPaymentToWallet(payment, accountId, usdcIssuer)) {
      return { outcome: 'error', reason: 'Payment does not target the configured USDC wallet', status: 400 }
    }

    const memo = await payment.transaction().then(tx => tx.memo).catch(() => null)
    if (!memo) {
      return { outcome: 'error', reason: 'Payment is missing memo', status: 400 }
    }

    const queueMessage: ReceivedCryptoTransactionMessage = {
      addressFrom: payment.from,
      amount: parseFloat(payment.amount),
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: CryptoCurrency.USDC,
      onChainId: payment.id,
      transactionId: this.decodeMemo(memo),
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

  private async getStellarSecrets(): Promise<{ accountId: string, horizonUrl: string, usdcIssuer: string }> {
    const [accountId, horizonUrl, usdcIssuer] = await Promise.all([
      this.secretManager.getSecret(Secrets.STELLAR_ACCOUNT_ID),
      this.secretManager.getSecret(Secrets.STELLAR_HORIZON_URL),
      this.secretManager.getSecret(Secrets.STELLAR_USDC_ISSUER),
    ])

    return { accountId, horizonUrl, usdcIssuer }
  }

  private isPayment(record: Horizon.ServerApi.OperationRecord): record is Horizon.ServerApi.PaymentOperationRecord {
    return record.type === 'payment'
  }

  private isUsdcPaymentToWallet(
    payment: Horizon.ServerApi.PaymentOperationRecord,
    accountId: string,
    usdcIssuer: string,
  ): boolean {
    const isUsdcAsset = payment.asset_type === 'credit_alphanum4'
      && payment.asset_code === 'USDC'
      && payment.asset_issuer === usdcIssuer

    return payment.to === accountId && isUsdcAsset
  }
}
