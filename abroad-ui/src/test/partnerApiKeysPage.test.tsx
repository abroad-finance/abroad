import { render, screen, waitFor } from '@testing-library/react'
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
    await user.type(screen.getByPlaceholderText('Company'), 'Acme')
    await user.type(screen.getByPlaceholderText('First name'), 'Ada')
    await user.type(screen.getByPlaceholderText('Last name'), 'Lovelace')
    await user.type(screen.getByPlaceholderText('Email'), 'acme@example.com')
    await user.type(screen.getByPlaceholderText('Client domain (optional)'), 'https://App.Abroad.Finance/swap')
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
  })
})
