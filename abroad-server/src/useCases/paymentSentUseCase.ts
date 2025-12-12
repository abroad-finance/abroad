import { BlockchainNetwork, CryptoCurrency, SupportedCurrency, TargetCurrency } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { ILogger, ISlackNotifier, IWalletHandlerFactory } from '../interfaces'
import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
import { IExchangeProviderFactory } from '../interfaces/IExchangeProviderFactory'
import { PaymentSentMessage, PaymentSentMessageSchema } from '../interfaces/queueSchema'
import { createScopedLogger } from '../shared/logging'
import { getCorrelationId } from '../shared/requestContext'
import { TYPES } from '../types'

export interface IPaymentSentUseCase {
  process(rawMessage: unknown): Promise<void>
}

@injectable()
export class PaymentSentUseCase implements IPaymentSentUseCase {
  private readonly exchangeErrorPrefix = 'Error exchanging'
  private readonly logPrefix = '[PaymentSent]'

  public constructor(
    @inject(TYPES.ILogger) private readonly logger: ILogger,
    @inject(TYPES.IWalletHandlerFactory) private readonly walletHandlerFactory: IWalletHandlerFactory,
    @inject(TYPES.ISlackNotifier) private readonly slackNotifier: ISlackNotifier,
    @inject(TYPES.IDatabaseClientProvider) private readonly dbClientProvider: IDatabaseClientProvider,
    @inject(TYPES.IExchangeProviderFactory) private readonly exchangeProviderFactory: IExchangeProviderFactory,
  ) { }

  public async process(rawMessage: unknown): Promise<void> {
    const logger = createScopedLogger(this.logger, {
      correlationId: getCorrelationId(),
      scope: '',
    })
    const message = this.parseMessage(rawMessage, logger)
    if (!message) {
      return
    }

    const { amount, blockchain, cryptoCurrency, targetCurrency } = message
    await this.sendToExchangeAndUpdatePendingConversions(logger, {
      amount,
      blockchain,
      cryptoCurrency,
      targetCurrency,
    })

    logger.info(
      `${this.logPrefix}: Payment sent successfully`,
    )
  }

  private buildPendingConversionUpdates(
    cryptoCurrency: CryptoCurrency,
    targetCurrency: TargetCurrency,
  ): Array<{ source: SupportedCurrency, symbol: string, target: SupportedCurrency }> {
    if (cryptoCurrency !== SupportedCurrency.USDC) {
      return []
    }

    if (targetCurrency === SupportedCurrency.COP) {
      return [
        { source: SupportedCurrency.USDC, symbol: 'USDCUSDT', target: SupportedCurrency.USDT },
        { source: SupportedCurrency.USDT, symbol: 'USDTCOP', target: SupportedCurrency.COP },
      ]
    }

    if (targetCurrency === SupportedCurrency.BRL) {
      return [{ source: SupportedCurrency.USDC, symbol: 'USDCBRL', target: SupportedCurrency.BRL }]
    }

    return []
  }

  private parseMessage(msg: unknown, logger: ILogger): PaymentSentMessage | undefined {
    const parsed = PaymentSentMessageSchema.safeParse(msg)
    if (!parsed.success) {
      logger.error(`${this.logPrefix}: Invalid message format:`, parsed.error)
      return undefined
    }

    return parsed.data
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
    const conversions = this.buildPendingConversionUpdates(cryptoCurrency, targetCurrency)
    for (const conversion of conversions) {
      await clientDb.pendingConversions.upsert({
        create: {
          amount,
          side: 'SELL',
          source: conversion.source,
          symbol: conversion.symbol,
          target: conversion.target,
        },
        update: {
          amount: { increment: amount },
        },
        where: {
          source_target: { source: conversion.source, target: conversion.target },
        },
      })
    }
  }

  private async sendToExchangeAndUpdatePendingConversions(
    logger: ILogger,
    {
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
        logger.error(`${this.logPrefix}: Error sending payment to exchange:`, transactionId)
        await this.slackNotifier.sendMessage(
          `${this.logPrefix}: ${this.exchangeErrorPrefix} ${amount} ${cryptoCurrency} to ${targetCurrency}.`,
        )
        return
      }

      const clientDb = await this.dbClientProvider.getClient()
      await this.persistPendingConversions(clientDb, { amount, cryptoCurrency, targetCurrency })
    }
    catch (error) {
      const errorMessage
        = `${this.logPrefix}: Failed to process exchange handoff for ${amount} ${cryptoCurrency} to ${targetCurrency}`
      logger.error(errorMessage, error)
      const errorDetail = error instanceof Error ? error.message : String(error)
      await this.slackNotifier.sendMessage(`${errorMessage}. Error: ${errorDetail}`)
      throw error
    }
  }
}
