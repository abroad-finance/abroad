import 'reflect-metadata'
import { BlockchainNetwork, CryptoCurrency } from '@prisma/client'

import { ReceivedCryptoTransactionUseCase } from '../../../../modules/transactions/application/receivedCryptoTransactionUseCase'
import { ReceivedCryptoTransactionMessage } from '../../../../platform/messaging/queueSchema'
import { createMockLogger } from '../../../setup/mockFactories'

const baseMessage: ReceivedCryptoTransactionMessage = {
  addressFrom: 'sender-wallet',
  amount: 50,
  blockchain: BlockchainNetwork.STELLAR,
  cryptoCurrency: CryptoCurrency.USDC,
  onChainId: 'on-chain-hash',
  transactionId: '11111111-1111-4111-8111-111111111111',
}

const buildHarness = () => {
  const logger = createMockLogger()
  const orchestrator = { startFlow: jest.fn() }
  const useCase = new ReceivedCryptoTransactionUseCase(
    { getClient: jest.fn(async () => ({})) } as never,
    orchestrator as never,
    { refundToSender: jest.fn() } as never,
    { enqueueQueue: jest.fn(), enqueueWebhook: jest.fn() } as never,
    logger,
  )

  const repository = {
    applyDepositReceived: jest.fn(async () => ({ transaction: { id: 'tx-1', quote: { sourceAmount: 10 } } })),
    findRefundState: jest.fn(),
    getClient: jest.fn(async () => ({})),
  }
  ;(useCase as unknown as { repository: unknown }).repository = repository as never
  ;(useCase as unknown as { dispatcher: unknown }).dispatcher = { notifyPartnerAndUser: jest.fn() } as never

  return { logger, orchestrator, repository, useCase }
}

describe('ReceivedCryptoTransactionUseCase', () => {
  it('rejects invalid messages', async () => {
    const { useCase } = buildHarness()
    await expect(useCase.process({ transactionId: 'not-a-uuid' })).rejects.toThrow(/Invalid received crypto transaction message/)
  })

  it('starts flow for valid deposit', async () => {
    const { orchestrator, useCase } = buildHarness()
    await useCase.process(baseMessage)
    expect(orchestrator.startFlow).toHaveBeenCalledWith('tx-1')
  })
})
