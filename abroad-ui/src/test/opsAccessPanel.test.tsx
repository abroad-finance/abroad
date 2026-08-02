import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest'

import OpsApiKeyPanel from '../pages/Ops/OpsApiKeyPanel'
import {
  clearOpsApiKey,
  setOpsAuthStatus,
  setOpsSession,
} from '../services/admin/opsAuthStore'

const identityMocks = vi.hoisted(() => ({
  bootstrapOpsAdministrator: vi.fn(),
  restoreOpsSession: vi.fn(),
  signInToOps: vi.fn(),
  signOutFromOps: vi.fn(),
  stepUpOpsSession: vi.fn(),
}))

vi.mock('../services/admin/opsIdentityApi', () => identityMocks)

const session = {
  authenticatedAt: '2026-08-02T15:00:00.000Z',
  bootstrapRequired: false,
  displayName: 'Ana Operator',
  email: 'ana@abroad.finance',
  kind: 'ops_user' as const,
  permissions: ['overview:read'],
  role: 'OPERATIONS',
  sessionVersion: 1,
  stepUpExpiresAt: '2099-08-02T15:10:00.000Z',
  userId: 'ops-user-1',
}

beforeEach(() => {
  setOpsSession(null)
  setOpsAuthStatus('signed_out')
  identityMocks.signInToOps.mockResolvedValue(session)
})

afterEach(() => {
  clearOpsApiKey()
  setOpsSession(null)
})

describe('Ops access panel', () => {
  test('leads with named organization sign-in and keeps legacy access collapsed', async () => {
    const user = userEvent.setup()
    render(<OpsApiKeyPanel />)

    expect(screen.getByRole('heading', { name: 'Sign in with your Abroad account' })).toBeVisible()
    expect(screen.queryByLabelText('Emergency Ops API key')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Sign in with Google' }))
    expect(identityMocks.signInToOps).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Emergency legacy-key access' }))
    expect(screen.getByLabelText('Emergency Ops API key')).toBeVisible()
  })

  test('collapses an authenticated user into a compact named-session indicator', () => {
    setOpsSession(session)

    render(<OpsApiKeyPanel />)

    expect(screen.getByTestId('ops-session-bar')).toBeVisible()
    expect(screen.getByText('Ana Operator')).toBeVisible()
    expect(screen.getByText('Operations')).toBeVisible()
    expect(screen.queryByText('Sign in with your Abroad account')).not.toBeInTheDocument()
  })

  test('shows dual-proof bootstrap only when the server reports it is required', () => {
    setOpsSession({ ...session, bootstrapRequired: true, role: 'VIEWER' })

    render(<OpsApiKeyPanel />)

    expect(screen.getByLabelText('One-time bootstrap Ops key')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Bootstrap administrator' })).toBeDisabled()
  })
})
