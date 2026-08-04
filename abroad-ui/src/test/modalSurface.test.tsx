import { fireEvent, render, screen } from '@testing-library/react'
import React, { useState } from 'react'
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { ModalSurface } from '../shared/components/ModalSurface'

const TestModal = (): React.JSX.Element => {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)} type="button">Open selector</button>
      <ModalSurface onClose={() => setOpen(false)} open={open} titleId="test-modal-title">
        <section>
          <h2 id="test-modal-title">Choose source</h2>
          <button data-modal-initial-focus type="button">First option</button>
          <button onClick={() => setOpen(false)} type="button">Close selector</button>
        </section>
      </ModalSurface>
    </>
  )
}

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: vi.fn(function showModal(this: HTMLDialogElement): void {
      this.setAttribute('open', '')
    }),
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: vi.fn(function close(this: HTMLDialogElement): void {
      this.removeAttribute('open')
    }),
  })
})

describe('ModalSurface', () => {
  it('opens a named modal, focuses its initial control, and restores the opener', () => {
    render(<TestModal />)
    const opener = screen.getByRole('button', { name: 'Open selector' })
    opener.focus()

    fireEvent.click(opener)

    const dialog = screen.getByRole('dialog', { name: 'Choose source' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('button', { name: 'First option' })).toHaveFocus()

    fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }))
    expect(screen.queryByRole('dialog', { name: 'Choose source' })).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('closes only when the native backdrop itself is clicked', () => {
    render(<TestModal />)
    fireEvent.click(screen.getByRole('button', { name: 'Open selector' }))
    const dialog = screen.getByRole('dialog', { name: 'Choose source' })

    fireEvent.click(screen.getByRole('heading', { name: 'Choose source' }))
    expect(dialog).toBeInTheDocument()

    fireEvent.click(dialog)
    expect(screen.queryByRole('dialog', { name: 'Choose source' })).not.toBeInTheDocument()
  })

  it('uses an explicit viewport-sized contract for fullscreen journeys', () => {
    render(
      <ModalSurface onClose={vi.fn()} open titleId="scanner-title" variant="fullscreen">
        <h2 id="scanner-title">Scan payment code</h2>
      </ModalSurface>,
    )

    expect(screen.getByRole('dialog', { name: 'Scan payment code' })).toHaveClass(
      'h-dvh',
      'max-h-none',
      'w-screen',
    )
  })
})
