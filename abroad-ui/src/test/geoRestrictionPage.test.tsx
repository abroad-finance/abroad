import { render, screen, waitFor } from '@testing-library/react'
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

import type { OpsGeoRestriction } from '../services/admin/geoRestrictionTypes'
import type { OpsSession } from '../services/admin/opsAuthStore'

import GeoRestriction from '../pages/Ops/GeoRestriction'
import { clearOpsApiKey, setOpsSession } from '../services/admin/opsAuthStore'
import { testOpsMutationDetails } from './opsMutationTestFixtures'
import { ImmediateOpsMutationProvider } from './opsMutationTestUtils'

const mocked = vi.hoisted(() => ({
  getGeoRestriction: vi.fn(),
  updateGeoRestriction: vi.fn(),
}))

vi.mock('../services/admin/geoRestrictionAdminApi', () => ({
  getGeoRestriction: mocked.getGeoRestriction,
  updateGeoRestriction: mocked.updateGeoRestriction,
}))

const enforcedSetting: OpsGeoRestriction = {
  enabled: true,
  restrictedCountries: ['US'],
  updatedAt: '2026-08-02T15:00:00.000Z',
  version: 4,
}

const session = (permissions: OpsSession['permissions']): OpsSession => ({
  authenticatedAt: '2026-08-02T15:00:00.000Z',
  bootstrapRequired: false,
  displayName: 'Ops Administrator',
  email: 'administrator@abroad.finance',
  kind: 'ops_user',
  permissions,
  role: 'ADMINISTRATOR',
  sessionVersion: 1,
  stepUpExpiresAt: '2026-08-02T15:30:00.000Z',
  userId: 'ops-admin-1',
})

const renderPage = () => render(
  <MemoryRouter>
    <ImmediateOpsMutationProvider>
      <GeoRestriction />
    </ImmediateOpsMutationProvider>
  </MemoryRouter>,
)

beforeEach(() => {
  setOpsSession(session(['configuration:manage', 'configuration:read']))
})

afterEach(() => {
  clearOpsApiKey()
  setOpsSession(null)
  vi.clearAllMocks()
})

describe('GeoRestriction page', () => {
  it('disables an enforced restriction and sends the loaded version', async () => {
    mocked.getGeoRestriction.mockResolvedValue(enforcedSetting)
    mocked.updateGeoRestriction.mockResolvedValue({
      ...enforcedSetting,
      enabled: false,
      version: 5,
    })
    renderPage()

    expect(await screen.findByText('Enforced')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Disable restriction' }))

    await waitFor(() => {
      expect(mocked.updateGeoRestriction).toHaveBeenCalledWith(
        { enabled: false },
        { ...testOpsMutationDetails, expectedVersion: 4 },
      )
    })
    expect(await screen.findByText('Not enforced')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enable restriction' })).toBeInTheDocument()
  })

  it('re-enables a lifted restriction', async () => {
    const lifted: OpsGeoRestriction = { ...enforcedSetting, enabled: false, version: 7 }
    mocked.getGeoRestriction.mockResolvedValue(lifted)
    mocked.updateGeoRestriction.mockResolvedValue({ ...lifted, enabled: true, version: 8 })
    renderPage()

    expect(await screen.findByText('Not enforced')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Enable restriction' }))

    await waitFor(() => {
      expect(mocked.updateGeoRestriction).toHaveBeenCalledWith(
        { enabled: true },
        { ...testOpsMutationDetails, expectedVersion: 7 },
      )
    })
    expect(await screen.findByText('Enforced')).toBeInTheDocument()
  })

  it('surfaces a rejected update and leaves the displayed state unchanged', async () => {
    mocked.getGeoRestriction.mockResolvedValue(enforcedSetting)
    mocked.updateGeoRestriction.mockRejectedValue(
      new Error('The region restriction changed after it was loaded; refresh before trying again'),
    )
    renderPage()

    expect(await screen.findByText('Enforced')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Disable restriction' }))

    expect(await screen.findByText(
      'The region restriction changed after it was loaded; refresh before trying again',
    )).toBeInTheDocument()
    expect(screen.getByText('Enforced')).toBeInTheDocument()
  })

  it('lets a read-only operator see the state but not change it', async () => {
    setOpsSession(session(['configuration:read']))
    mocked.getGeoRestriction.mockResolvedValue(enforcedSetting)
    renderPage()

    expect(await screen.findByText('Enforced')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Disable restriction' })).toBeDisabled()
    expect(mocked.updateGeoRestriction).not.toHaveBeenCalled()
  })

  it('does not read the setting without configuration access', async () => {
    setOpsSession(session(['transactions:read']))
    renderPage()

    expect(await screen.findByText('Your current role cannot view the region restriction.')).toBeInTheDocument()
    expect(mocked.getGeoRestriction).not.toHaveBeenCalled()
  })
})
