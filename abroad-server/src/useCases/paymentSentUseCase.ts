import { BlockchainNetwork, CryptoCurrency, SupportedCurrency, TargetCurrency } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { ILogger, ISlackNotifier, IWalletHandlerFactory } from '../interfaces'
import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
import { IExchangeProviderFactory } from '../interfaces/IExchangeProviderFactory'
import { PaymentSentMessage, PaymentSentMessageSchema } from '../interfaces/queueSchema'
import { TYPES } from '../types'

export interface IPaymentSentUseCase {
  process(rawMessage: Record<string, boolean | number | string>): Promise<void>
}

@injectable()
export class PaymentSentUseCase implements IPaymentSentUseCase {
  private readonly logPrefix = '[PaymentSent]'

  public constructor(
    @inject(TYPES.ILogger) private readonly logger: ILogger,
    @inject(TYPES.IWalletHandlerFactory) private readonly walletHandlerFactory: IWalletHandlerFactory,
    @inject(TYPES.ISlackNotifier) private readonly slackNotifier: ISlackNotifier,
    @inject(TYPES.IDatabaseClientProvider) private readonly dbClientProvider: IDatabaseClientProvider,
    @inject(TYPES.IExchangeProviderFactory) private readonly exchangeProviderFactory: IExchangeProviderFactory,
  ) { }

  public async process(rawMessage: Record<string, boolean | number | string>): Promise<void> {
    const message = this.parseMessage(rawMessage)
    if (!message) {
      return
    }

    const { amount, blockchain, cryptoCurrency, targetCurrency } = message
    await this.sendToExchangeAndUpdatePendingConversions({
      amount,
      blockchain,
      cryptoCurrency,
      targetCurrency,
    })

    this.logger.info(
      `${this.logPrefix}: Payment sent successfully`,
    )
  }

  private parseMessage(msg: Record<string, boolean | number | string>): PaymentSentMessage | undefined {
    if (!msg || Object.keys(msg).length === 0) {
      this.logger.warn(
        `${this.logPrefix}: Received empty message. Skipping...`,
      )
      return undefined
    }

    try {
      return PaymentSentMessageSchema.parse(msg)
    }
    catch (error) {
      this.logger.error(`${this.logPrefix}: Invalid message format:`, error)
      return undefined
    }
  }

  private async persistPendingConversions(
    clientDb: Awaited<ReturnType<IDatabaseClientProvider['getClient']>>,
    {
      amount,
      cryptoCurrency,
      targetCurrency,
    }: {
      amount: number
      cryptoCurrency: CryptoCurrency
      targetCurrency: TargetCurrency
    },
  ): Promise<void> {
    if (cryptoCurrency === SupportedCurrency.USDC && targetCurrency === SupportedCurrency.COP) {
      await clientDb.pendingConversions.upsert({
        create: {
          amount,
          side: 'SELL',
          source: cryptoCurrency,
          symbol: 'USDCUSDT',
          target: SupportedCurrency.USDT,
        },
        update: {
          amount: { increment: amount },
        },
        where: {
          source_target: { source: cryptoCurrency, target: SupportedCurrency.USDT },
        },
      })

      await clientDb.pendingConversions.upsert({
        create: {
          amount,
          side: 'SELL',
          source: SupportedCurrency.USDT,
          symbol: 'USDTCOP',
          target: targetCurrency,
        },
        update: {
          amount: { increment: amount },
        },
        where: {
          source_target: { source: SupportedCurrency.USDT, target: targetCurrency },
        },
      })
      return
    }

    if (cryptoCurrency === SupportedCurrency.USDC && targetCurrency === SupportedCurrency.BRL) {
      await clientDb.pendingConversions.upsert({
        create: {
          amount,
          side: 'SELL',
          source: cryptoCurrency,
          symbol: 'USDCBRL',
          target: targetCurrency,
        },
        update: {
          amount: { increment: amount },
        },
        where: {
          source_target: { source: cryptoCurrency, target: targetCurrency },
        },
      })
    }
  }

  private async sendToExchangeAndUpdatePendingConversions({
    amount,
    blockchain,
    cryptoCurrency,
    targetCurrency,
  }: {
    amount: number
    blockchain: BlockchainNetwork
    cryptoCurrency: CryptoCurrency
    targetCurrency: TargetCurrency
  }): Promise<void> {
    try {
      const walletHandler = this.walletHandlerFactory.getWalletHandler(blockchain)
      const exchangeProvider = this.exchangeProviderFactory.getExchangeProvider(targetCurrency)
      const { address, memo } = await exchangeProvider.getExchangeAddress({ blockchain, cryptoCurrency })

      const { success, transactionId } = await walletHandler.send({ address, amount, cryptoCurrency, memo })

      if (!success) {
        this.logger.error(`${this.logPrefix}: Error sending payment to exchange:`, transactionId)
        await this.slackNotifier.sendMessage(
          `${this.logPrefix}: Error exchanging ${amount} ${cryptoCurrency} to ${targetCurrency}.`,
        )
        return
      }

      const clientDb = await this.dbClientProvider.getClient()
      await this.persistPendingConversions(clientDb, { amount, cryptoCurrency, targetCurrency })
    }
    catch (error) {
      const errorMessage
        = `${this.logPrefix}: Failed to process exchange handoff for ${amount} ${cryptoCurrency} to ${targetCurrency}`
      this.logger.error(errorMessage, error)
      const errorDetail = error instanceof Error ? error.message : String(error)
      await this.slackNotifier.sendMessage(`${errorMessage}. Error: ${errorDetail}`)
      throw error
    }
  }
}
