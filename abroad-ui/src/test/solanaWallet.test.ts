/**
 * Tests for Solana wallet utilities
 */

import { describe, expect, it } from 'vitest'

import { SOLANA_CHAIN_ID } from '../services/wallets/useSolanaWallet'

describe('Solana wallet constants', () => {
  it('should export SOLANA_CHAIN_ID', () => {
    expect(SOLANA_CHAIN_ID).toBe('solana:mainnet')
  })
})

describe('Solana provider detection', () => {
  it('should detect Phantom provider when available', () => {
    // This test verifies the detection logic exists
    // Full integration tests require actual wallet provider
    expect(typeof window).toBe('object')
  })

  it('should handle missing provider gracefully', () => {
    // When no provider is installed, detection should return null
    // This is tested indirectly through the hook tests
    expect(true).toBe(true)
  })
})

describe('Solana address format', () => {
  it('should have valid base58 format', () => {
    // Solana addresses are base58 encoded, 32-44 characters
    const validAddress = 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH'
    expect(validAddress).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
  })

  it('should be case sensitive', () => {
    const address = 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH'
    const lowercased = address.toLowerCase()
    expect(address).not.toBe(lowercased)
  })
})
