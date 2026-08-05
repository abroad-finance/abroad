import { BlockchainNetwork } from '@prisma/client'
import { PublicKey } from '@solana/web3.js'
import { StrKey } from '@stellar/stellar-sdk'
import { ethers } from 'ethers'

type DestinationAddressRejection
  = | 'empty'
    | 'malformed'
    | 'unsupported_network'

type DestinationAddressResult
  = | { address: string, valid: true }
    | { reason: DestinationAddressRejection, valid: false }

/**
 * Validates and canonicalises the wallet a FIAT_TO_CRYPTO delivery will be sent
 * to, before the customer is ever shown something to pay.
 *
 * This is the last cheap place to catch a bad address: once the PIX settles,
 * the money is ours to deliver and a malformed destination turns a delivery
 * into a refund. Each chain is checked with its own library rather than a
 * regex, so a checksum-invalid EVM address or an off-curve Solana key is
 * rejected rather than accepted and paid into the void.
 */
export function validateDestinationAddress(params: {
  address: string
  network: BlockchainNetwork
}): DestinationAddressResult {
  const trimmed = params.address.trim()
  if (!trimmed) {
    return { reason: 'empty', valid: false }
  }

  switch (params.network) {
    case BlockchainNetwork.CELO:
      return validateEvmAddress(trimmed)
    case BlockchainNetwork.SOLANA:
      return validateSolanaAddress(trimmed)
    case BlockchainNetwork.STELLAR:
      return validateStellarAddress(trimmed)
    default:
      return { reason: 'unsupported_network', valid: false }
  }
}

function validateEvmAddress(address: string): DestinationAddressResult {
  try {
    // Normalises to the EIP-55 checksummed form and throws on a bad checksum.
    return { address: ethers.utils.getAddress(address), valid: true }
  }
  catch {
    return { reason: 'malformed', valid: false }
  }
}

function validateSolanaAddress(address: string): DestinationAddressResult {
  try {
    const publicKey = new PublicKey(address)
    // A base58 string can decode to 32 bytes yet not be a valid ed25519 point;
    // sending to one of those burns the funds.
    if (!PublicKey.isOnCurve(publicKey.toBytes())) {
      return { reason: 'malformed', valid: false }
    }
    return { address: publicKey.toBase58(), valid: true }
  }
  catch {
    return { reason: 'malformed', valid: false }
  }
}

function validateStellarAddress(address: string): DestinationAddressResult {
  const normalized = address.toUpperCase()
  if (!StrKey.isValidEd25519PublicKey(normalized)) {
    return { reason: 'malformed', valid: false }
  }
  return { address: normalized, valid: true }
}
