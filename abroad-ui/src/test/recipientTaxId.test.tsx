import { fireEvent, render, screen } from '@testing-library/react'
import {
  describe, expect, it, vi,
} from 'vitest'

import { _36EnumsTargetCurrency as TargetCurrency } from '../api'
import ConfirmQr from '../features/swap/components/ConfirmQr'
import Swap from '../features/swap/components/Swap'

vi.mock('@tolgee/react', () => ({
  useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}))

describe('BRL recipient details', () => {
  it('keeps focus recovery safe when an embedded browser lacks scrollIntoView', () => {
    vi.useFakeTimers()
    try {
      render(
        <Swap
          continueDisabled={false}
          exchangeRateDisplay="1 USDC = R$5.00"
          feeDisplay={null}
          isAboveMaximum={false}
          isAuthenticated={true}
          isBelowMinimum={false}
          maximumAmountDisplay={null}
          minimumAmountDisplay={null}
          networkLabel="Stellar"
          onPrimaryAction={vi.fn()}
          onRecipientChange={vi.fn()}
          onRetryQuote={vi.fn()}
          onTargetChange={vi.fn()}
          quoteExpired={false}
          quoteIssue={null}
          quoteRemainingSeconds={60}
          recipientValue=""
          selectedAssetLabel="USDC"
          sourceAmount=""
          targetAmount=""
          targetCurrency={TargetCurrency.BRL}
          timingDisplay={null}
        />,
      )

      const recipient = screen.getByPlaceholderText('Email, phone, or registered Pix key')
      expect(recipient.scrollIntoView).toBeUndefined()
      fireEvent.focus(recipient)
      expect(() => vi.advanceTimersByTime(150)).not.toThrow()
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('collects a PIX key without rendering a recipient tax-ID field', () => {
    const { container } = render(
      <Swap
        continueDisabled={false}
        exchangeRateDisplay="1 USDC = R$5.00"
        feeDisplay={null}
        isAboveMaximum={false}
        isAuthenticated={true}
        isBelowMinimum={false}
        maximumAmountDisplay={null}
        minimumAmountDisplay={null}
        networkLabel="Stellar"
        onPrimaryAction={vi.fn()}
        onRecipientChange={vi.fn()}
        onRetryQuote={vi.fn()}
        onTargetChange={vi.fn()}
        quoteExpired={false}
        quoteIssue={null}
        quoteRemainingSeconds={60}
        recipientValue="recipient-pix-key"
        selectedAssetLabel="USDC"
        sourceAmount="1"
        targetAmount="5"
        targetCurrency={TargetCurrency.BRL}
        timingDisplay={null}
      />,
    )

    expect(screen.getByPlaceholderText('Email, phone, or registered Pix key')).toHaveValue('recipient-pix-key')
    expect(container.querySelector('#swap-cpf')).not.toBeInTheDocument()
    expect(screen.queryByText(/CPF|CNPJ/)).not.toBeInTheDocument()
  })

  it('keeps the confirmation view free of tax-ID fields', () => {
    render(
      <ConfirmQr
        currency={TargetCurrency.BRL}
        exchangeRateDisplay="1 USDC = 5.00 BRL"
        feeDisplay={null}
        networkLabel="Stellar"
        onBack={vi.fn()}
        onConfirm={vi.fn()}
        onEdit={vi.fn()}
        onRefreshQuote={vi.fn()}
        pixKey="recipient-pix-key"
        quoteExpired={false}
        quoteRemainingSeconds={60}
        sourceAmount="1"
        targetAmount="5"
        timingDisplay={null}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Reveal recipient' }))
    expect(screen.getByText('recipient-pix-key')).toBeInTheDocument()
    expect(screen.queryByText(/CPF|CNPJ/)).not.toBeInTheDocument()
  })

  it('offers recipient-method help and records an unfinished manual entry without exposing its value', () => {
    const onRecipientEntryAbandoned = vi.fn()
    const onRecipientHelp = vi.fn()
    const view = render(
      <Swap
        continueDisabled={false}
        exchangeRateDisplay="1 USDC = R$5.00"
        feeDisplay={null}
        isAboveMaximum={false}
        isAuthenticated={true}
        isBelowMinimum={false}
        maximumAmountDisplay={null}
        minimumAmountDisplay={null}
        networkLabel="Stellar"
        onPrimaryAction={vi.fn()}
        onRecipientChange={vi.fn()}
        onRecipientEntryAbandoned={onRecipientEntryAbandoned}
        onRecipientHelp={onRecipientHelp}
        onRetryQuote={vi.fn()}
        onTargetChange={vi.fn()}
        quoteExpired={false}
        quoteIssue={null}
        quoteRemainingSeconds={60}
        recipientValue="synthetic-recipient-key"
        selectedAssetLabel="USDC"
        sourceAmount="1"
        targetAmount="5"
        targetCurrency={TargetCurrency.BRL}
        timingDisplay={null}
      />,
    )

    fireEvent.click(screen.getByRole('link', { name: 'Need help choosing the right recipient method?' }))
    expect(onRecipientHelp).toHaveBeenCalledOnce()

    view.unmount()
    expect(onRecipientEntryAbandoned).toHaveBeenCalledOnce()
  })
})
