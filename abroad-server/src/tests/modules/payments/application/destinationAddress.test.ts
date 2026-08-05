import { BlockchainNetwork } from '@prisma/client'

import { validateDestinationAddress } from '../../../../modules/payments/application/destinationAddress'

const CELO_ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'
const SOLANA_ADDRESS = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const STELLAR_ADDRESS = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H'

describe('validateDestinationAddress', () => {
  it.each([
    [BlockchainNetwork.CELO, CELO_ADDRESS],
    [BlockchainNetwork.SOLANA, SOLANA_ADDRESS],
    [BlockchainNetwork.STELLAR, STELLAR_ADDRESS],
  ])('accepts a well-formed %s address', (network, address) => {
    expect(validateDestinationAddress({ address, network })).toEqual({
      address: expect.any(String),
      valid: true,
    })
  })

  it('canonicalises a Celo address to its checksummed form', () => {
    const result = validateDestinationAddress({
      address: CELO_ADDRESS.toLowerCase(),
      network: BlockchainNetwork.CELO,
    })

    expect(result).toEqual({ address: CELO_ADDRESS, valid: true })
  })

  it('canonicalises a Stellar address to upper case', () => {
    const result = validateDestinationAddress({
      address: STELLAR_ADDRESS.toLowerCase(),
      network: BlockchainNetwork.STELLAR,
    })

    expect(result).toEqual({ address: STELLAR_ADDRESS, valid: true })
  })

  it('trims surrounding whitespace before validating', () => {
    const result = validateDestinationAddress({
      address: `  ${SOLANA_ADDRESS}  `,
      network: BlockchainNetwork.SOLANA,
    })

    expect(result).toEqual({ address: SOLANA_ADDRESS, valid: true })
  })

  it.each([
    [BlockchainNetwork.CELO, ''],
    [BlockchainNetwork.SOLANA, '   '],
    [BlockchainNetwork.STELLAR, ''],
  ])('rejects an empty %s address', (network, address) => {
    expect(validateDestinationAddress({ address, network })).toEqual({
      reason: 'empty',
      valid: false,
    })
  })

  // A one-character change to a checksummed EVM address is the classic
  // copy-paste corruption; accepting it would send funds nowhere.
  it('rejects a Celo address whose checksum does not hold', () => {
    const corrupted = `${CELO_ADDRESS.slice(0, -1)}D`

    expect(validateDestinationAddress({
      address: corrupted,
      network: BlockchainNetwork.CELO,
    })).toEqual({ reason: 'malformed', valid: false })
  })

  it.each([
    [BlockchainNetwork.CELO, 'not-an-address'],
    [BlockchainNetwork.CELO, STELLAR_ADDRESS],
    [BlockchainNetwork.SOLANA, 'not-an-address'],
    [BlockchainNetwork.SOLANA, CELO_ADDRESS],
    [BlockchainNetwork.STELLAR, 'not-an-address'],
    [BlockchainNetwork.STELLAR, CELO_ADDRESS],
  ])('rejects %s address %s', (network, address) => {
    expect(validateDestinationAddress({ address, network })).toEqual({
      reason: 'malformed',
      valid: false,
    })
  })

  // Stellar muxed (M...) and contract (C...) addresses are not ed25519 account
  // ids, and the payout path only supports classic accounts today.
  it('rejects a Stellar address that is not a classic ed25519 account', () => {
    expect(validateDestinationAddress({
      address: 'MBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OAAAAAAAAAAAAAJLK',
      network: BlockchainNetwork.STELLAR,
    })).toEqual({ reason: 'malformed', valid: false })
  })
})
