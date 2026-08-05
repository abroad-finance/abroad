import {
  render, screen, waitFor, within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import type { OpsSession } from '../services/admin/opsAuthStore'

import PartnerApiKeys from '../pages/Ops/PartnerApiKeys'
import { clearOpsApiKey, setOpsSession } from '../services/admin/opsAuthStore'
import { testOpsMutationDetails } from './opsMutationTestFixtures'
import { ImmediateOpsMutationProvider } from './opsMutationTestUtils'

const mocked = vi.hoisted(() => ({
  createPartner: vi.fn(),
  getPartnerCredentialHistory: vi.fn(),
  listPartners: vi.fn(),
  revokePartnerApiKey: vi.fn(),
  rotatePartnerApiKey: vi.fn(),
  updatePartnerClientDomain: vi.fn(),
  updatePartnerKybApproval: vi.fn(),
  updatePartnerKycRequirement: vi.fn(),
  updatePartnerProfile: vi.fn(),
  updatePartnerStatus: vi.fn(),
  updatePartnerWebhookUrl: vi.fn(),
}))

vi.mock('../services/admin/partnerAdminApi', () => ({
  createPartner: mocked.createPartner,
  getPartnerCredentialHistory: mocked.getPartnerCredentialHistory,
  listPartners: mocked.listPartners,
  revokePartnerApiKey: mocked.revokePartnerApiKey,
  rotatePartnerApiKey: mocked.rotatePartnerApiKey,
  updatePartnerClientDomain: mocked.updatePartnerClientDomain,
  updatePartnerKybApproval: mocked.updatePartnerKybApproval,
  updatePartnerKycRequirement: mocked.updatePartnerKycRequirement,
  updatePartnerProfile: mocked.updatePartnerProfile,
  updatePartnerStatus: mocked.updatePartnerStatus,
  updatePartnerWebhookUrl: mocked.updatePartnerWebhookUrl,
}))

const administratorSession: OpsSession = {
  authenticatedAt: '2026-08-02T15:00:00.000Z',
  bootstrapRequired: false,
  displayName: 'Ops Administrator',
  email: 'administrator@abroad.finance',
  kind: 'ops_user',
  permissions: [
    'credentials:manage',
    'partners:manage',
    'partners:read',
  ],
  role: 'ADMINISTRATOR',
  sessionVersion: 1,
  stepUpExpiresAt: '2026-08-02T15:30:00.000Z',
  userId: 'ops-admin-1',
}

beforeEach(() => {
  setOpsSession(administratorSession)
})

afterEach(() => {
  clearOpsApiKey()
  setOpsSession(null)
  vi.clearAllMocks()
})

describe('PartnerApiKeys page', () => {
  it('creates partner and includes the optional client domain', async () => {
    mocked.listPartners.mockResolvedValue({
      items: [],
      maximumStablecoinAmount: 0,
      page: 1,
      pageSize: 20,
      total: 0,
    })
    mocked.createPartner.mockResolvedValue({
      apiKey: 'partner_created_key',
      partner: {
        clientDomain: 'app.abroad.finance',
        createdAt: new Date('2024-01-01T00:00:00.000Z').toISOString(),
        hasApiKey: true,
        id: 'partner-1',
        isKybApproved: false,
        name: 'Acme',
        needsKyc: true,
      },
    })

    render(
      <MemoryRouter>
        <ImmediateOpsMutationProvider>
          <PartnerApiKeys />
        </ImmediateOpsMutationProvider>
      </MemoryRouter>,
    )

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('Company'), 'Acme')
    await user.type(screen.getByLabelText('First name'), 'Ada')
    await user.type(screen.getByLabelText('Last name'), 'Lovelace')
    await user.type(screen.getByLabelText('Email'), 'acme@example.com')
    await user.type(screen.getByLabelText('Client domain'), 'https://App.Abroad.Finance/swap')
    await user.click(screen.getByRole('button', { name: 'Create Partner & Generate Key' }))

    await screen.findByText('One-Time API Key')
    expect(screen.getByText('partner_created_key')).toBeInTheDocument()
    expect(mocked.createPartner).toHaveBeenCalledWith(
      expect.objectContaining({
        clientDomain: 'https://App.Abroad.Finance/swap',
        company: 'Acme',
        email: 'acme@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
      }),
      testOpsMutationDetails,
    )
  })

  it('rotates, edits, clears, and revokes partner settings inline', async () => {
    mocked.listPartners.mockResolvedValue({
      items: [{
        clientDomain: 'old.abroad.finance',
        completedVolume: {
          completedTransactions: 3,
          payout: [{ amount: 1_500, currency: 'BRL' }, { amount: 23_000, currency: 'COP' }],
          source: [{ amount: 303.12, currency: 'USDC' }, { amount: 12.5, currency: 'USDT' }],
          stablecoinAmount: 315.62,
        },
        createdAt: new Date('2024-01-01T00:00:00.000Z').toISOString(),
        email: 'acme@example.com',
        firstName: 'Ada',
        hasApiKey: true,
        id: 'partner-1',
        isKybApproved: false,
        lastName: 'Lovelace',
        name: 'Acme',
        needsKyc: true,
      }],
      maximumStablecoinAmount: 315.62,
      page: 1,
      pageSize: 20,
      total: 1,
    })
    mocked.rotatePartnerApiKey.mockResolvedValue({
      apiKey: 'partner_rotated_key',
      partner: {
        clientDomain: 'old.abroad.finance',
        createdAt: new Date('2024-01-01T00:00:00.000Z').toISOString(),
        email: 'acme@example.com',
        firstName: 'Ada',
        hasApiKey: true,
        id: 'partner-1',
        isKybApproved: false,
        lastName: 'Lovelace',
        name: 'Acme',
        needsKyc: true,
      },
    })
    mocked.updatePartnerClientDomain
      .mockResolvedValueOnce({
        clientDomain: 'app.abroad.finance',
        createdAt: new Date('2024-01-01T00:00:00.000Z').toISOString(),
        email: 'acme@example.com',
        firstName: 'Ada',
        hasApiKey: true,
        id: 'partner-1',
        isKybApproved: false,
        lastName: 'Lovelace',
        name: 'Acme',
        needsKyc: true,
      })
      .mockResolvedValueOnce({
        clientDomain: undefined,
        createdAt: new Date('2024-01-01T00:00:00.000Z').toISOString(),
        email: 'acme@example.com',
        firstName: 'Ada',
        hasApiKey: true,
        id: 'partner-1',
        isKybApproved: false,
        lastName: 'Lovelace',
        name: 'Acme',
        needsKyc: true,
      })
    mocked.revokePartnerApiKey.mockResolvedValue(undefined)
    render(
      <MemoryRouter>
        <ImmediateOpsMutationProvider>
          <PartnerApiKeys />
        </ImmediateOpsMutationProvider>
      </MemoryRouter>,
    )

    await screen.findByText('Acme')
    expect(screen.getByLabelText('Volume rank 1')).toBeInTheDocument()
    expect(screen.getByRole('img', {
      name: 'Rank 1: 315.62 USD stablecoins across 3 completed transactions; 303.12 USDC, 12.5 USDT',
    })).toBeInTheDocument()
    expect(screen.getByText('303.12 USDC')).toBeInTheDocument()
    expect(screen.getByText('12.5 USDT')).toBeInTheDocument()
    expect(screen.getByText('1,500.00 BRL')).toBeInTheDocument()
    expect(screen.getByText('23,000.00 COP')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Rotate Key' }))

    await screen.findByText('partner_rotated_key')
    expect(mocked.rotatePartnerApiKey).toHaveBeenCalledWith('partner-1', testOpsMutationDetails)

    await user.click(screen.getByRole('button', { name: 'Edit Domain' }))

    const domainInput = screen.getByLabelText('Client domain for Acme')
    await user.clear(domainInput)
    await user.type(domainInput, 'https://App.Abroad.Finance/path')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(mocked.updatePartnerClientDomain).toHaveBeenNthCalledWith(
        1,
        'partner-1',
        { clientDomain: 'https://App.Abroad.Finance/path' },
        testOpsMutationDetails,
      )
    })
    expect(screen.getByText('app.abroad.finance')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear Domain' }))

    await waitFor(() => {
      expect(mocked.updatePartnerClientDomain).toHaveBeenNthCalledWith(
        2,
        'partner-1',
        { clientDomain: null },
        testOpsMutationDetails,
      )
    })
    expect(screen.getByText('No browser origin configured')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Revoke' }))

    await waitFor(() => {
      expect(mocked.revokePartnerApiKey).toHaveBeenCalledWith('partner-1', testOpsMutationDetails)
    })
    expect(screen.getByText('Revoked')).toBeInTheDocument()
    expect(screen.getByText('315.62')).toBeInTheDocument()
  })

  it('toggles the partner KYC requirement and reflects the new state', async () => {
    const basePartner = {
      clientDomain: undefined,
      createdAt: new Date('2024-01-01T00:00:00.000Z').toISOString(),
      email: 'acme@example.com',
      firstName: 'Ada',
      hasApiKey: true,
      id: 'partner-1',
      isKybApproved: false,
      lastName: 'Lovelace',
      name: 'Acme',
    }
    mocked.listPartners.mockResolvedValue({
      items: [{
        ...basePartner,
        completedVolume: {
          completedTransactions: 0,
          payout: [],
          source: [],
          stablecoinAmount: 0,
        },
        needsKyc: true,
      }],
      maximumStablecoinAmount: 0,
      page: 1,
      pageSize: 20,
      total: 1,
    })
    mocked.updatePartnerKycRequirement.mockResolvedValue({ ...basePartner, needsKyc: false })

    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <ImmediateOpsMutationProvider>
          <PartnerApiKeys />
        </ImmediateOpsMutationProvider>
      </MemoryRouter>,
    )

    await screen.findByText('Acme')
    expect(screen.getByText('Required')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Disable KYC' }))

    await waitFor(() => {
      expect(mocked.updatePartnerKycRequirement).toHaveBeenCalledWith(
        'partner-1',
        { needsKyc: false },
        testOpsMutationDetails,
      )
    })

    // The row reflects the server's response, and the action flips to re-enable.
    expect(await screen.findByText('Disabled')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Require KYC' })).toBeInTheDocument()
  })

  it('approves KYB, edits the profile, sets a webhook, and suspends the partner', async () => {
    const basePartner = {
      clientDomain: undefined,
      createdAt: new Date('2024-01-01T00:00:00.000Z').toISOString(),
      email: 'acme@example.com',
      firstName: 'Ada',
      hasApiKey: true,
      id: 'partner-1',
      isKybApproved: false,
      lastName: 'Lovelace',
      name: 'Acme',
      needsKyc: true,
    }
    mocked.listPartners.mockResolvedValue({
      items: [{
        ...basePartner,
        completedVolume: {
          completedTransactions: 0, payout: [], source: [], stablecoinAmount: 0,
        },
      }],
      maximumStablecoinAmount: 0,
      page: 1,
      pageSize: 20,
      total: 1,
    })
    mocked.updatePartnerKybApproval.mockResolvedValue({ ...basePartner, isKybApproved: true })
    mocked.updatePartnerProfile.mockResolvedValue({ ...basePartner, isKybApproved: true, name: 'Acme Global' })
    mocked.updatePartnerWebhookUrl.mockResolvedValue({
      ...basePartner,
      isKybApproved: true,
      name: 'Acme Global',
      webhookUrl: 'https://hooks.acme.test/abroad',
    })
    mocked.updatePartnerStatus.mockResolvedValue({
      ...basePartner,
      disabledAt: new Date('2026-08-04T12:00:00.000Z').toISOString(),
      disabledBy: 'administrator@abroad.finance',
      disabledReason: 'fraud review',
      isKybApproved: true,
      name: 'Acme Global',
    })
    vi.spyOn(window, 'prompt').mockReturnValue('fraud review')

    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <ImmediateOpsMutationProvider>
          <PartnerApiKeys />
        </ImmediateOpsMutationProvider>
      </MemoryRouter>,
    )

    await screen.findByText('Acme')
    expect(screen.getByText('$100 cap')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Approve KYB' }))
    await waitFor(() => {
      expect(mocked.updatePartnerKybApproval).toHaveBeenCalledWith(
        'partner-1',
        { isKybApproved: true },
        testOpsMutationDetails,
      )
    })
    expect(await screen.findByText('Approved')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit Profile' }))
    const nameInput = screen.getByLabelText('Company name for Acme')
    await user.clear(nameInput)
    await user.type(nameInput, 'Acme Global')
    await user.click(screen.getByRole('button', { name: 'Save Profile' }))
    await waitFor(() => {
      expect(mocked.updatePartnerProfile).toHaveBeenCalledWith(
        'partner-1',
        expect.objectContaining({ name: 'Acme Global' }),
        testOpsMutationDetails,
      )
    })

    await user.click(screen.getByRole('button', { name: 'Set Webhook' }))
    await user.type(screen.getByLabelText('Webhook URL for Acme Global'), 'https://hooks.acme.test/abroad')
    await user.click(screen.getByRole('button', { name: 'Save Webhook' }))
    await waitFor(() => {
      expect(mocked.updatePartnerWebhookUrl).toHaveBeenCalledWith(
        'partner-1',
        { webhookUrl: 'https://hooks.acme.test/abroad' },
        testOpsMutationDetails,
      )
    })

    await user.click(screen.getByRole('button', { name: 'Suspend Partner' }))
    await waitFor(() => {
      expect(mocked.updatePartnerStatus).toHaveBeenCalledWith(
        'partner-1',
        { disabled: true, reason: 'fraud review' },
        testOpsMutationDetails,
      )
    })
    expect(await screen.findByText('Suspended')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore Partner' })).toBeInTheDocument()
  })

  it('renders a responsive partner ranking with proportional visual rails', async () => {
    mocked.listPartners.mockResolvedValue({
      items: [{
        completedVolume: {
          completedTransactions: 9,
          payout: [{ amount: 4_500, currency: 'BRL' }],
          source: [{ amount: 900, currency: 'USDC' }],
          stablecoinAmount: 900,
        },
        createdAt: new Date('2024-01-01T00:00:00.000Z').toISOString(),
        hasApiKey: true,
        id: 'partner-high',
        isKybApproved: false,
        name: 'High Volume',
        needsKyc: true,
      }, {
        completedVolume: {
          completedTransactions: 2,
          payout: [{ amount: 500, currency: 'BRL' }],
          source: [{ amount: 50, currency: 'USDC' }, { amount: 50, currency: 'USDT' }],
          stablecoinAmount: 100,
        },
        createdAt: new Date('2024-02-01T00:00:00.000Z').toISOString(),
        hasApiKey: true,
        id: 'partner-low',
        isKybApproved: false,
        name: 'Lower Volume',
        needsKyc: true,
      }],
      maximumStablecoinAmount: 900,
      page: 1,
      pageSize: 20,
      total: 2,
    })

    render(
      <MemoryRouter>
        <ImmediateOpsMutationProvider>
          <PartnerApiKeys />
        </ImmediateOpsMutationProvider>
      </MemoryRouter>,
    )

    await screen.findByText('High Volume')
    const rankedList = screen.getByRole('list', { name: 'Partners ranked by completed volume' })
    const rankedPartners = within(rankedList).getAllByRole('listitem')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(within(rankedPartners[0]).getByText('High Volume')).toBeInTheDocument()
    expect(within(rankedPartners[0]).getByLabelText('Volume rank 1')).toBeInTheDocument()
    expect(within(rankedPartners[1]).getByText('Lower Volume')).toBeInTheDocument()
    expect(within(rankedPartners[1]).getByLabelText('Volume rank 2')).toBeInTheDocument()

    const leaderRail = within(rankedPartners[0]).getByRole('img', { name: /Rank 1: 900 USD stablecoins/ })
    expect(leaderRail.querySelector('[data-currency="USDC"]')).toHaveAttribute('width', '100')
    expect(within(rankedPartners[1]).getByRole('img', { name: /Rank 2: 100 USD stablecoins/ })).toBeInTheDocument()
  })

  it('shows safe credential metadata, graceful overlap, and lifecycle history', async () => {
    mocked.listPartners.mockResolvedValue({
      items: [{
        completedVolume: {
          completedTransactions: 0,
          payout: [],
          source: [],
          stablecoinAmount: 0,
        },
        createdAt: '2026-01-01T00:00:00.000Z',
        hasApiKey: true,
        id: 'partner-1',
        isKybApproved: true,
        name: 'Credential Partner',
        needsKyc: false,
      }],
      maximumStablecoinAmount: 0,
      page: 1,
      pageSize: 20,
      total: 1,
    })
    mocked.getPartnerCredentialHistory.mockResolvedValue({
      events: [{
        action: 'credentials.api_key.rotate.succeeded',
        actorLabel: 'Ops Administrator',
        createdAt: '2026-08-02T15:00:00.000Z',
        id: 'event-1',
        reason: 'Scheduled partner rotation',
        source: 'OPS',
      }],
      legacyCredential: {
        active: true,
        overlapExpiresAt: '2026-08-03T15:00:00.000Z',
      },
      managedCredentials: [{
        createdAt: '2026-08-01T15:00:00.000Z',
        displayPrefix: 'partner_ab12',
        id: 'managed-key-1',
        lastUsedAt: '2026-08-02T14:00:00.000Z',
        name: 'Production integration',
        scopes: ['transactions:read', 'transactions:write'],
        status: 'ACTIVE',
      }],
      partner: {
        createdAt: '2026-01-01T00:00:00.000Z',
        hasApiKey: true,
        id: 'partner-1',
        isKybApproved: true,
        name: 'Credential Partner',
        needsKyc: false,
      },
    })

    render(
      <MemoryRouter>
        <ImmediateOpsMutationProvider>
          <PartnerApiKeys />
        </ImmediateOpsMutationProvider>
      </MemoryRouter>,
    )

    const user = userEvent.setup()
    await screen.findByText('Credential Partner')
    await user.click(screen.getByRole('button', { name: 'View History' }))

    expect(await screen.findByRole('region', { name: 'Credential history for Credential Partner' })).toBeInTheDocument()
    expect(screen.getByText('Production integration')).toBeInTheDocument()
    expect(screen.getByText('partner_ab12…')).toBeInTheDocument()
    expect(screen.getByText(/Previous key valid until/)).toBeInTheDocument()
    expect(screen.getByText('Scheduled partner rotation')).toBeInTheDocument()
    expect(screen.queryByText(/secretHash/i)).not.toBeInTheDocument()
  })
})
