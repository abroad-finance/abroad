import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import FlowDefinitions from '../pages/Ops/FlowDefinitions'
import {
  clearOpsApiKey,
  setOpsApiKey,
  setOpsSession,
} from '../services/admin/opsAuthStore'
import { ImmediateOpsMutationProvider } from './opsMutationTestUtils'

const mocked = vi.hoisted(() => ({
  createFlowDefinition: vi.fn(),
  listFlowCorridors: vi.fn(),
  listFlowDefinitions: vi.fn(),
  updateFlowCorridor: vi.fn(),
  updateFlowDefinition: vi.fn(),
}))
const releaseMocked = vi.hoisted(() => ({
  createOpsConfigurationRelease: vi.fn(),
}))

vi.mock('../services/admin/flowAdminApi', () => mocked)
vi.mock('../services/admin/configurationReleaseAdminApi', () => releaseMocked)

const LocationProbe = () => {
  const location = useLocation()
  return <output aria-label="Current route">{`${location.pathname}${location.search}`}</output>
}

afterEach(() => {
  clearOpsApiKey()
  setOpsSession(null)
  vi.clearAllMocks()
})

describe('FlowDefinitions fee fields', () => {
  it('explains percentage units and identifies the fixed-fee payout currency', async () => {
    setOpsApiKey('ops_key')
    mocked.listFlowDefinitions.mockResolvedValue([])
    mocked.listFlowCorridors.mockResolvedValue({
      corridors: [{
        blockchain: 'STELLAR',
        cryptoCurrency: 'USDC',
        status: 'MISSING',
        targetCurrency: 'BRL',
        updatedAt: '2026-08-01T12:00:00.000Z',
        version: 1,
      }, {
        blockchain: 'STELLAR',
        cryptoCurrency: 'USDC',
        status: 'MISSING',
        targetCurrency: 'COP',
        updatedAt: '2026-08-01T12:00:00.000Z',
        version: 1,
      }],
      summary: {
        defined: 0,
        missing: 2,
        total: 2,
        unsupported: 0,
      },
    })

    render(
      <MemoryRouter>
        <ImmediateOpsMutationProvider>
          <FlowDefinitions />
          <LocationProbe />
        </ImmediateOpsMutationProvider>
      </MemoryRouter>,
    )

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /USDC · Stellar → BRL/ }))
    expect(screen.getByLabelText('Current route')).toHaveTextContent(
      'corridor=USDC%3ASTELLAR%3ABRL',
    )

    expect(screen.getByLabelText('Percentage Fee')).toHaveAttribute('placeholder', '0.01')
    expect(screen.getByText('Enter the fee as a decimal. Example: 0.01 = 1%; 0.001 = 0.1%.')).toBeInTheDocument()
    expect(screen.getByLabelText('Fixed Fee (BRL)')).toHaveAttribute('placeholder', '2.50')
    expect(screen.getByText('Added once per transaction in the payout currency. Example: 2.50 BRL.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /USDC · Stellar → COP/ }))

    expect(screen.getByLabelText('Fixed Fee (COP)')).toBeInTheDocument()
    expect(screen.getByText('Added once per transaction in the payout currency. Example: 2.50 COP.')).toBeInTheDocument()
  })

  it('creates a governed review draft and preserves the selected corridor in the URL', async () => {
    setOpsSession({
      authenticatedAt: '2026-08-02T18:00:00.000Z',
      bootstrapRequired: false,
      displayName: 'Configuration Owner',
      email: 'owner@abroad.finance',
      kind: 'ops_user',
      permissions: ['configuration:manage', 'configuration:read'],
      role: 'ADMINISTRATOR',
      sessionVersion: 1,
      stepUpExpiresAt: null,
      userId: 'ops-owner',
    })
    mocked.listFlowDefinitions.mockResolvedValue([])
    mocked.listFlowCorridors.mockResolvedValue({
      corridors: [{
        blockchain: 'STELLAR',
        cryptoCurrency: 'USDC',
        status: 'MISSING',
        targetCurrency: 'BRL',
        updatedAt: '2026-08-01T12:00:00.000Z',
        version: 1,
      }],
      summary: {
        defined: 0, missing: 1, total: 1, unsupported: 0,
      },
    })
    releaseMocked.createOpsConfigurationRelease.mockResolvedValue({
      id: 'release-flow-1',
      status: 'DRAFT',
      title: 'Create USDC on Stellar to BRL flow',
    })

    render(
      <MemoryRouter initialEntries={['/ops/configuration/corridors?status=missing']}>
        <ImmediateOpsMutationProvider>
          <FlowDefinitions />
        </ImmediateOpsMutationProvider>
      </MemoryRouter>,
    )

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /USDC · Stellar → BRL/ }))
    await user.type(screen.getByLabelText('Name'), 'Stellar to Brazil')
    await user.click(screen.getByRole('button', { name: 'Create review draft' }))

    expect(releaseMocked.createOpsConfigurationRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          kind: 'FLOW_DEFINITION',
          operation: 'CREATE',
          value: expect.objectContaining({ name: 'Stellar to Brazil' }),
        }),
      }),
      expect.objectContaining({ reason: 'Focused automated test operation' }),
    )
    expect(mocked.createFlowDefinition).not.toHaveBeenCalled()
    expect(await screen.findByRole('link', { name: 'Create USDC on Stellar to BRL flow' })).toHaveAttribute(
      'href',
      '/ops/configuration/history?release=release-flow-1',
    )
  })

  it('keeps configuration controls read-only without management permission', async () => {
    setOpsSession({
      authenticatedAt: '2026-08-02T18:00:00.000Z',
      bootstrapRequired: false,
      displayName: 'Read Only Operator',
      email: 'viewer@abroad.finance',
      kind: 'ops_user',
      permissions: ['configuration:read'],
      role: 'VIEWER',
      sessionVersion: 1,
      stepUpExpiresAt: null,
      userId: 'ops-viewer',
    })
    mocked.listFlowDefinitions.mockResolvedValue([])
    mocked.listFlowCorridors.mockResolvedValue({
      corridors: [{
        blockchain: 'STELLAR',
        cryptoCurrency: 'USDC',
        status: 'MISSING',
        targetCurrency: 'BRL',
        updatedAt: '2026-08-01T12:00:00.000Z',
        version: 1,
      }],
      summary: {
        defined: 0, missing: 1, total: 1, unsupported: 0,
      },
    })

    render(
      <MemoryRouter>
        <ImmediateOpsMutationProvider>
          <FlowDefinitions />
        </ImmediateOpsMutationProvider>
      </MemoryRouter>,
    )

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /USDC · Stellar → BRL/ }))

    expect(screen.getByText(/Read-only access/)).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toBeDisabled()
    expect(screen.getByLabelText('Percentage Fee')).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'New step type' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Create review draft' })).toBeDisabled()
    expect(releaseMocked.createOpsConfigurationRelease).not.toHaveBeenCalled()
  })
})
