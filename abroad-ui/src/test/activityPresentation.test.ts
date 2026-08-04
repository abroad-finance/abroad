import { describe, expect, it } from 'vitest'

import type { ConsumerActivityReceiptDto } from '../api'

import {
  activityReferenceRows,
  activityStatusPresentation,
  formatActivityMoney,
  formatActivityRate,
} from '../features/activity/shared/activityPresentation'

describe('activityStatusPresentation', () => {
  it.each([
    [
      'AWAITING_PAYMENT',
      'awaiting',
      'Awaiting payment',
    ],
    [
      'PROCESSING_PAYMENT',
      'processing',
      'Processing payment',
    ],
    [
      'PAYMENT_COMPLETED',
      'completed',
      'Completed',
    ],
    [
      'PAYMENT_FAILED',
      'failed',
      'Payment failed',
    ],
    [
      'PAYMENT_EXPIRED',
      'expired',
      'Expired',
    ],
    [
      'WRONG_AMOUNT',
      'wrong-amount',
      'Amount needs review',
    ],
  ] as const)('preserves %s without collapsing lifecycle meaning', (status, tone, label) => {
    expect(activityStatusPresentation(status)).toMatchObject({ label, tone })
  })

  it('never treats an unknown runtime status as completed', () => {
    expect(activityStatusPresentation('PROVIDER_DELAYED')).toEqual({
      description: 'We cannot verify the latest payment state right now.',
      label: 'Status unavailable',
      tone: 'unknown',
    })
  })
})

describe('Activity financial presentation', () => {
  it('formats every supported currency independently with Intl', () => {
    expect(formatActivityMoney(525.4, 'BRL', 'pt-BR')).toBe('R$\u00a0525,40')
    expect(formatActivityMoney(1500, 'COP', 'es-CO')).toContain('1.500')
    expect(formatActivityMoney(100, 'USDC', 'en-US')).toBe('100.00 USDC')
    expect(formatActivityMoney(100, 'USDT', 'en-US')).toBe('100.00 USDT')
  })

  it('labels a rate only when the authoritative value is available', () => {
    expect(formatActivityRate('5.254', 'USDC', 'BRL', 'en-US')).toBe('1 USDC = 5.254 BRL')
    expect(formatActivityRate(null, 'USDC', 'BRL', 'en-US')).toBeNull()
  })
})

describe('activityReferenceRows', () => {
  const receipt = {
    references: {
      abroadId: '11111111-1111-4111-8111-111111111111',
      brebId: null,
      onChainId: 'on-chain-1',
      pixEndToEndId: 'pix-e2e-1',
      providerId: null,
      refundOnChainId: null,
    },
  } as ConsumerActivityReceiptDto

  it('keeps authoritative identifiers separately labelled and omits unavailable rows', () => {
    expect(activityReferenceRows(receipt)).toEqual([
      { key: 'abroad', label: 'Abroad ID', value: '11111111-1111-4111-8111-111111111111' },
      { key: 'pix', label: 'PIX end-to-end ID', value: 'pix-e2e-1' },
      { key: 'on-chain', label: 'On-chain transaction', value: 'on-chain-1' },
    ])
  })
})
