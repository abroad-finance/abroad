import {
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest'

import type { OpsSession } from '../services/admin/opsAuthStore'

import OpsAuditLog from '../pages/Ops/OpsAuditLog'
import OpsUsers from '../pages/Ops/OpsUsers'
import { setOpsSession } from '../services/admin/opsAuthStore'
import { testOpsMutationDetails } from './opsMutationTestFixtures'
import { ImmediateOpsMutationProvider } from './opsMutationTestUtils'

const administrationMocks = vi.hoisted(() => ({
  disableOpsUser: vi.fn(),
  enableOpsUser: vi.fn(),
  inviteOpsUser: vi.fn(),
  listOpsAuditEvents: vi.fn(),
  listOpsUsers: vi.fn(),
  revokeOpsUserSessions: vi.fn(),
  updateOpsUserRole: vi.fn(),
}))

vi.mock('../services/admin/administrationAdminApi', () => administrationMocks)

const administratorSession: OpsSession = {
  authenticatedAt: '2026-08-02T15:00:00.000Z',
  bootstrapRequired: false,
  displayName: 'Admin Operator',
  email: 'admin@abroad.finance',
  kind: 'ops_user',
  permissions: ['administration:audit', 'administration:users'],
  role: 'ADMINISTRATOR',
  sessionVersion: 3,
  stepUpExpiresAt: '2099-08-02T15:10:00.000Z',
  userId: 'ops-user-admin',
}

const adminUser = {
  createdAt: '2026-07-01T10:00:00.000Z',
  disabledAt: null,
  displayName: 'Admin Operator',
  email: 'admin@abroad.finance',
  id: 'ops-user-admin',
  lastLoginAt: '2026-08-02T15:00:00.000Z',
  permissions: ['administration:audit', 'administration:users'],
  role: 'ADMINISTRATOR' as const,
  sessionsRevokedAt: null,
  sessionVersion: 3,
  status: 'ACTIVE' as const,
  updatedAt: '2026-08-02T15:00:00.000Z',
  version: 6,
}

const supportUser = {
  createdAt: '2026-07-15T10:00:00.000Z',
  disabledAt: null,
  displayName: 'Support Operator',
  email: 'support@abroad.finance',
  id: 'ops-user-support',
  lastLoginAt: null,
  permissions: [
    'cases:manage',
    'transactions:proof',
    'transactions:read',
  ],
  role: 'SUPPORT' as const,
  sessionsRevokedAt: null,
  sessionVersion: 1,
  status: 'ACTIVE' as const,
  updatedAt: '2026-07-15T10:00:00.000Z',
  version: 4,
}

beforeEach(() => {
  setOpsSession(administratorSession)
  administrationMocks.listOpsUsers.mockResolvedValue({ items: [adminUser, supportUser] })
  administrationMocks.listOpsAuditEvents.mockResolvedValue({
    items: [],
    page: 1,
    pageSize: 30,
    total: 0,
  })
})

afterEach(() => {
  setOpsSession(null)
  vi.clearAllMocks()
})

describe('Ops administration pages', () => {
  test('admits users and applies versioned role and session controls', async () => {
    const invitedUser = {
      ...supportUser,
      createdAt: '2026-08-02T16:00:00.000Z',
      displayName: 'New Viewer',
      email: 'viewer@abroad.finance',
      id: 'ops-user-viewer',
      permissions: ['overview:read'],
      role: 'VIEWER' as const,
      status: 'INVITED' as const,
      version: 1,
    }
    administrationMocks.inviteOpsUser.mockResolvedValue(invitedUser)
    administrationMocks.updateOpsUserRole.mockResolvedValue({
      ...supportUser,
      permissions: ['treasury:read'],
      role: 'FINANCE',
      version: 5,
    })
    administrationMocks.revokeOpsUserSessions.mockResolvedValue({
      ...supportUser,
      sessionsRevokedAt: '2026-08-02T16:05:00.000Z',
      sessionVersion: 2,
      version: 5,
    })

    render(
      <MemoryRouter initialEntries={['/ops/administration/users']}>
        <ImmediateOpsMutationProvider>
          <OpsUsers />
        </ImmediateOpsMutationProvider>
      </MemoryRouter>,
    )

    await screen.findByRole('heading', { name: 'Support Operator' })
    const currentUserCard = screen.getByRole('heading', { name: 'Admin Operator' }).closest('article')
    const supportCard = screen.getByRole('heading', { name: 'Support Operator' }).closest('article')
    expect(currentUserCard).not.toBeNull()
    expect(supportCard).not.toBeNull()
    expect(within(currentUserCard as HTMLElement).getByRole('button', { name: 'Disable account' })).toBeDisabled()

    const user = userEvent.setup()
    await user.selectOptions(
      within(supportCard as HTMLElement).getByRole('combobox', { name: 'Role for Support Operator' }),
      'FINANCE',
    )
    await user.click(within(supportCard as HTMLElement).getByRole('button', { name: 'Save role' }))

    await waitFor(() => {
      expect(administrationMocks.updateOpsUserRole).toHaveBeenCalledWith(
        'ops-user-support',
        'FINANCE',
        { ...testOpsMutationDetails, expectedVersion: 4 },
      )
    })

    await user.type(screen.getByLabelText('Display name'), 'New Viewer')
    await user.type(screen.getByLabelText('Organization email'), 'viewer@abroad.finance')
    await user.click(screen.getByRole('button', { name: 'Grant access' }))

    await screen.findByRole('heading', { name: 'New Viewer' })
    expect(administrationMocks.inviteOpsUser).toHaveBeenCalledWith({
      displayName: 'New Viewer',
      email: 'viewer@abroad.finance',
      role: 'VIEWER',
    }, testOpsMutationDetails)
  })

  test('keeps audit filters draft-only until applied and renders linked evidence', async () => {
    administrationMocks.listOpsAuditEvents.mockResolvedValue({
      items: [{
        action: 'administration.user.role_update',
        actorKind: 'ops_user',
        actorLabel: 'Admin Operator',
        actorUserId: 'ops-user-admin',
        createdAt: '2026-08-02T15:45:00.000Z',
        id: 'audit-event-1',
        metadata: { outcome: 'succeeded', version: 5 },
        reason: 'Align access with current finance responsibilities',
        reference: 'OPS-482',
        resourceId: 'ops-user-support',
        resourceType: 'ops_user',
      }],
      page: 2,
      pageSize: 30,
      total: 31,
    })

    render(
      <MemoryRouter initialEntries={['/ops/administration/audit?action=role_update&page=2']}>
        <OpsAuditLog />
      </MemoryRouter>,
    )

    await screen.findByRole('heading', { name: 'Administration user role update' })
    expect(screen.getByText('Align access with current finance responsibilities')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Open resource' })).toHaveAttribute(
      'href',
      '/ops/administration/users',
    )
    expect(administrationMocks.listOpsAuditEvents).toHaveBeenCalledWith(expect.objectContaining({
      action: 'role_update',
      page: 2,
      pageSize: 30,
    }))

    const user = userEvent.setup()
    const actionInput = screen.getByLabelText('Action')
    await user.clear(actionInput)
    await user.type(actionInput, 'disable')
    expect(administrationMocks.listOpsAuditEvents).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Apply filters' }))
    await waitFor(() => {
      expect(administrationMocks.listOpsAuditEvents).toHaveBeenCalledTimes(2)
    })
    expect(administrationMocks.listOpsAuditEvents).toHaveBeenLastCalledWith(expect.objectContaining({
      action: 'disable',
      page: 1,
    }))
  })

  test('does not fetch administration data without the effective permission', async () => {
    setOpsSession({ ...administratorSession, permissions: ['overview:read'], role: 'VIEWER' })

    render(
      <MemoryRouter initialEntries={['/ops/administration/audit']}>
        <OpsAuditLog />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Your current role cannot view the production audit trail.')).toBeVisible()
    expect(administrationMocks.listOpsAuditEvents).not.toHaveBeenCalled()
  })
})
