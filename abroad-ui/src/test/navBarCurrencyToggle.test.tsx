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

describe('NavBarResponsive journey ownership', () => {
  it('keeps destination controls out of the header and exposes labelled Activity separately from account state', () => {
    const onHistoryClick = vi.fn()

    render(
      <NavBarResponsive
        address="0x1111111111111111111111111111111111111111"
        infoUrl="https://www.abroad.finance"
        labels={{
          connectWallet: 'Connect Wallet',
          connectWalletAria: 'Connect wallet',
          infoAriaLabel: 'Abroad information',
          notConnected: 'Not connected',
        }}
        onHistoryClick={onHistoryClick}
        walletInfo={{ name: 'Wallet' }}
      />,
    )

    const navigation = screen.getByRole('navigation')
    expect(within(navigation).queryByRole('group', { name: 'Select currency' })).not.toBeInTheDocument()
    expect(within(navigation).getByRole('status')).toHaveAccessibleName(/Connected: Wallet/)
    fireEvent.click(within(navigation).getByRole('button', { name: 'Activity' }))
    expect(onHistoryClick).toHaveBeenCalledOnce()
  })
})
