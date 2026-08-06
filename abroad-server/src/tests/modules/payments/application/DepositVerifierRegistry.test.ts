import { BlockchainNetwork } from '@prisma/client'

import type { IDepositVerifier } from '../../../../modules/payments/application/contracts/IDepositVerifier'

import { DepositVerifierRegistry } from '../../../../modules/payments/application/DepositVerifierRegistry'

const buildVerifier = (network: BlockchainNetwork): IDepositVerifier => ({
  supportedNetwork: network,
  verifyNotification: jest.fn(),
})

describe('DepositVerifierRegistry', () => {
  it('returns the verifier registered for the requested blockchain', () => {
    const stellarVerifier = buildVerifier(BlockchainNetwork.STELLAR)
    const solanaVerifier = buildVerifier(BlockchainNetwork.SOLANA)
    const registry = new DepositVerifierRegistry([stellarVerifier, solanaVerifier])

    expect(registry.getVerifier(BlockchainNetwork.STELLAR)).toBe(stellarVerifier)
    expect(registry.getVerifier(BlockchainNetwork.SOLANA)).toBe(solanaVerifier)
  })

  it('throws when no verifier is registered for the blockchain', () => {
    const registry = new DepositVerifierRegistry([buildVerifier(BlockchainNetwork.STELLAR)])

    expect(() => registry.getVerifier(BlockchainNetwork.SOLANA)).toThrow('No deposit verifier registered for SOLANA')
  })

  it('refuses to let a second verifier take over a network', () => {
    // Two verifiers can legitimately exist for one network — the classic and the
    // confidential Stellar paths — but only one may be reachable through here,
    // and a silent replacement would reroute deposits without anyone noticing.
    expect(() => new DepositVerifierRegistry([
      buildVerifier(BlockchainNetwork.STELLAR),
      buildVerifier(BlockchainNetwork.STELLAR),
    ])).toThrow('Duplicate deposit verifier registered for STELLAR')
  })
})
