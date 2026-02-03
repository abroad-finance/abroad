import { act, render } from '@testing-library/react'
import React from 'react'
import {
  afterEach,
  describe,
  expect,
  vi,
} from 'vitest'

import type { IWallet } from '../interfaces/IWallet'

import { WalletAuthContext } from '../contexts/WalletAuthContext'
import { useWebSocketSubscription, WebSocketProvider } from '../contexts/WebSocketContext'

vi.mock('@tolgee/react', () => ({
  useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}))

type Listener = (payload?: unknown) => void

class FakeSocket {
  listeners = new Map<string, Set<Listener>>()

  disconnect() {
    this.emit('disconnect')
  }

  emit(event: string, payload?: unknown) {
    const set = this.listeners.get(event)
    set?.forEach(handler => handler(payload))
  }

  off(event: string, handler: Listener) {
    const set = this.listeners.get(event)
    set?.delete(handler)
    return this
  }

  on(event: string, handler: Listener) {
    const set = this.listeners.get(event) ?? new Set()
    set.add(handler)
    this.listeners.set(event, set)
    return this
  }
}

const fakeSocket = new FakeSocket()

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => fakeSocket as unknown),
}))

const mockKit: IWallet = {
  address: 'GADDR',
  chainId: 'stellar:pubnet',
  connect: vi.fn(),
  disconnect: vi.fn(),
  signTransaction: vi.fn(async () => ({ signedTxXdr: 'xdr', signerAddress: 'GADDR' })),
  walletId: 'stellar-kit',
}

const TestSubscriber: React.FC<{ onEvent: (payload: unknown) => void }> = ({ onEvent }) => {
  useWebSocketSubscription('transaction.updated', onEvent)
  return null
}

afterEach(() => {
  fakeSocket.listeners.clear()
})

describe('WebSocketProvider', () => {
  it('replays listeners after reconnect', () => {
    const received: unknown[] = []

    render(
      <WalletAuthContext.Provider value={{
        kycUrl: null,
        setKycUrl: vi.fn(),
        wallet: mockKit,
        walletAuthentication: {
          authenticate: vi.fn(),
          getAuthToken: vi.fn(),
          getChallengeMessage: vi.fn(),
          jwtToken: 'token',
          refreshAuthToken: vi.fn(),
          setJwtToken: vi.fn(),
        },
      }}
      >
        <WebSocketProvider>
          <TestSubscriber onEvent={payload => received.push(payload)} />
        </WebSocketProvider>
      </WalletAuthContext.Provider>,
    )

    act(() => {
      fakeSocket.emit('connect')
    })

    act(() => {
      fakeSocket.emit('transaction.updated', { id: '1' })
    })
    act(() => {
      fakeSocket.disconnect()
      fakeSocket.emit('connect')
      fakeSocket.emit('transaction.updated', { id: '2' })
    })

    expect(received).toHaveLength(2)
    expect((received[1] as { id?: string }).id).toBe('2')
  })
})
