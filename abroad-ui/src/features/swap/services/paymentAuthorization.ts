import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import {
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import {
  Asset,
  BASE_FEE,
  Horizon,
  Memo,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} from '@stellar/stellar-sdk'
import { getAddress, Interface, parseUnits } from 'ethers'

import type { IWallet } from '@/interfaces/IWallet'

import { fromBase64, toBase64 } from '@/services/wallets/shared/wallet-connect-base'

import type { PaymentContextSnapshot } from '../model/paymentIntent'

export type PaymentAuthorizationFailureKind
  = | 'broadcast-unknown'
    | 'insufficient-balance'
    | 'preparation-failed'
    | 'wallet-rejected'

type Translate = (key: string, fallback: string) => string

export class PaymentAuthorizationError extends Error {
  public readonly kind: PaymentAuthorizationFailureKind

  constructor(kind: PaymentAuthorizationFailureKind, message: string, cause?: unknown) {
    super(message)
    if (cause !== undefined) {
      Object.defineProperty(this, 'cause', {
        configurable: true,
        enumerable: false,
        value: cause,
        writable: true,
      })
    }
    this.name = 'PaymentAuthorizationError'
    this.kind = kind
  }
}

const parseAmountUnits = (amount: number, decimals: number): bigint => {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('invalid_amount')
  }
  return parseUnits(String(amount), decimals)
}

const resolveStellarNetworkPassphrase = (chainId: string): string => (
  chainId.toLowerCase().includes('test') ? Networks.TESTNET : Networks.PUBLIC
)

const errorCode = (error: unknown): null | number => {
  if (!error || typeof error !== 'object' || Array.isArray(error)) return null
  const code = (error as Record<string, unknown>).code
  return typeof code === 'number' ? code : null
}

export const isWalletRejection = (error: unknown): boolean => {
  if (errorCode(error) === 4001) return true
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return message.includes('user rejected')
    || message.includes('user denied')
    || message.includes('request rejected')
    || message.includes('cancelled by user')
    || message.includes('canceled by user')
}

const isInsufficientBalance = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return (message.includes('insufficient') || message.includes('exceeds balance'))
    && (message.includes('balance') || message.includes('funds'))
}

const buildStellarPaymentXdr = async ({ context, source }: {
  context: PaymentContextSnapshot
  source: string
}): Promise<{ horizon: Horizon.Server, networkPassphrase: string, unsignedXdr: string }> => {
  if (!context.mintAddress) throw new Error('missing_asset')
  const horizon = new Horizon.Server(context.rpcUrl || 'https://horizon.stellar.org')
  const account = await horizon.loadAccount(source)
  const fee = await horizon.fetchBaseFee()
  const networkPassphrase = resolveStellarNetworkPassphrase(context.chainId)
  let builder = new TransactionBuilder(account, {
    fee: String(fee || BASE_FEE),
    networkPassphrase,
  })
    .addOperation(Operation.payment({
      amount: String(context.amount),
      asset: new Asset(context.cryptoCurrency, context.mintAddress),
      destination: context.depositAddress,
    }))
    .setTimeout(180)
  if (context.memo) builder = builder.addMemo(Memo.text(context.memo))
  return {
    horizon,
    networkPassphrase,
    unsignedXdr: builder.build().toXDR(),
  }
}

const requireWalletRequest = (
  wallet: IWallet,
  context: PaymentContextSnapshot,
): { amountUnits: bigint, mintAddress: string, request: NonNullable<IWallet['request']> } => {
  if (!wallet.request) throw new Error('unsupported_wallet')
  if (!context.mintAddress) throw new Error('missing_asset')
  if (context.decimals === null) throw new Error('missing_decimals')
  return {
    amountUnits: parseAmountUnits(context.amount, context.decimals),
    mintAddress: context.mintAddress,
    request: wallet.request,
  }
}

const safePreparationMessage = (error: unknown, t: Translate): string => {
  if (isInsufficientBalance(error)) {
    return t('swap.errors.insufficient_balance', 'Your wallet does not have enough balance to authorize this payment.')
  }
  return t('swap.errors.authorization_preparation', 'We could not prepare the wallet authorization. Your Abroad request is saved; you can safely resume authorization.')
}

export const authorizeAcceptedPayment = async ({ context, t, wallet }: {
  context: PaymentContextSnapshot
  t: Translate
  wallet: IWallet
}): Promise<{ onChainId: string }> => {
  let broadcastAttempted = false

  try {
    if (!wallet.address || !wallet.chainId) throw new Error('missing_wallet')
    if (wallet.chainId !== context.chainId) throw new Error('network_mismatch')

    if (context.chainFamily === 'stellar') {
      const { horizon, networkPassphrase, unsignedXdr } = await buildStellarPaymentXdr({
        context,
        source: wallet.address,
      })
      const { signedTxXdr } = await wallet.signTransaction({ message: unsignedXdr })
      const transaction = new Transaction(signedTxXdr, networkPassphrase)
      broadcastAttempted = true
      const result = await horizon.submitTransaction(transaction)
      return { onChainId: result.hash }
    }

    if (context.chainFamily === 'solana') {
      if (!context.rpcUrl) throw new Error('missing_rpc')
      const { amountUnits, mintAddress, request } = requireWalletRequest(wallet, context)
      const connection = new Connection(context.rpcUrl, 'confirmed')
      const mint = new PublicKey(mintAddress)
      const owner = new PublicKey(wallet.address)
      const destinationOwner = new PublicKey(context.depositAddress)
      const sourceAta = await getAssociatedTokenAddress(mint, owner)
      const destinationAta = await getAssociatedTokenAddress(mint, destinationOwner, true)
      const sourceInfo = await connection.getAccountInfo(sourceAta)
      if (!sourceInfo) throw new Error('insufficient balance')

      const instructions: TransactionInstruction[] = []
      const destinationInfo = await connection.getAccountInfo(destinationAta)
      if (!destinationInfo) {
        instructions.push(createAssociatedTokenAccountInstruction(
          owner,
          destinationAta,
          destinationOwner,
          mint,
        ))
      }
      instructions.push(createTransferInstruction(
        sourceAta,
        destinationAta,
        owner,
        amountUnits,
        [],
        TOKEN_PROGRAM_ID,
      ))

      const { blockhash } = await connection.getLatestBlockhash()
      const message = new TransactionMessage({
        instructions,
        payerKey: owner,
        recentBlockhash: blockhash,
      }).compileToV0Message()
      const unsignedTransaction = new VersionedTransaction(message)
      const signed = await request<string | { signedTransaction?: string, transaction?: string }>({
        chainId: context.chainId,
        method: 'solana_signTransaction',
        params: {
          pubkey: wallet.address,
          transaction: toBase64(unsignedTransaction.serialize()),
        },
      })
      const signedBase64 = typeof signed === 'string' ? signed : signed.signedTransaction || signed.transaction
      if (!signedBase64) throw new Error('missing_signature')
      broadcastAttempted = true
      const signature = await connection.sendRawTransaction(fromBase64(signedBase64))
      return { onChainId: signature }
    }

    const { amountUnits, mintAddress, request } = requireWalletRequest(wallet, context)
    const tokenAddress = getAddress(mintAddress)
    const destinationAddress = getAddress(context.depositAddress)
    const iface = new Interface(['function transfer(address to, uint256 value)'])
    const data = iface.encodeFunctionData('transfer', [destinationAddress, amountUnits])
    broadcastAttempted = true
    const transactionHash = await request<string>({
      chainId: context.chainId,
      method: 'eth_sendTransaction',
      params: [{
        data,
        from: wallet.address,
        to: tokenAddress,
        value: '0x0',
      }],
    })
    if (typeof transactionHash !== 'string' || transactionHash.length === 0) {
      throw new Error('missing_transaction_hash')
    }
    return { onChainId: transactionHash }
  }
  catch (error) {
    if (error instanceof PaymentAuthorizationError) throw error
    if (isWalletRejection(error)) {
      throw new PaymentAuthorizationError(
        'wallet-rejected',
        t('swap.errors.wallet_rejected_saved', 'Wallet authorization was cancelled. Your Abroad request is saved and no duplicate request will be created.'),
        error,
      )
    }
    if (broadcastAttempted) {
      throw new PaymentAuthorizationError(
        'broadcast-unknown',
        t('swap.errors.broadcast_unknown', 'The network did not confirm whether the transfer was sent. Do not submit it again while Abroad reconciles the result.'),
        error,
      )
    }
    throw new PaymentAuthorizationError(
      isInsufficientBalance(error) ? 'insufficient-balance' : 'preparation-failed',
      safePreparationMessage(error, t),
      error,
    )
  }
}
