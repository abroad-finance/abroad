import {
  afterEach,
  describe,
  expect,
  test,
} from 'vitest'

import {
  clearOpsApiKey,
  getOpsApiKey,
  getOpsAuthState,
  setOpsApiKey,
  setOpsSession,
} from '../services/admin/opsAuthStore'

afterEach(() => {
  clearOpsApiKey()
  setOpsSession(null)
})

describe('opsAuthStore', () => {
  test('keeps the legacy key in memory and trims it', () => {
    setOpsApiKey('  emergency-key  ')

    expect(getOpsApiKey()).toBe('emergency-key')
    expect(getOpsAuthState().legacyApiKey).toBe('emergency-key')

    clearOpsApiKey()
    expect(getOpsApiKey()).toBeNull()
  })

  test('stores a named session without persisting a bearer token', () => {
    setOpsSession({
      authenticatedAt: '2026-08-02T15:00:00.000Z',
      bootstrapRequired: false,
      displayName: 'Ana Operator',
      email: 'ana@abroad.finance',
      kind: 'ops_user',
      permissions: ['overview:read'],
      role: 'OPERATIONS',
      sessionVersion: 1,
      stepUpExpiresAt: '2026-08-02T15:10:00.000Z',
      userId: 'ops-user-1',
    })

    expect(getOpsAuthState()).toEqual(expect.objectContaining({
      error: null,
      legacyApiKey: null,
      status: 'authenticated',
    }))
    expect(JSON.stringify(getOpsAuthState())).not.toContain('Bearer')
  })
})
