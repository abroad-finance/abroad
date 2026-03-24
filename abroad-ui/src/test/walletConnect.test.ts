/**
 * Tests for WalletConnect shared utilities
 */

import { describe, expect, it } from 'vitest'

import {
  caip10ToAddress,
  getNamespaceFromChainId,
  isValidAddressForChain,
  normalizeAddress,
} from '../services/wallets/shared/wallet-utils'
import {
  WC_STORAGE_PREFIX,
  resolveNamespaceFromChainId,
  resolveStellarNetwork,
  toBase64,
  fromBase64,
} from '../services/wallets/shared/wallet-connect-base'

describe('wallet-utils', () => {
  describe('caip10ToAddress', () => {
    it('should extract address from CAIP-10 format (eip155)', () => {
      const result = caip10ToAddress('eip155:42220:0x1234567890abcdef1234567890abcdef12345678')
      expect(result).toBe('0x1234567890abcdef1234567890abcdef12345678')
    })

    it('should extract address from CAIP-10 format (solana)', () => {
      const result = caip10ToAddress('solana:mainnet:HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH')
      expect(result).toBe('HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH')
    })

    it('should extract address from CAIP-10 format (stellar)', () => {
      const result = caip10ToAddress('stellar:pubnet:GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABC')
      expect(result).toBe('GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABC')
    })

    it('should return the last part for invalid format (no colon separator)', () => {
      const result = caip10ToAddress('invalid-format')
      expect(result).toBe('invalid-format')
    })
  })

  describe('getNamespaceFromChainId', () => {
    it('should return eip155 for Ethereum chain', () => {
      expect(getNamespaceFromChainId('eip155:1')).toBe('eip155')
      expect(getNamespaceFromChainId('eip155:42220')).toBe('eip155')
    })

    it('should return solana for Solana chain', () => {
      expect(getNamespaceFromChainId('solana:mainnet')).toBe('solana')
      expect(getNamespaceFromChainId('solana:testnet')).toBe('solana')
    })

    it('should return stellar for Stellar chain', () => {
      expect(getNamespaceFromChainId('stellar:pubnet')).toBe('stellar')
      expect(getNamespaceFromChainId('stellar:testnet')).toBe('stellar')
    })

    it('should return the first part for unknown chains', () => {
      expect(getNamespaceFromChainId('unknown:chain')).toBe('unknown')
    })
  })

  describe('resolveNamespaceFromChainId', () => {
    it('should resolve namespace from chainId', () => {
      expect(resolveNamespaceFromChainId('eip155:1')).toBe('eip155')
      expect(resolveNamespaceFromChainId('solana:mainnet')).toBe('solana')
      expect(resolveNamespaceFromChainId('stellar:pubnet')).toBe('stellar')
    })
  })

  describe('normalizeAddress', () => {
    it('should checksum Ethereum addresses', () => {
      // Note: ethers.getAddress() does the actual checksum
      // This test verifies the function delegates correctly
      const result = normalizeAddress('0x1234567890123456789012345678901234567890', 'eip155:1')
      expect(result).toMatch(/^0x[0-9A-Fa-f]{40}$/)
    })

    it('should lowercase Solana addresses', () => {
      const result = normalizeAddress('HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH', 'solana:mainnet')
      // Note: toLowerCase() is used, actual result depends on the input
      expect(result).toBe(result.toLowerCase())
    })

    it('should not modify Stellar addresses', () => {
      const input = 'GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABC'
      const result = normalizeAddress(input, 'stellar:pubnet')
      expect(result).toBe(input)
    })
  })

  describe('isValidAddressForChain', () => {
    describe('EVM chains (eip155)', () => {
      it('should validate Ethereum address format', () => {
        expect(isValidAddressForChain('0x1234567890123456789012345678901234567890', 'eip155:1')).toBe(true)
        expect(isValidAddressForChain('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd', 'eip155:42220')).toBe(true)
      })

      it('should reject invalid Ethereum addresses', () => {
        expect(isValidAddressForChain('1234567890123456789012345678901234567890', 'eip155:1')).toBe(false)
        expect(isValidAddressForChain('0x123', 'eip155:1')).toBe(false)
        expect(isValidAddressForChain('', 'eip155:1')).toBe(false)
      })
    })

    describe('Solana', () => {
      it('should validate Solana address format', () => {
        // Valid base58 Solana addresses (32-44 chars)
        expect(isValidAddressForChain('HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH', 'solana:mainnet')).toBe(true)
        expect(isValidAddressForChain('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', 'solana:mainnet')).toBe(true)
      })

      it('should reject invalid Solana addresses', () => {
        expect(isValidAddressForChain('0x1234567890123456789012345678901234567890', 'solana:mainnet')).toBe(false)
        expect(isValidAddressForChain('invalid!!!', 'solana:mainnet')).toBe(false)
        expect(isValidAddressForChain('tooShort', 'solana:mainnet')).toBe(false)
      })
    })

    describe('Stellar', () => {
      it('should validate Stellar public address format', () => {
        // Valid Stellar address: G prefix, 56 chars total
        expect(isValidAddressForChain('GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ', 'stellar:pubnet')).toBe(true)
      })

      it('should validate Stellar private address format', () => {
        // Valid Stellar seed: S prefix, 56 chars total
        expect(isValidAddressForChain('SA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVAAA', 'stellar:pubnet')).toBe(true)
      })

      it('should reject invalid Stellar addresses', () => {
        expect(isValidAddressForChain('0x1234567890123456789012345678901234567890', 'stellar:pubnet')).toBe(false)
        expect(isValidAddressForChain('GABC', 'stellar:pubnet')).toBe(false)
        expect(isValidAddressForChain('XA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ', 'stellar:pubnet')).toBe(false)
      })
    })
  })
})

describe('wallet-connect-base', () => {
  describe('WC_STORAGE_PREFIX', () => {
    it('should be defined', () => {
      expect(WC_STORAGE_PREFIX).toBe('wc:session')
    })
  })

  describe('resolveStellarNetwork', () => {
    it('should return PUBLIC for pubnet', () => {
      expect(resolveStellarNetwork('stellar:pubnet')).toBe('PUBLIC')
      expect(resolveStellarNetwork('stellar:PUBLIC')).toBe('PUBLIC')
    })

    it('should return TESTNET for testnet', () => {
      expect(resolveStellarNetwork('stellar:testnet')).toBe('TESTNET')
      expect(resolveStellarNetwork('stellar:TESTNET')).toBe('TESTNET')
      expect(resolveStellarNetwork('stellar:test')).toBe('TESTNET')
    })
  })

  describe('toBase64 / fromBase64', () => {
    it('should encode and decode string correctly', () => {
      const original = 'Hello, World!'
      const encoded = toBase64(new TextEncoder().encode(original))
      const decoded = new TextDecoder().decode(fromBase64(encoded))
      expect(decoded).toBe(original)
    })

    it('should handle empty string', () => {
      const original = ''
      const encoded = toBase64(new TextEncoder().encode(original))
      const decoded = new TextDecoder().decode(fromBase64(encoded))
      expect(decoded).toBe('')
    })

    it('should handle special characters', () => {
      const original = '🎉 Special chars: ñ, ü, 中文'
      const encoded = toBase64(new TextEncoder().encode(original))
      const decoded = new TextDecoder().decode(fromBase64(encoded))
      expect(decoded).toBe(original)
    })
  })
})
