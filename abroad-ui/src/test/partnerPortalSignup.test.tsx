import {
  act, render, screen, waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import PartnerPortalSignup from '../pages/PartnerPortal/PartnerPortalSignup'

const mocked = vi.hoisted(() => ({
  createPartnerPortalSignup: vi.fn(),
  createPartnerPortalSignupChallenge: vi.fn(),
  resendPartnerPortalSignupVerificationEmail: vi.fn(),
}))

vi.mock('../services/partnerPortal/partnerPortalApi', () => ({
  createPartnerPortalSignup: mocked.createPartnerPortalSignup,
  createPartnerPortalSignupChallenge: mocked.createPartnerPortalSignupChallenge,
  resendPartnerPortalSignupVerificationEmail: mocked.resendPartnerPortalSignupVerificationEmail,
}))

const fillSignupForm = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText('First name'), ' Ana ')
  await user.type(screen.getByLabelText('Last name'), ' Silva ')
  await user.type(screen.getByLabelText('Organization'), ' Atlas   Payments ')
  await user.selectOptions(screen.getByLabelText('Organization country'), 'BR')
  await user.type(screen.getByLabelText('Administrator email'), ' Admin@Atlas.Example ')
  await user.type(screen.getByLabelText('Password'), 'correct horse battery staple')
  await user.type(screen.getByLabelText('Confirm password'), 'correct horse battery staple')
}

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  window.sessionStorage.clear()
})

describe('PartnerPortalSignup', () => {
  it('creates a normalized idempotent signup and shows the enumeration-safe email state', async () => {
    mocked.createPartnerPortalSignupChallenge.mockResolvedValue({
      challengeToken: 'signed-challenge',
      expiresAt: '2099-01-01T00:15:00.000Z',
      readyAt: '2000-01-01T00:00:00.000Z',
    })
    mocked.createPartnerPortalSignup.mockResolvedValue({ status: 'VERIFICATION_REQUIRED' })
    render(<PartnerPortalSignup />)
    const user = userEvent.setup()
    await fillSignupForm(user)

    await user.click(screen.getByRole('button', { name: 'Create workspace' }))

    expect(await screen.findByRole('heading', { name: 'Verification link queued' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('After verification')
    expect(screen.queryByText(/already exists/iu)).not.toBeInTheDocument()
    expect(mocked.createPartnerPortalSignup).toHaveBeenCalledWith({
      challengeToken: 'signed-challenge',
      company: 'Atlas Payments',
      contactWebsite: '',
      country: 'BR',
      email: 'admin@atlas.example',
      firstName: 'Ana',
      lastName: 'Silva',
      password: 'correct horse battery staple',
    }, expect.stringMatching(/^[A-Za-z0-9._:-]{16,128}$/u))
    expect(JSON.stringify(window.sessionStorage)).not.toContain('correct horse battery staple')
    expect(screen.getByRole('button', { name: 'Another link available in one minute' })).toBeDisabled()
  })

  it('validates password confirmation before requesting a challenge', async () => {
    render(<PartnerPortalSignup />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('First name'), 'Ana')
    await user.type(screen.getByLabelText('Last name'), 'Silva')
    await user.type(screen.getByLabelText('Organization'), 'Atlas Payments')
    await user.selectOptions(screen.getByLabelText('Organization country'), 'BR')
    await user.type(screen.getByLabelText('Administrator email'), 'admin@atlas.example')
    await user.type(screen.getByLabelText('Password'), 'correct horse battery staple')
    await user.type(screen.getByLabelText('Confirm password'), 'different secure password')

    await user.click(screen.getByRole('button', { name: 'Create workspace' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match')
    expect(mocked.createPartnerPortalSignupChallenge).not.toHaveBeenCalled()
    expect(mocked.createPartnerPortalSignup).not.toHaveBeenCalled()
  })

  it('uses the credential-protected recovery endpoint for a bounded resend', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mocked.createPartnerPortalSignupChallenge.mockResolvedValue({
      challengeToken: 'signed-challenge',
      expiresAt: '2099-01-01T00:15:00.000Z',
      readyAt: '2000-01-01T00:00:00.000Z',
    })
    mocked.createPartnerPortalSignup.mockResolvedValue({ status: 'VERIFICATION_REQUIRED' })
    mocked.resendPartnerPortalSignupVerificationEmail.mockResolvedValue({ status: 'VERIFICATION_REQUIRED' })
    render(<PartnerPortalSignup />)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await fillSignupForm(user)
    await user.click(screen.getByRole('button', { name: 'Create workspace' }))
    await screen.findByRole('heading', { name: 'Verification link queued' })

    act(() => vi.advanceTimersByTime(60_000))
    await user.click(screen.getByRole('button', { name: 'Send another link' }))

    await waitFor(() => expect(mocked.resendPartnerPortalSignupVerificationEmail).toHaveBeenCalledTimes(1))
    expect(mocked.createPartnerPortalSignup).toHaveBeenCalledTimes(1)
    expect(mocked.createPartnerPortalSignupChallenge).toHaveBeenCalledTimes(2)
    expect(mocked.resendPartnerPortalSignupVerificationEmail).toHaveBeenCalledWith({
      challengeToken: 'signed-challenge',
      contactWebsite: '',
      email: 'admin@atlas.example',
      password: 'correct horse battery staple',
    })
    expect(screen.getByText(/another verification link is now queued/iu)).toBeInTheDocument()
  })
})
