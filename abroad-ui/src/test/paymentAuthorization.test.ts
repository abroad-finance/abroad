import {
  describe, expect, it, vi,
} from 'vitest'

import type { IWallet } from '../interfaces/IWallet'

import {
  authorizeAcceptedPayment,
  isWalletRejection,
  PaymentAuthorizationError,
} from '../features/swap/services/paymentAuthorization'

const translate = (_key: string, fallback: string): string => fallback

const evmContext = {
  amount: 10,
  blockchain: 'CELO' as const,
  chainFamily: 'evm' as const,
  chainId: 'eip155:42220',
  cryptoCurrency: 'USDC' as const,
  decimals: 6,
  depositAddress: '0x2222222222222222222222222222222222222222',
  memo: null,
  memoType: null,
  mintAddress: '0x1111111111111111111111111111111111111111',
  notify: { endpoint: '/payments/notify', required: true },
  rpcUrl: 'https://forno.celo.org',
}

const walletWithRequest = (request: NonNullable<IWallet['request']>): IWallet => ({
  address: '0x3333333333333333333333333333333333333333',
  chainId: 'eip155:42220',
  connect: vi.fn(async () => undefined),
  disconnect: vi.fn(async () => undefined),
  request,
  signTransaction: vi.fn(async () => ({ signedTxXdr: '', signerAddress: undefined })),
  walletId: 'mini-pay',
})

describe('accepted payment authorization', () => {
  it('returns the authoritative on-chain identity after a confirmed wallet response', async () => {
    const wallet = walletWithRequest(async <TResult>(): Promise<TResult> => '0xhash' as TResult)

    await expect(authorizeAcceptedPayment({ context: evmContext, t: translate, wallet }))
      .resolves.toEqual({ onChainId: '0xhash' })
  })

  it('classifies explicit wallet rejection as safe to resume', async () => {
    const wallet = walletWithRequest(async <TResult>(): Promise<TResult> => {
      throw Object.assign(new Error('User rejected the request'), { code: 4001 })
    })

    await expect(authorizeAcceptedPayment({ context: evmContext, t: translate, wallet }))
      .rejects.toMatchObject({ kind: 'wallet-rejected' } satisfies Partial<PaymentAuthorizationError>)
  })

  it('treats a non-rejection error after eth_sendTransaction begins as ambiguous', async () => {
    const wallet = walletWithRequest(async <TResult>(): Promise<TResult> => {
      throw new Error('transport disconnected')
    })

    await expect(authorizeAcceptedPayment({ context: evmContext, t: translate, wallet }))
      .rejects.toMatchObject({ kind: 'broadcast-unknown' } satisfies Partial<PaymentAuthorizationError>)
  })

  it('recognizes only explicit rejection evidence', () => {
    expect(isWalletRejection(Object.assign(new Error('request failed'), { code: 4001 }))).toBe(true)
    expect(isWalletRejection(new Error('transport disconnected'))).toBe(false)
  })
})
