import { BlockchainNetwork } from '@prisma/client'
import { injectable, multiInject, optional } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IDepositVerifier, IDepositVerifierRegistry } from './contracts/IDepositVerifier'

@injectable()
export class DepositVerifierRegistry implements IDepositVerifierRegistry {
  private readonly verifiers: Map<BlockchainNetwork, IDepositVerifier>

  constructor(
    @multiInject(TYPES.IDepositVerifier) @optional() verifiers: IDepositVerifier[] = [],
  ) {
    this.verifiers = new Map()
    for (const verifier of verifiers) {
      // One verifier per network. Silently replacing an existing one would let a
      // newly registered adapter take over a network's deposits unnoticed.
      if (this.verifiers.has(verifier.supportedNetwork)) {
        throw new Error(`Duplicate deposit verifier registered for ${verifier.supportedNetwork}`)
      }
      this.verifiers.set(verifier.supportedNetwork, verifier)
    }
  }

  public getVerifier(blockchain: BlockchainNetwork): IDepositVerifier {
    const verifier = this.verifiers.get(blockchain)
    if (!verifier) {
      throw new Error(`No deposit verifier registered for ${blockchain}`)
    }
    return verifier
  }
}
