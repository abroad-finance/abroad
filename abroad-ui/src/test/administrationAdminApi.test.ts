import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from 'vitest'

import type { OpsMutationDetails } from '../services/admin/opsMutationTypes'

import {
  inviteOpsUser,
  listOpsAuditEvents,
  updateOpsUserRole,
} from '../services/admin/administrationAdminApi'
import { clearOpsApiKey, setOpsApiKey } from '../services/admin/opsAuthStore'

const baseUrl = 'https://api.abroad.finance'
const server = setupServer()
const mutation: OpsMutationDetails = {
  confirmation: 'CHANGE OPS ROLE',
  expectedVersion: 7,
  idempotencyKey: 'd2856a20-8953-4b12-ad30-1107837ca9ef',
  reason: 'Align access with current responsibilities',
  reference: 'OPS-482',
}

const userResponse = {
  createdAt: '2026-08-02T15:00:00.000Z',
  disabledAt: null,
  displayName: 'Support Operator',
  email: 'support@abroad.finance',
  id: 'ops-user-support',
  lastLoginAt: null,
  permissions: ['transactions:read'],
  role: 'SUPPORT',
  sessionsRevokedAt: null,
  sessionVersion: 1,
  status: 'ACTIVE',
  updatedAt: '2026-08-02T15:00:00.000Z',
  version: 7,
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  clearOpsApiKey()
  server.resetHandlers()
})
afterAll(() => server.close())

describe('administrationAdminApi', () => {
  test('sends versioned protected-operation evidence for role updates', async () => {
    setOpsApiKey('ops_test_key')
    server.use(http.patch(`${baseUrl}/ops/administration/users/ops-user-support/role`, async ({ request }) => {
      expect(request.headers.get('if-match')).toBe('"7"')
      expect(request.headers.get('x-ops-confirmation')).toBe('CHANGE OPS ROLE')
      expect(request.headers.get('x-ops-idempotency-key')).toBe(mutation.idempotencyKey)
      expect(request.headers.get('x-ops-reason')).toBe(mutation.reason)
      expect(request.headers.get('x-ops-reference')).toBe(mutation.reference)
      expect(await request.json()).toEqual({ role: 'FINANCE' })
      return HttpResponse.json({ ...userResponse, role: 'FINANCE', version: 8 })
    }))

    const result = await updateOpsUserRole('ops-user-support', 'FINANCE', mutation)

    expect(result.role).toBe('FINANCE')
    expect(result.version).toBe(8)
  })

  test('invites an organization identity without sending an optimistic version', async () => {
    setOpsApiKey('ops_test_key')
    server.use(http.post(`${baseUrl}/ops/administration/users`, async ({ request }) => {
      expect(request.headers.get('if-match')).toBeNull()
      expect(await request.json()).toEqual({
        displayName: 'New Viewer',
        email: 'viewer@abroad.finance',
        role: 'VIEWER',
      })
      return HttpResponse.json({
        ...userResponse,
        displayName: 'New Viewer',
        email: 'viewer@abroad.finance',
        id: 'ops-user-viewer',
        role: 'VIEWER',
        status: 'INVITED',
        version: 1,
      }, { status: 201 })
    }))

    const result = await inviteOpsUser({
      displayName: 'New Viewer',
      email: 'viewer@abroad.finance',
      role: 'VIEWER',
    }, { ...mutation, confirmation: 'INVITE OPS USER', expectedVersion: undefined })

    expect(result.status).toBe('INVITED')
  })

  test('encodes all audit filters as a shareable read request', async () => {
    setOpsApiKey('ops_test_key')
    server.use(http.get(`${baseUrl}/ops/administration/audit`, ({ request }) => {
      const params = new URL(request.url).searchParams
      expect(Object.fromEntries(params)).toEqual({
        action: 'role_update',
        actor: 'Admin Operator',
        createdFrom: '2026-08-01T00:00:00.000Z',
        createdTo: '2026-08-02T00:00:00.000Z',
        page: '2',
        pageSize: '30',
        resourceId: 'ops-user-support',
        resourceType: 'ops_user',
      })
      return HttpResponse.json({
        items: [], page: 2, pageSize: 30, total: 0,
      })
    }))

    const result = await listOpsAuditEvents({
      action: 'role_update',
      actor: 'Admin Operator',
      createdFrom: '2026-08-01T00:00:00.000Z',
      createdTo: '2026-08-02T00:00:00.000Z',
      page: 2,
      pageSize: 30,
      resourceId: 'ops-user-support',
      resourceType: 'ops_user',
    })

    expect(result.page).toBe(2)
  })
})
