import { BlockchainNetwork } from '@prisma/client'

import { ReceivedCryptoTransactionMessage } from '../../../../platform/messaging/queueSchema'

export type DepositVerificationError = { outcome: 'error', reason: string, status: 400 | 404 }
export type DepositVerificationSuccess = { outcome: 'ok', queueMessage: ReceivedCryptoTransactionMessage }

/**
 * A confidential deposit verifier.
 *
 * Deliberately a separate port rather than another entry in the registry:
 * `DepositVerifierRegistry` keys verifiers by network, and a confidential Stellar
 * deposit shares `BlockchainNetwork.STELLAR` with the classic one. Registering
 * both would let one silently displace the other.
 */
export interface IConfidentialDepositVerifier extends IDepositVerifier {
  /**
   * Reads the Abroad transaction reference out of a confidential transfer's memo,
   * or `null` when the transaction is not a usable confidential deposit.
   *
   * The listener needs the reference before it can ask for verification, and the
   * decoding lives behind this port so that transport code never has to parse
   * contract payloads itself.
   */
  resolveTransactionId(onChainSignature: string): Promise<null | string>
}

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
