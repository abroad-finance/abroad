import { CryptoCurrency } from '@prisma/client'
import { ethers } from 'ethers'

import { ILogger } from '../../../../../core/logging/types'
import { CeloWalletHandler } from '../../../../../modules/payments/infrastructure/wallets/CeloWalletHandler'
import { ISecretManager, Secret } from '../../../../../platform/secrets/ISecretManager'

class LoggerStub implements ILogger {
  error(): void {}
  info(): void {}
  warn(): void {}
}

class SecretManagerStub implements ISecretManager {
  constructor(private readonly secrets: Partial<Record<Secret, string>>) {}

  async getSecret(secretName: Secret): Promise<string> {
    return this.secrets[secretName] ?? ''
  }

  async getSecrets<T extends readonly Secret[]>(secretNames: T): Promise<Record<T[number], string>> {
    const result: Record<string, string> = {}
    secretNames.forEach((name) => {
      result[name] = this.secrets[name] ?? ''
    })
    return result as Record<T[number], string>
  }
}

const buildReceipt = (params: {
  amount: ethers.BigNumber
  from: string
  to: string
  token: string
}): ethers.providers.TransactionReceipt => {
  const iface = new ethers.utils.Interface([
    'event Transfer(address indexed from, address indexed to, uint256 value)',
  ])
  const { data, topics } = iface.encodeEventLog(
    iface.getEvent('Transfer'),
    [params.from, params.to, params.amount],
  )
  const log = {
    address: params.token,
    data,
    topics,
  }

  return {
    logs: [log],
    status: 1,
  } as unknown as ethers.providers.TransactionReceipt
}

describe('CeloWalletHandler', () => {
  const depositAddress = '0x1111111111111111111111111111111111111111'
  const senderAddress = '0x2222222222222222222222222222222222222222'
  const usdcAddress = '0xcebA9300f2b948710d2653dD7B07f33A8B32118C'
  const rpcUrl = 'http://celo-rpc.local'
  const privateKey = '0x' + '11'.repeat(32)

  const buildHandler = (overrides?: Partial<Record<Secret, string>>) => {
    const secretManager = new SecretManagerStub({
      CELO_DEPOSIT_ADDRESS: depositAddress,
      CELO_PRIVATE_KEY: privateKey,
      CELO_RPC_URL: rpcUrl,
      CELO_USDC_ADDRESS: usdcAddress,
      ...overrides,
    })
    return new CeloWalletHandler(secretManager, new LoggerStub())
  }

  it('returns the sender address from a USDC transfer', async () => {
    const receipt = buildReceipt({
      amount: ethers.utils.parseUnits('5', 6),
      from: senderAddress,
      to: depositAddress,
      token: usdcAddress,
    })
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl)
    jest.spyOn(provider, 'getTransactionReceipt').mockResolvedValue(receipt)
    const handler = buildHandler()
    ;(handler as unknown as { cachedProvider?: { provider: ethers.providers.JsonRpcProvider, rpcUrl: string } }).cachedProvider = {
      provider,
      rpcUrl,
    }

    const resolved = await handler.getAddressFromTransaction({ onChainId: '0xhash' })

    expect(resolved).toBe(ethers.utils.getAddress(senderAddress))
  })

  it('throws when the on-chain id is missing', async () => {
    const handler = buildHandler()

    await expect(handler.getAddressFromTransaction({})).rejects.toThrow('Missing on-chain transaction id')
  })

  it('throws when the receipt indicates a failed transaction', async () => {
    const receipt = {
      logs: [],
      status: 0,
    } as unknown as ethers.providers.TransactionReceipt
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl)
    jest.spyOn(provider, 'getTransactionReceipt').mockResolvedValue(receipt)

    const handler = buildHandler()
    ;(handler as unknown as { cachedProvider?: { provider: ethers.providers.JsonRpcProvider, rpcUrl: string } }).cachedProvider = {
      provider,
      rpcUrl,
    }

    await expect(handler.getAddressFromTransaction({ onChainId: '0xhash' }))
      .rejects
      .toThrow('Transaction failed on-chain')
  })

  it('throws when the receipt is missing', async () => {
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl)
    jest.spyOn(provider, 'getTransactionReceipt').mockResolvedValue(null as unknown as ethers.providers.TransactionReceipt)

    const handler = buildHandler()
    ;(handler as unknown as { cachedProvider?: { provider: ethers.providers.JsonRpcProvider, rpcUrl: string } }).cachedProvider = {
      provider,
      rpcUrl,
    }

    await expect(handler.getAddressFromTransaction({ onChainId: '0xhash' }))
      .rejects
      .toThrow('Transaction not found on Celo')
  })

  it('throws when no USDC transfer reaches the deposit wallet', async () => {
    const receipt = buildReceipt({
      amount: ethers.utils.parseUnits('5', 6),
      from: senderAddress,
      to: '0x3333333333333333333333333333333333333333',
      token: usdcAddress,
    })
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl)
    jest.spyOn(provider, 'getTransactionReceipt').mockResolvedValue(receipt)

    const handler = buildHandler()
    ;(handler as unknown as { cachedProvider?: { provider: ethers.providers.JsonRpcProvider, rpcUrl: string } }).cachedProvider = {
      provider,
      rpcUrl,
    }

    await expect(handler.getAddressFromTransaction({ onChainId: '0xhash' }))
      .rejects
      .toThrow('No USDC transfer to the configured wallet found in this transaction')
  })

  it('throws when multiple senders are detected', async () => {
    const iface = new ethers.utils.Interface([
      'event Transfer(address indexed from, address indexed to, uint256 value)',
    ])
    const first = iface.encodeEventLog(
      iface.getEvent('Transfer'),
      [senderAddress, depositAddress, ethers.utils.parseUnits('1', 6)],
    )
    const second = iface.encodeEventLog(
      iface.getEvent('Transfer'),
      ['0x7777777777777777777777777777777777777777', depositAddress, ethers.utils.parseUnits('1', 6)],
    )
    const receipt = {
      logs: [
        { address: usdcAddress, data: first.data, topics: first.topics },
        { address: usdcAddress, data: second.data, topics: second.topics },
      ],
      status: 1,
    } as unknown as ethers.providers.TransactionReceipt

    const provider = new ethers.providers.JsonRpcProvider(rpcUrl)
    jest.spyOn(provider, 'getTransactionReceipt').mockResolvedValue(receipt)

    const handler = buildHandler()
    ;(handler as unknown as { cachedProvider?: { provider: ethers.providers.JsonRpcProvider, rpcUrl: string } }).cachedProvider = {
      provider,
      rpcUrl,
    }

    await expect(handler.getAddressFromTransaction({ onChainId: '0xhash' }))
      .rejects
      .toThrow('Multiple senders found for USDC transfers')
  })

  it('rejects unsupported currencies', async () => {
    const handler = buildHandler()

    const result = await handler.send({
      address: depositAddress,
      amount: 10,
      cryptoCurrency: 'USDT' as CryptoCurrency,
    })

    expect(result).toEqual({
      code: 'validation',
      reason: 'unsupported_currency',
      success: false,
    })
  })

  it('rejects invalid amounts', async () => {
    const handler = buildHandler()

    const result = await handler.send({
      address: depositAddress,
      amount: 0,
      cryptoCurrency: CryptoCurrency.USDC,
    })

    expect(result).toEqual({
      code: 'validation',
      reason: 'invalid_amount',
      success: false,
    })
  })

  it('rejects invalid destination addresses', async () => {
    const handler = buildHandler()

    const result = await handler.send({
      address: 'not-an-address',
      amount: 1,
      cryptoCurrency: CryptoCurrency.USDC,
    })

    expect(result).toEqual({
      code: 'validation',
      reason: 'invalid_destination',
      success: false,
    })
  })

  it('sends USDC and returns the transaction hash', async () => {
    const transferMock = jest.fn().mockResolvedValue({
      hash: '0xsend',
      wait: jest.fn().mockResolvedValue({ status: 1 }),
    })
    const contractSpy = jest.spyOn(ethers, 'Contract')
      .mockImplementation(() => ({ transfer: transferMock }) as unknown as ethers.Contract)

    const handler = buildHandler()
    const result = await handler.send({
      address: depositAddress,
      amount: 1.5,
      cryptoCurrency: CryptoCurrency.USDC,
    })

    expect(result).toEqual({ success: true, transactionId: '0xsend' })
    expect(transferMock).toHaveBeenCalled()

    contractSpy.mockRestore()
  })

  it('returns retriable error when the transfer fails on-chain', async () => {
    const transferMock = jest.fn().mockResolvedValue({
      hash: '0xfail',
      wait: jest.fn().mockResolvedValue({ status: 0 }),
    })
    const contractSpy = jest.spyOn(ethers, 'Contract')
      .mockImplementation(() => ({ transfer: transferMock }) as unknown as ethers.Contract)

    const handler = buildHandler()
    const result = await handler.send({
      address: depositAddress,
      amount: 2,
      cryptoCurrency: CryptoCurrency.USDC,
    })

    expect(result).toEqual({
      code: 'retriable',
      reason: 'transaction_failed',
      success: false,
      transactionId: '0xfail',
    })

    contractSpy.mockRestore()
  })

  it('returns a retriable error when the transfer throws', async () => {
    const transferMock = jest.fn().mockRejectedValue(new Error('transfer boom'))
    const contractSpy = jest.spyOn(ethers, 'Contract')
      .mockImplementation(() => ({ transfer: transferMock }) as unknown as ethers.Contract)

    const handler = buildHandler()
    const result = await handler.send({
      address: depositAddress,
      amount: 3,
      cryptoCurrency: CryptoCurrency.USDC,
    })

    expect(result).toEqual({
      code: 'retriable',
      reason: 'transfer boom',
      success: false,
    })

    contractSpy.mockRestore()
  })

  it('returns a retriable error when secrets are invalid', async () => {
    const handler = buildHandler({ CELO_DEPOSIT_ADDRESS: 'not-an-address' })

    const result = await handler.send({
      address: depositAddress,
      amount: 1,
      cryptoCurrency: CryptoCurrency.USDC,
    })

    expect(result).toEqual({
      code: 'retriable',
      reason: 'Invalid Celo address configuration',
      success: false,
    })
  })

  it('normalizes scientific notation in toPlainDecimalString', () => {
    const handler = buildHandler()
    const internal = handler as unknown as { toPlainDecimalString: (value: number) => string }

    expect(internal.toPlainDecimalString(1e-7)).toBe('0.0000001')
    expect(internal.toPlainDecimalString(-1e-7)).toBe('-0.0000001')
    expect(internal.toPlainDecimalString(1e21)).toBe('1000000000000000000000')
  })

  it('returns retriable errors for string throws', async () => {
    const transferMock = jest.fn().mockRejectedValue('boom')
    const contractSpy = jest.spyOn(ethers, 'Contract')
      .mockImplementation(() => ({ transfer: transferMock }) as unknown as ethers.Contract)

    const handler = buildHandler()
    const result = await handler.send({
      address: depositAddress,
      amount: 1,
      cryptoCurrency: CryptoCurrency.USDC,
    })

    expect(result).toEqual({
      code: 'retriable',
      reason: 'boom',
      success: false,
    })

    contractSpy.mockRestore()
  })

  it('returns retriable errors for unknown throws', async () => {
    const transferMock = jest.fn().mockRejectedValue({ code: 'UNKNOWN' })
    const contractSpy = jest.spyOn(ethers, 'Contract')
      .mockImplementation(() => ({ transfer: transferMock }) as unknown as ethers.Contract)

    const handler = buildHandler()
    const result = await handler.send({
      address: depositAddress,
      amount: 1,
      cryptoCurrency: CryptoCurrency.USDC,
    })

    expect(result).toEqual({
      code: 'retriable',
      reason: 'Unknown error',
      success: false,
    })

    contractSpy.mockRestore()
  })
})
