/**
 * Tests for sessionStore validation
 */

import { describe, expect, it, beforeEach } from 'vitest'

import { sessionStore } from '../services/auth/sessionStore'

// Helper to bypass the internal readSession/writeSession
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

describe('sessionStore', () => {
  beforeEach(() => {
    clearLocalStorage()
  })

  describe('get/set/clear', () => {
    it('should return null when no session exists', () => {
      expect(sessionStore.get()).toBe(null)
    })

    it('should set and get session data', () => {
      const sessionData = {
        address: '0x1234567890123456789012345678901234567890',
        chainId: 'eip155:42220',
        walletId: 'mini-pay',
      }

      sessionStore.set(sessionData)
      const retrieved = sessionStore.get()

      expect(retrieved).toEqual(expect.objectContaining({
        address: sessionData.address,
        chainId: sessionData.chainId,
        walletId: sessionData.walletId,
        timestamp: expect.any(Number),
      }))
    })

    it('should clear session data', () => {
      sessionStore.set({
        address: '0x1234567890123456789012345678901234567890',
        chainId: 'eip155:42220',
        walletId: 'mini-pay',
      })

      sessionStore.clear()
      expect(sessionStore.get()).toBe(null)
    })
  })

  describe('isValid', () => {
    it('should return false when no session exists', () => {
      expect(sessionStore.isValid()).toBe(false)
    })

    it('should return true for valid EVM session', () => {
      sessionStore.set({
        address: '0x1234567890123456789012345678901234567890',
        chainId: 'eip155:42220',
        walletId: 'mini-pay',
      })

      expect(sessionStore.isValid()).toBe(true)
    })

    it('should return true for valid Stellar session', () => {
      sessionStore.set({
        address: 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ',
        chainId: 'stellar:pubnet',
        walletId: 'stellar-kit',
      })

      expect(sessionStore.isValid()).toBe(true)
    })

    it('should return true for valid Solana session', () => {
      sessionStore.set({
        address: 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH',
        chainId: 'solana:mainnet',
        walletId: 'solana',
      })

      expect(sessionStore.isValid()).toBe(true)
    })

    it('should return false for invalid EVM address format', () => {
      sessionStore.set({
        address: 'invalid-address',
        chainId: 'eip155:42220',
        walletId: 'mini-pay',
      })

      expect(sessionStore.isValid()).toBe(false)
    })

    it('should return false for invalid Stellar address format', () => {
      sessionStore.set({
        address: '0x1234567890123456789012345678901234567890',
        chainId: 'stellar:pubnet',
        walletId: 'stellar-kit',
      })

      expect(sessionStore.isValid()).toBe(false)
    })

    it('should return false for expired session (older than 24h)', () => {
      // Manually set an expired session
      const expiredTimestamp = Date.now() - (25 * 60 * 60 * 1000) // 25 hours ago
      setLocalStorageItem('ab_session', JSON.stringify({
        address: '0x1234567890123456789012345678901234567890',
        chainId: 'eip155:42220',
        walletId: 'mini-pay',
        timestamp: expiredTimestamp,
      }))

      expect(sessionStore.isValid()).toBe(false)
    })

    it('should return false for address mismatch with chainId', () => {
      // EVM address with Stellar chainId
      sessionStore.set({
        address: '0x1234567890123456789012345678901234567890',
        chainId: 'stellar:pubnet',
        walletId: 'stellar-kit',
      })

      expect(sessionStore.isValid()).toBe(false)
    })

    it('should return true for session without timestamp (backward compatibility)', () => {
      // Manually set a session without timestamp (old format)
      setLocalStorageItem('ab_session', JSON.stringify({
        address: '0x1234567890123456789012345678901234567890',
        chainId: 'eip155:42220',
        walletId: 'mini-pay',
      }))

      // Should still validate (no expiration check for old sessions)
      expect(sessionStore.isValid()).toBe(true)
    })
  })

  describe('address validation edge cases', () => {
    it('should reject empty address', () => {
      sessionStore.set({
        address: '',
        chainId: 'eip155:42220',
        walletId: 'mini-pay',
      })

      expect(sessionStore.isValid()).toBe(false)
    })

    it('should reject Solana address with wrong length', () => {
      sessionStore.set({
        address: 'tooShort',
        chainId: 'solana:mainnet',
        walletId: 'solana',
      })

      expect(sessionStore.isValid()).toBe(false)
    })

    it('should reject Stellar address without G/S prefix', () => {
      sessionStore.set({
        address: 'XABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABC',
        chainId: 'stellar:pubnet',
        walletId: 'stellar-kit',
      })

      expect(sessionStore.isValid()).toBe(false)
    })
  })
})
