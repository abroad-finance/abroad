import { render, screen } from '@testing-library/react'
import {
  describe, expect, it, vi,
} from 'vitest'

import { _36EnumsTargetCurrency as TargetCurrency } from '../api'
import BankDetailsRoute from '../features/swap/components/BankDetailsRoute'
import ConfirmQr from '../features/swap/components/ConfirmQr'
import Swap from '../features/swap/components/Swap'

vi.mock('@tolgee/react', () => ({
  useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}))

describe('BRL recipient details', () => {
  it('collects a PIX key without rendering a recipient tax-ID field', () => {
    const { container } = render(
      <Swap
        continueDisabled={false}
        exchangeRateDisplay="1 USDC = R$5.00"
        isAboveMaximum={false}
        isAuthenticated={true}
        isBelowMinimum={false}
        onPrimaryAction={vi.fn()}
        onRecipientChange={vi.fn()}
        onTargetChange={vi.fn()}
        recipientValue="recipient-pix-key"
        selectedAssetLabel="USDC"
        sourceAmount="1"
        targetAmount="5"
        targetCurrency={TargetCurrency.BRL}
        transferFeeDisplay="R$0"
      />,
    )

    expect(screen.getByPlaceholderText('PIX key or phone number')).toHaveValue('recipient-pix-key')
    expect(container.querySelector('#swap-cpf')).not.toBeInTheDocument()
    expect(screen.queryByText(/CPF|CNPJ/)).not.toBeInTheDocument()
  })

  it('keeps both the bank-details and confirmation views free of tax-ID fields', () => {
    const commonProps = {
      accountNumber: '',
      continueDisabled: false,
      onAccountNumberChange: vi.fn(),
      onBackClick: vi.fn(),
      onContinue: vi.fn(),
      onPixKeyChange: vi.fn(),
      pixKey: 'recipient-pix-key',
      targetAmount: '5',
      targetCurrency: TargetCurrency.BRL,
    }
    const { container, rerender } = render(<BankDetailsRoute {...commonProps} />)

    expect(screen.getByPlaceholderText('PIX Key')).toHaveValue('recipient-pix-key')
    expect(container.querySelector('#cpf-input')).not.toBeInTheDocument()
    expect(screen.queryByText(/CPF|CNPJ/)).not.toBeInTheDocument()

    rerender(
      <ConfirmQr
        currency={TargetCurrency.BRL}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
        onEdit={vi.fn()}
        pixKey="recipient-pix-key"
        sourceAmount="1"
        targetAmount="5"
      />,
    )

    expect(screen.getByText('recipient-pix-key')).toBeInTheDocument()
    expect(screen.queryByText(/CPF|CNPJ/)).not.toBeInTheDocument()
  })
})
