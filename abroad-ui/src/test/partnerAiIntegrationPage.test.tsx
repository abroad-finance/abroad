import {
  render, screen, waitFor, within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import {
  afterEach, beforeAll, describe, expect, it, vi,
} from 'vitest'

import type { PartnerAiConnection } from '../services/partnerPortal/partnerPortalTypes'

import PartnerAiIntegration from '../pages/PartnerPortal/PartnerAiIntegration'
import {
  clearPartnerPortalSession,
  setPartnerPortalSession,
} from '../services/partnerPortal/partnerPortalSessionStore'
import { PartnerPortalTestProviders } from './partnerPortalTestProviders'

const mocked = vi.hoisted(() => ({
  listPartnerAiConnections: vi.fn(),
  recordPartnerAiProductEvent: vi.fn(),
  revokePartnerAiConnection: vi.fn(),
  testPartnerAiConnection: vi.fn(),
}))

vi.mock('../services/partnerPortal/partnerPortalApi', () => mocked)

const adminSession = {
  accessToken: 'admin-token',
  email: 'admin@partner.example',
  expiresAt: '2099-01-01T00:00:00.000Z',
  mfaEnabled: true,
  mfaVerified: true,
  partnerName: 'Atlas Payments',
  role: 'ADMIN',
  userId: 'admin-1',
} as const

const connection = (
  status: PartnerAiConnection['status'],
  overrides: Partial<PartnerAiConnection> = {},
): PartnerAiConnection => ({
  clientName: `${status} Assistant`,
  connectedAt: '2026-08-01T12:00:00.000Z',
  expiresAt: '2026-09-01T12:00:00.000Z',
  id: `connection-${status.toLowerCase()}`,
  lastTestedAt: null,
  lastUsedAt: status === 'ACTIVE' ? '2026-08-02T12:00:00.000Z' : null,
  scopes: ['account:read', 'transactions:read'],
  status,
  verifiedClient: false,
  ...overrides,
})

const renderPage = () => render(
  <PartnerPortalTestProviders>
    <MemoryRouter><PartnerAiIntegration /></MemoryRouter>
  </PartnerPortalTestProviders>,
)

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute('open', '')
    },
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute('open')
    },
  })
})

afterEach(() => {
  clearPartnerPortalSession()
  vi.clearAllMocks()
  window.history.replaceState({}, '', '/')
})

describe('PartnerAiIntegration', () => {
  it('lets a newly verified administrator discover and understand the connection without credentials', async () => {
    setPartnerPortalSession({ ...adminSession, mfaEnabled: false, mfaVerified: false })
    mocked.listPartnerAiConnections.mockResolvedValue([])
    mocked.recordPartnerAiProductEvent.mockResolvedValue(undefined)
    window.history.replaceState({}, '', '/partner/integration/ai?from=transaction-empty')

    renderPage()

    expect(screen.getByRole('heading', { level: 1, name: 'AI integrations' })).toBeInTheDocument()
    expect(screen.getByText('https://api.abroad.finance/mcp')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Read-only by design' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Other MCP client' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Read the setup guide' })).toHaveAttribute(
      'href',
      'https://abroad-docs.web.app/ai-integration',
    )
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(await screen.findByText('No AI clients connected')).toBeInTheDocument()
    expect(screen.getByText(/Verify MFA to revoke connected clients/iu)).toBeInTheDocument()
    await waitFor(() => expect(mocked.recordPartnerAiProductEvent).toHaveBeenCalledWith({
      clientCategory: 'GENERIC',
      entryPoint: 'TRANSACTION_EMPTY_STATE',
      event: 'AI_INTEGRATION_PAGE_VIEWED',
      outcome: 'NOT_APPLICABLE',
    }))
  })

  it('copies the production address and practical prompts with an accessible announcement', async () => {
    setPartnerPortalSession(adminSession)
    mocked.listPartnerAiConnections.mockResolvedValue([])
    mocked.recordPartnerAiProductEvent.mockResolvedValue(undefined)
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: navigator.clipboard,
    })
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Copy address' }))
    expect(writeText).toHaveBeenCalledWith('https://api.abroad.finance/mcp')
    expect(screen.getByText('MCP connection address copied.')).toHaveClass('sr-only')

    await user.click(screen.getAllByRole('button', { name: 'Copy example prompt' })[0])
    expect(writeText).toHaveBeenCalledWith(
      'Validate this create-quote request and explain any missing fields.',
    )
    expect(screen.getByText('Example prompt copied.')).toHaveClass('sr-only')
  })

  it('shows active, expired, revoked, and failed connections and safely tests metadata', async () => {
    setPartnerPortalSession(adminSession)
    const connections = [
      connection('ACTIVE'),
      connection('EXPIRED'),
      connection('REVOKED'),
      connection('FAILED'),
    ]
    mocked.listPartnerAiConnections.mockResolvedValue(connections)
    mocked.recordPartnerAiProductEvent.mockResolvedValue(undefined)
    mocked.testPartnerAiConnection.mockResolvedValue({
      connectionId: 'connection-active',
      organizationName: 'Atlas Payments',
      resource: 'https://api.abroad.finance/mcp',
      scopes: ['account:read', 'transactions:read'],
      serverVersion: '1.0.0',
      status: 'ACTIVE',
    })
    renderPage()
    const user = userEvent.setup()

    expect(await screen.findByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Expired')).toBeInTheDocument()
    expect(screen.getByText('Revoked')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Test connection for ACTIVE Assistant' }))

    expect(mocked.testPartnerAiConnection).toHaveBeenCalledWith('connection-active')
    expect(await screen.findByText(/No transaction or financial operation was performed/iu)).toBeInTheDocument()
    expect(mocked.recordPartnerAiProductEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'AI_CONNECTION_TESTED',
      outcome: 'SUCCEEDED',
    }))
  })

  it('explains immediate revocation and lets only an MFA-verified administrator confirm it', async () => {
    setPartnerPortalSession(adminSession)
    const active = connection('ACTIVE')
    mocked.listPartnerAiConnections.mockResolvedValue([active])
    mocked.recordPartnerAiProductEvent.mockResolvedValue(undefined)
    mocked.revokePartnerAiConnection.mockResolvedValue({ ...active, status: 'REVOKED' })
    renderPage()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Revoke ACTIVE Assistant' }))
    const dialog = screen.getByRole('dialog', { name: 'Revoke this AI client?' })
    expect(within(dialog).getByText(/lose access immediately/iu)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Revoke access' }))

    await waitFor(() => expect(mocked.revokePartnerAiConnection).toHaveBeenCalledWith(
      'connection-active',
    ))
    expect(mocked.recordPartnerAiProductEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: 'AI_CONNECTION_REVOKED',
      outcome: 'REVOKED',
    }))
  })

  it('keeps management read-only for members and provides a recoverable server-error state', async () => {
    setPartnerPortalSession({ ...adminSession, role: 'MEMBER' })
    mocked.listPartnerAiConnections.mockResolvedValueOnce([connection('ACTIVE')])
    mocked.recordPartnerAiProductEvent.mockResolvedValue(undefined)
    renderPage()

    const revoke = await screen.findByRole('button', { name: 'Revoke ACTIVE Assistant' })
    expect(revoke).toBeDisabled()
    expect(screen.getByText(/administrator must approve or revoke access/iu)).toBeInTheDocument()
    expect(mocked.revokePartnerAiConnection).not.toHaveBeenCalled()

    mocked.listPartnerAiConnections.mockRejectedValueOnce(new Error('Connected clients are temporarily unavailable'))
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('Connected clients are temporarily unavailable')).toBeInTheDocument()
  })
})
