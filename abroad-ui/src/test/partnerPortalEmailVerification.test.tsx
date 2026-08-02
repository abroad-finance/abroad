import { render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import {
  MemoryRouter, Route, Routes,
} from 'react-router-dom'
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import PartnerPortalEmailVerification from '../pages/PartnerPortal/PartnerPortalEmailVerification'
import {
  clearPartnerPortalSession,
  getPartnerPortalSession,
} from '../services/partnerPortal/partnerPortalSessionStore'

const mocked = vi.hoisted(() => ({
  verifyPartnerPortalSignupEmail: vi.fn(),
}))

vi.mock('../services/partnerPortal/partnerPortalApi', () => ({
  verifyPartnerPortalSignupEmail: mocked.verifyPartnerPortalSignupEmail,
}))

const renderVerification = () => render(
  <StrictMode>
    <MemoryRouter initialEntries={['/partner/verify-email']}>
      <Routes>
        <Route element={<PartnerPortalEmailVerification />} path="/partner/verify-email" />
        <Route element={<div>Transaction workspace opened</div>} path="/partner/transactions" />
      </Routes>
    </MemoryRouter>
  </StrictMode>,
)

afterEach(() => {
  clearPartnerPortalSession()
  vi.clearAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('PartnerPortalEmailVerification', () => {
  it('consumes the URL token once under StrictMode, stores the normal session, and enters the portal', async () => {
    window.history.replaceState(null, '', `/partner/verify-email#token=${'v'.repeat(43)}`)
    mocked.verifyPartnerPortalSignupEmail.mockResolvedValue({
      accessToken: 'verified-session',
      email: 'admin@atlas.example',
      expiresAt: '2099-01-01T00:30:00.000Z',
      mfaEnabled: false,
      mfaVerified: false,
      partnerName: 'Atlas Payments',
      role: 'ADMIN',
      userId: 'user-1',
    })

    renderVerification()

    expect(await screen.findByText('Transaction workspace opened')).toBeInTheDocument()
    expect(mocked.verifyPartnerPortalSignupEmail).toHaveBeenCalledTimes(1)
    expect(mocked.verifyPartnerPortalSignupEmail).toHaveBeenCalledWith('v'.repeat(43))
    expect(getPartnerPortalSession()?.accessToken).toBe('verified-session')
    expect(window.location.hash).toBe('')
    expect(window.sessionStorage.getItem('abroad.partnerPortal.session.v2')).not.toContain(
      'v'.repeat(43),
    )
  })

  it('removes an invalid token from the address bar and offers safe recovery routes', async () => {
    window.history.replaceState(null, '', `/partner/verify-email#token=${'x'.repeat(43)}`)
    mocked.verifyPartnerPortalSignupEmail.mockRejectedValue(
      new Error('Verification link is invalid or expired'),
    )

    renderVerification()

    expect(await screen.findByRole('heading', { name: 'This link cannot be used' })).toBeInTheDocument()
    await waitFor(() => expect(window.location.hash).toBe(''))
    expect(screen.getByText('Verification link is invalid or expired')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Start signup again' })).toHaveAttribute(
      'href',
      '/partner/signup',
    )
    expect(getPartnerPortalSession()).toBeNull()
  })
})
