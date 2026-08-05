import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  describe, expect, it, vi,
} from 'vitest'

import BuyCryptoForm from '../features/swap/components/BuyCryptoForm'
import { parseFiatAmount, validateOnrampForm } from '../features/swap/shared/onrampFormModel'

const translate = (_key: string, fallback: string) => fallback

const WALLET = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'

const renderForm = (overrides?: {
  assetLabel?: null | string
  destinationAddress?: null | string
  isSubmitting?: boolean
  limits?: { maxAmount: null | number, minAmount: null | number }
  onSubmit?: (values: { fiatAmount: number }) => void
  submissionError?: null | string
}) => {
  const onSubmit = overrides?.onSubmit ?? vi.fn()
  render(
    <BuyCryptoForm
      assetLabel={overrides?.assetLabel === undefined ? 'USDC' : overrides.assetLabel}
      destinationAddress={overrides?.destinationAddress === undefined ? WALLET : overrides.destinationAddress}
      isSubmitting={overrides?.isSubmitting ?? false}
      limits={overrides?.limits ?? { maxAmount: null, minAmount: null }}
      networkLabel="Stellar"
      onBack={vi.fn()}
      onSubmit={onSubmit}
      submissionError={overrides?.submissionError ?? null}
      translate={translate}
    />,
  )
  return { onSubmit }
}

describe('parseFiatAmount', () => {
  it.each([
    ['500', 500],
    ['500,50', 500.5],
    ['1.500,25', 1500.25],
    ['R$ 250,00', 250],
  ])('parses %s as %d', (input, expected) => {
    expect(parseFiatAmount(input)).toBe(expected)
  })

  it.each([
    '',
    '   ',
    'abc',
    '0',
    '-5',
  ])('rejects %p', (input) => {
    expect(parseFiatAmount(input)).toBeNull()
  })
})

describe('validateOnrampForm', () => {
  it('accepts a well-formed purchase', () => {
    expect(validateOnrampForm(
      { fiatAmount: '500' },
      { maxAmount: null, minAmount: null },
    )).toEqual({})
  })

  it('reports an amount below the corridor minimum', () => {
    expect(validateOnrampForm(
      { fiatAmount: '5' },
      { maxAmount: null, minAmount: 10 },
    )).toEqual({ fiatAmount: 'below-minimum' })
  })

  it('reports an amount above the corridor maximum', () => {
    expect(validateOnrampForm(
      { fiatAmount: '50000' },
      { maxAmount: 10_000, minAmount: null },
    )).toEqual({ fiatAmount: 'above-maximum' })
  })

  it('reports a missing amount', () => {
    expect(validateOnrampForm(
      { fiatAmount: '' },
      { maxAmount: null, minAmount: null },
    )).toEqual({ fiatAmount: 'required' })
  })
})

describe('BuyCryptoForm', () => {
  it('submits the parsed amount', async () => {
    const { onSubmit } = renderForm()

    await userEvent.type(screen.getByLabelText('You pay'), '1.500,25')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(onSubmit).toHaveBeenCalledWith({ fiatAmount: 1500.25 })
  })

  // Nothing about the payer is collected: the payer does not have to be the
  // person receiving the crypto, so there is nothing to match a CPF against.
  it('asks for nothing but the amount', () => {
    renderForm()

    expect(screen.queryByLabelText(/CPF/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/CPF/i)).not.toBeInTheDocument()
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
  })

  it('does not submit without an amount', async () => {
    const { onSubmit } = renderForm()

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/Enter how much you want to spend/)).toBeInTheDocument()
  })

  it('reports the corridor minimum back to the customer', async () => {
    renderForm({ limits: { maxAmount: null, minAmount: 25 } })

    await userEvent.type(screen.getByLabelText('You pay'), '5')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByText(/The least you can buy is 25 BRL/)).toBeInTheDocument()
  })

  it('names the asset being bought in the heading', () => {
    renderForm()

    expect(screen.getByRole('heading', { name: 'Buy USDC' })).toBeInTheDocument()
  })

  // The old heading read "Buy Select asset" whenever no token was picked,
  // leaking a picker placeholder into the title.
  it('falls back to a generic heading rather than a placeholder', () => {
    renderForm({ assetLabel: null })

    expect(screen.getByRole('heading', { name: 'Buy crypto' })).toBeInTheDocument()
  })

  it('shows the spendable range before anything is typed', () => {
    renderForm({ limits: { maxAmount: 500, minAmount: 10 } })

    expect(screen.getByText(/Between/)).toBeInTheDocument()
  })

  // Without a wallet there is nowhere to deliver, so the purchase cannot start.
  it('blocks submission until a wallet can receive the delivery', () => {
    renderForm({ destinationAddress: null })

    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
    expect(screen.getByText(/Connect a wallet first/)).toBeInTheDocument()
  })

  it('shows the destination wallet so the customer can check it', () => {
    renderForm()

    expect(screen.getByTestId('buy-crypto-destination')).toHaveTextContent(WALLET)
  })

  it('blocks a second submission while one is in flight', () => {
    renderForm({ isSubmitting: true })

    expect(screen.getByRole('button', { name: 'Getting your PIX code…' })).toBeDisabled()
  })

  it('surfaces a submission failure', () => {
    renderForm({ submissionError: 'We could not start this purchase.' })

    expect(screen.getByText('We could not start this purchase.')).toBeInTheDocument()
  })
})
