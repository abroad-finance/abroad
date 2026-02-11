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

import { clearOpsApiKey, setOpsApiKey } from '../services/admin/opsAuthStore'
import PartnerApiKeys from '../pages/Ops/PartnerApiKeys'

const mocked = vi.hoisted(() => ({
  createPartner: vi.fn(),
  listPartners: vi.fn(),
  revokePartnerApiKey: vi.fn(),
  rotatePartnerApiKey: vi.fn(),
}))

vi.mock('../services/admin/partnerAdminApi', () => ({
  createPartner: mocked.createPartner,
  listPartners: mocked.listPartners,
  revokePartnerApiKey: mocked.revokePartnerApiKey,
  rotatePartnerApiKey: mocked.rotatePartnerApiKey,
}))

afterEach(() => {
  clearOpsApiKey()
  vi.clearAllMocks()
})

describe('PartnerApiKeys page', () => {
  it('creates partner and shows one-time API key', async () => {
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
    await user.click(screen.getByRole('button', { name: 'Create Partner & Generate Key' }))

    await screen.findByText('One-Time API Key')
    expect(screen.getByText('partner_created_key')).toBeInTheDocument()
    expect(mocked.createPartner).toHaveBeenCalledWith(expect.objectContaining({
      company: 'Acme',
      email: 'acme@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
    }))
  })

  it('rotates and revokes partner API key', async () => {
    setOpsApiKey('ops_key')

    mocked.listPartners.mockResolvedValue({
      items: [{
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

    await user.click(screen.getByRole('button', { name: 'Revoke' }))

    await waitFor(() => {
      expect(mocked.revokePartnerApiKey).toHaveBeenCalledWith('partner-1')
    })
    expect(screen.getByText('Revoked')).toBeInTheDocument()
  })
})
