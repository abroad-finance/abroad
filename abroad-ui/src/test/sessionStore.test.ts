/**
 * Tests for sessionStore validation
 */

import {
  beforeEach, describe, expect, it,
} from 'vitest'

import { sessionStore } from '../services/auth/sessionStore'

const setLocalStorageItem = (key: string, value: string) => {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(key, value)
  }
}

const clearLocalStorage = () => {
  if (typeof window !== 'undefined') {
    window.localStorage.clear()
  }
}

const EVM_SESSION = {
  address: '0x1234567890123456789012345678901234567890',
  chainId: 'eip155:42220',
  walletId: 'mini-pay',
}

const STELLAR_SESSION = {
  address: 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ',
  chainId: 'stellar:pubnet',
  walletId: 'stellar-kit',
}

const SOLANA_SESSION = {
  address: 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH',
  chainId: 'solana:mainnet',
  walletId: 'solana',
}

describe('sessionStore', () => {
  beforeEach(() => {
    clearLocalStorage()
  })

  describe('get/set/clear', () => {
    it('should return null when no session exists', () => {
      expect(sessionStore.get()).toBe(null)
    })

    it('should set and get session data', () => {
      sessionStore.set(EVM_SESSION)
      const retrieved = sessionStore.get()

      expect(retrieved).toEqual(expect.objectContaining({
        address: EVM_SESSION.address,
        chainId: EVM_SESSION.chainId,
        timestamp: expect.any(Number),
        walletId: EVM_SESSION.walletId,
      }))
    })

    it('should clear session data', () => {
      sessionStore.set(EVM_SESSION)

      sessionStore.clear()
      expect(sessionStore.get()).toBe(null)
    })
  })

  describe('isValid', () => {
    it('should return false when no session exists', () => {
      expect(sessionStore.isValid()).toBe(false)
    })

    it('should return true for valid EVM session', () => {
      sessionStore.set(EVM_SESSION)
      expect(sessionStore.isValid()).toBe(true)
    })

    it('should return true for valid Stellar session', () => {
      sessionStore.set(STELLAR_SESSION)
      expect(sessionStore.isValid()).toBe(true)
    })

    it('should return true for valid Solana session', () => {
      sessionStore.set(SOLANA_SESSION)
      expect(sessionStore.isValid()).toBe(true)
    })

    it('should return false for invalid EVM address format', () => {
      sessionStore.set({ ...EVM_SESSION, address: 'invalid-address' })
      expect(sessionStore.isValid()).toBe(false)
    })

    it('should return false for invalid Stellar address format', () => {
      sessionStore.set({ ...STELLAR_SESSION, address: EVM_SESSION.address })
      expect(sessionStore.isValid()).toBe(false)
    })

    it('should return false for expired session (older than 24h)', () => {
      const expiredTimestamp = Date.now() - (25 * 60 * 60 * 1000)
      setLocalStorageItem('ab_session', JSON.stringify({ ...EVM_SESSION, timestamp: expiredTimestamp }))

      expect(sessionStore.isValid()).toBe(false)
    })

    it('should return false for address mismatch with chainId', () => {
      sessionStore.set({ ...STELLAR_SESSION, address: EVM_SESSION.address })
      expect(sessionStore.isValid()).toBe(false)
    })

    it('should return true for session without timestamp (backward compatibility)', () => {
      setLocalStorageItem('ab_session', JSON.stringify(EVM_SESSION))
      expect(sessionStore.isValid()).toBe(true)
    })
  })

  describe('address validation edge cases', () => {
    it('should reject empty address', () => {
      sessionStore.set({ ...EVM_SESSION, address: '' })
      expect(sessionStore.isValid()).toBe(false)
    })

    it('should reject Solana address with wrong length', () => {
      sessionStore.set({ ...SOLANA_SESSION, address: 'tooShort' })
      expect(sessionStore.isValid()).toBe(false)
    })

    it('should reject Stellar address without G/S prefix', () => {
      sessionStore.set({ ...STELLAR_SESSION, address: 'XABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABC' })
      expect(sessionStore.isValid()).toBe(false)
    })
  })
})
