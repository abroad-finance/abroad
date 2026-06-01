// scripts/auditCorridorPricing.ts
import { PrismaClient } from '@prisma/client'

import { CorridorAuditClient, findCorridorsMissingPricing } from '../src/modules/flows/application/corridorPricingAudit'

async function main(): Promise<void> {
  const prisma = new PrismaClient()
  try {
    const missing = await findCorridorsMissingPricing(prisma as unknown as CorridorAuditClient)
    if (missing.length === 0) {
      console.log('✅ All SUPPORTED corridors have an enabled flow definition.')
      return
    }

    console.error(`❌ ${missing.length} SUPPORTED corridor(s) missing an enabled flow definition:`)
    for (const label of missing) {
      console.error(`  - ${label}`)
    }
    process.exitCode = 1
  }
  finally {
    await prisma.$disconnect()
  }
}

void main()
