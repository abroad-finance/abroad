import { describe, expect, it } from 'vitest'

import { resolveStablecoinPreference } from '../features/swap/lib/stablecoinPortfolio'
import { sanitizeMiniPayRequest } from '../services/wallets/minipay'

describe('MiniPay contracts', () => {
  it('strips fee fields from MiniPay eth_sendTransaction requests', () => {
    const request = sanitizeMiniPayRequest({
      chainId: 'eip155:42220',
      method: 'eth_sendTransaction',
      params: [{
        data: '0x1234',
        from: '0x1111111111111111111111111111111111111111',
        gasPrice: '0x10',
        maxFeePerGas: '0x20',
        maxPriorityFeePerGas: '0x5',
        to: '0x2222222222222222222222222222222222222222',
        value: '0x0',
      }],
    })

    expect(request.params).toEqual([{
      data: '0x1234',
      from: '0x1111111111111111111111111111111111111111',
      to: '0x2222222222222222222222222222222222222222',
      value: '0x0',
    }])
  })

  it('represents cUSD-first portfolios as unsupported-preferred with a supported fallback', () => {
    const preference = resolveStablecoinPreference({
      cUSD: '40.00',
      USDC: '5.00',
      USDT: '22.00',
    })

    expect(preference).toEqual({
      highestBalanceToken: 'cUSD',
      kind: 'unsupported-preferred',
      preferredSupportedToken: 'USDT',
    })
  })
})
