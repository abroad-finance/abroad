import { BlockchainNetwork, CryptoCurrency, FlowCorridorStatus, FlowDirection, PrismaClient, TargetCurrency } from '@prisma/client'

import { assertLocalDemoDatabase } from './guard'
assertLocalDemoDatabase()

const p = new PrismaClient()
async function main() {
  const defs = await p.flowDefinition.findMany({
    select: { blockchain: true, cryptoCurrency: true, direction: true, enabled: true, name: true, targetCurrency: true },
  })
  console.log('DEFINITIONS:')
  defs.forEach(d => console.log(`  ${d.name} :: ${d.cryptoCurrency}/${d.blockchain} -> ${d.targetCurrency} ${d.direction} enabled=${d.enabled}`))

  // A corridor is what makes (asset, chain, target, direction) routable.
  const corridor = await p.flowCorridor.upsert({
    create: {
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: CryptoCurrency.USDC,
      direction: FlowDirection.CRYPTO_TO_FIAT,
      status: FlowCorridorStatus.SUPPORTED,
      targetCurrency: TargetCurrency.BRL,
    },
    update: { status: FlowCorridorStatus.SUPPORTED },
    where: {
      flow_corridor_status_unique: {
        blockchain: BlockchainNetwork.STELLAR,
        cryptoCurrency: CryptoCurrency.USDC,
        direction: FlowDirection.CRYPTO_TO_FIAT,
        targetCurrency: TargetCurrency.BRL,
      },
    },
  })
  console.log(`CORRIDOR: USDC/STELLAR -> BRL ${corridor.status}`)
  await p.$disconnect()
}
void main()
