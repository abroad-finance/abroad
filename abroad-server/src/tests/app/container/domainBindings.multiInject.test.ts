import 'reflect-metadata'
import { BlockchainNetwork, PrismaClient } from '@prisma/client'
import { Container } from 'inversify'

import { bindDomainServices } from '../../../app/container/domainBindings'
import { TYPES } from '../../../app/container/types'
import { ILogger } from '../../../core/logging/types'
import { DepositVerifierRegistry } from '../../../modules/payments/application/DepositVerifierRegistry'
import { PayoutStatusAdapterRegistry } from '../../../modules/payments/application/PayoutStatusAdapterRegistry'
import { BrebPayoutStatusAdapter } from '../../../modules/payments/infrastructure/BrebPayoutStatusAdapter'
import { TransferoPayoutStatusAdapter } from '../../../modules/payments/infrastructure/TransferoPayoutStatusAdapter'
import { CeloPaymentVerifier } from '../../../modules/payments/infrastructure/wallets/CeloPaymentVerifier'
import { SolanaPaymentVerifier } from '../../../modules/payments/infrastructure/wallets/SolanaPaymentVerifier'
import { StellarDepositVerifier } from '../../../modules/payments/infrastructure/wallets/StellarDepositVerifier'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { ISecretManager, Secret, Secrets } from '../../../platform/secrets/ISecretManager'

class StubDatabaseClientProvider implements IDatabaseClientProvider {
  private readonly prismaClient: PrismaClient = {} as PrismaClient

  async getClient(): Promise<PrismaClient> {
    return this.prismaClient
  }
}

class StubLogger implements ILogger {
  error(): void {}
  info(): void {}
  warn(): void {}
}

class StubSecretManager implements ISecretManager {
  private readonly values: Record<Secret, string>

  constructor() {
    this.values = {} as Record<Secret, string>
    Object.values(Secrets).forEach((secretName) => {
      this.values[secretName] = `stub-${secretName.toLowerCase()}`
    })
  }

  async getSecret(secretName: Secret): Promise<string> {
    return this.values[secretName] ?? ''
  }

  async getSecrets<T extends readonly Secret[]>(secretNames: T): Promise<Record<T[number], string>> {
    const entries = secretNames.map(secretName => [secretName, this.values[secretName] ?? ''] as const)
    return Object.fromEntries(entries) as Record<T[number], string>
  }
}

describe('domainBindings', () => {
  let container: Container

  beforeEach(() => {
    container = new Container({ defaultScope: 'Singleton' })
    container.bind<ISecretManager>(TYPES.ISecretManager).toConstantValue(new StubSecretManager())
    container.bind<IDatabaseClientProvider>(TYPES.IDatabaseClientProvider).toConstantValue(new StubDatabaseClientProvider())
    container.bind<ILogger>(TYPES.ILogger).toConstantValue(new StubLogger())
    bindDomainServices(container)
  })

  it('wires deposit verifiers for the registry', () => {
    const registry = container.get<DepositVerifierRegistry>(TYPES.IDepositVerifierRegistry)

    expect(registry.getVerifier(BlockchainNetwork.CELO)).toBeInstanceOf(CeloPaymentVerifier)
    expect(registry.getVerifier(BlockchainNetwork.SOLANA)).toBeInstanceOf(SolanaPaymentVerifier)
    expect(registry.getVerifier(BlockchainNetwork.STELLAR)).toBeInstanceOf(StellarDepositVerifier)
  })

  it('wires payout status adapters for the registry', () => {
    const registry = container.get<PayoutStatusAdapterRegistry>(PayoutStatusAdapterRegistry)

    expect(registry.getAdapter('transfero')).toBeInstanceOf(TransferoPayoutStatusAdapter)
    expect(registry.getAdapter('breb')).toBeInstanceOf(BrebPayoutStatusAdapter)
  })
})
