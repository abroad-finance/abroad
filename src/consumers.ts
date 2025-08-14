import dotenv from 'dotenv'

import { BinanceBalanceUpdatedController } from './controllers/queue/BinanceBalanceUpdatedController'
import { PaymentSentController } from './controllers/queue/PaymentSentController'
import { ReceivedCryptoTransactionController } from './controllers/queue/ReceivedCryptoTransactionController'
import { IAuthService } from './interfaces'
import { iocContainer } from './ioc'
import { TYPES } from './types'

dotenv.config()

iocContainer
  .get<ReceivedCryptoTransactionController>(
    TYPES.ReceivedCryptoTransactionController,
  )
  .registerConsumers()

iocContainer
  .get<PaymentSentController>(TYPES.PaymentSentController)
  .registerConsumers()

iocContainer
  .get<BinanceBalanceUpdatedController>(TYPES.BinanceBalanceUpdatedController)
  .registerConsumers()

iocContainer.get<IAuthService>(TYPES.IAuthService).initialize()
