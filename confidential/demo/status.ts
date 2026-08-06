import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()
async function main() {
  const t = await p.transaction.findUnique({
    include: { quote: true },
    where: { id: process.env.DEMO_TRANSACTION_ID ?? '3f2b1a90-8c4d-4e21-9b77-5a1c2d3e4f50' },
  })
  console.log(`status        : ${t?.status}`)
  console.log(`onChainId     : ${t?.onChainId ?? '—'}`)
  console.log(`pixEndToEndId : ${t?.pixEndToEndId ?? '—'}`)
  console.log(`amount        : ${t?.quote.sourceAmount} ${t?.quote.cryptoCurrency} → ${t?.quote.targetCurrency}`)
  await p.$disconnect()
}
void main()
