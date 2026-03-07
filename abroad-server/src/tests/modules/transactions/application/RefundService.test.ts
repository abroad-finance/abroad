import { BlockchainNetwork, CryptoCurrency } from '@prisma/client'

import { RefundService } from '../../../../modules/transactions/application/RefundService'
import { createMockLogger } from '../../../setup/mockFactories'

describe('RefundService', () => {
  it('uses transaction lookup for non-Solana refunds', async () => {
    const send = jest.fn(async () => ({ success: true, transactionId: 'refund-1' }))
    const getAddressFromTransaction = jest.fn(async () => 'sender-from-chain')
    const handler = { getAddressFromTransaction, send }
    const service = new RefundService({ getWalletHandler: jest.fn(() => handler) } as never, createMockLogger())

    await service.refundByOnChainId({
      amount: 12,
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.CELO,
      onChainId: 'on-chain-1',
    })

    expect(getAddressFromTransaction).toHaveBeenCalledWith({ onChainId: 'on-chain-1' })
    expect(send).toHaveBeenCalledWith({
      address: 'sender-from-chain',
      amount: 12,
      cryptoCurrency: CryptoCurrency.USDC,
    })
  })

  it('uses provided sourceAddress for Solana refunds', async () => {
    const send = jest.fn(async () => ({ success: true, transactionId: 'refund-2' }))
    const getAddressFromTransaction = jest.fn(async () => {
      throw new Error('should not be called')
    })
    const handler = { getAddressFromTransaction, send }
    const service = new RefundService({ getWalletHandler: jest.fn(() => handler) } as never, createMockLogger())

    await service.refundByOnChainId({
      amount: 20,
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.SOLANA,
      onChainId: 'on-chain-2',
      sourceAddress: 'sender-wallet',
    })

    expect(getAddressFromTransaction).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith({
      address: 'sender-wallet',
      amount: 20,
      cryptoCurrency: CryptoCurrency.USDC,
    })
  })

  it('fails Solana refunds with explicit error when sourceAddress is missing', async () => {
    const send = jest.fn(async () => ({ success: true, transactionId: 'refund-3' }))
    const getAddressFromTransaction = jest.fn(async () => 'sender-from-chain')
    const handler = { getAddressFromTransaction, send }
    const service = new RefundService({ getWalletHandler: jest.fn(() => handler) } as never, createMockLogger())

    await expect(service.refundByOnChainId({
      amount: 20,
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.SOLANA,
      onChainId: 'on-chain-3',
    })).rejects.toThrow('Unable to refund Solana transaction: missing source address (addressFrom) in transaction context')

    expect(getAddressFromTransaction).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
})
