// scripts/seed-dev.ts
import {
  BlockchainNetwork,
  Country,
  CryptoCurrency,
  KycStatus,
  KYCTier,
  OrderSide,
  PaymentMethod,
  PrismaClient,
  SupportedCurrency,
  TargetCurrency,
  TransactionStatus,
} from '@prisma/client'

const prisma = new PrismaClient()

function assertDevelopmentEnvironment() {
  if (process.env.NODE_ENV && process.env.NODE_ENV !== 'development') {
    throw new Error('The development seed script only runs when NODE_ENV is "development".')
  }
}

function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000)
}

async function main() {
  assertDevelopmentEnvironment()

  console.info('🌱 Seeding development data...')
  await seedPartners()
  await seedPaymentProviders()
  await seedPendingConversions()
  console.info('✅ Development data ready.')
}

async function seedPartners() {
  const alphaPartner = await prisma.partner.upsert({
    create: {
      apiKey: 'dev-partner-alpha',
      country: 'CO',
      email: 'alpha.ops@example.com',
      firstName: 'Ana',
      isKybApproved: true,
      lastName: 'Alvarez',
      name: 'Alpha Remittances',
      needsKyc: true,
      phone: '+57-300-000-0001',
      webhookUrl: 'https://alpha.dev/webhooks/admin',
    },
    update: {
      country: 'CO',
      email: 'alpha.ops@example.com',
      firstName: 'Ana',
      isKybApproved: true,
      lastName: 'Alvarez',
      name: 'Alpha Remittances',
      needsKyc: true,
      phone: '+57-300-000-0001',
      webhookUrl: 'https://alpha.dev/webhooks/admin',
    },
    where: { apiKey: 'dev-partner-alpha' },
  })

  const betaPartner = await prisma.partner.upsert({
    create: {
      apiKey: 'dev-partner-beta',
      country: 'CO',
      email: 'beta.ops@example.com',
      firstName: 'Bernardo',
      isKybApproved: false,
      lastName: 'Bautista',
      name: 'Beta Crossborder',
      needsKyc: true,
      phone: '+57-300-000-0002',
      webhookUrl: 'https://beta.dev/webhooks/admin',
    },
    update: {
      country: 'CO',
      email: 'beta.ops@example.com',
      firstName: 'Bernardo',
      isKybApproved: false,
      lastName: 'Bautista',
      name: 'Beta Crossborder',
      needsKyc: true,
      phone: '+57-300-000-0002',
      webhookUrl: 'https://beta.dev/webhooks/admin',
    },
    where: { apiKey: 'dev-partner-beta' },
  })

  const alphaPrimaryUser = await prisma.partnerUser.upsert({
    create: {
      kycExternalToken: 'alpha-kyc-token-1',
      partnerId: alphaPartner.id,
      userId: 'alpha-user-1',
    },
    update: {
      kycExternalToken: 'alpha-kyc-token-1',
    },
    where: {
      partnerId_userId: {
        partnerId: alphaPartner.id,
        userId: 'alpha-user-1',
      },
    },
  })

  await prisma.partnerUserKyc.upsert({
    create: {
      externalId: 'kyc-alpha-1',
      link: 'https://kyc.dev/alpha/alpha-user-1',
      partnerUserId: alphaPrimaryUser.id,
      status: KycStatus.APPROVED,
      tier: KYCTier.STANDARD,
    },
    update: {
      link: 'https://kyc.dev/alpha/alpha-user-1',
      status: KycStatus.APPROVED,
      tier: KYCTier.STANDARD,
    },
    where: {
      partnerUserId_externalId: {
        externalId: 'kyc-alpha-1',
        partnerUserId: alphaPrimaryUser.id,
      },
    },
  })

  const betaPrimaryUser = await prisma.partnerUser.upsert({
    create: {
      kycExternalToken: 'beta-kyc-token-1',
      partnerId: betaPartner.id,
      userId: 'beta-user-1',
    },
    update: {
      kycExternalToken: 'beta-kyc-token-1',
    },
    where: {
      partnerId_userId: {
        partnerId: betaPartner.id,
        userId: 'beta-user-1',
      },
    },
  })

  await prisma.partnerUserKyc.upsert({
    create: {
      externalId: 'kyc-beta-1',
      link: 'https://kyc.dev/beta/beta-user-1',
      partnerUserId: betaPrimaryUser.id,
      status: KycStatus.PENDING,
      tier: KYCTier.BASIC,
    },
    update: {
      link: 'https://kyc.dev/beta/beta-user-1',
      status: KycStatus.PENDING,
      tier: KYCTier.BASIC,
    },
    where: {
      partnerUserId_externalId: {
        externalId: 'kyc-beta-1',
        partnerUserId: betaPrimaryUser.id,
      },
    },
  })

  const alphaQuote = await prisma.quote.upsert({
    create: {
      country: Country.CO,
      cryptoCurrency: CryptoCurrency.USDC,
      expirationDate: hoursFromNow(6),
      id: 'quote-dev-alpha-1',
      network: BlockchainNetwork.STELLAR,
      partnerId: alphaPartner.id,
      paymentMethod: PaymentMethod.NEQUI,
      sourceAmount: 100,
      targetAmount: 250000,
      targetCurrency: TargetCurrency.COP,
    },
    update: {
      expirationDate: hoursFromNow(6),
      partnerId: alphaPartner.id,
    },
    where: { id: 'quote-dev-alpha-1' },
  })

  await prisma.transaction.upsert({
    create: {
      accountNumber: '1234567890',
      bankCode: 'NEQUI',
      externalId: 'txn-dev-alpha-ext-1',
      id: 'txn-dev-alpha-1',
      partnerUserId: alphaPrimaryUser.id,
      qrCode: 'https://alpha.dev/qr/txn-dev-alpha-1',
      quoteId: alphaQuote.id,
      status: TransactionStatus.PAYMENT_COMPLETED,
      taxId: '901234567',
    },
    update: {
      accountNumber: '1234567890',
      bankCode: 'NEQUI',
      externalId: 'txn-dev-alpha-ext-1',
      partnerUserId: alphaPrimaryUser.id,
      qrCode: 'https://alpha.dev/qr/txn-dev-alpha-1',
      quoteId: alphaQuote.id,
      status: TransactionStatus.PAYMENT_COMPLETED,
      taxId: '901234567',
    },
    where: { id: 'txn-dev-alpha-1' },
  })

  const betaQuote = await prisma.quote.upsert({
    create: {
      country: Country.CO,
      cryptoCurrency: CryptoCurrency.USDC,
      expirationDate: hoursFromNow(3),
      id: 'quote-dev-beta-1',
      network: BlockchainNetwork.SOLANA,
      partnerId: betaPartner.id,
      paymentMethod: PaymentMethod.MOVII,
      sourceAmount: 200,
      targetAmount: 500000,
      targetCurrency: TargetCurrency.COP,
    },
    update: {
      expirationDate: hoursFromNow(3),
      partnerId: betaPartner.id,
    },
    where: { id: 'quote-dev-beta-1' },
  })

  await prisma.transaction.upsert({
    create: {
      accountNumber: '9876543210',
      bankCode: 'MOVII',
      externalId: 'txn-dev-beta-ext-1',
      id: 'txn-dev-beta-1',
      partnerUserId: betaPrimaryUser.id,
      qrCode: 'https://beta.dev/qr/txn-dev-beta-1',
      quoteId: betaQuote.id,
      status: TransactionStatus.PROCESSING_PAYMENT,
    },
    update: {
      accountNumber: '9876543210',
      bankCode: 'MOVII',
      externalId: 'txn-dev-beta-ext-1',
      partnerUserId: betaPrimaryUser.id,
      qrCode: 'https://beta.dev/qr/txn-dev-beta-1',
      quoteId: betaQuote.id,
      status: TransactionStatus.PROCESSING_PAYMENT,
    },
    where: { id: 'txn-dev-beta-1' },
  })
}

async function seedPaymentProviders() {
  await prisma.paymentProvider.upsert({
    create: {
      country: Country.CO,
      id: 'provider-dev-stellar',
      liquidity: 2000000,
      name: 'Stellar Dev Liquidity',
    },
    update: {
      country: Country.CO,
      liquidity: 2000000,
      name: 'Stellar Dev Liquidity',
    },
    where: { id: 'provider-dev-stellar' },
  })

  await prisma.paymentProvider.upsert({
    create: {
      country: Country.CO,
      id: 'provider-dev-solana',
      liquidity: 1250000,
      name: 'Solana Dev Liquidity',
    },
    update: {
      country: Country.CO,
      liquidity: 1250000,
      name: 'Solana Dev Liquidity',
    },
    where: { id: 'provider-dev-solana' },
  })
}

async function seedPendingConversions() {
  await prisma.pendingConversions.upsert({
    create: {
      amount: 1500,
      side: OrderSide.SELL,
      source: SupportedCurrency.USDC,
      symbol: 'USDC/COP',
      target: SupportedCurrency.COP,
    },
    update: {
      amount: 1500,
      side: OrderSide.SELL,
      symbol: 'USDC/COP',
    },
    where: {
      source_target: {
        source: SupportedCurrency.USDC,
        target: SupportedCurrency.COP,
      },
    },
  })

  await prisma.pendingConversions.upsert({
    create: {
      amount: 800,
      side: OrderSide.SELL,
      source: SupportedCurrency.USDC,
      symbol: 'USDC/BRL',
      target: SupportedCurrency.BRL,
    },
    update: {
      amount: 800,
      side: OrderSide.SELL,
      symbol: 'USDC/BRL',
    },
    where: {
      source_target: {
        source: SupportedCurrency.USDC,
        target: SupportedCurrency.BRL,
      },
    },
  })
}

main()
  .catch((error) => {
    console.error('❌ Failed to seed development data')
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
