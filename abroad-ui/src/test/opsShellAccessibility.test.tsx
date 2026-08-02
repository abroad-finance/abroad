import {
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest'

import type { OpsSession } from '../services/admin/opsAuthStore'

import { OpsField } from '../pages/Ops/shared/OpsField'
import { OPS_NAV_GROUPS } from '../pages/Ops/shared/OpsNav'
import { OpsPageShell } from '../pages/Ops/shared/OpsPageShell'
import { OpsShellStatusProvider } from '../pages/Ops/shared/OpsShellStatusContext'
import {
  clearOpsApiKey,
  setOpsAuthStatus,
  setOpsSession,
} from '../services/admin/opsAuthStore'

const incidentMocks = vi.hoisted(() => ({
  getOpsIncidentOverview: vi.fn(),
}))

vi.mock('../services/admin/incidentAdminApi', () => incidentMocks)

const administratorSession: OpsSession = {
  authenticatedAt: '2026-08-02T15:00:00.000Z',
  bootstrapRequired: false,
  displayName: 'Ana Administrator',
  email: 'ana@abroad.finance',
  kind: 'ops_user',
  permissions: [
    'administration:audit',
    'administration:integrations',
    'administration:users',
    'configuration:read',
    'credentials:manage',
    'flows:read',
    'incidents:read',
    'kyc:read',
    'overview:read',
    'partners:read',
    'search:read',
    'transactions:read',
    'transactions:reconcile',
    'treasury:read',
  ],
  role: 'ADMINISTRATOR',
  sessionVersion: 1,
  stepUpExpiresAt: '2099-08-02T15:10:00.000Z',
  userId: 'ops-user-1',
}

const LocationProbe = () => {
  const location = useLocation()
  return <output data-testid="location-probe">{location.pathname}</output>
}

const renderShell = () => render(
  <MemoryRouter initialEntries={['/ops']}>
    <OpsShellStatusProvider>
      <OpsPageShell eyebrow="Work" subtitle="Prioritized operational work." title="Control Tower">
        <section aria-label="Operational signal">Queue is healthy</section>
      </OpsPageShell>
      <LocationProbe />
    </OpsShellStatusProvider>
  </MemoryRouter>,
)

beforeEach(() => {
  setOpsSession(administratorSession)
  incidentMocks.getOpsIncidentOverview.mockResolvedValue({
    critical: 1,
    high: 2,
    open: 3,
    top: [],
    unowned: 1,
  })
})

afterEach(() => {
  clearOpsApiKey()
  setOpsSession(null)
  setOpsAuthStatus('signed_out')
  vi.clearAllMocks()
})

describe('task-oriented Ops shell', () => {
  test('renders the exact role-grouped hierarchy, operational chrome, and semantic page structure', async () => {
    renderShell()

    await screen.findByLabelText('3 active incidents')
    const sidebar = screen.getByTestId('ops-desktop-sidebar')
    const expectedGroups = OPS_NAV_GROUPS.map(group => group.label)
    const actualGroups = within(sidebar).getAllByRole('heading', { level: 2 }).map(heading => heading.textContent)

    expect(actualGroups).toEqual(expectedGroups)
    expect(within(sidebar).getAllByRole('link').map(link => link.textContent?.trim())).toEqual([
      'Home',
      'Incidents3',
      'Transactions',
      'Flows',
      'Reconciliation',
      'Treasury',
      'Bridge',
      'Partners',
      'Credentials',
      'KYC',
      'Corridors',
      'Assets',
      'History',
      'Users',
      'Audit',
      'Integrations',
    ])
    expect(screen.getByRole('link', { name: 'Skip to operations content' })).toHaveAttribute('href', '#ops-main-content')
    expect(screen.getByRole('main')).toHaveAttribute('id', 'ops-main-content')
    expect(screen.getByTestId('ops-compact-session')).toHaveTextContent('Ana Administrator')
    expect(screen.queryByRole('heading', { name: 'Sign in with your Abroad account' })).not.toBeInTheDocument()
    expect(screen.getAllByText('Production').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'Search operations' })).toHaveAttribute('href', '/ops/search')
    expect(screen.getByRole('link', { name: 'Open Incident Center, 3 active incidents' })).toHaveAttribute('href', '/ops/incidents')
    expect(screen.getAllByLabelText('3 active incidents')).toHaveLength(1)
    expect(screen.getByLabelText('Live data. Refresh shell status')).toBeInTheDocument()
    await waitFor(() => expect(document.title).toBe('Control Tower | Abroad Ops'))
  })

  test('filters navigation from server-issued permissions', async () => {
    setOpsSession({
      ...administratorSession,
      displayName: 'Sam Support',
      permissions: [
        'flows:read',
        'incidents:read',
        'overview:read',
        'partners:read',
        'search:read',
        'transactions:read',
        'treasury:read',
      ],
      role: 'SUPPORT',
    })

    renderShell()
    await screen.findByLabelText('3 active incidents')

    const sidebar = screen.getByTestId('ops-desktop-sidebar')
    expect(within(sidebar).getByRole('link', { name: 'Transactions' })).toBeInTheDocument()
    expect(within(sidebar).queryByRole('link', { name: 'Reconciliation' })).not.toBeInTheDocument()
    expect(within(sidebar).queryByRole('link', { name: 'Credentials' })).not.toBeInTheDocument()
    expect(within(sidebar).queryByRole('heading', { name: 'Administration' })).not.toBeInTheDocument()
  })

  test('opens an accessible mobile drawer, restores focus, and supports global search shortcut', async () => {
    const user = userEvent.setup()
    renderShell()
    const trigger = screen.getByRole('button', { name: 'Open operations navigation' })
    trigger.focus()

    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Operations navigation' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveFocus())
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Operations navigation' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    await user.keyboard('{Meta>}k{/Meta}')
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/ops/search')
  })
})

describe('OpsField', () => {
  test('associates help and errors and focuses the first invalid control', async () => {
    render(
      <main id="ops-main-content">
        <OpsField error="Enter a valid reference" hint="Use the provider reference." label="Reference">
          <input />
        </OpsField>
      </main>,
    )

    const input = screen.getByRole('textbox', { name: 'Reference' })
    expect(input).toHaveAttribute('name')
    expect(input).toHaveAttribute('autocomplete', 'off')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.getAttribute('aria-describedby')?.split(' ')).toHaveLength(2)
    await waitFor(() => expect(input).toHaveFocus())
  })
})
