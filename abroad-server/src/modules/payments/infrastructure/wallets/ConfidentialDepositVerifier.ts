import { BlockchainNetwork } from '@prisma/client'
import { xdr } from '@stellar/stellar-sdk'
import axios from 'axios'
import { inject, injectable } from 'inversify'
import { z } from 'zod'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager, Secrets } from '../../../../platform/secrets/ISecretManager'
import { DepositVerificationError, DepositVerificationSuccess, IConfidentialDepositVerifier } from '../../application/contracts/IDepositVerifier'
import { CryptoAssetConfigService } from '../../application/CryptoAssetConfigService'
import { parseViewingKey, recoverDisclosedAmount } from './confidentialDisclosure'
import { ConfidentialTransferCallFailure, parseConfidentialTransferCall } from './confidentialTransferCall'
import { ensureUniqueOnChainId, validateDepositTransaction } from './depositVerification'

const SorobanTransactionSchema = z.object({
  envelopeXdr: z.string().optional(),
  status: z.string(),
})

type ConfidentialSecrets = {
  depositAccount: string
  rpcUrl: string
  viewingKey: bigint
}

/**
 * Verifies a deposit that arrived as a confidential transfer on an OpenZeppelin
 * confidential-token contract.
 *
 * It mirrors `StellarDepositVerifier`'s discipline — re-fetch from the network,
 * check the transaction is payable, pin the asset, pin the recipient, decode the
 * reference — and adds the two checks the classic path has no equivalent for:
 *
 *   1. the amount is recovered by ECDH against our viewing key rather than read
 *      from a plaintext field, and
 *   2. the recovered amount is re-committed and required to equal the on-chain
 *      Pedersen commitment, so a wrong amount is not merely implausible but
 *      infeasible without breaking discrete log.
 *
 * It also calls `ensureUniqueOnChainId`, which the classic Stellar verifier
 * currently does not. Nothing here logs a key, an amount, an address or a reference.
 */
@injectable()
export class ConfidentialDepositVerifier implements IConfidentialDepositVerifier {
  public readonly supportedNetwork = BlockchainNetwork.STELLAR
  private readonly logger: ScopedLogger

  constructor(
    @inject(TYPES.IDatabaseClientProvider) private readonly dbProvider: IDatabaseClientProvider,
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
    @inject(CryptoAssetConfigService) private readonly assetConfigService: CryptoAssetConfigService,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'ConfidentialDepositVerifier' })
  }

  public async resolveTransactionId(onChainSignature: string): Promise<null | string> {
    const rpcUrl = await this.secretManager.getSecret(Secrets.SOROBAN_RPC_URL)
    const envelope = await this.fetchSuccessfulEnvelope(rpcUrl, onChainSignature)
    if (envelope.outcome === 'error') {
      return null
    }

    const parsed = parseConfidentialTransferCall(envelope.envelope)
    return parsed.outcome === 'ok' ? parsed.call.reference : null
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

    const validationError = validateDepositTransaction(transaction, BlockchainNetwork.STELLAR)
    if (validationError) {
      return { outcome: 'error', reason: validationError, status: 400 }
    }

    const duplicateReason = await ensureUniqueOnChainId(prisma, onChainSignature, transaction.id)
    if (duplicateReason) {
      return { outcome: 'error', reason: duplicateReason, status: 400 }
    }

    const asset = await this.assetConfigService.getActiveConfidentialAsset({
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: transaction.quote.cryptoCurrency,
    })
    if (!asset) {
      return { outcome: 'error', reason: 'Unsupported currency for confidential Stellar payments', status: 400 }
    }

    const secrets = await this.loadSecrets()
    if (!secrets) {
      return { outcome: 'error', reason: 'Confidential deposit configuration is invalid', status: 400 }
    }

    const envelope = await this.fetchSuccessfulEnvelope(secrets.rpcUrl, onChainSignature)
    if (envelope.outcome === 'error') {
      return envelope
    }

    const parsed = parseConfidentialTransferCall(envelope.envelope)
    if (parsed.outcome === 'rejected') {
      return { outcome: 'error', reason: PARSE_FAILURE_REASONS[parsed.reason], status: 400 }
    }
    const call = parsed.call

    if (call.contractAddress !== asset.depositContractAddress) {
      return { outcome: 'error', reason: 'Deposit does not target the configured wrapper contract', status: 400 }
    }

    if (call.recipient !== secrets.depositAccount) {
      return { outcome: 'error', reason: 'Transfer does not target the configured wallet', status: 400 }
    }

    if (call.reference !== transactionId) {
      return { outcome: 'error', reason: 'Deposit reference does not match transaction', status: 400 }
    }

    const disclosure = recoverDisclosedAmount({
      encryptedAmount: call.encryptedAmount,
      ephemeralPublicKey: call.ephemeralPublicKey,
      salt: call.salt,
      transferCommitment: call.transferCommitment,
      viewingKey: secrets.viewingKey,
    })
    if (disclosure.outcome === 'rejected') {
      // An unverifiable disclosure never advances state: the transaction stays
      // where it is and is reconciled read-only.
      this.logger.warn('Rejected confidential deposit disclosure', {
        failure: disclosure.reason,
        transactionId,
      })
      return { outcome: 'error', reason: 'Disclosed amount does not match the on-chain commitment', status: 400 }
    }

    const amount = toMajorUnitAmount(disclosure.amount, asset.decimals)
    if (amount === null) {
      return { outcome: 'error', reason: 'Disclosed amount is out of the representable range', status: 400 }
    }

    return {
      outcome: 'ok',
      queueMessage: {
        addressFrom: call.sender,
        amount,
        blockchain: BlockchainNetwork.STELLAR,
        cryptoCurrency: transaction.quote.cryptoCurrency,
        onChainId: onChainSignature,
        transactionId,
      },
    }
  }

  /**
   * Fetches a transaction's envelope from Soroban RPC.
   *
   * The SDK's `getTransaction` also parses `resultMetaXdr`, which is
   * `TransactionMeta` v4 from protocol 23 onward and which `@stellar/stellar-sdk`
   * v13 cannot read — it throws before returning. Only `status` and
   * `envelopeXdr` are needed here and both are stable across that change, so the
   * two fields are read straight off the JSON-RPC response instead.
   */
  private async fetchSuccessfulEnvelope(
    rpcUrl: string,
    onChainSignature: string,
  ): Promise<DepositVerificationError | { envelope: xdr.TransactionEnvelope, outcome: 'ok' }> {
    let result: unknown
    try {
      const response = await axios.post<{ result?: unknown }>(rpcUrl, {
        id: 1,
        jsonrpc: '2.0',
        method: 'getTransaction',
        params: { hash: onChainSignature },
      })
      result = response.data.result
    }
    catch (error) {
      this.logger.error('Failed to fetch confidential deposit from Soroban RPC', error)
      return { outcome: 'error', reason: 'Failed to fetch transaction from Soroban RPC', status: 400 }
    }

    const parsed = SorobanTransactionSchema.safeParse(result)
    if (!parsed.success) {
      this.logger.error('Soroban RPC returned an unexpected transaction shape')
      return { outcome: 'error', reason: 'Failed to fetch transaction from Soroban RPC', status: 400 }
    }

    if (parsed.data.status === 'NOT_FOUND') {
      // Soroban RPC keeps a short retention window, so "not found" also covers a
      // transaction that is simply older than the node's history.
      return { outcome: 'error', reason: 'Transaction not found on Soroban RPC', status: 404 }
    }

    if (parsed.data.status !== 'SUCCESS' || !parsed.data.envelopeXdr) {
      return { outcome: 'error', reason: 'Transaction failed on-chain', status: 400 }
    }

    try {
      return {
        envelope: xdr.TransactionEnvelope.fromXDR(parsed.data.envelopeXdr, 'base64'),
        outcome: 'ok',
      }
    }
    catch {
      return { outcome: 'error', reason: 'Confidential transfer envelope could not be decoded', status: 400 }
    }
  }

  private async loadSecrets(): Promise<ConfidentialSecrets | null> {
    const {
      SOROBAN_RPC_URL,
      STELLAR_CONFIDENTIAL_ACCOUNT_ID,
      STELLAR_CONFIDENTIAL_VIEWING_KEY,
    } = await this.secretManager.getSecrets([
      'SOROBAN_RPC_URL',
      'STELLAR_CONFIDENTIAL_ACCOUNT_ID',
      'STELLAR_CONFIDENTIAL_VIEWING_KEY',
    ])

    const viewingKey = parseViewingKey(STELLAR_CONFIDENTIAL_VIEWING_KEY)
    if (!viewingKey || !STELLAR_CONFIDENTIAL_ACCOUNT_ID || !SOROBAN_RPC_URL) {
      this.logger.error('Confidential deposit secrets are missing or malformed', {
        hasAccount: Boolean(STELLAR_CONFIDENTIAL_ACCOUNT_ID),
        hasRpcUrl: Boolean(SOROBAN_RPC_URL),
        hasViewingKey: Boolean(viewingKey),
      })
      return null
    }

    return {
      depositAccount: STELLAR_CONFIDENTIAL_ACCOUNT_ID,
      rpcUrl: SOROBAN_RPC_URL,
      viewingKey,
    }
  }
}

const PARSE_FAILURE_REASONS: Record<ConfidentialTransferCallFailure, string> = {
  malformed_envelope: 'Confidential transfer envelope could not be decoded',
  malformed_payload: 'Confidential transfer payload could not be decoded',
  malformed_reference: 'Confidential deposit carries no Abroad transaction reference',
  not_a_confidential_deposit: 'Transaction is not a confidential deposit',
}

/**
 * Converts the token's minor units to the major-unit amount the deposit queue
 * carries, refusing any value a double cannot hold exactly as an integer.
 *
 * The queue contract is a float, matching every other deposit path. The guard is
 * what keeps an oversized confidential amount from rounding into a payout.
 */
function toMajorUnitAmount(minorUnits: bigint, decimals: number): null | number {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    return null
  }
  if (minorUnits < 0n || minorUnits > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null
  }

  const scale = 10n ** BigInt(decimals)
  const whole = minorUnits / scale
  const fraction = minorUnits % scale
  const text = decimals === 0
    ? whole.toString()
    : `${whole.toString()}.${fraction.toString().padStart(decimals, '0')}`

  return Number(text)
}
