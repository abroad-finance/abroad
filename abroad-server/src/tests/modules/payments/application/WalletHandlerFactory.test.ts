import { BlockchainNetwork } from '@prisma/client'

import type { IWalletHandler } from '../../../../modules/payments/application/contracts/IWalletHandler'

import { WalletHandlerFactory } from '../../../../modules/payments/application/WalletHandlerFactory'

const buildHandler = (label: string): IWalletHandler => ({
  getAddressFromTransaction: async () => `${label}-address`,
  send: async () => ({ success: true, transactionId: `${label}-tx` }),
})

describe('WalletHandlerFactory', () => {
  const celoHandler = buildHandler('celo')
  const solanaHandler = buildHandler('solana')
  const stellarHandler = buildHandler('stellar')

  it('returns the correct handler per network', () => {
    const factory = new WalletHandlerFactory(celoHandler, solanaHandler, stellarHandler)

    expect(factory.getWalletHandler(BlockchainNetwork.CELO)).toBe(celoHandler)
    expect(factory.getWalletHandler(BlockchainNetwork.SOLANA)).toBe(solanaHandler)
    expect(factory.getWalletHandler(BlockchainNetwork.STELLAR)).toBe(stellarHandler)
  })

  it('throws on unsupported networks', () => {
    const factory = new WalletHandlerFactory(celoHandler, solanaHandler, stellarHandler)

    expect(() => factory.getWalletHandler('POLYGON' as BlockchainNetwork))
      .toThrow('Unsupported blockchain network: POLYGON')
  })
})
