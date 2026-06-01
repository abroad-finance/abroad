/**
 * Tests for WalletConnect shared utilities
 */

import { describe, expect, it } from 'vitest'

import {
  fromBase64,
  resolveStellarNetwork,
  toBase64,
  WC_STORAGE_PREFIX,
} from '../services/wallets/shared/wallet-connect-base'
import {
  caip10ToAddress,
  getNamespaceFromChainId,
  isValidAddressForChain,
  normalizeAddress,
} from '../services/wallets/shared/wallet-utils'

const roundTripBase64 = (input: string): string =>
  new TextDecoder().decode(fromBase64(toBase64(new TextEncoder().encode(input))))

describe('wallet-utils', () => {
  describe('caip10ToAddress', () => {
    it('should extract address from CAIP-10 format (eip155)', () => {
      expect(caip10ToAddress('eip155:42220:0x1234567890abcdef1234567890abcdef12345678'))
        .toBe('0x1234567890abcdef1234567890abcdef12345678')
    })

    it('should extract address from CAIP-10 format (solana)', () => {
      expect(caip10ToAddress('solana:mainnet:HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH'))
        .toBe('HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH')
    })

    it('should extract address from CAIP-10 format (stellar)', () => {
      expect(caip10ToAddress('stellar:pubnet:GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABC'))
        .toBe('GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABC')
    })

    it('should return the last part for invalid format (no colon separator)', () => {
      expect(caip10ToAddress('invalid-format')).toBe('invalid-format')
    })
  })

  describe('getNamespaceFromChainId', () => {
    it.each([
      ['eip155:1', 'eip155'],
      ['eip155:42220', 'eip155'],
      ['solana:mainnet', 'solana'],
      ['solana:testnet', 'solana'],
      ['stellar:pubnet', 'stellar'],
      ['stellar:testnet', 'stellar'],
      ['unknown:chain', 'unknown'],
    ])('returns %s -> %s', (chainId, expected) => {
      expect(getNamespaceFromChainId(chainId)).toBe(expected)
    })
  })

  describe('normalizeAddress', () => {
    it('should checksum Ethereum addresses', () => {
      const result = normalizeAddress('0x1234567890123456789012345678901234567890', 'eip155:1')
      expect(result).toMatch(/^0x[0-9A-Fa-f]{40}$/)
    })

    it('should lowercase Solana addresses', () => {
      const result = normalizeAddress('HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH', 'solana:mainnet')
      expect(result).toBe(result.toLowerCase())
    })

    it('should not modify Stellar addresses', () => {
      const input = 'GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABC'
      expect(normalizeAddress(input, 'stellar:pubnet')).toBe(input)
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
        expect(isValidAddressForChain('GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ', 'stellar:pubnet')).toBe(true)
      })

      it('should validate Stellar private address format', () => {
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
    it.each([
      ['Hello, World!'],
      [''],
      ['🎉 Special chars: ñ, ü, 中文'],
    ])('round-trips %j', (input) => {
      expect(roundTripBase64(input)).toBe(input)
    })
  })
})
