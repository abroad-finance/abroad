import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest'

import type { OpsSession } from '../services/admin/opsAuthStore'

import {
  clearOpsApiKey,
  getOpsAuthState,
  setOpsApiKey,
  setOpsSession,
} from '../services/admin/opsAuthStore'
import {
  getOpsCredentialHeaders,
  signInToOps,
  signOutFromOps,
} from '../services/admin/opsIdentityApi'

const firebaseMocks = vi.hoisted(() => ({
  authStateReady: vi.fn().mockResolvedValue(undefined),
  getApps: vi.fn(() => []),
  getAuth: vi.fn(),
  getIdToken: vi.fn().mockResolvedValue('firebase-id-token'),
  initializeApp: vi.fn(() => ({ name: 'abroad-ops' })),
  setCustomParameters: vi.fn(),
  setPersistence: vi.fn().mockResolvedValue(undefined),
  signInWithPopup: vi.fn(),
  signOut: vi.fn().mockResolvedValue(undefined),
}))

type TestUser = {
  getIdToken: typeof firebaseMocks.getIdToken
}

const currentUser: TestUser = {
  getIdToken: firebaseMocks.getIdToken,
}

const auth: {
  authStateReady: typeof firebaseMocks.authStateReady
  currentUser: null | TestUser
} = {
  authStateReady: firebaseMocks.authStateReady,
  currentUser,
}

vi.mock('firebase/app', () => ({
  getApps: firebaseMocks.getApps,
  initializeApp: firebaseMocks.initializeApp,
}))

vi.mock('firebase/auth', () => ({
  browserSessionPersistence: { type: 'SESSION' },
  getAuth: firebaseMocks.getAuth,
  GoogleAuthProvider: class {
    public setCustomParameters(parameters: Record<string, string>): void {
      firebaseMocks.setCustomParameters(parameters)
    }
  },
  reauthenticateWithPopup: vi.fn(),
  setPersistence: firebaseMocks.setPersistence,
  signInWithPopup: firebaseMocks.signInWithPopup,
  signOut: firebaseMocks.signOut,
}))

const session: OpsSession = {
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
}

const jsonResponse = (body: unknown, status = 200): Response => new Response(
  JSON.stringify(body),
  {
    headers: { 'Content-Type': 'application/json' },
    status,
  },
)

beforeEach(() => {
  auth.currentUser = currentUser
  firebaseMocks.authStateReady.mockResolvedValue(undefined)
  firebaseMocks.getApps.mockReturnValue([])
  firebaseMocks.getAuth.mockReturnValue(auth)
  firebaseMocks.getIdToken.mockResolvedValue('firebase-id-token')
  firebaseMocks.initializeApp.mockReturnValue({ name: 'abroad-ops' })
  firebaseMocks.setPersistence.mockResolvedValue(undefined)
  firebaseMocks.signInWithPopup.mockResolvedValue({ user: currentUser })
  firebaseMocks.signOut.mockResolvedValue(undefined)
})

afterEach(() => {
  clearOpsApiKey()
  setOpsSession(null)
  vi.unstubAllGlobals()
})

describe('opsIdentityApi', () => {
  test('signs in with Firebase and exchanges the verified token for a named session', async () => {
    let sessionAuthorization: null | string = null
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/ops/auth/config')) {
        return jsonResponse({
          allowedEmailDomain: 'abroad.finance',
          firebaseConfigPath: '/__/firebase/init.json',
          provider: 'google.com',
          stepUpMaxAgeSeconds: 600,
        })
      }
      if (url.endsWith('/__/firebase/init.json')) {
        return jsonResponse({
          apiKey: 'public-firebase-key',
          appId: 'firebase-app-id',
          authDomain: 'abroad-452212.firebaseapp.com',
          projectId: 'abroad-452212',
        })
      }
      if (url.endsWith('/ops/auth/session')) {
        sessionAuthorization = new Headers(init?.headers).get('authorization')
        return jsonResponse(session)
      }
      throw new Error(`Unhandled request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    firebaseMocks.signInWithPopup.mockResolvedValue({ user: currentUser })

    await expect(signInToOps()).resolves.toEqual(session)

    expect(getOpsAuthState().session).toEqual(session)
    expect(sessionAuthorization).toBe('Bearer firebase-id-token')
    expect(firebaseMocks.setPersistence).toHaveBeenCalled()
    expect(firebaseMocks.setCustomParameters).toHaveBeenCalledWith({
      hd: 'abroad.finance',
      prompt: 'select_account',
    })
    expect((await getOpsCredentialHeaders()).get('authorization')).toBe(
      'Bearer firebase-id-token',
    )
  })

  test('uses the legacy key only when no Firebase user is available', async () => {
    auth.currentUser = null
    setOpsApiKey('emergency-key')

    const headers = await getOpsCredentialHeaders()

    expect(headers.get('x-ops-api-key')).toBe('emergency-key')
    expect(headers.has('authorization')).toBe(false)
    auth.currentUser = currentUser
  })

  test('clears the named session when signing out', async () => {
    setOpsSession(session)

    await signOutFromOps()

    expect(firebaseMocks.signOut).toHaveBeenCalled()
    expect(getOpsAuthState().session).toBeNull()
  })

  test('keeps emergency legacy access usable after identity initialization fails', async () => {
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/ops/auth/config')) {
        return jsonResponse({ reason: 'Identity configuration is temporarily unavailable' }, 503)
      }
      throw new Error(`Unhandled request: ${url}`)
    }))

    const isolatedStore = await import('../services/admin/opsAuthStore')
    const isolatedIdentity = await import('../services/admin/opsIdentityApi')
    isolatedStore.setOpsApiKey('emergency-key')

    await expect(isolatedIdentity.restoreOpsSession()).rejects.toThrow(
      'Identity configuration is temporarily unavailable',
    )

    const headers = await isolatedIdentity.getOpsCredentialHeaders()
    expect(headers.get('x-ops-api-key')).toBe('emergency-key')
    expect(headers.has('authorization')).toBe(false)
    isolatedStore.clearOpsApiKey()
    isolatedStore.setOpsSession(null)
  })
})
