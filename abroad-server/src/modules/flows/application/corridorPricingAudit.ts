import { BlockchainNetwork, CryptoCurrency, TargetCurrency } from '@prisma/client'

export interface CorridorAuditClient {
  flowCorridor: {
    findMany(args: { where: { status: 'SUPPORTED' } }): Promise<CorridorRow[]>
  }
  flowDefinition: {
    findFirst(args: {
      where: {
        blockchain: BlockchainNetwork
        cryptoCurrency: CryptoCurrency
        enabled: true
        targetCurrency: TargetCurrency
      }
    }): Promise<unknown>
  }
}

interface CorridorRow {
  blockchain: BlockchainNetwork
  cryptoCurrency: CryptoCurrency
  targetCurrency: TargetCurrency
}

export async function findCorridorsMissingPricing(client: CorridorAuditClient): Promise<string[]> {
  const corridors = await client.flowCorridor.findMany({ where: { status: 'SUPPORTED' } })
  const missing: string[] = []

  for (const corridor of corridors) {
    const definition = await client.flowDefinition.findFirst({
      where: {
        blockchain: corridor.blockchain,
        cryptoCurrency: corridor.cryptoCurrency,
        enabled: true,
        targetCurrency: corridor.targetCurrency,
      },
    })

    if (!definition) {
      missing.push(`${corridor.cryptoCurrency}/${corridor.blockchain} → ${corridor.targetCurrency}`)
    }
  }

  return missing
}
