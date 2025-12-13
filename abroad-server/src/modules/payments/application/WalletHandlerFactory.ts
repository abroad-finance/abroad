// src/modules/payments/application/WalletHandlerFactory.ts
import { BlockchainNetwork } from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IWalletHandler } from './contracts/IWalletHandler'
import { IWalletHandlerFactory } from './contracts/IWalletHandlerFactory'

@injectable()
export class WalletHandlerFactory implements IWalletHandlerFactory {
  constructor(
    @inject(TYPES.SolanaWalletHandler) private solanaWalletHandler: IWalletHandler,
    @inject(TYPES.StellarWalletHandler) private stellarWalletHandler: IWalletHandler,
  ) {}

  /**
   * Returns the appropriate wallet handler based on the blockchain network
   * @param blockchain The blockchain network for which to get a wallet handler
   * @returns A wallet handler implementation for the specified blockchain
   */
  getWalletHandler(blockchain: BlockchainNetwork): IWalletHandler {
    switch (blockchain) {
      case BlockchainNetwork.SOLANA:
        return this.solanaWalletHandler
      case BlockchainNetwork.STELLAR:
        return this.stellarWalletHandler
      default:
        throw new Error(`Unsupported blockchain network: ${blockchain}`)
    }
  }
}
