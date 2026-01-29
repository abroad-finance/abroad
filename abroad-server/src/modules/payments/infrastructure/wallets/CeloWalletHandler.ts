import { BlockchainNetwork, CryptoCurrency } from '@prisma/client'
import { BigNumber, ethers } from 'ethers'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { ILogger } from '../../../../core/logging/types'
import { ISecretManager, Secrets } from '../../../../platform/secrets/ISecretManager'
import { IWalletHandler, WalletSendParams, WalletSendResult } from '../../application/contracts/IWalletHandler'
import { parseErc20Transfers, safeNormalizeAddress } from './celoErc20'

type CeloWalletContext = {
  depositAddress: string
  provider: ethers.providers.JsonRpcProvider
  signer: ethers.Wallet
  usdcAddress: string
}

@injectable()
export class CeloWalletHandler implements IWalletHandler {
  public readonly capability = { blockchain: BlockchainNetwork.CELO }
  private cachedProvider?: { provider: ethers.providers.JsonRpcProvider, rpcUrl: string }

  public constructor(
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
    @inject(TYPES.ILogger) private readonly logger: ILogger,
  ) {}

  public async getAddressFromTransaction({ onChainId }: { onChainId?: string }): Promise<string> {
    if (!onChainId) {
      throw new Error('Missing on-chain transaction id')
    }

    const context = await this.buildContext()
    const receipt = await context.provider.getTransactionReceipt(onChainId)
    if (!receipt) {
      throw new Error('Transaction not found on Celo')
    }

    if (receipt.status !== 1) {
      throw new Error('Transaction failed on-chain')
    }

    const transfers = parseErc20Transfers(receipt, context.usdcAddress)
      .filter(transfer => transfer.to === context.depositAddress)

    if (transfers.length === 0) {
      throw new Error('No USDC transfer to the configured wallet found in this transaction')
    }

    const uniqueSenders = new Set(transfers.map(transfer => transfer.from))
    if (uniqueSenders.size > 1) {
      throw new Error('Multiple senders found for USDC transfers')
    }

    const sender = transfers[0]?.from
    if (!sender) {
      throw new Error('Missing sender address in transfer logs')
    }

    return sender
  }

  public async send({ address, amount, cryptoCurrency }: WalletSendParams): Promise<WalletSendResult> {
    if (cryptoCurrency !== CryptoCurrency.USDC) {
      this.logger.warn('[CeloWalletHandler] Unsupported cryptocurrency', cryptoCurrency)
      return { code: 'validation', reason: 'unsupported_currency', success: false }
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return { code: 'validation', reason: 'invalid_amount', success: false }
    }

    try {
      const context = await this.buildContext()
      const destination = safeNormalizeAddress(address)
      if (!destination) {
        return { code: 'validation', reason: 'invalid_destination', success: false }
      }

      const amountInBaseUnits = this.toBaseUnits(amount, 6)
      const erc20 = new ethers.Contract(
        context.usdcAddress,
        ['function transfer(address to, uint256 value) returns (bool)'],
        context.signer,
      )

      const tx = await erc20.transfer(destination, amountInBaseUnits)
      const receipt = await tx.wait()

      if (receipt.status !== 1) {
        return { code: 'retriable', reason: 'transaction_failed', success: false, transactionId: tx.hash }
      }

      return { success: true, transactionId: tx.hash }
    }
    catch (error: unknown) {
      const reason = this.describeError(error)
      this.logger.error('[CeloWalletHandler] Failed to send USDC', { error, reason })
      return { code: 'retriable', reason, success: false }
    }
  }

  private async buildContext(): Promise<CeloWalletContext> {
    const {
      CELO_DEPOSIT_ADDRESS: depositAddressRaw,
      CELO_PRIVATE_KEY: privateKey,
      CELO_RPC_URL: rpcUrl,
      CELO_USDC_ADDRESS: usdcAddressRaw,
    } = await this.secretManager.getSecrets([
      Secrets.CELO_RPC_URL,
      Secrets.CELO_PRIVATE_KEY,
      Secrets.CELO_DEPOSIT_ADDRESS,
      Secrets.CELO_USDC_ADDRESS,
    ])

    const depositAddress = safeNormalizeAddress(depositAddressRaw)
    const usdcAddress = safeNormalizeAddress(usdcAddressRaw)
    if (!depositAddress || !usdcAddress) {
      throw new Error('Invalid Celo address configuration')
    }

    const provider = this.getOrCreateProvider(rpcUrl)
    const signer = new ethers.Wallet(privateKey, provider)

    return {
      depositAddress,
      provider,
      signer,
      usdcAddress,
    }
  }

  private describeError(error: unknown): string {
    if (error instanceof Error) {
      return error.message || 'Error'
    }
    if (typeof error === 'string') {
      return error
    }
    return 'Unknown error'
  }

  private getOrCreateProvider(rpcUrl: string): ethers.providers.JsonRpcProvider {
    if (this.cachedProvider && this.cachedProvider.rpcUrl === rpcUrl) {
      return this.cachedProvider.provider
    }

    const provider = new ethers.providers.JsonRpcProvider(rpcUrl)

    this.cachedProvider = { provider, rpcUrl }
    return provider
  }

  private toBaseUnits(amount: number, decimals: number): BigNumber {
    const normalized = this.toPlainDecimalString(amount)
    return ethers.utils.parseUnits(normalized, decimals)
  }

  private toPlainDecimalString(value: number): string {
    const stringValue = value.toString()
    if (!/[eE]/.test(stringValue)) return stringValue

    const [mantissaRaw, expRaw] = stringValue.split(/[eE]/)
    const exp = Number.parseInt(expRaw, 10)
    if (!Number.isFinite(exp)) return stringValue

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
}
