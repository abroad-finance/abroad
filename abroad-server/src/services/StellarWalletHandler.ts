import { CryptoCurrency } from '@prisma/client'
import {
  Asset,
  Horizon,
  Keypair,
  Memo,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk'
import { inject, injectable } from 'inversify'

import { ILockManager } from '../interfaces/ILockManager'
import { ISecretManager } from '../interfaces/ISecretManager'
import { IWalletHandler } from '../interfaces/IWalletHandler'
import { TYPES } from '../types'

function safeMemo(m: string): string {
  // Memo.text must be <= 28 bytes (UTF-8). Trim if user passes longer text.
  const enc = new TextEncoder()
  if (enc.encode(m).length <= 28) return m
  let s = m
  while (enc.encode(s).length > 28 && s.length > 0) s = s.slice(0, -1)
  return s
}

function toStellarAmount(n: number): string {
  // <= 7 decimals; strip trailing zeros and trailing dot
  return n.toFixed(7).replace(/\.?0+$/, '')
}

@injectable()
export class StellarWalletHandler implements IWalletHandler {
  constructor(
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
    @inject(TYPES.ILockManager) private lockManager: ILockManager,
  ) {}

  async getAddressFromTransaction({ onChainId }: { onChainId?: string }): Promise<string> {
    if (!onChainId) {
      throw new Error('onChainId is required to get address from transaction')
    }

    const horizonUrl = await this.secretManager.getSecret('STELLAR_HORIZON_URL')
    const server = new Horizon.Server(horizonUrl)
    try {
      const op = await server.operations().operation(onChainId).call()
      return op.source_account || ''
    }
    catch (error) {
      console.error('Error fetching Stellar transaction:', error, onChainId)
      throw new Error(`Failed to fetch transaction with ID ${onChainId}`)
    }
  }

  /**
   * Send cryptocurrency to the specified address on the Stellar network.
   * Uses a Redis-backed distributed lock to serialize submissions per source account.
   */
  async send({
    address,
    amount,
    cryptoCurrency,
    memo,
  }: {
    address: string
    amount: number
    cryptoCurrency: CryptoCurrency
    memo?: string
  }): Promise<{ success: boolean, transactionId?: string }> {
    try {
      if (cryptoCurrency !== CryptoCurrency.USDC) {
        throw new Error(`Unsupported cryptocurrency for Stellar: ${cryptoCurrency}`)
      }

      const horizonUrl = await this.secretManager.getSecret('STELLAR_HORIZON_URL')
      const privateKey = await this.secretManager.getSecret('STELLAR_PRIVATE_KEY')
      const usdcIssuer = await this.secretManager.getSecret('STELLAR_USDC_ISSUER')

      const server = new Horizon.Server(horizonUrl)
      const sourceKeypair = Keypair.fromSecret(privateKey)
      const sourcePublicKey = sourceKeypair.publicKey()

      // 🔒 Serialize all txs per source account across ALL nodes
      const LOCK_TTL_MS = 20_000 // long enough for load+build+submit; auto-extends if needed
      const result = await this.lockManager.withLock(sourcePublicKey, LOCK_TTL_MS, async () => {
        const sourceAccount = await server.loadAccount(sourcePublicKey)
        const fee = await server.fetchBaseFee()

        const usdcAsset = new Asset(cryptoCurrency, usdcIssuer)
        const amountStr = toStellarAmount(amount)

        const builder = new TransactionBuilder(sourceAccount, {
          fee: fee.toString(),
          networkPassphrase: Networks.PUBLIC,
        })

        if (memo) builder.addMemo(Memo.text(safeMemo(memo)))

        builder.addOperation(
          Operation.payment({
            amount: amountStr,
            asset: usdcAsset,
            destination: address,
          }),
        )

        const tx = builder.setTimeout(30).build()
        tx.sign(sourceKeypair)

        const submitResp = await this.submitWithRetry(server, tx)
        return submitResp.hash as string
      })

      return { success: true, transactionId: result }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    catch (error: any) {
      const rc = error?.response?.data?.extras?.result_codes
      console.error('Error sending Stellar transaction', {
        data: error?.response?.data,
        err: error,
        result_codes: rc,
        status: error?.response?.status,
      })
      return { success: false }
    }
  }

  /** Submit once; on 504 or timeout, check by hash and then resubmit the SAME envelope once. */
  private async submitWithRetry(server: Horizon.Server, tx: Transaction) {
    try {
      return await server.submitTransaction(tx)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    catch (error: any) {
      const status = error?.response?.status
      const message: string | undefined = error?.message

      const isTimeout
        = status === 504 || (typeof message === 'string' && /timeout|timed out/i.test(message))

      if (!isTimeout) throw error

      // Did it actually make it into the ledger?
      try {
        const hashHex = tx.hash().toString('hex')
        const existing = await server.transactions().transaction(hashHex).call()
        if (existing) return existing
      }
      catch {
        // not found; proceed to one resubmission
      }

      // Resubmit the exact same envelope ONCE
      return await server.submitTransaction(tx)
    }
  }
}
