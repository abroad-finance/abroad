import { BlockchainNetwork, CryptoCurrency } from '@prisma/client'

import { ReceivedCryptoTransactionMessage } from '../../../../platform/messaging/queueSchema'

export type DepositVerificationError = { outcome: 'error', reason: string, status: 400 | 404 }
export type DepositVerificationRequest = {
  blockchain: BlockchainNetwork
  cryptoCurrency: CryptoCurrency
  onChainId: string
  transactionId: string
}

export type DepositVerificationSuccess = { outcome: 'ok', queueMessage: ReceivedCryptoTransactionMessage }

export interface IDepositVerifier {
  supportedNetwork: BlockchainNetwork
  verifyNotification(
    onChainSignature: string,
    transactionId: string,
  ): Promise<DepositVerificationError | DepositVerificationSuccess>
}

export interface IDepositVerifierRegistry {
  getVerifier(blockchain: BlockchainNetwork): IDepositVerifier
}
