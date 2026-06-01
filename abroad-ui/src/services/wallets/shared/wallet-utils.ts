/**
 * Utilidades compartidas para todas las implementaciones de wallet
 */

import { getAddress } from 'ethers'

/**
 * Convierte una dirección CAIP-10 a dirección nativa
 * Ej: "eip155:42220:0x1234..." → "0x1234..."
 */
export function caip10ToAddress(caip10: string): string {
  const parts = caip10.split(':')
  return parts[parts.length - 1] || ''
}

/**
 * Extrae el namespace de un chainId
 */
export function getNamespaceFromChainId(chainId: string): string {
  const parts = chainId.split(':')
  return parts[0] || 'eip155'
}

/**
 * Valida si un address tiene el formato correcto para un chainId dado
 */
export function isValidAddressForChain(address: string, chainId: string): boolean {
  if (!address) return false

  if (chainId.startsWith('eip155')) {
    // Ethereum/Celo: debe empezar con 0x y tener 42 caracteres
    return /^0x[a-fA-F0-9]{40}$/.test(address)
  }

  if (chainId.startsWith('solana')) {
    // Solana: base58, longitud típica 32-44 caracteres
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)
  }

  if (chainId.startsWith('stellar')) {
    // Stellar: empieza con G (pública) o S (privada), 56 caracteres
    return /^[GS][a-zA-Z0-9]{55}$/.test(address)
  }

  return false
}

/**
 * Normaliza una address según el tipo de chain
 */
export function normalizeAddress(address: string, chainId: string): string {
  if (chainId.startsWith('eip155')) {
    // Ethereum/Celo: checksum address
    return getAddress(address)
  }
  if (chainId.startsWith('solana')) {
    // Solana: lowercase
    return address.toLowerCase()
  }
  // Stellar: mantener como está (GABC... o SABC...)
  return address
}
