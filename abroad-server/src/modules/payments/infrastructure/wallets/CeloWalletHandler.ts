import { BlockchainNetwork } from '@prisma/client'
import { BigNumber, ethers } from 'ethers'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../../app/container/types'
import { ILogger } from '../../../../core/logging/types'
import { ISecretManager, Secrets } from '../../../../platform/secrets/ISecretManager'
import { IWalletHandler, WalletSendParams, WalletSendResult } from '../../application/contracts/IWalletHandler'
import { CryptoAssetConfigService } from '../../application/CryptoAssetConfigService'
import { fetchErc20Decimals, parseErc20Transfers, safeNormalizeAddress } from './celoErc20'

type CeloReceiptContext = {
  depositAddress: string
  provider: ethers.providers.JsonRpcProvider
}

type CeloSendContext = {
  provider: ethers.providers.JsonRpcProvider
  signer: ethers.Wallet
  tokenAddress: string
  tokenDecimals: number
}

@injectable()
export class CeloWalletHandler implements IWalletHandler {
  public readonly capability = { blockchain: BlockchainNetwork.CELO }
  private cachedProvider?: { provider: ethers.providers.JsonRpcProvider, rpcUrl: string }
  private readonly tokenDecimalsCache = new Map<string, number>()

  public constructor(
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
    @inject(CryptoAssetConfigService) private readonly assetConfigService: CryptoAssetConfigService,
    @inject(TYPES.ILogger) private readonly logger: ILogger,
  ) {}

  public async getAddressFromTransaction({ onChainId }: { onChainId?: string }): Promise<string> {
    if (!onChainId) {
      throw new Error('Missing on-chain transaction id')
    }

    const context = await this.buildReceiptContext()
    const receipt = await context.provider.getTransactionReceipt(onChainId)
    if (!receipt) {
      throw new Error('Transaction not found on Celo')
    }

    if (receipt.status !== 1) {
      throw new Error('Transaction failed on-chain')
    }

    const enabledAssets = await this.assetConfigService.listEnabledAssets(BlockchainNetwork.CELO)
    const validAssets = enabledAssets.flatMap((asset) => {
      const tokenAddress = safeNormalizeAddress(asset.mintAddress)
      if (!tokenAddress) {
        return []
      }
      return [{ tokenAddress }]
    })

    if (validAssets.length === 0) {
      throw new Error('No enabled Celo assets configured for this wallet')
    }

    const transfers = validAssets.flatMap(asset => (
      parseErc20Transfers(receipt, asset.tokenAddress)
        .filter(transfer => transfer.to === context.depositAddress)
    ))

    if (transfers.length === 0) {
      throw new Error('No transfer to the configured wallet found in this transaction')
    }

    const uniqueSenders = new Set(transfers.map(transfer => transfer.from))
    if (uniqueSenders.size > 1) {
      throw new Error('Multiple senders found for token transfers')
    }

    const sender = transfers[0]?.from
    if (!sender) {
      throw new Error('Missing sender address in transfer logs')
    }

    return sender
  }

  public async send({ address, amount, cryptoCurrency }: WalletSendParams): Promise<WalletSendResult> {
    if (!Number.isFinite(amount) || amount <= 0) {
      return { code: 'validation', reason: 'invalid_amount', success: false }
    }

    try {
      const assetConfig = await this.assetConfigService.getActiveMint({
        blockchain: BlockchainNetwork.CELO,
        cryptoCurrency,
      })
      if (!assetConfig) {
        this.logger.warn('[CeloWalletHandler] Unsupported cryptocurrency', cryptoCurrency)
        return { code: 'validation', reason: 'unsupported_currency', success: false }
      }

      const context = await this.buildSendContext(assetConfig)
      const destination = safeNormalizeAddress(address)
      if (!destination) {
        return { code: 'validation', reason: 'invalid_destination', success: false }
      }

      const amountInBaseUnits = this.toBaseUnits(amount, context.tokenDecimals)
      const erc20 = new ethers.Contract(
        context.tokenAddress,
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
      this.logger.error('[CeloWalletHandler] Failed to send token', { error, reason })
      return { code: 'retriable', reason, success: false }
    }
  }

  private async buildReceiptContext(): Promise<CeloReceiptContext> {
    const {
      CELO_DEPOSIT_ADDRESS: depositAddressRaw,
      CELO_RPC_URL: rpcUrl,
    } = await this.secretManager.getSecrets([
      Secrets.CELO_RPC_URL,
      Secrets.CELO_DEPOSIT_ADDRESS,
    ])

    const depositAddress = safeNormalizeAddress(depositAddressRaw)
    if (!depositAddress) {
      throw new Error('Invalid Celo address configuration')
    }

    const provider = this.getOrCreateProvider(rpcUrl)

    return {
      depositAddress,
      provider,
    }
  }

  private async buildSendContext(assetConfig: { decimals: null | number, mintAddress: string }): Promise<CeloSendContext> {
    const { CELO_PRIVATE_KEY: privateKey, CELO_RPC_URL: rpcUrl } = await this.secretManager.getSecrets([
      Secrets.CELO_RPC_URL,
      Secrets.CELO_PRIVATE_KEY,
    ])

    const provider = this.getOrCreateProvider(rpcUrl)
    const signer = new ethers.Wallet(privateKey, provider)
    const tokenAddress = safeNormalizeAddress(assetConfig.mintAddress)
    if (!tokenAddress) {
      throw new Error('Invalid token address configuration')
    }

    const tokenDecimals = await this.resolveTokenDecimals(provider, tokenAddress, assetConfig.decimals)

    return {
      provider,
      signer,
      tokenAddress,
      tokenDecimals,
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
