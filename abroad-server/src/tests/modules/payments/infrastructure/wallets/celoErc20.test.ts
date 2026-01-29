import { BigNumber, ethers } from 'ethers'

import { parseErc20Transfers, safeNormalizeAddress, sumTransfers, toDecimalAmount } from '../../../../../modules/payments/infrastructure/wallets/celoErc20'

describe('celoErc20 helpers', () => {
  it('returns null for invalid addresses', () => {
    expect(safeNormalizeAddress('not-an-address')).toBeNull()
  })

  it('returns null for empty addresses', () => {
    expect(safeNormalizeAddress(undefined)).toBeNull()
    expect(safeNormalizeAddress(null)).toBeNull()
  })

  it('skips logs that do not match the token address', () => {
    const receipt = {
      logs: [
        {
          address: '0x1111111111111111111111111111111111111111',
          data: '0x',
          topics: [],
        },
      ],
    } as unknown as ethers.providers.TransactionReceipt

    const transfers = parseErc20Transfers(receipt, '0x2222222222222222222222222222222222222222')
    expect(transfers).toEqual([])
  })

  it('skips logs with invalid contract addresses', () => {
    const receipt = {
      logs: [
        {
          address: 'not-an-address',
          data: '0x',
          topics: [],
        },
      ],
    } as unknown as ethers.providers.TransactionReceipt

    const transfers = parseErc20Transfers(receipt, '0x7777777777777777777777777777777777777777')
    expect(transfers).toEqual([])
  })

  it('skips logs that cannot be parsed', () => {
    const receipt = {
      logs: [
        {
          address: '0x3333333333333333333333333333333333333333',
          data: '0xdeadbeef',
          topics: ['0x0'],
        },
      ],
    } as unknown as ethers.providers.TransactionReceipt

    const transfers = parseErc20Transfers(receipt, '0x3333333333333333333333333333333333333333')
    expect(transfers).toEqual([])
  })

  it('parses valid transfer logs', () => {
    const iface = new ethers.utils.Interface([
      'event Transfer(address indexed from, address indexed to, uint256 value)',
    ])
    const payload = iface.encodeEventLog(
      iface.getEvent('Transfer'),
      [
        '0x4444444444444444444444444444444444444444',
        '0x5555555555555555555555555555555555555555',
        BigNumber.from(10),
      ],
    )

    const receipt = {
      logs: [
        {
          address: '0x6666666666666666666666666666666666666666',
          data: payload.data,
          topics: payload.topics,
        },
      ],
    } as unknown as ethers.providers.TransactionReceipt

    const transfers = parseErc20Transfers(receipt, '0x6666666666666666666666666666666666666666')
    expect(transfers).toEqual([
      {
        amount: BigNumber.from(10),
        from: ethers.utils.getAddress('0x4444444444444444444444444444444444444444'),
        to: ethers.utils.getAddress('0x5555555555555555555555555555555555555555'),
      },
    ])
  })

  it('sums transfer amounts', () => {
    const transfers = [
      {
        amount: BigNumber.from(5),
        from: '0x1111111111111111111111111111111111111111',
        to: '0x2222222222222222222222222222222222222222',
      },
      {
        amount: BigNumber.from(7),
        from: '0x3333333333333333333333333333333333333333',
        to: '0x4444444444444444444444444444444444444444',
      },
    ]

    expect(sumTransfers(transfers).toString()).toBe('12')
  })

  it('converts token amounts to decimals', () => {
    const amount = BigNumber.from('1234567')
    expect(toDecimalAmount(amount, 6)).toBeCloseTo(1.234567)
  })

  it('throws when token amounts cannot be converted to numbers', () => {
    const hugeAmount = BigNumber.from('1' + '0'.repeat(400))
    expect(() => toDecimalAmount(hugeAmount, 6)).toThrow('Invalid token amount:')
  })
})
