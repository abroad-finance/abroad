import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { SwapView } from '../features/swap/types'

import WebSwapLayout from '../features/swap/components/WebSwapLayout'

const slots = {
  buyCrypto: <p>buy crypto form view</p>,
  buyCryptoPix: <p>buy crypto code view</p>,
  confirmQr: <p>review view</p>,
  home: <p>home view</p>,
  kycNeeded: <p>verification view</p>,
  swap: <p>details view</p>,
  txStatus: <p>receipt view</p>,
  waitSign: <p>authorization view</p>,
}

const surfaces: ReadonlyArray<[SwapView, string]> = [
  ['buy-crypto', 'buy crypto form view'],
  ['buy-crypto-pix', 'buy crypto code view'],
  ['confirm-qr', 'review view'],
  ['home', 'home view'],
  ['kyc-needed', 'verification view'],
  ['swap', 'details view'],
  ['txStatus', 'receipt view'],
  ['wait-sign', 'authorization view'],
]

describe('WebSwapLayout', () => {
  it('renders the slot belonging to each payment surface', () => {
    const { rerender } = render(<WebSwapLayout slots={slots} view="home" />)

    for (const [view, expected] of surfaces) {
      rerender(<WebSwapLayout slots={slots} view={view} />)
      expect(screen.getByText(expected)).toBeInTheDocument()
    }
  })

  it('does not render a step progress indicator on any surface', () => {
    const { rerender } = render(<WebSwapLayout slots={slots} view="home" />)

    for (const [view] of surfaces) {
      rerender(<WebSwapLayout slots={slots} view={view} />)
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
      expect(screen.queryByText(/step \d+ of \d+/i)).not.toBeInTheDocument()
    }
  })

  it('renders the disclosure alongside the active slot', () => {
    render(<WebSwapLayout disclosure={<p>disclosure copy</p>} slots={slots} view="home" />)

    expect(screen.getByText('home view')).toBeInTheDocument()
    expect(screen.getByText('disclosure copy')).toBeInTheDocument()
  })

  /*
   * jsdom does no layout, so this guards the cause rather than the symptom.
   *
   * The scrolling column must not centre with `justify-center`: when a view is
   * taller than the viewport that overflows equally in both directions and the
   * top becomes unreachable, because scrolling stops at scrollTop 0. Adding the
   * Pix QR pushed the code screen over that line and hid its heading. Auto
   * margins centre identically when the content fits and collapse to zero when
   * it does not, so the view simply starts at the top and scrolls.
   */
  it('centres the scrolling column with auto margins, never justify-center', () => {
    const { container, rerender } = render(<WebSwapLayout slots={slots} view="buy-crypto-pix" />)

    for (const [view] of surfaces) {
      rerender(<WebSwapLayout slots={slots} view={view} />)
      const scroller = container.querySelector('.overflow-y-auto')
      expect(scroller).not.toBeNull()
      expect(scroller?.className).not.toContain('justify-center')
    }
  })

  it('keeps the secondary surfaces vertically centred when they fit', () => {
    const { container } = render(<WebSwapLayout slots={slots} view="buy-crypto-pix" />)

    const inner = container.querySelector('.overflow-y-auto')?.firstElementChild
    expect(inner?.className).toContain('my-auto')
  })
})
