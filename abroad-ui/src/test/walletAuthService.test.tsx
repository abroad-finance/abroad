import { act, renderHook } from '@testing-library/react'
import {
  afterEach,
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

const mocked = vi.hoisted(() => ({
  challengeMock: vi.fn(async () => ({
    data: { xdr: 'challenge-xdr' },
    headers: new Headers(),
    ok: true,
    status: 200,
  })),
  refreshMock: vi.fn(async () => ({
    data: { token: `${token}-refreshed` },
    headers: new Headers(),
    ok: true,
    status: 200,
  })),
  verifyMock: vi.fn(async () => ({
    data: { token },
    headers: new Headers(),
    ok: true,
    status: 200,
  })),
}))

vi.mock('../api', () => ({
  challenge: mocked.challengeMock,
  refresh: mocked.refreshMock,
  verify: mocked.verifyMock,
}))

afterEach(() => {
  authTokenStore.setToken(null)
  vi.clearAllMocks()
})

describe('useWalletAuthentication', () => {
  it('authenticates using challenge + verify and stores token', async () => {
    const { result } = renderHook(() => useWalletAuthentication())

    await act(async () => {
      await result.current.authenticate('GADDR', async (message) => {
        expect(message).toBe('challenge-xdr')
        return 'signed-xdr'
      })
    })

    expect(mocked.challengeMock).toHaveBeenCalled()
    expect(mocked.verifyMock).toHaveBeenCalledWith({
      address: 'GADDR',
      signedXDR: 'signed-xdr',
    })
    expect(authTokenStore.getToken()).toBe(token)
  })

  it('refreshes tokens when requested directly', async () => {
    const { result } = renderHook(() => useWalletAuthentication())

    const refreshed = await act(async () => result.current.refreshAuthToken({ token }))

    expect(mocked.refreshMock).toHaveBeenCalled()
    expect(refreshed.token).toContain('refreshed')
  })
})
