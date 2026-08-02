import {
  BlockchainNetwork,
  CryptoCurrency,
  FlowCorridorStatus,
  PaymentMethod,
  Prisma,
  TargetCurrency,
} from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { ApplicationError } from '../../../core/errors'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { FlowCorridorDto, FlowCorridorListDto, FlowCorridorUpdateInput } from './flowDefinitionSchemas'

export class FlowCorridorConflictError extends ApplicationError {
  constructor() {
    super(409, 'flow_corridor_version_conflict', 'This corridor changed after it was loaded')
    this.name = 'FlowCorridorConflictError'
  }
}

@injectable()
export class FlowCorridorService {
  constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly dbProvider: IDatabaseClientProvider,
  ) {}

  public async list(transaction?: Prisma.TransactionClient): Promise<FlowCorridorListDto> {
    const client = transaction ?? await this.dbProvider.getClient()
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
          version: true,
        },
      }),
      client.flowCorridor.findMany(),
      client.cryptoAssetConfig.findMany({
        where: { enabled: true, mintAddress: { not: null } },
      }),
    ])

    const overrideMap = new Map<string, {
      reason: null | string
      status: FlowCorridorStatus
      version: number
    }>()
    overrides.forEach((item) => {
      overrideMap.set(this.key(item.cryptoCurrency, item.blockchain, item.targetCurrency), {
        reason: item.reason ?? null,
        status: item.status,
        version: item.version,
      })
    })

    const definitionMap = new Map<string, {
      enabled: boolean
      id: string
      name: string
      payoutProvider: PaymentMethod
      updatedAt: Date
      version: number
    }>()

    definitions.forEach((def) => {
      definitionMap.set(this.key(def.cryptoCurrency, def.blockchain, def.targetCurrency), {
        enabled: def.enabled,
        id: def.id,
        name: def.name,
        payoutProvider: def.payoutProvider,
        updatedAt: def.updatedAt,
        version: def.version,
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

        if (override?.status === FlowCorridorStatus.UNSUPPORTED) {
          corridors.push({
            blockchain,
            cryptoCurrency,
            status: 'UNSUPPORTED',
            targetCurrency,
            unsupportedReason: override.reason,
            version: override.version,
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
            version: override?.version ?? 1,
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
          version: override?.version ?? 1,
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

  public async updateStatus(
    payload: FlowCorridorUpdateInput,
    expectedVersion: number,
  ): Promise<FlowCorridorDto> {
    const client = await this.dbProvider.getClient()
    return this.updateStatusInTransaction(client, payload, expectedVersion)
  }

  public async updateStatusInTransaction(
    client: Prisma.TransactionClient,
    payload: FlowCorridorUpdateInput,
    expectedVersion: number,
  ): Promise<FlowCorridorDto> {
    const key = {
      blockchain: payload.blockchain,
      cryptoCurrency: payload.cryptoCurrency,
      targetCurrency: payload.targetCurrency,
    }
    const current = await client.flowCorridor.findUnique({
      where: { flow_corridor_status_unique: key },
    })
    if ((current?.version ?? 1) !== expectedVersion) {
      throw new FlowCorridorConflictError()
    }

    try {
      if (!current) {
        await client.flowCorridor.create({
          data: {
            ...key,
            reason: payload.reason?.trim() || null,
            status: payload.status,
            version: 2,
          },
        })
      }
      else {
        const updated = await client.flowCorridor.updateMany({
          data: {
            reason: payload.reason?.trim() || null,
            status: payload.status,
            version: { increment: 1 },
          },
          where: { id: current.id, version: expectedVersion },
        })
        if (updated.count !== 1) throw new FlowCorridorConflictError()
      }
    }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new FlowCorridorConflictError()
      }
      throw error
    }

    const list = await this.list(client)
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
