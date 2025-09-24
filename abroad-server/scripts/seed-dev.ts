// scripts/seed-dev.ts
import {
  PrismaClient,
  TransactionStatus,
  KycStatus,
  KYCTier,
  OrderSide,
  SupportedCurrency,
  Country,
  PaymentMethod,
  CryptoCurrency,
  BlockchainNetwork,
  TargetCurrency,
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

async function seedPartners() {
  const alphaPartner = await prisma.partner.upsert({
    where: { apiKey: 'dev-partner-alpha' },
    update: {
      name: 'Alpha Remittances',
      country: 'CO',
      email: 'alpha.ops@example.com',
      phone: '+57-300-000-0001',
      firstName: 'Ana',
      lastName: 'Alvarez',
      isKybApproved: true,
      needsKyc: true,
      webhookUrl: 'https://alpha.dev/webhooks/admin',
    },
    create: {
      name: 'Alpha Remittances',
      apiKey: 'dev-partner-alpha',
      country: 'CO',
      email: 'alpha.ops@example.com',
      phone: '+57-300-000-0001',
      firstName: 'Ana',
      lastName: 'Alvarez',
      isKybApproved: true,
      needsKyc: true,
      webhookUrl: 'https://alpha.dev/webhooks/admin',
    },
  })

  const betaPartner = await prisma.partner.upsert({
    where: { apiKey: 'dev-partner-beta' },
    update: {
      name: 'Beta Crossborder',
      country: 'CO',
      email: 'beta.ops@example.com',
      phone: '+57-300-000-0002',
      firstName: 'Bernardo',
      lastName: 'Bautista',
      isKybApproved: false,
      needsKyc: true,
      webhookUrl: 'https://beta.dev/webhooks/admin',
    },
    create: {
      name: 'Beta Crossborder',
      apiKey: 'dev-partner-beta',
      country: 'CO',
      email: 'beta.ops@example.com',
      phone: '+57-300-000-0002',
      firstName: 'Bernardo',
      lastName: 'Bautista',
      isKybApproved: false,
      needsKyc: true,
      webhookUrl: 'https://beta.dev/webhooks/admin',
    },
  })

  const alphaPrimaryUser = await prisma.partnerUser.upsert({
    where: {
      partnerId_userId: {
        partnerId: alphaPartner.id,
        userId: 'alpha-user-1',
      },
    },
    update: {
      kycExternalToken: 'alpha-kyc-token-1',
    },
    create: {
      partnerId: alphaPartner.id,
      userId: 'alpha-user-1',
      kycExternalToken: 'alpha-kyc-token-1',
    },
  })

  await prisma.partnerUserKyc.upsert({
    where: {
      partnerUserId_externalId: {
        partnerUserId: alphaPrimaryUser.id,
        externalId: 'kyc-alpha-1',
      },
    },
    update: {
      status: KycStatus.APPROVED,
      tier: KYCTier.STANDARD,
      link: 'https://kyc.dev/alpha/alpha-user-1',
    },
    create: {
      partnerUserId: alphaPrimaryUser.id,
      externalId: 'kyc-alpha-1',
      status: KycStatus.APPROVED,
      tier: KYCTier.STANDARD,
      link: 'https://kyc.dev/alpha/alpha-user-1',
    },
  })

  const betaPrimaryUser = await prisma.partnerUser.upsert({
    where: {
      partnerId_userId: {
        partnerId: betaPartner.id,
        userId: 'beta-user-1',
      },
    },
    update: {
      kycExternalToken: 'beta-kyc-token-1',
    },
    create: {
      partnerId: betaPartner.id,
      userId: 'beta-user-1',
      kycExternalToken: 'beta-kyc-token-1',
    },
  })

  await prisma.partnerUserKyc.upsert({
    where: {
      partnerUserId_externalId: {
        partnerUserId: betaPrimaryUser.id,
        externalId: 'kyc-beta-1',
      },
    },
    update: {
      status: KycStatus.PENDING,
      tier: KYCTier.BASIC,
      link: 'https://kyc.dev/beta/beta-user-1',
    },
    create: {
      partnerUserId: betaPrimaryUser.id,
      externalId: 'kyc-beta-1',
      status: KycStatus.PENDING,
      tier: KYCTier.BASIC,
      link: 'https://kyc.dev/beta/beta-user-1',
    },
  })

  const alphaQuote = await prisma.quote.upsert({
    where: { id: 'quote-dev-alpha-1' },
    update: {
      expirationDate: hoursFromNow(6),
      partnerId: alphaPartner.id,
    },
    create: {
      id: 'quote-dev-alpha-1',
      targetAmount: 250000,
      sourceAmount: 100,
      targetCurrency: TargetCurrency.COP,
      paymentMethod: PaymentMethod.NEQUI,
      country: Country.CO,
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.STELLAR,
      partnerId: alphaPartner.id,
      expirationDate: hoursFromNow(6),
    },
  })

  await prisma.transaction.upsert({
    where: { id: 'txn-dev-alpha-1' },
    update: {
      status: TransactionStatus.PAYMENT_COMPLETED,
      partnerUserId: alphaPrimaryUser.id,
      quoteId: alphaQuote.id,
      accountNumber: '1234567890',
      bankCode: 'NEQUI',
      taxId: '901234567',
      externalId: 'txn-dev-alpha-ext-1',
      qrCode: 'https://alpha.dev/qr/txn-dev-alpha-1',
    },
    create: {
      id: 'txn-dev-alpha-1',
      partnerUserId: alphaPrimaryUser.id,
      accountNumber: '1234567890',
      bankCode: 'NEQUI',
      status: TransactionStatus.PAYMENT_COMPLETED,
      quoteId: alphaQuote.id,
      taxId: '901234567',
      externalId: 'txn-dev-alpha-ext-1',
      qrCode: 'https://alpha.dev/qr/txn-dev-alpha-1',
    },
  })

  const betaQuote = await prisma.quote.upsert({
    where: { id: 'quote-dev-beta-1' },
    update: {
      expirationDate: hoursFromNow(3),
      partnerId: betaPartner.id,
    },
    create: {
      id: 'quote-dev-beta-1',
      targetAmount: 500000,
      sourceAmount: 200,
      targetCurrency: TargetCurrency.COP,
      paymentMethod: PaymentMethod.MOVII,
      country: Country.CO,
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.SOLANA,
      partnerId: betaPartner.id,
      expirationDate: hoursFromNow(3),
    },
  })

  await prisma.transaction.upsert({
    where: { id: 'txn-dev-beta-1' },
    update: {
      status: TransactionStatus.PROCESSING_PAYMENT,
      partnerUserId: betaPrimaryUser.id,
      quoteId: betaQuote.id,
      accountNumber: '9876543210',
      bankCode: 'MOVII',
      externalId: 'txn-dev-beta-ext-1',
      qrCode: 'https://beta.dev/qr/txn-dev-beta-1',
    },
    create: {
      id: 'txn-dev-beta-1',
      partnerUserId: betaPrimaryUser.id,
      accountNumber: '9876543210',
      bankCode: 'MOVII',
      status: TransactionStatus.PROCESSING_PAYMENT,
      quoteId: betaQuote.id,
      externalId: 'txn-dev-beta-ext-1',
      qrCode: 'https://beta.dev/qr/txn-dev-beta-1',
    },
  })
}

async function seedPendingConversions() {
  await prisma.pendingConversions.upsert({
    where: {
      source_target: {
        source: SupportedCurrency.USDC,
        target: SupportedCurrency.COP,
      },
    },
    update: {
      amount: 1500,
      symbol: 'USDC/COP',
      side: OrderSide.SELL,
    },
    create: {
      source: SupportedCurrency.USDC,
      target: SupportedCurrency.COP,
      amount: 1500,
      symbol: 'USDC/COP',
      side: OrderSide.SELL,
    },
  })

  await prisma.pendingConversions.upsert({
    where: {
      source_target: {
        source: SupportedCurrency.USDC,
        target: SupportedCurrency.BRL,
      },
    },
    update: {
      amount: 800,
      symbol: 'USDC/BRL',
      side: OrderSide.SELL,
    },
    create: {
      source: SupportedCurrency.USDC,
      target: SupportedCurrency.BRL,
      amount: 800,
      symbol: 'USDC/BRL',
      side: OrderSide.SELL,
    },
  })
}

async function seedPaymentProviders() {
  await prisma.paymentProvider.upsert({
    where: { id: 'provider-dev-stellar' },
    update: {
      name: 'Stellar Dev Liquidity',
      liquidity: 2000000,
      country: Country.CO,
    },
    create: {
      id: 'provider-dev-stellar',
      name: 'Stellar Dev Liquidity',
      liquidity: 2000000,
      country: Country.CO,
    },
  })

  await prisma.paymentProvider.upsert({
    where: { id: 'provider-dev-solana' },
    update: {
      name: 'Solana Dev Liquidity',
      liquidity: 1250000,
      country: Country.CO,
    },
    create: {
      id: 'provider-dev-solana',
      name: 'Solana Dev Liquidity',
      liquidity: 1250000,
      country: Country.CO,
    },
  })
}

async function main() {
  assertDevelopmentEnvironment()

  console.info('🌱 Seeding development data...')
  await seedPartners()
  await seedPaymentProviders()
  await seedPendingConversions()
  console.info('✅ Development data ready.')
}

main()
  .catch(error => {
    console.error('❌ Failed to seed development data')
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
