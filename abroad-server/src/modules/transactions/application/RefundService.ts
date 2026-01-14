import { BlockchainNetwork, CryptoCurrency } from '@prisma/client'

import { createScopedLogger, ScopedLogger } from '../../../core/logging/scopedLogger'
import { ILogger } from '../../../core/logging/types'
import { WalletSendResult } from '../../payments/application/contracts/IWalletHandler'
import { IWalletHandlerFactory } from '../../payments/application/contracts/IWalletHandlerFactory'

export type RefundResult = WalletSendResult

/**
 * Handles outbound refunds across blockchains via the injected wallet handlers.
 * This is intentionally isolated so it can be reused by both the transaction workflow
 * and ancillary flows (e.g., orphan Stellar payments without memos).
 */
export class RefundService {
  private readonly logger: ScopedLogger

  constructor(
    private readonly walletHandlerFactory: IWalletHandlerFactory,
    baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'RefundService' })
  }

  public async refundByOnChainId(params: {
    amount: number
    cryptoCurrency: Parameters<RefundService['refundToSender']>[0]['cryptoCurrency']
    network: Parameters<IWalletHandlerFactory['getWalletHandler']>[0]
    onChainId: string
  }): Promise<RefundResult> {
    const { amount, cryptoCurrency, network, onChainId } = params
    const walletHandler = this.walletHandlerFactory.getWalletHandlerForCapability?.({ blockchain: network })
      ?? this.walletHandlerFactory.getWalletHandler(network)
    const address = await walletHandler.getAddressFromTransaction({ onChainId })
    return walletHandler.send({ address, amount, cryptoCurrency })
  }

  public async refundToSender(message: {
    addressFrom: string
    amount: number
    blockchain: BlockchainNetwork
    cryptoCurrency: CryptoCurrency
  }): Promise<RefundResult> {
    const walletHandler = this.walletHandlerFactory.getWalletHandlerForCapability?.({ blockchain: message.blockchain })
      ?? this.walletHandlerFactory.getWalletHandler(message.blockchain)
    return walletHandler.send({
      address: message.addressFrom,
      amount: message.amount,
      cryptoCurrency: message.cryptoCurrency,
    })
  }

  public resolveWalletHandler(blockchain: Parameters<IWalletHandlerFactory['getWalletHandler']>[0]) {
    return this.walletHandlerFactory.getWalletHandlerForCapability?.({ blockchain })
      ?? this.walletHandlerFactory.getWalletHandler(blockchain)
  }
}
