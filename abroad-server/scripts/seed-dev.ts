// scripts/seed-dev.ts
import {
  BlockchainNetwork,
  Country,
  CryptoCurrency,
  FlowInstanceStatus,
  FlowPricingProvider,
  FlowStepCompletionPolicy,
  FlowStepStatus,
  FlowStepType,
  KycStatus,
  KYCTier,
  PaymentMethod,
  Prisma,
  PrismaClient,
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

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000)
}

function normalizeJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

async function main() {
  assertDevelopmentEnvironment()

  console.info('🌱 Seeding development data...')
  await seedPartners()
  await seedPaymentProviders()
  await seedFlowDefinitions()
  await seedFlowInstances()
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
      paymentMethod: PaymentMethod.BREB,
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
      bankCode: 'BREB',
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
      bankCode: 'BREB',
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
      paymentMethod: PaymentMethod.PIX,
      sourceAmount: 200,
      targetAmount: 950,
      targetCurrency: TargetCurrency.BRL,
    },
    update: {
      expirationDate: hoursFromNow(3),
      partnerId: betaPartner.id,
      paymentMethod: PaymentMethod.PIX,
      targetAmount: 950,
      targetCurrency: TargetCurrency.BRL,
    },
    where: { id: 'quote-dev-beta-1' },
  })

  await prisma.transaction.upsert({
    create: {
      accountNumber: '9876543210',
      bankCode: 'PIX',
      externalId: 'transfero-ext-1',
      id: 'txn-dev-beta-1',
      partnerUserId: betaPrimaryUser.id,
      qrCode: 'https://beta.dev/qr/txn-dev-beta-1',
      quoteId: betaQuote.id,
      status: TransactionStatus.PROCESSING_PAYMENT,
    },
    update: {
      accountNumber: '9876543210',
      bankCode: 'PIX',
      externalId: 'transfero-ext-1',
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

type FlowDefinitionWithSteps = Prisma.FlowDefinitionGetPayload<{
  include: { steps: true }
}>

type FlowStepSeed = {
  completionPolicy: FlowStepCompletionPolicy
  config: Record<string, unknown>
  signalMatch?: Record<string, unknown>
  stepOrder: number
  stepType: FlowStepType
}

type FlowBusinessStepSeed =
  | { type: 'PAYOUT' }
  | { type: 'MOVE_TO_EXCHANGE', venue: 'BINANCE' | 'TRANSFERO' }
  | { type: 'CONVERT', venue: 'BINANCE' | 'TRANSFERO', fromAsset: 'USDC' | 'USDT', toAsset: 'BRL' | 'COP' | 'USDT' }
  | { type: 'TRANSFER_VENUE', asset: 'USDC' | 'USDT', fromVenue: 'BINANCE', toVenue: 'TRANSFERO' }

type FlowDefinitionSeed = {
  blockchain: BlockchainNetwork
  cryptoCurrency: CryptoCurrency
  exchangeFeePct: number
  fixedFee: number
  maxAmount: number | null
  minAmount: number | null
  name: string
  payoutProvider: PaymentMethod
  pricingProvider: FlowPricingProvider
  steps: FlowBusinessStepSeed[]
  systemSteps: FlowStepSeed[]
  targetCurrency: TargetCurrency
}

type FlowStepInstanceSeed = {
  attempts?: number
  correlation?: Record<string, unknown>
  endedAt?: Date | null
  error?: Record<string, unknown>
  input?: Record<string, unknown>
  maxAttempts?: number
  output?: Record<string, unknown>
  startedAt?: Date | null
  status: FlowStepStatus
  stepOrder: number
  stepType: FlowStepType
}

type FlowSignalSeed = {
  consumedAt?: Date | null
  correlationKeys: Record<string, unknown>
  createdAt?: Date
  eventType: string
  payload: Record<string, unknown>
  stepInstanceId?: string | null
}

async function seedFlowDefinitions() {
  const definitions: FlowDefinitionSeed[] = [
    {
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: CryptoCurrency.USDC,
      exchangeFeePct: 0.6,
      fixedFee: 1.25,
      maxAmount: null,
      minAmount: 10,
      name: 'USDC Stellar → COP (Binance)',
      payoutProvider: PaymentMethod.BREB,
      pricingProvider: FlowPricingProvider.BINANCE,
      steps: [
        { type: 'PAYOUT' },
        { type: 'MOVE_TO_EXCHANGE', venue: 'BINANCE' },
        { type: 'CONVERT', venue: 'BINANCE', fromAsset: 'USDC', toAsset: 'USDT' },
        { type: 'CONVERT', venue: 'BINANCE', fromAsset: 'USDT', toAsset: 'COP' },
      ],
      systemSteps: [
        {
          completionPolicy: FlowStepCompletionPolicy.SYNC,
          config: { paymentMethod: 'BREB' },
          stepOrder: 1,
          stepType: FlowStepType.PAYOUT_SEND,
        },
        {
          completionPolicy: FlowStepCompletionPolicy.SYNC,
          config: { provider: 'binance' },
          stepOrder: 2,
          stepType: FlowStepType.EXCHANGE_SEND,
        },
        {
          completionPolicy: FlowStepCompletionPolicy.AWAIT_EVENT,
          config: { provider: 'binance' },
          stepOrder: 3,
          stepType: FlowStepType.AWAIT_EXCHANGE_BALANCE,
        },
        {
          completionPolicy: FlowStepCompletionPolicy.SYNC,
          config: { provider: 'binance', side: 'SELL', symbol: 'USDCUSDT' },
          stepOrder: 4,
          stepType: FlowStepType.EXCHANGE_CONVERT,
        },
        {
          completionPolicy: FlowStepCompletionPolicy.SYNC,
          config: { provider: 'binance', side: 'SELL', symbol: 'USDTCOP' },
          stepOrder: 5,
          stepType: FlowStepType.EXCHANGE_CONVERT,
        },
      ],
      targetCurrency: TargetCurrency.COP,
    },
    {
      blockchain: BlockchainNetwork.SOLANA,
      cryptoCurrency: CryptoCurrency.USDC,
      exchangeFeePct: 0.4,
      fixedFee: 0.75,
      maxAmount: null,
      minAmount: 20,
      name: 'USDC Solana → BRL (Transfero)',
      payoutProvider: PaymentMethod.PIX,
      pricingProvider: FlowPricingProvider.TRANSFERO,
      steps: [
        { type: 'PAYOUT' },
        { type: 'MOVE_TO_EXCHANGE', venue: 'TRANSFERO' },
        { type: 'CONVERT', venue: 'TRANSFERO', fromAsset: 'USDC', toAsset: 'BRL' },
      ],
      systemSteps: [
        {
          completionPolicy: FlowStepCompletionPolicy.SYNC,
          config: { paymentMethod: 'PIX' },
          stepOrder: 1,
          stepType: FlowStepType.PAYOUT_SEND,
        },
        {
          completionPolicy: FlowStepCompletionPolicy.AWAIT_EVENT,
          config: {},
          stepOrder: 2,
          stepType: FlowStepType.AWAIT_PROVIDER_STATUS,
        },
        {
          completionPolicy: FlowStepCompletionPolicy.SYNC,
          config: { provider: 'transfero' },
          stepOrder: 3,
          stepType: FlowStepType.EXCHANGE_SEND,
        },
        {
          completionPolicy: FlowStepCompletionPolicy.AWAIT_EVENT,
          config: { provider: 'transfero' },
          stepOrder: 4,
          stepType: FlowStepType.AWAIT_EXCHANGE_BALANCE,
        },
        {
          completionPolicy: FlowStepCompletionPolicy.SYNC,
          config: {
            provider: 'transfero',
            sourceCurrency: 'USDC',
            targetCurrency: TargetCurrency.BRL,
          },
          stepOrder: 5,
          stepType: FlowStepType.EXCHANGE_CONVERT,
        },
      ],
      targetCurrency: TargetCurrency.BRL,
    },
  ]

  for (const seed of definitions) {
    const existing = await prisma.flowDefinition.findFirst({
      where: {
        blockchain: seed.blockchain,
        cryptoCurrency: seed.cryptoCurrency,
        targetCurrency: seed.targetCurrency,
      },
    })

    const stepCreates = seed.systemSteps.map(step => ({
      completionPolicy: step.completionPolicy,
      config: normalizeJson(step.config),
      signalMatch: step.signalMatch ? normalizeJson(step.signalMatch) : undefined,
      stepOrder: step.stepOrder,
      stepType: step.stepType,
    }))

    if (!existing) {
      await prisma.flowDefinition.create({
        data: {
          blockchain: seed.blockchain,
          cryptoCurrency: seed.cryptoCurrency,
          exchangeFeePct: seed.exchangeFeePct,
          fixedFee: seed.fixedFee,
          maxAmount: seed.maxAmount,
          minAmount: seed.minAmount,
          name: seed.name,
          payoutProvider: seed.payoutProvider,
          pricingProvider: seed.pricingProvider,
          steps: { create: stepCreates },
          targetCurrency: seed.targetCurrency,
          userSteps: normalizeJson(seed.steps),
        },
      })
      continue
    }

    await prisma.flowStepDefinition.deleteMany({ where: { flowDefinitionId: existing.id } })
    await prisma.flowDefinition.update({
      data: {
        blockchain: seed.blockchain,
        cryptoCurrency: seed.cryptoCurrency,
        exchangeFeePct: seed.exchangeFeePct,
        fixedFee: seed.fixedFee,
        maxAmount: seed.maxAmount,
        minAmount: seed.minAmount,
        name: seed.name,
        payoutProvider: seed.payoutProvider,
        pricingProvider: seed.pricingProvider,
        steps: { create: stepCreates },
        targetCurrency: seed.targetCurrency,
        userSteps: normalizeJson(seed.steps),
      },
      where: { id: existing.id },
    })
  }
}

async function seedFlowInstances() {
  const definitions = await prisma.flowDefinition.findMany({
    include: { steps: true },
    where: { enabled: true },
  })

  const findDefinition = (blockchain: BlockchainNetwork, targetCurrency: TargetCurrency) =>
    definitions.find(def => def.blockchain === blockchain && def.targetCurrency === targetCurrency)

  const alphaDefinition = findDefinition(BlockchainNetwork.STELLAR, TargetCurrency.COP)
  const betaDefinition = findDefinition(BlockchainNetwork.SOLANA, TargetCurrency.BRL)

  if (!alphaDefinition || !betaDefinition) {
    throw new Error('Flow definitions missing for seeded instances')
  }

  await upsertFlowInstance({
    currentStepOrder: 3,
    definition: alphaDefinition,
    signals: [
      {
        correlationKeys: { provider: 'binance' },
        createdAt: minutesAgo(8),
        eventType: 'exchange.balance.updated',
        payload: { provider: 'binance', note: 'seed-balance-update' },
      },
    ],
    status: FlowInstanceStatus.WAITING,
    steps: [
      {
        attempts: 1,
        endedAt: minutesAgo(42),
        output: { provider: 'breb' },
        startedAt: minutesAgo(43),
        status: FlowStepStatus.SUCCEEDED,
        stepOrder: 1,
        stepType: FlowStepType.PAYOUT_SEND,
      },
      {
        attempts: 1,
        endedAt: minutesAgo(38),
        output: {
          address: 'binance-dev-deposit',
          amount: 100,
          transactionId: 'binance-send-dev-1',
        },
        startedAt: minutesAgo(39),
        status: FlowStepStatus.SUCCEEDED,
        stepOrder: 2,
        stepType: FlowStepType.EXCHANGE_SEND,
      },
      {
        attempts: 1,
        correlation: { provider: 'binance' },
        output: { provider: 'binance' },
        startedAt: minutesAgo(35),
        status: FlowStepStatus.WAITING,
        stepOrder: 3,
        stepType: FlowStepType.AWAIT_EXCHANGE_BALANCE,
      },
      {
        status: FlowStepStatus.READY,
        stepOrder: 4,
        stepType: FlowStepType.EXCHANGE_CONVERT,
      },
      {
        status: FlowStepStatus.READY,
        stepOrder: 5,
        stepType: FlowStepType.EXCHANGE_CONVERT,
      },
    ],
    transactionId: 'txn-dev-alpha-1',
  })

  await upsertFlowInstance({
    currentStepOrder: 2,
    definition: betaDefinition,
    signals: [
      {
        consumedAt: minutesAgo(20),
        correlationKeys: { externalId: 'transfero-ext-1' },
        createdAt: minutesAgo(22),
        eventType: 'payment.status.updated',
        payload: {
          amount: 950,
          currency: TargetCurrency.BRL,
          externalId: 'transfero-ext-1',
          provider: 'transfero',
          status: 'failed',
        },
      },
    ],
    status: FlowInstanceStatus.FAILED,
    steps: [
      {
        attempts: 1,
        endedAt: minutesAgo(24),
        output: { externalId: 'transfero-ext-1', provider: 'transfero' },
        startedAt: minutesAgo(25),
        status: FlowStepStatus.SUCCEEDED,
        stepOrder: 1,
        stepType: FlowStepType.PAYOUT_SEND,
      },
      {
        attempts: 1,
        correlation: { externalId: 'transfero-ext-1' },
        endedAt: minutesAgo(22),
        error: { message: 'Provider reported payment failure' },
        startedAt: minutesAgo(23),
        status: FlowStepStatus.FAILED,
        stepOrder: 2,
        stepType: FlowStepType.AWAIT_PROVIDER_STATUS,
      },
      {
        status: FlowStepStatus.READY,
        stepOrder: 3,
        stepType: FlowStepType.EXCHANGE_SEND,
      },
      {
        status: FlowStepStatus.READY,
        stepOrder: 4,
        stepType: FlowStepType.AWAIT_EXCHANGE_BALANCE,
      },
      {
        status: FlowStepStatus.READY,
        stepOrder: 5,
        stepType: FlowStepType.EXCHANGE_CONVERT,
      },
    ],
    transactionId: 'txn-dev-beta-1',
  })
}

function buildSnapshot(definition: FlowDefinitionWithSteps): Prisma.InputJsonValue {
  return normalizeJson({
    definition: {
      blockchain: definition.blockchain,
      cryptoCurrency: definition.cryptoCurrency,
      exchangeFeePct: definition.exchangeFeePct,
      fixedFee: definition.fixedFee,
      id: definition.id,
      maxAmount: definition.maxAmount,
      minAmount: definition.minAmount,
      name: definition.name,
      payoutProvider: definition.payoutProvider,
      pricingProvider: definition.pricingProvider,
      targetCurrency: definition.targetCurrency,
    },
    steps: definition.steps
      .sort((a, b) => a.stepOrder - b.stepOrder)
      .map(step => ({
        completionPolicy: step.completionPolicy,
        config: step.config,
        signalMatch: step.signalMatch ?? null,
        stepOrder: step.stepOrder,
        stepType: step.stepType,
      })),
  })
}

async function upsertFlowInstance(params: {
  currentStepOrder: number | null
  definition: FlowDefinitionWithSteps
  signals?: FlowSignalSeed[]
  status: FlowInstanceStatus
  steps: FlowStepInstanceSeed[]
  transactionId: string
}) {
  const snapshot = buildSnapshot(params.definition)
  const existing = await prisma.flowInstance.findUnique({ where: { transactionId: params.transactionId } })

  const stepPayloads = params.steps.map(step => ({
    attempts: step.attempts ?? 0,
    correlation: step.correlation ? normalizeJson(step.correlation) : undefined,
    endedAt: step.endedAt ?? null,
    error: step.error ? normalizeJson(step.error) : undefined,
    flowInstanceId: existing?.id ?? 'pending',
    input: step.input ? normalizeJson(step.input) : undefined,
    maxAttempts: step.maxAttempts ?? 3,
    output: step.output ? normalizeJson(step.output) : undefined,
    startedAt: step.startedAt ?? null,
    status: step.status,
    stepOrder: step.stepOrder,
    stepType: step.stepType,
  }))

  if (existing) {
    await prisma.flowStepInstance.deleteMany({ where: { flowInstanceId: existing.id } })
    await prisma.flowSignal.deleteMany({ where: { flowInstanceId: existing.id } })

    await prisma.flowInstance.update({
      data: {
        currentStepOrder: params.currentStepOrder,
        flowSnapshot: snapshot,
        status: params.status,
      },
      where: { id: existing.id },
    })

    await prisma.flowStepInstance.createMany({
      data: stepPayloads.map(step => ({ ...step, flowInstanceId: existing.id })),
    })

    if (params.signals && params.signals.length > 0) {
      await prisma.flowSignal.createMany({
        data: params.signals.map(signal => ({
          consumedAt: signal.consumedAt ?? null,
          correlationKeys: normalizeJson(signal.correlationKeys),
          createdAt: signal.createdAt ?? new Date(),
          eventType: signal.eventType,
          flowInstanceId: existing.id,
          payload: normalizeJson(signal.payload),
          stepInstanceId: signal.stepInstanceId ?? null,
        })),
      })
    }
    return
  }

  const created = await prisma.flowInstance.create({
    data: {
      currentStepOrder: params.currentStepOrder,
      flowSnapshot: snapshot,
      status: params.status,
      transactionId: params.transactionId,
    },
  })

  await prisma.flowStepInstance.createMany({
    data: stepPayloads.map(step => ({ ...step, flowInstanceId: created.id })),
  })

  if (params.signals && params.signals.length > 0) {
    await prisma.flowSignal.createMany({
      data: params.signals.map(signal => ({
        consumedAt: signal.consumedAt ?? null,
        correlationKeys: normalizeJson(signal.correlationKeys),
        createdAt: signal.createdAt ?? new Date(),
        eventType: signal.eventType,
        flowInstanceId: created.id,
        payload: normalizeJson(signal.payload),
        stepInstanceId: signal.stepInstanceId ?? null,
      })),
    })
  }
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
