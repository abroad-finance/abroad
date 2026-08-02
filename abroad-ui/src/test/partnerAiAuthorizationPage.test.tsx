import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import type { PartnerAiAuthorizationRequest } from '../services/partnerPortal/partnerPortalTypes'

import PartnerAiAuthorization from '../pages/PartnerPortal/PartnerAiAuthorization'
import { PartnerPortalTestProviders } from './partnerPortalTestProviders'

const mocked = vi.hoisted(() => ({
  approvePartnerAiAuthorization: vi.fn(),
  denyPartnerAiAuthorization: vi.fn(),
  getPartnerAiAuthorizationRequest: vi.fn(),
  recordPartnerAiProductEvent: vi.fn(),
}))

vi.mock('../services/partnerPortal/partnerPortalApi', () => mocked)

const requestId = '11111111-1111-4111-8111-111111111111'

const authorizationRequest = (
  overrides: Partial<PartnerAiAuthorizationRequest> = {},
): PartnerAiAuthorizationRequest => ({
  alreadyConnected: true,
  client: {
    destinationHost: 'assistant.example',
    name: 'Operations Assistant',
    verified: false,
  },
  expiresAt: '2026-08-02T18:15:00.000Z',
  organizationName: 'Atlas Payments',
  permissions: [
    {
      description: 'View organization metadata',
      scope: 'account:read',
    },
    {
      description: 'View transaction diagnostics',
      scope: 'transactions:read',
    },
    {
      description: 'View webhook health',
      scope: 'webhooks:read',
    },
  ],
  requestId,
  state: 'READY',
  ...overrides,
})

const renderPage = (query = `?request=${requestId}`) => {
  window.history.replaceState({}, '', `/partner/integration/ai/authorize${query}`)
  return render(
    <PartnerPortalTestProviders>
      <MemoryRouter><PartnerAiAuthorization /></MemoryRouter>
    </PartnerPortalTestProviders>,
  )
}

afterEach(() => {
  vi.clearAllMocks()
  window.history.replaceState({}, '', '/')
})

describe('PartnerAiAuthorization', () => {
  it('shows the client, organization, destination, every permission, and fixed read-only boundary', async () => {
    mocked.getPartnerAiAuthorizationRequest.mockResolvedValue(authorizationRequest())
    mocked.recordPartnerAiProductEvent.mockResolvedValue(undefined)

    renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: 'Authorize an AI client' })).toBeInTheDocument()
    expect(screen.getByText('Operations Assistant')).toBeInTheDocument()
    expect(screen.getByText('Atlas Payments')).toBeInTheDocument()
    expect(screen.getByText(/return you to assistant.example/iu)).toBeInTheDocument()
    expect(screen.getByText('account:read')).toBeInTheDocument()
    expect(screen.getByText('transactions:read')).toBeInTheDocument()
    expect(screen.getByText('webhooks:read')).toBeInTheDocument()
    expect(screen.getByText(/Create or accept transactions, move funds/iu)).toBeInTheDocument()
    expect(screen.getByText(/immediately replace its existing grant/iu)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve access' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled()
    await waitFor(() => expect(mocked.recordPartnerAiProductEvent).toHaveBeenCalledWith({
      clientCategory: 'GENERIC',
      entryPoint: 'DIRECT',
      event: 'AI_CONNECTION_STARTED',
      outcome: 'NOT_APPLICABLE',
    }))
  })

  it('approves access without rendering or persisting the returned authorization code', async () => {
    mocked.getPartnerAiAuthorizationRequest.mockResolvedValue(authorizationRequest())
    mocked.recordPartnerAiProductEvent.mockResolvedValue(undefined)
    mocked.approvePartnerAiAuthorization.mockResolvedValue({
      clientName: 'Operations Assistant',
      destinationHost: 'assistant.example',
      returnToClientUrl: 'https://assistant.example/callback?code=secret-authorization-code&state=opaque',
    })
    renderPage()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Approve access' }))

    expect(await screen.findByRole('heading', { name: 'Connection approved' })).toHaveAttribute('tabindex', '-1')
    expect(screen.getByText(/did not create or change any transaction/iu)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Return to Operations Assistant' })).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('secret-authorization-code')
    expect(document.body.textContent).not.toContain('opaque')
    expect(mocked.approvePartnerAiAuthorization).toHaveBeenCalledWith(requestId)
    expect(mocked.recordPartnerAiProductEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'AI_AUTHORIZATION_COMPLETED',
      outcome: 'APPROVED',
    }))
  })

  it('supports explicit denial and returns no grant information in the page', async () => {
    mocked.getPartnerAiAuthorizationRequest.mockResolvedValue(authorizationRequest())
    mocked.recordPartnerAiProductEvent.mockResolvedValue(undefined)
    mocked.denyPartnerAiAuthorization.mockResolvedValue({
      clientName: 'Operations Assistant',
      destinationHost: 'assistant.example',
      returnToClientUrl: 'https://assistant.example/callback?error=access_denied&state=opaque',
    })
    renderPage()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Deny' }))

    expect(await screen.findByRole('heading', { name: 'Connection denied' })).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('access_denied')
    expect(document.body.textContent).not.toContain('opaque')
    expect(mocked.denyPartnerAiAuthorization).toHaveBeenCalledWith(requestId)
    expect(mocked.recordPartnerAiProductEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'AI_AUTHORIZATION_COMPLETED',
      outcome: 'DENIED',
    }))
  })

  it.each([
    ['ADMIN_REQUIRED', 'Administrator approval required'],
    ['EXPIRED', 'Authorization request expired'],
    ['APPROVED', 'Authorization already completed'],
    ['DENIED', 'Authorization denied'],
    ['UNSUPPORTED_CLIENT', 'This AI client is not supported'],
  ] as const)('renders the %s authorization state without approval actions', async (state, title) => {
    mocked.getPartnerAiAuthorizationRequest.mockResolvedValue(authorizationRequest({ state }))
    mocked.recordPartnerAiProductEvent.mockResolvedValue(undefined)

    renderPage()

    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve access' })).not.toBeInTheDocument()
  })

  it('preserves the authorization request through MFA enrollment without an open redirect', async () => {
    mocked.getPartnerAiAuthorizationRequest.mockResolvedValue(authorizationRequest({
      state: 'MFA_REQUIRED',
    }))
    mocked.recordPartnerAiProductEvent.mockResolvedValue(undefined)

    renderPage()

    const link = await screen.findByRole('link', { name: 'Open security settings' })
    const href = link.getAttribute('href') ?? ''
    expect(href).toContain('/partner/security?returnTo=')
    expect(decodeURIComponent(href)).toContain(
      `/partner/integration/ai/authorize?request=${requestId}`,
    )
    expect(href).not.toContain('assistant.example')
  })

  it.each([
    ['?error=unsupported-client', 'This AI client is not supported'],
    ['?error=server-error', 'The connection could not start'],
    ['?error=temporarily-unavailable', 'The connection could not start'],
    ['', 'This AI client is not supported'],
  ])('renders a bounded entry failure for %s', async (query, title) => {
    mocked.recordPartnerAiProductEvent.mockResolvedValue(undefined)

    renderPage(query)

    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Read the setup guide' })).toHaveAttribute(
      'href',
      'https://abroad-docs.web.app/ai-integration',
    )
    expect(mocked.getPartnerAiAuthorizationRequest).not.toHaveBeenCalled()
    await waitFor(() => expect(mocked.recordPartnerAiProductEvent).toHaveBeenCalledWith({
      clientCategory: 'UNSUPPORTED',
      entryPoint: 'DIRECT',
      event: 'AI_CONNECTION_STARTED',
      outcome: 'FAILED',
    }))
  })

  it('shows a recoverable server error and records a bounded failed authorization event', async () => {
    mocked.getPartnerAiAuthorizationRequest.mockResolvedValue(authorizationRequest())
    mocked.recordPartnerAiProductEvent.mockResolvedValue(undefined)
    mocked.approvePartnerAiAuthorization.mockRejectedValue(new Error('Authorization is temporarily unavailable'))
    renderPage()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Approve access' }))

    expect(await screen.findByText('Authorization is temporarily unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve access' })).toBeEnabled()
    expect(mocked.recordPartnerAiProductEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'AI_AUTHORIZATION_COMPLETED',
      outcome: 'FAILED',
    }))
  })

  it('renders an expired-session recovery state when consent details cannot be loaded', async () => {
    mocked.getPartnerAiAuthorizationRequest.mockRejectedValue(new Error('Authorization request not found'))
    mocked.recordPartnerAiProductEvent.mockResolvedValue(undefined)

    renderPage()

    expect(await screen.findByRole('heading', { name: 'Authorization session unavailable' })).toBeInTheDocument()
    expect(screen.getByText('Authorization request not found')).toBeInTheDocument()
  })
})
