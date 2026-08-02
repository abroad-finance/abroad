import {
  fireEvent, render, screen, within,
} from '@testing-library/react'
import {
  describe, expect, it, vi,
} from 'vitest'

import NavBarResponsive from '../features/swap/components/NavBarResponsive'

vi.mock('@tolgee/react', () => ({
  useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}))

describe('NavBarResponsive currency toggle', () => {
  it('mounts one connected currency control and forwards its selection', () => {
    const onSelectCurrency = vi.fn()

    render(
      <NavBarResponsive
        address="0x1111111111111111111111111111111111111111"
        balance="0.00"
        balanceLoading={false}
        infoUrl="https://www.abroad.finance"
        labels={{
          connectWallet: 'Connect Wallet',
          connectWalletAria: 'Connect wallet',
          infoAriaLabel: 'Abroad information',
          notConnected: 'Not connected',
          walletDetailsAria: 'View wallet details',
        }}
        onSelectCurrency={onSelectCurrency}
        onWalletClick={vi.fn()}
        targetCurrency="BRL"
        walletInfo={{ name: 'Wallet' }}
      />,
    )

    const navigation = screen.getByRole('navigation')
    const currencyGroups = within(navigation).getAllByRole('group', {
      hidden: true,
      name: 'Select currency',
    })

    expect(currencyGroups).toHaveLength(1)

    const colombiaButton = within(currencyGroups[0]).getByRole('button', {
      hidden: true,
      name: 'Colombia',
    })
    fireEvent.click(colombiaButton)

    expect(onSelectCurrency).toHaveBeenCalledOnce()
    expect(onSelectCurrency).toHaveBeenCalledWith('COP')
  })
})
