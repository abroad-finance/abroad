// src/modules/payments/infrastructure/wallets/SolanaWalletHandler.ts
import { CryptoCurrency } from '@prisma/client'
import { createTransferInstruction, getOrCreateAssociatedTokenAccount } from '@solana/spl-token'
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionConfirmationStrategy,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import bs58 from 'bs58'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { ILogger } from '../../../../core/logging/types'
import { ISecretManager, Secrets } from '../../../../platform/secrets/ISecretManager'
import { IWalletHandler } from '../../application/contracts/IWalletHandler'

function decodeKeypairFromBase58Secret(secretBase58: string): Keypair {
  const secret = bs58.decode(secretBase58)

  // Common formats:
  // - 64 bytes: web3.js Keypair secretKey (private + public)
  // - 32 bytes: seed
  if (secret.length === 64) return Keypair.fromSecretKey(secret)
  if (secret.length === 32) return Keypair.fromSeed(secret)

  throw new Error(
    `Invalid SOLANA_PRIVATE_KEY: expected base58 for 64-byte secretKey (or 32-byte seed), got ${secret.length} bytes.`,
  )
}

function toBaseUnits(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Invalid amount: ${amount}`)
  }

  const s = toPlainDecimalString(amount)
  if (s.startsWith('-')) throw new Error('Amount must be positive')

  let [whole = '0', frac = ''] = s.split('.')
  whole = whole.replace(/^0+(?=\d)/, '') || '0'
  frac = frac.replace(/[^0-9]/g, '')

  const base = 10n ** BigInt(decimals)
  let wholeBI = BigInt(whole)

  // Round to `decimals` fractional digits
  if (frac.length > decimals) {
    const kept = frac.slice(0, decimals)
    const next = frac[decimals] ?? '0'

    let fracBI = BigInt(kept || '0')
    if (next >= '5') {
      fracBI += 1n
      if (fracBI >= base) {
        fracBI -= base
        wholeBI += 1n
      }
    }

    return wholeBI * base + fracBI
  }

  const fracStr = frac.padEnd(decimals, '0')
  return wholeBI * base + BigInt(fracStr || '0')
}

function toPlainDecimalString(n: number): string {
  const s = n.toString()
  if (!/[eE]/.test(s)) return s

  // Convert scientific notation to plain decimals
  const [mantissaRaw, expRaw] = s.split(/[eE]/)
  const exp = Number.parseInt(expRaw, 10)
  if (!Number.isFinite(exp)) return s

  let mantissa = mantissaRaw
  let sign = ''
  if (mantissa.startsWith('-')) {
    sign = '-'
    mantissa = mantissa.slice(1)
  }

  const [intPart, fracPart = ''] = mantissa.split('.')
  const digits = (intPart + fracPart).replace(/^0+(?=\d)/, '') || '0'
  const decimalPos = intPart.length
  const newDecimalPos = decimalPos + exp

  if (digits === '0') return '0'

  if (newDecimalPos <= 0) {
    return `${sign}0.${'0'.repeat(-newDecimalPos)}${digits}`
  }
  if (newDecimalPos >= digits.length) {
    return `${sign}${digits}${'0'.repeat(newDecimalPos - digits.length)}`
  }
  return `${sign}${digits.slice(0, newDecimalPos)}.${digits.slice(newDecimalPos)}`
}

@injectable()
export class SolanaWalletHandler implements IWalletHandler {
  constructor(
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
    @inject(TYPES.ILogger) private readonly logger: ILogger,
  ) {}

  async getAddressFromTransaction({}: { onChainId?: string }): Promise<string> {
    throw new Error('Solana does not support fetching address from transaction ID')
  }

  /**
   * Send cryptocurrency to the specified address on the Solana network
   * @param params The parameters for the transaction
   * @returns Object indicating success and transaction ID
   */
  async send({
    address,
    amount,
    cryptoCurrency,
  }: {
    address: string
    amount: number
    cryptoCurrency: CryptoCurrency
    memo?: string
  }): Promise<{ success: boolean, transactionId?: string }> {
    try {
      if (cryptoCurrency !== CryptoCurrency.USDC) {
        this.logger.warn('Unsupported cryptocurrency for Solana', cryptoCurrency)
        return { success: false }
      }

      const rpcUrl = await this.secretManager.getSecret(Secrets.SOLANA_RPC_URL)
      const privateKeyBase58 = await this.secretManager.getSecret(Secrets.SOLANA_PRIVATE_KEY)
      const usdcMintAddress = await this.secretManager.getSecret(Secrets.SOLANA_USDC_MINT)

      const connection = new Connection(rpcUrl, 'confirmed')
      const senderKeypair = decodeKeypairFromBase58Secret(privateKeyBase58)
      const destinationPubkey = new PublicKey(address)
      const usdcMint = new PublicKey(usdcMintAddress)

      // Guard: mint must exist on this cluster (catches mainnet/devnet mismatch)
      const mintInfo = await connection.getAccountInfo(usdcMint, 'confirmed')
      if (!mintInfo) {
        throw new Error(
          'USDC mint not found on this cluster (check SOLANA_RPC_URL vs SOLANA_USDC_MINT).',
        )
      }

      // Ensure token accounts exist (payer = sender)
      const senderTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        senderKeypair,
        usdcMint,
        senderKeypair.publicKey,
      )

      const destinationTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        senderKeypair,
        usdcMint,
        destinationPubkey,
      )

      // USDC has 6 decimals on Solana
      const amountInBaseUnits = toBaseUnits(amount, 6)

      const transferInstruction = createTransferInstruction(
        senderTokenAccount.address,
        destinationTokenAccount.address,
        senderKeypair.publicKey,
        amountInBaseUnits,
        [],
      )

      // IMPORTANT: fetch blockhash LAST (after extra RPC calls) to avoid expiration
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')

      const message = new TransactionMessage({
        instructions: [transferInstruction],
        payerKey: senderKeypair.publicKey,
        recentBlockhash: blockhash,
      }).compileToV0Message()

      const versionedTransaction = new VersionedTransaction(message)
      versionedTransaction.sign([senderKeypair])

      const signature = await connection.sendTransaction(versionedTransaction, {
        maxRetries: 3,
        preflightCommitment: 'confirmed',
        skipPreflight: false,
      })

      const confirmationStrategy: TransactionConfirmationStrategy = {
        blockhash,
        lastValidBlockHeight,
        signature,
      }

      const confirmation = await connection.confirmTransaction(confirmationStrategy, 'confirmed')

      // CRITICAL: confirmTransaction may return but still contain an on-chain error
      if (confirmation.value.err) {
        throw new Error(`Solana tx failed: ${JSON.stringify(confirmation.value.err)}`)
      }

      return { success: true, transactionId: signature }
    }
    catch (error: unknown) {
      const reason = this.describeError(error)

      // Many web3.js send failures include preflight logs on `error.logs`
      const maybeErr = error as { logs?: unknown, signature?: unknown }
      const logs = maybeErr?.logs
      const signature = maybeErr?.signature

      this.logger.error('Error sending Solana transaction', {
        error,
        logs,
        reason: reason || 'Unknown error (empty reason)',
        signature,
      })

      return { success: false }
    }
  }

  private describeError(error: unknown): string {
    if (error == null) return String(error)

    if (error instanceof Error) {
      return error.message || error.name || 'Error'
    }

    if (typeof error === 'string') {
      return error
    }

    const maybeMessage = (error as { message?: unknown })?.message
    if (typeof maybeMessage === 'string') {
      return maybeMessage
    }

    try {
      return JSON.stringify(error)
    }
    catch {
      return String(error)
    }
  }
}
