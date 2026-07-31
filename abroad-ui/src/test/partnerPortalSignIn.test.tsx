import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import PartnerPortalSignIn from '../pages/PartnerPortal/PartnerPortalSignIn'
import {
  clearPartnerPortalSession,
  getPartnerPortalSession,
} from '../services/partnerPortal/partnerPortalSessionStore'

const mocked = vi.hoisted(() => ({
  createPartnerPortalSession: vi.fn(),
}))

vi.mock('../services/partnerPortal/partnerPortalApi', () => ({
  createPartnerPortalSession: mocked.createPartnerPortalSession,
}))

afterEach(() => {
  clearPartnerPortalSession()
  vi.clearAllMocks()
})

describe('PartnerPortalSignIn', () => {
  it('stores only the short-lived portal session and clears both credential fields', async () => {
    mocked.createPartnerPortalSession.mockResolvedValue({
      accessToken: 'scoped-token',
      expiresAt: '2099-01-01T00:00:00.000Z',
      partnerName: 'Decaf',
    })
    render(<PartnerPortalSignIn />)
    const user = userEvent.setup()
    const emailInput = screen.getByLabelText('Email')
    const passwordInput = screen.getByLabelText('Password')

    await user.type(emailInput, ' Operator@Decaf.So ')
    await user.type(passwordInput, 'secret portal password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(getPartnerPortalSession()?.accessToken).toBe('scoped-token'))
    expect(mocked.createPartnerPortalSession).toHaveBeenCalledWith(
      'operator@decaf.so',
      'secret portal password',
    )
    expect(emailInput).toHaveValue('')
    expect(passwordInput).toHaveValue('')
    expect(window.sessionStorage.getItem('abroad.partnerPortal.session.v1')).not.toContain(
      'secret portal password',
    )
  })

  it('shows an authentication failure without persisting a session', async () => {
    mocked.createPartnerPortalSession.mockRejectedValue(new Error('Email or password is incorrect'))
    render(<PartnerPortalSignIn />)
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Email'), 'operator@decaf.so')
    await user.type(screen.getByLabelText('Password'), 'wrong password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect')
    expect(getPartnerPortalSession()).toBeNull()
  })

  it('reveals and hides the password without changing its value', async () => {
    render(<PartnerPortalSignIn />)
    const user = userEvent.setup()
    const passwordInput = screen.getByLabelText('Password')

    await user.type(passwordInput, 'visible only on request')
    expect(passwordInput).toHaveAttribute('type', 'password')

    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(passwordInput).toHaveAttribute('type', 'text')
    expect(passwordInput).toHaveValue('visible only on request')

    await user.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(passwordInput).toHaveAttribute('type', 'password')
  })
})
