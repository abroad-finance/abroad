import {
  BlockchainNetwork,
  CryptoCurrency,
  FlowCorridorStatus,
  PaymentMethod,
  TargetCurrency,
} from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { FlowCorridorDto, FlowCorridorListDto, FlowCorridorUpdateInput } from './flowDefinitionSchemas'

@injectable()
export class FlowCorridorService {
  constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly dbProvider: IDatabaseClientProvider,
  ) {}

  public async list(): Promise<FlowCorridorListDto> {
    const client = await this.dbProvider.getClient()
    const [definitions, overrides, enabledAssets] = await Promise.all([
      client.flowDefinition.findMany({
        select: {
          blockchain: true,
          cryptoCurrency: true,
          enabled: true,
          id: true,
          name: true,
          payoutProvider: true,
          targetCurrency: true,
          updatedAt: true,
        },
      }),
      client.flowCorridor.findMany({
        where: { status: FlowCorridorStatus.UNSUPPORTED },
      }),
      client.cryptoAssetConfig.findMany({
        where: { enabled: true, mintAddress: { not: null } },
      }),
    ])

    const overrideMap = new Map<string, { reason: null | string }>()
    overrides.forEach((item) => {
      overrideMap.set(this.key(item.cryptoCurrency, item.blockchain, item.targetCurrency), {
        reason: item.reason ?? null,
      })
    })

    const definitionMap = new Map<string, {
      enabled: boolean
      id: string
      name: string
      payoutProvider: PaymentMethod
      updatedAt: Date
    }>()

    definitions.forEach((def) => {
      definitionMap.set(this.key(def.cryptoCurrency, def.blockchain, def.targetCurrency), {
        enabled: def.enabled,
        id: def.id,
        name: def.name,
        payoutProvider: def.payoutProvider,
        updatedAt: def.updatedAt,
      })
    })

    const corridors: FlowCorridorDto[] = []

    const targetValues = Object.values(TargetCurrency) as TargetCurrency[]

    for (const asset of enabledAssets) {
      const { blockchain, cryptoCurrency } = asset
      for (const targetCurrency of targetValues) {
        const corridorKey = this.key(cryptoCurrency, blockchain, targetCurrency)
        const override = overrideMap.get(corridorKey)
        const definition = definitionMap.get(corridorKey)

        if (override) {
          corridors.push({
            blockchain,
            cryptoCurrency,
            status: 'UNSUPPORTED',
            targetCurrency,
            unsupportedReason: override.reason,
          })
          continue
        }

        if (definition && definition.enabled) {
          corridors.push({
            blockchain,
            cryptoCurrency,
            definitionId: definition.id,
            definitionName: definition.name,
            enabled: definition.enabled,
            payoutProvider: definition.payoutProvider,
            status: 'DEFINED',
            targetCurrency,
            updatedAt: definition.updatedAt,
          })
          continue
        }

        corridors.push({
          blockchain,
          cryptoCurrency,
          definitionId: definition?.id ?? null,
          definitionName: definition?.name ?? null,
          enabled: definition?.enabled,
          payoutProvider: definition?.payoutProvider ?? null,
          status: 'MISSING',
          targetCurrency,
          updatedAt: definition?.updatedAt ?? null,
        })
      }
    }

    const total = corridors.length
    const unsupported = corridors.filter(item => item.status === 'UNSUPPORTED').length
    const defined = corridors.filter(item => item.status === 'DEFINED').length
    const missing = total - unsupported - defined

    return {
      corridors,
      summary: {
        defined,
        missing,
        total,
        unsupported,
      },
    }
  }

  public async updateStatus(payload: FlowCorridorUpdateInput): Promise<FlowCorridorDto> {
    const client = await this.dbProvider.getClient()

    if (payload.status === FlowCorridorStatus.UNSUPPORTED) {
      await client.flowCorridor.upsert({
        create: {
          blockchain: payload.blockchain,
          cryptoCurrency: payload.cryptoCurrency,
          reason: payload.reason?.trim() || null,
          status: FlowCorridorStatus.UNSUPPORTED,
          targetCurrency: payload.targetCurrency,
        },
        update: {
          reason: payload.reason?.trim() || null,
          status: FlowCorridorStatus.UNSUPPORTED,
        },
        where: {
          flow_corridor_status_unique: {
            blockchain: payload.blockchain,
            cryptoCurrency: payload.cryptoCurrency,
            targetCurrency: payload.targetCurrency,
          },
        },
      })
    }

    if (payload.status === FlowCorridorStatus.SUPPORTED) {
      await client.flowCorridor.deleteMany({
        where: {
          blockchain: payload.blockchain,
          cryptoCurrency: payload.cryptoCurrency,
          targetCurrency: payload.targetCurrency,
        },
      })
    }

    const list = await this.list()
    const match = list.corridors.find(item => (
      item.blockchain === payload.blockchain
      && item.cryptoCurrency === payload.cryptoCurrency
      && item.targetCurrency === payload.targetCurrency
    ))

    if (!match) {
      throw new Error('Updated corridor not found')
    }

    return match
  }

  private key(
    cryptoCurrency: CryptoCurrency,
    blockchain: BlockchainNetwork,
    targetCurrency: TargetCurrency,
  ): string {
    return `${cryptoCurrency}-${blockchain}-${targetCurrency}`
  }
}
