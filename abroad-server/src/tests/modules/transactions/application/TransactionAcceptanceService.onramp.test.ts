import 'reflect-metadata'
import {
  BlockchainNetwork,
  CryptoCurrency,
  FlowDirection,
  PaymentMethod,
  Prisma,
  TargetCurrency,
  TransactionOrigin,
} from '@prisma/client'

import type { IKycService } from '../../../../modules/kyc/application/contracts/IKycService'
import type { IPaymentServiceFactory } from '../../../../modules/payments/application/contracts/IPaymentServiceFactory'
import type { LiquidityCacheService } from '../../../../modules/payments/application/LiquidityCacheService'
import type { BridgeFloatService } from '../../../../modules/treasury/application/BridgeFloatService'
import type { CryptoInventoryService } from '../../../../modules/treasury/application/CryptoInventoryService'
import type { JustInTimeUnwindService } from '../../../../modules/treasury/application/JustInTimeUnwindService'
import type { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

import { TransactionAcceptanceService } from '../../../../modules/transactions/application/TransactionAcceptanceService'
import { TransactionWebhookRouter } from '../../../../modules/transactions/application/TransactionWebhookRouter'
import {
  createMockCryptoInventoryService,
  createMockFiatDepositService,
  createMockFiatDepositServiceFactory,
  createMockJustInTimeUnwindService,
  createMockLogger,
} from '../../../setup/mockFactories'

const CELO_WALLET = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'

const buildHarness = (opts?: {
  depositService?: ReturnType<typeof createMockFiatDepositService>
  feasibility?: Awaited<ReturnType<JustInTimeUnwindService['assessFeasibility']>>
  inventory?: Awaited<ReturnType<CryptoInventoryService['getAvailable']>>
  sourceAmount?: number
}) => {
  const sourceAmount = opts?.sourceAmount ?? 10

  const prisma = {} as {
    $executeRaw: jest.Mock
    $transaction: jest.Mock
    partnerUser: { upsert: jest.Mock }
    partnerUserKyc: { findFirst: jest.Mock }
    quote: { aggregate: jest.Mock, findUnique: jest.Mock }
    transaction: { create: jest.Mock, findUnique: jest.Mock, update: jest.Mock }
  }
  Object.assign(prisma, {
    $executeRaw: jest.fn(async () => 1),
    $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
    partnerUser: {
      upsert: jest.fn().mockResolvedValue({
        disabledAt: null,
        id: 'pu-1',
        partnerId: 'partner-1',
        userId: 'user-1',
      }),
    },
    partnerUserKyc: { findFirst: jest.fn().mockResolvedValue(null) },
    quote: {
      aggregate: jest.fn(async () => ({
        _count: { _all: 0 },
        _sum: { sourceAmount: 0, targetAmount: 0 },
      })),
      findUnique: jest.fn().mockResolvedValue({
        cryptoCurrency: CryptoCurrency.USDC,
        direction: FlowDirection.FIAT_TO_CRYPTO,
        id: 'quote-1',
        network: BlockchainNetwork.CELO,
        partnerId: 'partner-1',
        paymentMethod: PaymentMethod.PIX,
        sourceAmount,
        targetAmount: 100,
        targetCurrency: TargetCurrency.BRL,
      }),
    },
    transaction: {
      create: jest.fn(async () => ({ bankCode: null, id: 't-1' })),
      findUnique: jest.fn().mockResolvedValue({
        id: 't-1',
        partnerUser: { partnerId: 'partner-1', userId: 'user-1' },
        quote: {
          id: 'quote-1',
          paymentMethod: PaymentMethod.PIX,
          targetCurrency: TargetCurrency.BRL,
        },
      }),
      update: jest.fn(async () => ({ id: 't-1' })),
    },
  })

  const paymentService = {
    capability: { method: PaymentMethod.PIX, targetCurrency: TargetCurrency.BRL },
    currency: TargetCurrency.BRL,
    fixedFee: 0,
    getLiquidity: jest.fn(async () => 1_000_000),
    isAsync: true,
    isEnabled: true,
    MAX_TOTAL_AMOUNT_PER_DAY: Number.POSITIVE_INFINITY,
    MAX_USER_AMOUNT_PER_DAY: Number.POSITIVE_INFINITY,
    MAX_USER_AMOUNT_PER_TRANSACTION: Number.POSITIVE_INFINITY,
    MAX_USER_TRANSACTIONS_PER_DAY: 1_000,
    MIN_USER_AMOUNT_PER_TRANSACTION: 0,
    onboardUser: jest.fn(async () => ({ success: true })),
    percentageFee: 0,
    sendPayment: jest.fn(),
    verifyAccount: jest.fn(async () => true),
  }
  const paymentServiceFactory = {
    getPaymentService: jest.fn(() => paymentService),
    getPaymentServiceForCapability: jest.fn(() => paymentService),
  } as unknown as IPaymentServiceFactory

  const depositService = opts?.depositService ?? createMockFiatDepositService()
  const fiatDepositServiceFactory = createMockFiatDepositServiceFactory(depositService)

  const cryptoInventoryService = createMockCryptoInventoryService()
  if (opts?.inventory) {
    cryptoInventoryService.getAvailable.mockResolvedValue(opts.inventory)
  }

  const justInTimeUnwindService = createMockJustInTimeUnwindService()
  if (opts?.feasibility) {
    justInTimeUnwindService.assessFeasibility.mockResolvedValue(opts.feasibility)
  }

  const liquidityCacheService = {
    getLiquidity: jest.fn(async () => ({
      fromCache: false,
      liquidity: 1_000_000,
      success: true,
    })),
  } as unknown as LiquidityCacheService

  const bridgeFloatService = {
    canSettle: jest.fn(async () => ({ cap: 1_000_000, deficit: 0, ok: true })),
    getOutstandingDeficit: jest.fn(async () => 0),
  } as unknown as BridgeFloatService

  const transactionWebhookRouter = {
    enqueueTargets: jest.fn(async () => undefined),
    resolveTargets: jest.fn(async () => []),
  } as unknown as TransactionWebhookRouter

  const service = new TransactionAcceptanceService(
    { getClient: jest.fn(async () => prisma) } as unknown as IDatabaseClientProvider,
    paymentServiceFactory,
    { hasApprovedKyc: jest.fn(async () => true) } as unknown as IKycService,
    { enqueueQueue: jest.fn(), enqueueWebhook: jest.fn() } as never,
    transactionWebhookRouter,
    liquidityCacheService,
    bridgeFloatService,
    justInTimeUnwindService as never,
    fiatDepositServiceFactory,
    cryptoInventoryService as never,
    createMockLogger(),
  )

  const partner = {
    id: 'partner-1',
    isKybApproved: true,
    needsKyc: false,
    origin: TransactionOrigin.DIRECT,
    webhookUrl: 'https://webhook.test',
  }

  return {
    bridgeFloatService,
    cryptoInventoryService,
    depositService,
    justInTimeUnwindService,
    liquidityCacheService,
    partner,
    prisma,
    service,
  }
}

const request = {
  accountNumber: '',
  destinationAddress: CELO_WALLET,
  quoteId: 'quote-1',
  userId: 'user-1',
}

describe('TransactionAcceptanceService onramp acceptance', () => {
  it('opens the deposit and returns the BR Code the customer pays', async () => {
    const { depositService, partner, prisma, service } = buildHarness()

    const result = await service.acceptTransaction(request, partner)

    expect(result.id).toBe('t-1')
    expect(result.kycRequired).toBe(false)
    expect(result.paymentInstructions).toEqual({
      brCode: '00020126BRCODE',
      expiresAt: null,
    })
    // Keyed on the transaction so a retried acceptance re-presents one QR.
    expect(depositService.createDeposit).toHaveBeenCalledWith({
      amount: 100,
      reference: 't-1',
      transactionId: 't-1',
    })
    expect(prisma.transaction.update).toHaveBeenCalledWith({
      data: { pixDepositId: 'deposit-1', qrCode: '00020126BRCODE' },
      where: { id: 't-1' },
    })
  })

  it('persists the wallet destination and leaves the bank account empty', async () => {
    const { partner, prisma, service } = buildHarness()

    await service.acceptTransaction(request, partner)

    const { data } = prisma.transaction.create.mock.calls[0][0]
    expect(data.destinationAddress).toBe(CELO_WALLET)
    expect(data.accountNumber).toBe('')
    expect(data.qrCode).toBeNull()
  })

  it('canonicalises the destination before persisting it', async () => {
    const { partner, prisma, service } = buildHarness()

    await service.acceptTransaction(
      { ...request, destinationAddress: CELO_WALLET.toLowerCase() },
      partner,
    )

    const { data } = prisma.transaction.create.mock.calls[0][0]
    expect(data.destinationAddress).toBe(CELO_WALLET)
  })

  it.each([
    ['a missing address', undefined],
    ['an empty address', '   '],
    ['an address from another chain', 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H'],
    ['a checksum-corrupted address', `${CELO_WALLET.slice(0, -1)}D`],
  ])('rejects %s before creating anything', async (_label, destinationAddress) => {
    const { depositService, partner, prisma, service } = buildHarness()

    await expect(
      service.acceptTransaction({ ...request, destinationAddress }, partner),
    ).rejects.toThrow()
    expect(prisma.transaction.create).not.toHaveBeenCalled()
    expect(depositService.createDeposit).not.toHaveBeenCalled()
  })

  // Promising crypto we cannot prove we hold is the failure mode that matters
  // here: an unreadable balance must reject, never pass as available float.
  it('fails closed when the hot wallet balance cannot be read', async () => {
    const { depositService, partner, prisma, service } = buildHarness({
      inventory: { reason: 'rpc_timeout', success: false },
    })

    await expect(service.acceptTransaction(request, partner)).rejects.toThrow()
    expect(prisma.transaction.create).not.toHaveBeenCalled()
    expect(depositService.createDeposit).not.toHaveBeenCalled()
  })

  it('rejects when hot wallet inventory is below the quoted delivery', async () => {
    const { partner, prisma, service } = buildHarness({
      inventory: { available: 9.99, success: true },
      sourceAmount: 10,
    })

    await expect(service.acceptTransaction(request, partner)).rejects.toThrow()
    expect(prisma.transaction.create).not.toHaveBeenCalled()
  })

  it('accepts when inventory exactly covers the quoted delivery', async () => {
    const { partner, prisma, service } = buildHarness({
      inventory: { available: 10, success: true },
      sourceAmount: 10,
    })

    await service.acceptTransaction(request, partner)

    expect(prisma.transaction.create).toHaveBeenCalled()
  })

  it('checks inventory against the crypto leg on the destination chain', async () => {
    const { cryptoInventoryService, partner, service } = buildHarness()

    await service.acceptTransaction(request, partner)

    expect(cryptoInventoryService.getAvailable).toHaveBeenCalledWith({
      cryptoCurrency: CryptoCurrency.USDC,
      network: BlockchainNetwork.CELO,
    })
  })

  // Payout-only guards must not run on an onramp: the payout rail's float and
  // the CELO->BRL bridge cap say nothing about our ability to deliver crypto.
  it('does not apply payout liquidity or bridge float guards', async () => {
    const { bridgeFloatService, liquidityCacheService, partner, service } = buildHarness()

    await service.acceptTransaction(request, partner)

    expect(liquidityCacheService.getLiquidity).not.toHaveBeenCalled()
    expect(bridgeFloatService.canSettle).not.toHaveBeenCalled()
  })

  it('surfaces a failure when the payment code cannot be opened', async () => {
    const depositService = createMockFiatDepositService()
    depositService.createDeposit.mockResolvedValue({
      code: 'retriable',
      reason: 'rate_limited',
      success: false,
    })
    const { partner, prisma, service } = buildHarness({ depositService })

    await expect(service.acceptTransaction(request, partner)).rejects.toThrow()
    // The row exists but was never given a payable code, so nothing is
    // reported back as though the customer could pay it.
    expect(prisma.transaction.update).not.toHaveBeenCalled()
  })

  it('refuses a collection rail that is switched off', async () => {
    const depositService = createMockFiatDepositService({ isEnabled: false })
    const { partner, prisma, service } = buildHarness({ depositService })

    await expect(service.acceptTransaction(request, partner)).rejects.toThrow()
    expect(prisma.transaction.create).not.toHaveBeenCalled()
  })
})

describe('TransactionAcceptanceService onramp just-in-time unwind gate', () => {
  const SHORT_INVENTORY = { available: 4, success: true as const }

  // The ship-dark contract: with the position off, an onramp short of inventory
  // is refused exactly as it was before this shipped.
  it('rejects a short onramp when the position is disabled', async () => {
    const { justInTimeUnwindService, partner, service } = buildHarness({ inventory: SHORT_INVENTORY })

    await expect(service.acceptTransaction(request, partner))
      .rejects.toThrow('This purchase is temporarily unavailable')
    expect(justInTimeUnwindService.assessFeasibility).toHaveBeenCalled()
  })

  it('admits a short onramp when the shortfall can be unwound in time', async () => {
    const { justInTimeUnwindService, partner, service } = buildHarness({
      feasibility: {
        enabled: true,
        feasible: true,
        sellTokens: new Prisma.Decimal('25'),
        spreadBps: 4,
      },
      inventory: SHORT_INVENTORY,
    })

    await expect(service.acceptTransaction(request, partner)).resolves.toEqual(
      expect.objectContaining({ kycRequired: false }),
    )
    // Only the gap is asked of the position: 10 quoted less 4 held.
    expect(justInTimeUnwindService.assessFeasibility.mock.calls[0][0].toFixed()).toBe('6')
  })

  it('refuses before anything moves when the unwind cannot clear', async () => {
    const { partner, service } = buildHarness({
      feasibility: { enabled: true, feasible: false, reason: 'slippage_bound_exceeded' },
      inventory: SHORT_INVENTORY,
    })

    await expect(service.acceptTransaction(request, partner))
      .rejects.toThrow('This purchase is temporarily unavailable')
  })

  it('never consults the position when inventory already covers the delivery', async () => {
    const { justInTimeUnwindService, partner, service } = buildHarness()

    await service.acceptTransaction(request, partner)

    // The gate must add no latency to an onramp that was always going to pass.
    expect(justInTimeUnwindService.assessFeasibility).not.toHaveBeenCalled()
  })

  // An unreadable balance cannot size a shortfall, so there is nothing safe to
  // quote against. It must refuse without reaching the position at all.
  it('refuses an unreadable inventory read without consulting the position', async () => {
    const { justInTimeUnwindService, partner, service } = buildHarness({
      inventory: { reason: 'horizon_unreachable', success: false },
    })

    await expect(service.acceptTransaction(request, partner))
      .rejects.toThrow('We could not verify available liquidity')
    expect(justInTimeUnwindService.assessFeasibility).not.toHaveBeenCalled()
  })
})
