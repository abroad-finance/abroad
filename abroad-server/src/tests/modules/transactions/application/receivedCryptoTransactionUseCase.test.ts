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
  const workflow = { handleIncomingDeposit: jest.fn() }
  const useCase = new ReceivedCryptoTransactionUseCase(workflow as never, logger)
  return { logger, useCase, workflow }
}

describe('ReceivedCryptoTransactionUseCase', () => {
  it('rejects invalid messages and logs the parsing error', async () => {
    const harness = buildHarness()

    await expect(harness.useCase.process({ transactionId: 'not-a-uuid' })).rejects.toThrow(
      /Invalid received crypto transaction message/,
    )

    expect(harness.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid message format'),
      expect.anything(),
    )
    expect(harness.workflow.handleIncomingDeposit).not.toHaveBeenCalled()
  })

  it('delegates valid messages to the transaction workflow', async () => {
    const harness = buildHarness()

    await harness.useCase.process(baseMessage)

    expect(harness.workflow.handleIncomingDeposit).toHaveBeenCalledWith(baseMessage)
  })

  it('propagates workflow failures after logging', async () => {
    const harness = buildHarness()
    harness.workflow.handleIncomingDeposit.mockRejectedValueOnce(new Error('workflow down'))

    await expect(harness.useCase.process(baseMessage)).rejects.toThrow('workflow down')
    expect(harness.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to process received crypto transaction'),
      expect.any(Error),
    )
  })
})
