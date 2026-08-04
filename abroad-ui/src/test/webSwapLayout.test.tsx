import { render, screen } from '@testing-library/react'
import {
  describe, expect, it, vi,
} from 'vitest'

import WebSwapLayout from '../features/swap/components/WebSwapLayout'

vi.mock('@tolgee/react', () => ({
  useTranslate: () => ({
    t: (_key: string, fallback: string, params?: Record<string, number | string>) => (
      Object.entries(params ?? {}).reduce(
        (translated, [name, value]) => translated.replace(`{${name}}`, String(value)),
        fallback,
      )
    ),
  }),
}))

const slots = {
  confirmQr: <p>review view</p>,
  home: <p>home view</p>,
  kycNeeded: <p>verification view</p>,
  swap: <p>details view</p>,
  txStatus: <p>receipt view</p>,
  waitSign: <p>authorization view</p>,
}

describe('WebSwapLayout journey progress', () => {
  it('maps each payment surface to a truthful compact progress step', () => {
    const { rerender } = render(
      <WebSwapLayout showJourneyProgress slots={slots} targetCurrency="BRL" view="home" />,
    )

    expect(screen.getByText('Destination and source · Brazil · Pix')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: /step 1 of 5/i })).toHaveValue(1)

    rerender(<WebSwapLayout showJourneyProgress slots={slots} targetCurrency="BRL" view="confirm-qr" />)
    expect(screen.getByText('Review payment')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: /step 3 of 5/i })).toHaveValue(3)

    rerender(<WebSwapLayout showJourneyProgress slots={slots} targetCurrency="BRL" view="txStatus" />)
    expect(screen.getByText('Track and receipt')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: /step 5 of 5/i })).toHaveValue(5)
  })

  it('does not duplicate KYC progress or show progress before onboarding', () => {
    const { rerender } = render(
      <WebSwapLayout slots={slots} targetCurrency="COP" view="home" />,
    )
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()

    rerender(<WebSwapLayout showJourneyProgress slots={slots} targetCurrency="COP" view="kyc-needed" />)
    expect(screen.getByText('verification view')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })
})
