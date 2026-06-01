import { act, renderHook } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  vi,
} from 'vitest'

import { authTokenStore } from '../services/auth/authTokenStore.ts'
import { useWalletAuthentication } from '../services/useWalletAuthentication'

const futureExp = Math.floor(Date.now() / 1000) + 3600
const tokenPayload = btoa(JSON.stringify({ exp: futureExp }))
const token = `header.${tokenPayload}.sig`

vi.mock('@tolgee/react', () => ({
  useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}))

// Set up MSW server for HTTP-level mocking
const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
afterEach(() => {
  server.resetHandlers()
  authTokenStore.setToken(null)
})
afterAll(() => server.close())

// Helper to create MSW handlers with full URL
const createHandler = (path: string, handler: Parameters<typeof http.post>[1]) => {
  return http.post(`https://api.abroad.finance${path}`, handler)
}

describe('useWalletAuthentication', () => {
  it('authenticates using challenge + verify and stores token', async () => {
    let challengeCalled = false
    let verifyCalledWith: unknown = null

    server.use(
      createHandler('/walletAuth/challenge', async () => {
        challengeCalled = true
        return HttpResponse.json({
          message: 'challenge-xdr',
          xdr: 'challenge-xdr',
        })
      }),
      createHandler('/walletAuth/verify', async ({ request }) => {
        verifyCalledWith = await request.json()
        return HttpResponse.json({ token })
      }),
    )

    const { result } = renderHook(() => useWalletAuthentication())

    await act(async () => {
      await result.current.authenticate({
        address: 'GADDR',
        chainId: 'stellar:public',
        signMessage: async (message: string) => {
          expect(message).toBe('challenge-xdr')
          return 'signed-xdr'
        },
      })
    })

    expect(challengeCalled).toBe(true)
    expect(verifyCalledWith).toEqual(expect.objectContaining({
      address: 'GADDR',
      chainId: 'stellar:public',
      signedXDR: 'signed-xdr',
    }))
    expect(authTokenStore.getToken()).toBe(token)
  })

  it('refreshes tokens when requested directly', async () => {
    let refreshCalled = false

    server.use(
      createHandler('/walletAuth/refresh', async () => {
        refreshCalled = true
        return HttpResponse.json({ token: `${token}-refreshed` })
      }),
    )

    const { result } = renderHook(() => useWalletAuthentication())

    const refreshed = await act(async () => result.current.refreshAuthToken({ token }))

    expect(refreshCalled).toBe(true)
    expect(refreshed.token).toContain('refreshed')
  })
})
