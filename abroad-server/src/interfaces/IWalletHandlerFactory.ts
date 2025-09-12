import { BlockchainNetwork } from '@prisma/client'

import { IWalletHandler } from './IWalletHandler'

export interface IWalletHandlerFactory {
  getWalletHandler(blockchain: BlockchainNetwork): IWalletHandler
}
