import {
  render, screen, waitFor, within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import PartnerApiKeys from '../pages/Ops/PartnerApiKeys'
import { clearOpsApiKey, setOpsApiKey } from '../services/admin/opsAuthStore'

const mocked = vi.hoisted(() => ({
  createPartner: vi.fn(),
  listPartners: vi.fn(),
  revokePartnerApiKey: vi.fn(),
  rotatePartnerApiKey: vi.fn(),
  updatePartnerClientDomain: vi.fn(),
}))

vi.mock('../services/admin/partnerAdminApi', () => ({
  createPartner: mocked.createPartner,
  listPartners: mocked.listPartners,
  revokePartnerApiKey: mocked.revokePartnerApiKey,
  rotatePartnerApiKey: mocked.rotatePartnerApiKey,
  updatePartnerClientDomain: mocked.updatePartnerClientDomain,
}))

afterEach(() => {
  clearOpsApiKey()
  vi.clearAllMocks()
})

describe('PartnerApiKeys page', () => {
  it('creates partner and includes the optional client domain', async () => {
    setOpsApiKey('ops_key')

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
        <PartnerApiKeys />
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
    expect(mocked.createPartner).toHaveBeenCalledWith(expect.objectContaining({
      clientDomain: 'https://App.Abroad.Finance/swap',
      company: 'Acme',
      email: 'acme@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
    }))
  })

  it('rotates, edits, clears, and revokes partner settings inline', async () => {
    setOpsApiKey('ops_key')

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
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(
      <MemoryRouter>
        <PartnerApiKeys />
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
    expect(mocked.rotatePartnerApiKey).toHaveBeenCalledWith('partner-1')

    await user.click(screen.getByRole('button', { name: 'Edit Domain' }))

    const domainInput = screen.getByLabelText('Client domain for Acme')
    await user.clear(domainInput)
    await user.type(domainInput, 'https://App.Abroad.Finance/path')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(mocked.updatePartnerClientDomain).toHaveBeenNthCalledWith(1, 'partner-1', {
        clientDomain: 'https://App.Abroad.Finance/path',
      })
    })
    expect(screen.getByText('app.abroad.finance')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear Domain' }))

    await waitFor(() => {
      expect(mocked.updatePartnerClientDomain).toHaveBeenNthCalledWith(2, 'partner-1', {
        clientDomain: null,
      })
    })
    expect(screen.getByText('No browser origin configured')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Revoke' }))

    await waitFor(() => {
      expect(mocked.revokePartnerApiKey).toHaveBeenCalledWith('partner-1')
    })
    expect(screen.getByText('Revoked')).toBeInTheDocument()
    expect(screen.getByText('315.62')).toBeInTheDocument()
  })

  it('renders partners in server-ranked order with proportional visual rails', async () => {
    setOpsApiKey('ops_key')

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
        <PartnerApiKeys />
      </MemoryRouter>,
    )

    await screen.findByText('High Volume')
    const rows = screen.getAllByRole('row').slice(1)
    expect(within(rows[0]).getByText('High Volume')).toBeInTheDocument()
    expect(within(rows[0]).getByLabelText('Volume rank 1')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Lower Volume')).toBeInTheDocument()
    expect(within(rows[1]).getByLabelText('Volume rank 2')).toBeInTheDocument()

    const leaderRail = within(rows[0]).getByRole('img', { name: /Rank 1: 900 USD stablecoins/ })
    expect(leaderRail.querySelector('[data-currency="USDC"]')).toHaveAttribute('width', '100')
    expect(within(rows[1]).getByRole('img', { name: /Rank 2: 100 USD stablecoins/ })).toBeInTheDocument()
  })
})
