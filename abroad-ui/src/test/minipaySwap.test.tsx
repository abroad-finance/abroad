import { render, screen } from '@testing-library/react'
import {
  describe, expect, it, vi,
} from 'vitest'

import Swap from '../features/swap/components/Swap'

vi.mock('@tolgee/react', () => ({
  useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}))

describe('MiniPay swap surface', () => {
  it('does not render wallet connect or wallet address controls in MiniPay mode', () => {
    render(
      <Swap
        continueDisabled={false}
        exchangeRateDisplay="1 USDC = 4,000 COP"
        isAboveMaximum={false}
        isAuthenticated={true}
        isBelowMinimum={false}
        isMiniPay={true}
        isMiniPayReady={true}
        miniPayNotice={null}
        onOpenSourceModal={vi.fn()}
        onOpenTargetModal={vi.fn()}
        onPrimaryAction={vi.fn()}
        onSourceChange={vi.fn()}
        onTargetChange={vi.fn()}
        selectedAssetLabel="USDC"
        sourceAmount="10"
        targetAmount="40,000"
        targetCurrency="COP"
        transferFeeDisplay="$0"
        usdcBalance="25.00"
        walletAddress={null}
        walletStatusLabel="MiniPay ready"
      />,
    )

    expect(screen.queryByText('Conectar Billetera')).not.toBeInTheDocument()
    expect(screen.queryByText(/0x111111/i)).not.toBeInTheDocument()
  })
})
