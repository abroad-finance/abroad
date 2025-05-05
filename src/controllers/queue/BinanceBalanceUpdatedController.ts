import { MainClient } from 'binance'
import { inject, injectable } from 'inversify'

import { ILogger, IQueueHandler, QueueName } from '../../interfaces'
import { ISecretManager } from '../../interfaces/ISecretManager'
import { TYPES } from '../../types'

@injectable()
export class BinanceBalanceUpdatedController {
  constructor(
        @inject(TYPES.ILogger) private logger: ILogger,
        @inject(TYPES.IQueueHandler) private queueHandler: IQueueHandler,
        @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
  ) { }

  public registerConsumers(): void {
    this.logger.info(
      '[BinanceBalanceUpdated queue]: Registering consumer for queue:',
      QueueName.BINANCE_BALANCE_UPDATED,
    )
    this.queueHandler.subscribeToQueue(
      QueueName.BINANCE_BALANCE_UPDATED,
      this.onBalanceUpdated.bind(this),
    )
  }

  private async onBalanceUpdated(
  ): Promise<void> {
    try {
      const apiKey = await this.secretManager.getSecret('BINANCE_API_KEY')
      const apiSecret = await this.secretManager.getSecret('BINANCE_API_SECRET')
      const apiUrl = await this.secretManager.getSecret('BINANCE_API_URL')

      const client = new MainClient({
        api_key: apiKey,
        api_secret: apiSecret,
        baseUrl: apiUrl,
      })

      const balances = await client.getBalances()
      const usdcBalance = balances.find(
        balance => balance.coin === 'USDC',
      )?.free

      this.logger.info(
        `[BinanceBalanceUpdated queue]: USDC balance: ${usdcBalance}`,
      )
    }
    catch (error) {
      this.logger.error(
        '[BinanceBalanceUpdated queue]: Error fetching USDC balance:',
        error,
      )
    }
  }
}
