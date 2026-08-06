import { BlockchainNetwork, PrismaClient, TargetCurrency } from '@prisma/client'

import { assertLocalDemoDatabase } from './guard'

/**
 * Clones the seeded Solana→BRL flow onto Stellar.
 *
 * The dev seed ships Stellar→COP and Solana→BRL but no Stellar→BRL, which is the
 * corridor a confidential deposit settles through. The payout half is identical —
 * Transfero Ultra either way — so the definition is a copy with the chain changed.
 */
assertLocalDemoDatabase()

const p = new PrismaClient()

async function main() {
  const source = await p.flowDefinition.findFirst({
    include: { steps: { orderBy: { stepOrder: 'asc' } } },
    where: { blockchain: BlockchainNetwork.SOLANA, targetCurrency: TargetCurrency.BRL },
  })
  if (!source) throw new Error('no Solana→BRL definition to clone')

  const existing = await p.flowDefinition.findFirst({
    where: { blockchain: BlockchainNetwork.STELLAR, targetCurrency: TargetCurrency.BRL },
  })
  if (existing) {
    console.log(`already present: ${existing.name}`)
    await p.$disconnect()
    return
  }

  const { id: _id, createdAt: _c, updatedAt: _u, steps, ...definition } = source
  const created = await p.flowDefinition.create({
    data: {
      ...definition,
      blockchain: BlockchainNetwork.STELLAR,
      name: 'USDC Stellar → BRL (Transfero Ultra), confidential deposits',
      steps: {
        create: steps.map(({ id: _sid, flowDefinitionId: _fid, ...step }) => step),
      },
    },
    include: { steps: true },
  })

  console.log(`created: ${created.name}`)
  console.log(`  steps: ${created.steps.length}`)
  await p.$disconnect()
}

void main()
