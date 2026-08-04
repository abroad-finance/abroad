import {
  describe, expect, it,
} from 'vitest'

import {
  canRetryWalletAuthorization,
  destinationForCurrency,
  parseRestorablePaymentDraft,
  recipientMatchesDestination,
  shouldReconcileBeforeAction,
} from '../features/swap/model/paymentIntent'

describe('payment intent invariants', () => {
  it('binds country, rail, and local currency as one destination', () => {
    expect(destinationForCurrency('BRL')).toEqual({ country: 'BR', currency: 'BRL', rail: 'PIX' })
    expect(destinationForCurrency('COP')).toEqual({ country: 'CO', currency: 'COP', rail: 'BREB' })
  })

  it('rejects recipient methods from the wrong rail', () => {
    expect(recipientMatchesDestination(
      destinationForCurrency('BRL'),
      { kind: 'pix-key', value: 'fixture' },
    )).toBe(true)
    expect(recipientMatchesDestination(
      destinationForCurrency('BRL'),
      { kind: 'breb-key', value: 'fixture' },
    )).toBe(false)
    expect(recipientMatchesDestination(
      destinationForCurrency('COP'),
      { kind: 'pix-qr', mode: 'paste', payload: 'fixture' },
    )).toBe(false)
  })

  it('never exposes a blind retry after a broadcast could have happened', () => {
    expect(canRetryWalletAuthorization({ kind: 'wallet-rejected', transactionId: 'tx' })).toBe(true)
    expect(canRetryWalletAuthorization({ kind: 'broadcast-unknown', transactionId: 'tx' })).toBe(false)
    expect(shouldReconcileBeforeAction({ kind: 'broadcast-unknown', transactionId: 'tx' })).toBe(true)
    expect(shouldReconcileBeforeAction({ kind: 'accepted', transactionId: 'tx' })).toBe(false)
  })

  it('restores only versioned bounded non-sensitive draft fields', () => {
    const draft = parseRestorablePaymentDraft({
      acceptedPayment: {
        authorization: {
          kind: 'wallet-rejected',
          transactionId: '11111111-1111-4111-8111-111111111111',
        },
        paymentContext: {
          amount: 10.2,
          blockchain: 'STELLAR',
          chainFamily: 'stellar',
          chainId: 'stellar:pubnet',
          cryptoCurrency: 'USDC',
          decimals: 7,
          depositAddress: 'GDEPOSIT',
          memo: 'reference',
          memoType: 'text',
          mintAddress: 'GISSUER',
          notify: { endpoint: null, required: false },
          rpcUrl: 'https://horizon.example',
        },
        transactionReference: 'reference',
      },
      corridorKey: 'STELLAR:USDC:PIX',
      destination: destinationForCurrency('BRL'),
      quote: {
        corridorKey: 'STELLAR:USDC:PIX',
        expiresAt: Date.now() + 60_000,
        fee: null,
        id: 'quote',
        network: 'STELLAR',
        rail: 'PIX',
        sourceAmount: 10.2,
        sourceCurrency: 'USDC',
        targetAmount: 50,
        targetCurrency: 'BRL',
      },
      schemaVersion: 4,
      sourceAmount: '10.2',
      targetAmount: '50.00',
      view: 'txStatus',
    })

    expect(draft?.acceptedPayment?.authorization.transactionId).toBe('11111111-1111-4111-8111-111111111111')
    expect(parseRestorablePaymentDraft({ ...draft, pixKey: 'must-not-be-read' })).toBeNull()
    expect(parseRestorablePaymentDraft({ ...draft, schemaVersion: 3 })).toBeNull()
    expect(parseRestorablePaymentDraft({ ...draft, destination: { country: 'BR', currency: 'COP', rail: 'PIX' } })).toBeNull()
  })
})
