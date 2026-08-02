import {
  render, screen, waitFor, within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import PartnerPortalTeamSecurity from '../pages/PartnerPortal/PartnerPortalTeamSecurity'
import {
  clearPartnerPortalSession,
  getPartnerPortalSession,
  setPartnerPortalSession,
} from '../services/partnerPortal/partnerPortalSessionStore'
import { PartnerPortalTestProviders } from './partnerPortalTestProviders'

const mocked = vi.hoisted(() => ({
  beginPartnerMfaEnrollment: vi.fn(),
  changePartnerPortalPassword: vi.fn(),
  confirmPartnerMfaEnrollment: vi.fn(),
  createPartnerPortalUser: vi.fn(),
  issuePartnerPasswordReset: vi.fn(),
  listPartnerAuditEvents: vi.fn(),
  listPartnerPortalUsers: vi.fn(),
  regeneratePartnerRecoveryCodes: vi.fn(),
  resetPartnerMfa: vi.fn(),
  updatePartnerPortalUser: vi.fn(),
}))

vi.mock('../services/partnerPortal/partnerPortalApi', () => mocked)

const adminSession = {
  accessToken: 'admin-token',
  email: 'admin@decaf.so',
  expiresAt: '2099-01-01T00:00:00.000Z',
  mfaEnabled: true,
  mfaVerified: true,
  partnerName: 'Decaf',
  role: 'ADMIN',
  userId: 'admin-1',
} as const

const adminUser = {
  createdAt: '2026-07-31T00:00:00.000Z',
  disabledAt: null,
  email: 'admin@decaf.so',
  id: 'admin-1',
  lastLoginAt: '2026-08-01T12:00:00.000Z',
  mfaEnabled: true,
  role: 'ADMIN',
} as const

const authorizationRequestId = '11111111-1111-4111-8111-111111111111'

const LocationProbe = () => {
  const location = useLocation()
  return <output data-testid="location-probe">{`${location.pathname}${location.search}`}</output>
}

afterEach(() => {
  clearPartnerPortalSession()
  vi.clearAllMocks()
})

describe('PartnerPortalTeamSecurity', () => {
  it('creates an individual account and reveals its invitation link only once', async () => {
    setPartnerPortalSession(adminSession)
    mocked.listPartnerPortalUsers.mockResolvedValue([adminUser])
    mocked.listPartnerAuditEvents.mockResolvedValue([])
    mocked.createPartnerPortalUser.mockResolvedValue({
      expiresAt: '2026-08-02T12:00:00.000Z',
      purpose: 'INVITATION',
      token: 'one-time-invitation-token',
      user: {
        ...adminUser,
        email: 'member@decaf.so',
        id: 'member-1',
        lastLoginAt: null,
        mfaEnabled: false,
        role: 'MEMBER',
      },
    })
    render(
      <PartnerPortalTestProviders>
        <MemoryRouter><PartnerPortalTeamSecurity /></MemoryRouter>
      </PartnerPortalTestProviders>,
    )
    const user = userEvent.setup()

    const teamSection = await screen.findByRole('heading', { name: 'Workspace team' })
    const section = teamSection.closest('section')
    expect(section).not.toBeNull()
    await user.type(within(section as HTMLElement).getByPlaceholderText('teammate@company.com'), 'member@decaf.so')
    const inviteButton = within(section as HTMLElement).getByRole('button', { name: 'Invite' })
    await user.click(inviteButton)

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('/partner/password-reset?token=one-time-invitation-token')
    const closeButton = within(dialog).getByRole('button', { name: 'Close Invitation link' })
    expect(closeButton).toHaveFocus()
    await user.keyboard('{Shift>}{Tab}{/Shift}')
    expect(within(dialog).getByRole('button', { name: 'I saved it' })).toHaveFocus()
    await user.tab()
    expect(closeButton).toHaveFocus()
    expect(mocked.createPartnerPortalUser).toHaveBeenCalledWith('member@decaf.so', 'MEMBER')
    expect(window.sessionStorage.getItem('abroad.partnerPortal.session.v2')).not.toContain('one-time-invitation-token')
    await user.keyboard('{Escape}')
    expect(screen.queryByText(/one-time-invitation-token/u)).not.toBeInTheDocument()
    expect(within(section as HTMLElement).getByPlaceholderText('teammate@company.com')).toHaveFocus()
  })

  it('enrolls MFA and replaces the session before revealing recovery codes', async () => {
    setPartnerPortalSession({ ...adminSession, mfaEnabled: false, mfaVerified: false })
    mocked.listPartnerPortalUsers.mockResolvedValue([adminUser])
    mocked.listPartnerAuditEvents.mockResolvedValue([])
    mocked.beginPartnerMfaEnrollment.mockResolvedValue({
      expiresAt: '2099-01-01T00:10:00.000Z',
      manualEntryKey: 'JBSWY3DPEHPK3PXP',
      otpauthUri: 'otpauth://totp/Abroad:admin%40decaf.so?secret=JBSWY3DPEHPK3PXP',
    })
    mocked.confirmPartnerMfaEnrollment.mockResolvedValue({
      recoveryCodes: ['AAAA-BBBB-CCCC', 'DDDD-EEEE-FFFF'],
      session: adminSession,
    })
    render(
      <PartnerPortalTestProviders>
        <MemoryRouter><PartnerPortalTeamSecurity /></MemoryRouter>
      </PartnerPortalTestProviders>,
    )
    const user = userEvent.setup()

    const personalHeading = screen.getByRole('heading', { name: 'Personal security' })
    const personalSection = personalHeading.closest('section')
    expect(personalSection).not.toBeNull()
    const passwordInputs = within(personalSection as HTMLElement).getAllByPlaceholderText('Current password')
    await user.type(passwordInputs[0], 'current secure password')
    expect(passwordInputs[1]).toHaveValue('')
    await user.click(within(personalSection as HTMLElement).getByRole('button', { name: 'Set up MFA' }))

    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Six-digit code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Enable MFA' }))

    expect(await screen.findByRole('dialog')).toHaveTextContent('AAAA-BBBB-CCCC')
    await waitFor(() => expect(getPartnerPortalSession()?.mfaVerified).toBe(true))
    expect(window.sessionStorage.getItem('abroad.partnerPortal.session.v2')).not.toContain('AAAA-BBBB-CCCC')
  })

  it('returns to the exact authorization request only after recovery codes are dismissed', async () => {
    setPartnerPortalSession({ ...adminSession, mfaEnabled: false, mfaVerified: false })
    mocked.listPartnerPortalUsers.mockResolvedValue([adminUser])
    mocked.listPartnerAuditEvents.mockResolvedValue([])
    mocked.beginPartnerMfaEnrollment.mockResolvedValue({
      expiresAt: '2099-01-01T00:10:00.000Z',
      manualEntryKey: 'JBSWY3DPEHPK3PXP',
      otpauthUri: 'otpauth://totp/Abroad:admin%40decaf.so?secret=JBSWY3DPEHPK3PXP',
    })
    mocked.confirmPartnerMfaEnrollment.mockResolvedValue({
      recoveryCodes: ['AAAA-BBBB-CCCC', 'DDDD-EEEE-FFFF'],
      session: adminSession,
    })
    const returnTo = `/partner/integration/ai/authorize?request=${authorizationRequestId}`
    render(
      <PartnerPortalTestProviders>
        <MemoryRouter initialEntries={[`/partner/security?returnTo=${encodeURIComponent(returnTo)}`]}>
          <PartnerPortalTeamSecurity />
          <LocationProbe />
        </MemoryRouter>
      </PartnerPortalTestProviders>,
    )
    const user = userEvent.setup()

    expect(screen.getByText(/After you enable MFA and save your recovery codes/iu)).toBeInTheDocument()
    const personalSection = screen.getByRole('heading', { name: 'Personal security' }).closest('section')
    expect(personalSection).not.toBeNull()
    await user.type(
      within(personalSection as HTMLElement).getAllByPlaceholderText('Current password')[0],
      'current secure password',
    )
    await user.click(within(personalSection as HTMLElement).getByRole('button', { name: 'Set up MFA' }))
    await user.type(await screen.findByLabelText('Six-digit code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Enable MFA' }))

    expect(await screen.findByRole('dialog')).toHaveTextContent('AAAA-BBBB-CCCC')
    expect(screen.getByTestId('location-probe')).not.toHaveTextContent(returnTo)
    await user.click(screen.getByRole('button', { name: 'I saved it' }))
    await waitFor(() => expect(screen.getByTestId('location-probe')).toHaveTextContent(returnTo))
  })

  it('rejects an external MFA return destination', () => {
    setPartnerPortalSession({ ...adminSession, mfaEnabled: false, mfaVerified: false })

    render(
      <PartnerPortalTestProviders>
        <MemoryRouter initialEntries={['/partner/security?returnTo=https%3A%2F%2Fevil.example%2Fauthorize']}>
          <PartnerPortalTeamSecurity />
        </MemoryRouter>
      </PartnerPortalTestProviders>,
    )

    expect(screen.queryByText(/return you to this authorization request/iu)).not.toBeInTheDocument()
  })
})
