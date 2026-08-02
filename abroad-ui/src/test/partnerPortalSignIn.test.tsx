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
  completePartnerMfaChallenge: vi.fn(),
  createPartnerPortalSession: vi.fn(),
  resetPartnerPasswordWithRecoveryCode: vi.fn(),
  resetPartnerPasswordWithToken: vi.fn(),
}))

vi.mock('../services/partnerPortal/partnerPortalApi', () => ({
  completePartnerMfaChallenge: mocked.completePartnerMfaChallenge,
  createPartnerPortalSession: mocked.createPartnerPortalSession,
  resetPartnerPasswordWithRecoveryCode: mocked.resetPartnerPasswordWithRecoveryCode,
  resetPartnerPasswordWithToken: mocked.resetPartnerPasswordWithToken,
}))

afterEach(() => {
  clearPartnerPortalSession()
  vi.clearAllMocks()
})

describe('PartnerPortalSignIn', () => {
  it('links new partners to public production signup', () => {
    render(<PartnerPortalSignIn />)

    expect(screen.getByRole('link', { name: 'Create a production workspace' })).toHaveAttribute(
      'href',
      '/partner/signup',
    )
  })

  it('stores only the short-lived portal session and clears both credential fields', async () => {
    mocked.createPartnerPortalSession.mockResolvedValue({
      session: {
        accessToken: 'scoped-token',
        email: 'operator@decaf.so',
        expiresAt: '2099-01-01T00:00:00.000Z',
        mfaEnabled: false,
        mfaVerified: false,
        partnerName: 'Decaf',
        role: 'ADMIN',
        userId: 'user-1',
      },
      status: 'AUTHENTICATED',
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
    expect(window.sessionStorage.getItem('abroad.partnerPortal.session.v2')).not.toContain(
      'secret portal password',
    )
  })

  it('completes an MFA challenge without persisting the challenge token or code', async () => {
    mocked.createPartnerPortalSession.mockResolvedValue({
      challenge: {
        challengeToken: 'challenge-token-that-stays-in-memory',
        expiresAt: '2099-01-01T00:05:00.000Z',
      },
      status: 'MFA_REQUIRED',
    })
    mocked.completePartnerMfaChallenge.mockResolvedValue({
      accessToken: 'mfa-session',
      email: 'operator@decaf.so',
      expiresAt: '2099-01-01T00:30:00.000Z',
      mfaEnabled: true,
      mfaVerified: true,
      partnerName: 'Decaf',
      role: 'ADMIN',
      userId: 'user-1',
    })
    render(<PartnerPortalSignIn />)
    const user = userEvent.setup()

    await user.type(screen.getByLabelText('Email'), 'operator@decaf.so')
    await user.type(screen.getByLabelText('Password'), 'secret portal password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await user.type(await screen.findByLabelText('Authentication or recovery code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }))

    await waitFor(() => expect(getPartnerPortalSession()?.accessToken).toBe('mfa-session'))
    expect(mocked.completePartnerMfaChallenge).toHaveBeenCalledWith(
      'challenge-token-that-stays-in-memory',
      '123456',
    )
    const stored = window.sessionStorage.getItem('abroad.partnerPortal.session.v2')
    expect(stored).not.toContain('challenge-token-that-stays-in-memory')
    expect(stored).not.toContain('123456')
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
