import {

import { assertLocalDemoDatabase } from './guard'
  BlockchainNetwork,
  CryptoCurrency,
  PrismaClient,
  TargetCurrency,
  TransactionStatus,
} from '@prisma/client'

/**
 * Arms the local rail for one confidential deposit.
 *
 * Enables the confidential asset against the testnet deployment and creates the
 * transaction the payer will reference, in AWAITING_PAYMENT, with the UUID the
 * demo sends on chain.
 */
assertLocalDemoDatabase()

const p = new PrismaClient()

const TRANSACTION_ID = process.env.DEMO_TRANSACTION_ID ?? '3f2b1a90-8c4d-4e21-9b77-5a1c2d3e4f50'
const AMOUNT = Number(process.env.DEMO_AMOUNT ?? '12.3456789')
const TOKEN = process.env.CONFIDENTIAL_TOKEN ?? 'CDX6HMFYPI4AVRU3E43NN3FNSYXOOIYKTI2LRFNKIJSLLNV56CGWD53L'
const WRAPPER = process.env.CONFIDENTIAL_WRAPPER ?? 'CCQ7EUXCQCNTCE4YOTU2IFWQ4YNSEHWPGTNTBCCHX2U7ESFY5RGI4HML'

async function main() {
  await p.confidentialAssetConfig.upsert({
    create: {
      blockchain: BlockchainNetwork.STELLAR,
      contractAddress: TOKEN,
      cryptoCurrency: CryptoCurrency.USDC,
      decimals: 7,
      depositContractAddress: WRAPPER,
      enabled: true,
    },
    update: { contractAddress: TOKEN, depositContractAddress: WRAPPER, enabled: true },
    where: {
      confidential_asset_unique: {
        blockchain: BlockchainNetwork.STELLAR,
        cryptoCurrency: CryptoCurrency.USDC,
      },
    },
  })
  console.log(`confidential asset enabled: wrapper ${WRAPPER.slice(0, 8)}…`)

  const templateTransaction = await p.transaction.findFirst()
  if (!templateTransaction) throw new Error('run seed:dev first')

  const template = await p.quote.findFirst()
  if (!template) throw new Error('run seed:dev first')
  const { id: _id, createdAt: _c, ...rest } = template

  const quote = await p.quote.create({
    data: {
      ...rest,
      cryptoCurrency: CryptoCurrency.USDC,
      expirationDate: new Date(Date.now() + 60 * 60 * 1000),
      network: BlockchainNetwork.STELLAR,
      sourceAmount: AMOUNT,
      targetCurrency: TargetCurrency.BRL,
    },
  })

  await p.transaction.upsert({
    create: {
      accountNumber: '000000000',
      id: TRANSACTION_ID,
      partnerUserId: templateTransaction.partnerUserId,
      quoteId: quote.id,
      status: TransactionStatus.AWAITING_PAYMENT,
    },
    update: { onChainId: null, quoteId: quote.id, status: TransactionStatus.AWAITING_PAYMENT },
    where: { id: TRANSACTION_ID },
  })

  console.log(`transaction ${TRANSACTION_ID} AWAITING_PAYMENT for ${AMOUNT} USDC on Stellar → BRL`)
  await p.$disconnect()
}

void main()
