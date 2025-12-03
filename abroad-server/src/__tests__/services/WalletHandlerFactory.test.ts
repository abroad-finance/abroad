import { BlockchainNetwork } from '@prisma/client'

import type { IWalletHandler } from '../../interfaces/IWalletHandler'

import { WalletHandlerFactory } from '../../services/WalletHandlerFactory'

const buildHandler = (label: string): IWalletHandler => ({
  getAddressFromTransaction: async () => `${label}-address`,
  send: async () => ({ success: true, transactionId: `${label}-tx` }),
})

describe('WalletHandlerFactory', () => {
  const solanaHandler = buildHandler('solana')
  const stellarHandler = buildHandler('stellar')

  it('returns the correct handler per network', () => {
    const factory = new WalletHandlerFactory(solanaHandler, stellarHandler)

    expect(factory.getWalletHandler(BlockchainNetwork.SOLANA)).toBe(solanaHandler)
    expect(factory.getWalletHandler(BlockchainNetwork.STELLAR)).toBe(stellarHandler)
  })

  it('throws on unsupported networks', () => {
    const factory = new WalletHandlerFactory(solanaHandler, stellarHandler)

    expect(() => factory.getWalletHandler('POLYGON' as BlockchainNetwork))
      .toThrow('Unsupported blockchain network: POLYGON')
  })
})
