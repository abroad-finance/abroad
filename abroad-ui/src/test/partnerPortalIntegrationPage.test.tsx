import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import {
  afterEach, describe, expect, it, vi,
} from 'vitest'

import PartnerPortalIntegration from '../pages/PartnerPortal/PartnerPortalIntegration'
import {
  clearPartnerPortalSession,
  setPartnerPortalSession,
} from '../services/partnerPortal/partnerPortalSessionStore'
import { PartnerPortalTestProviders } from './partnerPortalTestProviders'

const mocked = vi.hoisted(() => ({
  activatePartnerWebhook: vi.fn(),
  createPartnerApiKey: vi.fn(),
  discardPartnerWebhookDraft: vi.fn(),
  getPartnerWebhookConfiguration: vi.fn(),
  listPartnerApiKeys: vi.fn(),
  revokePartnerApiKey: vi.fn(),
  rotatePartnerApiKey: vi.fn(),
  rotatePartnerWebhookSecret: vi.fn(),
  stagePartnerWebhookUrl: vi.fn(),
  testPartnerWebhookDraft: vi.fn(),
}))

vi.mock('../services/partnerPortal/partnerPortalApi', () => mocked)

const emptyKeys = { items: [], legacyKeyActive: true }
const activeWebhook = {
  active: {
    managedSecret: false,
    secretPrefix: null,
    url: 'https://partner.example/current',
    version: 0,
  },
  pending: null,
}

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

afterEach(() => {
  clearPartnerPortalSession()
  vi.clearAllMocks()
})

describe('PartnerPortalIntegration', () => {
  it('creates a scoped API key and keeps its secret only in the one-time dialog', async () => {
    setPartnerPortalSession(adminSession)
    const keyResult = {
      apiKey: {
        createdAt: '2026-08-01T12:00:00.000Z',
        displayPrefix: 'ab_pk_live_',
        expiresAt: null,
        id: 'key-1',
        lastUsedAt: null,
        name: 'Production checkout',
        revokedAt: null,
        scopes: ['transactions:read', 'transactions:write'],
        status: 'ACTIVE',
      },
      secret: 'ab_pk_secret_shown_once',
    }
    mocked.listPartnerApiKeys.mockResolvedValue(emptyKeys)
    mocked.getPartnerWebhookConfiguration.mockResolvedValue(activeWebhook)
    mocked.createPartnerApiKey.mockResolvedValue(keyResult)
    mocked.listPartnerApiKeys.mockResolvedValueOnce(emptyKeys).mockResolvedValueOnce({
      items: [keyResult.apiKey],
      legacyKeyActive: true,
    })
    render(<PartnerPortalTestProviders><MemoryRouter><PartnerPortalIntegration /></MemoryRouter></PartnerPortalTestProviders>)
    const user = userEvent.setup()

    const aiIntegrationLink = await screen.findByRole('link', { name: 'Open AI integrations' })
    expect(aiIntegrationLink).toHaveAttribute('href', '/partner/integration/ai?from=integration-card')
    expect(screen.getByText(/without sharing an API key or webhook secret/iu)).toBeInTheDocument()

    await user.type(await screen.findByPlaceholderText('Production checkout'), 'Production checkout')
    await user.click(screen.getByRole('button', { name: 'Create API key' }))

    expect(await screen.findByRole('dialog')).toHaveTextContent('ab_pk_secret_shown_once')
    expect(mocked.createPartnerApiKey).toHaveBeenCalledWith({
      name: 'Production checkout',
      scopes: ['transactions:read', 'transactions:write'],
    })
    await user.click(screen.getByRole('button', { name: 'I saved it' }))
    expect(screen.queryByText('ab_pk_secret_shown_once')).not.toBeInTheDocument()
    expect(window.sessionStorage.getItem('abroad.partnerPortal.session.v2')).not.toContain('ab_pk_secret_shown_once')
  })

  it('requires a successful test of the exact webhook draft before activation', async () => {
    setPartnerPortalSession(adminSession)
    const pending = {
      ...activeWebhook,
      pending: {
        lastTest: null,
        revision: 2,
        rotatesSecret: false,
        secretPrefix: null,
        url: 'https://partner.example/new',
      },
    }
    const tested = {
      ...pending,
      pending: {
        ...pending.pending,
        lastTest: {
          attemptedAt: '2026-08-01T12:00:00.000Z',
          deliveryId: null,
          durationMs: 84,
          failureCode: null,
          httpStatus: 204,
          status: 'DELIVERED',
        },
      },
    }
    mocked.listPartnerApiKeys.mockResolvedValue(emptyKeys)
    mocked.getPartnerWebhookConfiguration
      .mockResolvedValueOnce(activeWebhook)
      .mockResolvedValueOnce(tested)
    mocked.stagePartnerWebhookUrl.mockResolvedValue(pending)
    mocked.testPartnerWebhookDraft.mockResolvedValue(tested.pending.lastTest)
    mocked.activatePartnerWebhook.mockResolvedValue({
      active: {
        managedSecret: false, secretPrefix: null, url: pending.pending.url, version: 0,
      },
      pending: null,
    })
    render(<PartnerPortalTestProviders><MemoryRouter><PartnerPortalIntegration /></MemoryRouter></PartnerPortalTestProviders>)
    const user = userEvent.setup()

    const endpoint = await screen.findByLabelText('HTTPS endpoint')
    await user.clear(endpoint)
    await user.type(endpoint, 'https://partner.example/new')
    await user.click(screen.getByRole('button', { name: 'Stage URL' }))
    expect(screen.getByRole('button', { name: 'Activate tested draft' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Send test' }))
    expect(await screen.findByText('Draft test delivered')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Activate tested draft' }))

    await waitFor(() => expect(mocked.activatePartnerWebhook).toHaveBeenCalledOnce())
    expect(await screen.findByText('The tested webhook draft is now active.')).toBeInTheDocument()
  })

  it('does not call integration APIs for members who enter the route directly', () => {
    setPartnerPortalSession({ ...adminSession, role: 'MEMBER' })

    render(<PartnerPortalTestProviders><MemoryRouter><PartnerPortalIntegration /></MemoryRouter></PartnerPortalTestProviders>)

    expect(screen.getByRole('heading', { name: 'Administrator verification required' })).toBeInTheDocument()
    expect(mocked.listPartnerApiKeys).not.toHaveBeenCalled()
    expect(mocked.getPartnerWebhookConfiguration).not.toHaveBeenCalled()
  })
})
