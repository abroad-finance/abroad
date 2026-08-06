import { BlockchainNetwork, PrismaClient, TargetCurrency } from '@prisma/client'

import { assertLocalDemoDatabase } from './guard'

/**
 * Keeps only the customer-facing half of the Stellar→BRL flow.
 *
 * PAYOUT_SEND and AWAIT_PROVIDER_STATUS are what take a transaction to
 * PAYMENT_COMPLETED with a PIX end-to-end id. The remaining steps replenish
 * treasury through Binance and a bridge, which happens after the customer is
 * paid and would need two more provider mocks to run locally.
 */
assertLocalDemoDatabase()

const p = new PrismaClient()

async function main() {
  const definition = await p.flowDefinition.findFirst({
    where: { blockchain: BlockchainNetwork.STELLAR, targetCurrency: TargetCurrency.BRL },
  })
  if (!definition) throw new Error('run seed-flow first')

  const removed = await p.flowStepDefinition.deleteMany({
    where: { flowDefinitionId: definition.id, stepOrder: { gt: 2 } },
  })

  const kept = await p.flowStepDefinition.findMany({
    orderBy: { stepOrder: 'asc' },
    where: { flowDefinitionId: definition.id },
  })
  console.log(`removed ${removed.count} treasury steps; kept ${kept.map(s => s.stepType).join(' → ')}`)
  await p.$disconnect()
}

void main()
