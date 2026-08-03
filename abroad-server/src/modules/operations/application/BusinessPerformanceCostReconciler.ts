import {
  FlowStepStatus,
  FlowStepType,
  Prisma,
  TransactionEconomicCostKind,
  TransactionEconomicCostStatus,
  TransactionStatus,
} from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IPaymentServiceFactory } from '../../payments/application/contracts/IPaymentServiceFactory'
import { IWalletHandlerFactory } from '../../payments/application/contracts/IWalletHandlerFactory'
import { businessPerformanceNetworkFeeOutputSchema, businessPerformancePayoutOutputSchema } from './BusinessPerformanceFlowSchemas'
import {
  BusinessPerformanceCandidate,
  BusinessPerformanceClient,
  BusinessPerformanceCostWrite,
  BusinessPerformanceFlowStep,
  toBusinessPerformanceDecimal,
} from './BusinessPerformanceReconciliationTypes'

const USD_RATE_LOOKBACK_MS = 24 * 60 * 60_000

@injectable()
export class BusinessPerformanceCostReconciler {
  public constructor(
    @inject(TYPES.IPaymentServiceFactory)
    private readonly paymentServiceFactory: IPaymentServiceFactory,
    @inject(TYPES.IWalletHandlerFactory)
    private readonly walletHandlerFactory: IWalletHandlerFactory,
  ) {}

  public async reconcile(params: {
    candidate: BusinessPerformanceCandidate
    client: BusinessPerformanceClient
    configuredProvider: string | undefined
    steps: BusinessPerformanceFlowStep[]
  }): Promise<void> {
    await this.reconcilePayoutCost(params.client, params.candidate, params.steps)
    await this.reconcileBridgeCost(params.client, params.candidate, params.configuredProvider)
    await this.reconcileBlockchainCost(params.client, params.candidate, params.steps)
    await this.reconcileRefundCost(params.client, params.candidate)
    await this.resolvePendingNativeCosts(params.client, params.candidate)
  }

  private async findUsdRate(
    client: BusinessPerformanceClient,
    currency: string,
    observedAt: Date,
  ): Promise<null | Prisma.Decimal> {
    if (currency === 'USDC' || currency === 'USDT') return new Prisma.Decimal(1)
    const snapshot = await client.treasuryBalanceSnapshot.findFirst({
      orderBy: { capturedAt: 'desc' },
      select: { usdRate: true },
      where: {
        capturedAt: {
          gte: new Date(observedAt.getTime() - USD_RATE_LOOKBACK_MS),
          lte: observedAt,
        },
        currency,
        usdRate: { not: null },
      },
    })
    return snapshot?.usdRate && snapshot.usdRate > 0
      ? toBusinessPerformanceDecimal(snapshot.usdRate)
      : null
  }

  private async readLockedRate(
    client: BusinessPerformanceClient,
    transactionId: string,
  ): Promise<null | Prisma.Decimal> {
    const economics = await client.transactionEconomics.findUnique({
      select: { lockedRateNativePerUsd: true },
      where: { transactionId },
    })
    return economics?.lockedRateNativePerUsd ?? null
  }

  private async reconcileBlockchainCost(
    client: BusinessPerformanceClient,
    candidate: BusinessPerformanceCandidate,
    steps: BusinessPerformanceFlowStep[],
  ): Promise<void> {
    const existingCost = await client.transactionEconomicCost.findUnique({
      where: {
        transactionId_kind_operationKey: {
          kind: TransactionEconomicCostKind.BLOCKCHAIN_FEE,
          operationKey: TransactionEconomicCostKind.BLOCKCHAIN_FEE.toLowerCase(),
          transactionId: candidate.id,
        },
      },
    })
    if (
      existingCost?.status === TransactionEconomicCostStatus.CONFIRMED
      || existingCost?.status === TransactionEconomicCostStatus.UNAVAILABLE
      || existingCost?.status === TransactionEconomicCostStatus.VOID
    ) return
    if (existingCost?.nativeAmount && existingCost.nativeCurrency) return

    const sendStep = steps.find(step => step.stepType === FlowStepType.EXCHANGE_SEND)
    if (!sendStep) {
      await this.writeCost(client, candidate.id, TransactionEconomicCostKind.BLOCKCHAIN_FEE, {
        observedAt: candidate.createdAt,
        reasonCode: 'exchange_send_not_required',
        status: TransactionEconomicCostStatus.VOID,
      })
      return
    }
    const output = businessPerformanceNetworkFeeOutputSchema.safeParse(sendStep.output)
    if (output.success && output.data.networkFee) {
      await this.writeNativeCost(client, candidate.id, TransactionEconomicCostKind.BLOCKCHAIN_FEE, {
        amount: output.data.networkFee.amount,
        currency: output.data.networkFee.currency,
        observedAt: sendStep.endedAt ?? candidate.createdAt,
      })
      return
    }
    const transactionId = output.success ? output.data.transactionId : undefined
    if (transactionId) {
      const handler = this.walletHandlerFactory.getWalletHandlerForCapability?.({
        blockchain: candidate.quote.network,
      }) ?? this.walletHandlerFactory.getWalletHandler(candidate.quote.network)
      const result = await handler.getTransactionFee?.(transactionId)
      if (result?.outcome === 'found') {
        await this.writeNativeCost(client, candidate.id, TransactionEconomicCostKind.BLOCKCHAIN_FEE, {
          amount: result.fee.amount,
          currency: result.fee.currency,
          observedAt: sendStep.endedAt ?? candidate.createdAt,
        })
        return
      }
      if (result?.outcome === 'unavailable') {
        await this.writeCost(client, candidate.id, TransactionEconomicCostKind.BLOCKCHAIN_FEE, {
          observedAt: sendStep.endedAt ?? candidate.createdAt,
          reasonCode: result.reason,
          status: TransactionEconomicCostStatus.UNAVAILABLE,
        })
        return
      }
    }
    await this.writeCost(client, candidate.id, TransactionEconomicCostKind.BLOCKCHAIN_FEE, {
      observedAt: sendStep.endedAt ?? candidate.createdAt,
      reasonCode: sendStep.status === FlowStepStatus.SUCCEEDED
        ? transactionId ? 'chain_fee_read_pending' : 'historical_chain_transaction_id_unavailable'
        : 'exchange_send_pending',
      status: TransactionEconomicCostStatus.PENDING,
    })
  }

  private async reconcileBridgeCost(
    client: BusinessPerformanceClient,
    candidate: BusinessPerformanceCandidate,
    configuredProvider: string | undefined,
  ): Promise<void> {
    const leg = await client.bridgePendingTransfer.findFirst({
      include: { batch: true },
      orderBy: { stepOrder: 'asc' },
      where: { transactionId: candidate.id },
    })
    if (!leg) {
      await this.writeCost(client, candidate.id, TransactionEconomicCostKind.BRIDGE_FEE, {
        observedAt: candidate.createdAt,
        reasonCode: configuredProvider === 'transfero' ? 'bridge_leg_pending' : 'bridge_not_required',
        status: configuredProvider === 'transfero'
          ? TransactionEconomicCostStatus.PENDING
          : TransactionEconomicCostStatus.VOID,
      })
      return
    }
    const batch = leg.batch
    if (!batch || batch.status === 'OPEN') {
      await this.writeCost(client, candidate.id, TransactionEconomicCostKind.BRIDGE_FEE, {
        observedAt: leg.createdAt,
        reasonCode: 'bridge_settlement_pending',
        status: TransactionEconomicCostStatus.PENDING,
      })
      return
    }
    if (batch.status === 'FAILED') {
      await this.writeCost(client, candidate.id, TransactionEconomicCostKind.BRIDGE_FEE, {
        observedAt: batch.updatedAt,
        reasonCode: batch.withdrawId ? 'bridge_failed_cost_unavailable' : 'bridge_not_submitted',
        status: batch.withdrawId
          ? TransactionEconomicCostStatus.UNAVAILABLE
          : TransactionEconomicCostStatus.VOID,
      })
      return
    }
    if (batch.withdrawFee === null || batch.grossAmount <= 0) {
      await this.writeCost(client, candidate.id, TransactionEconomicCostKind.BRIDGE_FEE, {
        observedAt: batch.settledAt ?? batch.updatedAt,
        reasonCode: 'bridge_fee_unavailable',
        status: TransactionEconomicCostStatus.UNAVAILABLE,
      })
      return
    }
    const allocated = toBusinessPerformanceDecimal(batch.withdrawFee)
      .times(toBusinessPerformanceDecimal(leg.amount))
      .dividedBy(toBusinessPerformanceDecimal(batch.grossAmount))
    await this.writeCost(client, candidate.id, TransactionEconomicCostKind.BRIDGE_FEE, {
      nativeAmount: allocated,
      nativeCurrency: batch.asset,
      observedAt: batch.settledAt ?? batch.updatedAt,
      status: TransactionEconomicCostStatus.CONFIRMED,
      usdAmount: allocated,
      usdRate: new Prisma.Decimal(1),
    })
  }

  private async reconcilePayoutCost(
    client: BusinessPerformanceClient,
    candidate: BusinessPerformanceCandidate,
    steps: BusinessPerformanceFlowStep[],
  ): Promise<void> {
    const existingCost = await client.transactionEconomicCost.findUnique({
      where: {
        transactionId_kind_operationKey: {
          kind: TransactionEconomicCostKind.PAYOUT_PROVIDER_FEE,
          operationKey: TransactionEconomicCostKind.PAYOUT_PROVIDER_FEE.toLowerCase(),
          transactionId: candidate.id,
        },
      },
    })
    if (
      existingCost?.status === TransactionEconomicCostStatus.CONFIRMED
      || existingCost?.status === TransactionEconomicCostStatus.UNAVAILABLE
      || existingCost?.status === TransactionEconomicCostStatus.VOID
    ) return
    if (existingCost?.nativeAmount && existingCost.nativeCurrency) return

    const payoutStep = steps.find(step => step.stepType === FlowStepType.PAYOUT_SEND)
    const output = businessPerformancePayoutOutputSchema.safeParse(payoutStep?.output)
    let paymentEconomics = output.success ? output.data.economics : undefined
    const providerTransactionId = output.success
      ? output.data.externalId ?? candidate.externalId ?? undefined
      : candidate.externalId ?? undefined
    let providerReadSucceeded = false
    if (!paymentEconomics && providerTransactionId) {
      const service = this.paymentServiceFactory.getPaymentServiceForCapability?.({
        paymentMethod: candidate.quote.paymentMethod,
        targetCurrency: candidate.quote.targetCurrency,
      }) ?? this.paymentServiceFactory.getPaymentService(candidate.quote.paymentMethod)
      const facts = await service.getPaymentFacts?.(providerTransactionId)
      if (facts?.success) {
        providerReadSucceeded = true
        paymentEconomics = facts.economics
      }
    }

    if (paymentEconomics) {
      const lockedRate = await this.readLockedRate(client, candidate.id)
      const fee = toBusinessPerformanceDecimal(paymentEconomics.feeNative)
      const zeroFee = fee.isZero()
      await client.transactionEconomics.update({
        data: { customerPayoutNative: toBusinessPerformanceDecimal(paymentEconomics.netAmountNative) },
        where: { transactionId: candidate.id },
      })
      await this.writeCost(client, candidate.id, TransactionEconomicCostKind.PAYOUT_PROVIDER_FEE, {
        nativeAmount: fee,
        nativeCurrency: paymentEconomics.feeCurrency,
        observedAt: payoutStep?.endedAt ?? candidate.createdAt,
        ...(lockedRate
          ? {
              usdAmount: fee.dividedBy(lockedRate),
              usdRate: new Prisma.Decimal(1).dividedBy(lockedRate),
            }
          : zeroFee ? { usdAmount: new Prisma.Decimal(0) } : {}),
        reasonCode: lockedRate || zeroFee ? undefined : 'locked_rate_pending',
        status: lockedRate || zeroFee
          ? TransactionEconomicCostStatus.CONFIRMED
          : TransactionEconomicCostStatus.PENDING,
      })
      return
    }

    const terminalWithoutProviderId = !providerTransactionId && (
      candidate.status === TransactionStatus.PAYMENT_FAILED
      || candidate.status === TransactionStatus.PAYMENT_EXPIRED
      || candidate.status === TransactionStatus.WRONG_AMOUNT
    )
    await this.writeCost(client, candidate.id, TransactionEconomicCostKind.PAYOUT_PROVIDER_FEE, {
      observedAt: payoutStep?.endedAt ?? candidate.createdAt,
      reasonCode: terminalWithoutProviderId
        ? 'payout_not_submitted'
        : providerReadSucceeded ? 'provider_history_omits_fee' : 'provider_fee_pending',
      status: terminalWithoutProviderId
        ? TransactionEconomicCostStatus.VOID
        : providerReadSucceeded
          ? TransactionEconomicCostStatus.UNAVAILABLE
          : TransactionEconomicCostStatus.PENDING,
    })
  }

  private async reconcileRefundCost(
    client: BusinessPerformanceClient,
    candidate: BusinessPerformanceCandidate,
  ): Promise<void> {
    const existing = await client.transactionEconomicCost.findUnique({
      where: {
        transactionId_kind_operationKey: {
          kind: TransactionEconomicCostKind.REFUND_FEE,
          operationKey: TransactionEconomicCostKind.REFUND_FEE.toLowerCase(),
          transactionId: candidate.id,
        },
      },
    })
    if (existing?.nativeAmount && existing.nativeCurrency) return
    if (!candidate.refundOnChainId) {
      await this.writeCost(client, candidate.id, TransactionEconomicCostKind.REFUND_FEE, {
        observedAt: candidate.createdAt,
        reasonCode: 'refund_not_required',
        status: TransactionEconomicCostStatus.VOID,
      })
      return
    }
    const handler = this.walletHandlerFactory.getWalletHandlerForCapability?.({
      blockchain: candidate.quote.network,
    }) ?? this.walletHandlerFactory.getWalletHandler(candidate.quote.network)
    const result = await handler.getTransactionFee?.(candidate.refundOnChainId)
    if (result?.outcome === 'found') {
      await this.writeNativeCost(client, candidate.id, TransactionEconomicCostKind.REFUND_FEE, {
        amount: result.fee.amount,
        currency: result.fee.currency,
        observedAt: candidate.transitions[0]?.createdAt ?? candidate.createdAt,
      })
      return
    }
    await this.writeCost(client, candidate.id, TransactionEconomicCostKind.REFUND_FEE, {
      observedAt: candidate.transitions[0]?.createdAt ?? candidate.createdAt,
      reasonCode: result?.reason ?? 'historical_refund_fee_reader_unavailable',
      status: result?.outcome === 'unavailable' || !handler.getTransactionFee
        ? TransactionEconomicCostStatus.UNAVAILABLE
        : TransactionEconomicCostStatus.PENDING,
    })
  }

  private async resolvePendingNativeCosts(
    client: BusinessPerformanceClient,
    candidate: BusinessPerformanceCandidate,
  ): Promise<void> {
    const costs = await client.transactionEconomicCost.findMany({
      where: {
        nativeAmount: { not: null },
        nativeCurrency: { not: null },
        status: TransactionEconomicCostStatus.PENDING,
        transactionId: candidate.id,
      },
    })
    for (const cost of costs) {
      if (!cost.nativeAmount || !cost.nativeCurrency) continue
      if (cost.nativeAmount.isZero()) {
        await client.transactionEconomicCost.update({
          data: {
            reasonCode: null,
            status: TransactionEconomicCostStatus.CONFIRMED,
            usdAmount: new Prisma.Decimal(0),
          },
          where: { id: cost.id },
        })
        continue
      }
      const observedAt = cost.observedAt ?? candidate.createdAt
      const rate = cost.kind === TransactionEconomicCostKind.PAYOUT_PROVIDER_FEE
        ? await this.readLockedRate(client, candidate.id).then(lockedRate => (
            lockedRate?.gt(0) ? new Prisma.Decimal(1).dividedBy(lockedRate) : null
          ))
        : await this.findUsdRate(client, cost.nativeCurrency, observedAt)
      if (!rate) continue
      await client.transactionEconomicCost.update({
        data: {
          reasonCode: null,
          status: TransactionEconomicCostStatus.CONFIRMED,
          usdAmount: cost.nativeAmount.times(rate),
          usdRate: rate,
        },
        where: { id: cost.id },
      })
    }
  }

  private async writeCost(
    client: BusinessPerformanceClient,
    transactionId: string,
    kind: TransactionEconomicCostKind,
    value: BusinessPerformanceCostWrite,
  ): Promise<void> {
    await client.transactionEconomicCost.upsert({
      create: {
        kind,
        nativeAmount: value.nativeAmount,
        nativeCurrency: value.nativeCurrency,
        observedAt: value.observedAt,
        operationKey: kind.toLowerCase(),
        reasonCode: value.reasonCode,
        status: value.status,
        transactionId,
        usdAmount: value.usdAmount,
        usdRate: value.usdRate,
      },
      update: {
        nativeAmount: value.nativeAmount ?? null,
        nativeCurrency: value.nativeCurrency ?? null,
        observedAt: value.observedAt ?? null,
        reasonCode: value.reasonCode ?? null,
        status: value.status,
        usdAmount: value.usdAmount ?? null,
        usdRate: value.usdRate ?? null,
      },
      where: {
        transactionId_kind_operationKey: {
          kind,
          operationKey: kind.toLowerCase(),
          transactionId,
        },
      },
    })
  }

  private async writeNativeCost(
    client: BusinessPerformanceClient,
    transactionId: string,
    kind: TransactionEconomicCostKind,
    input: { amount: string, currency: string, observedAt: Date },
  ): Promise<void> {
    const nativeAmount = toBusinessPerformanceDecimal(input.amount)
    const rate = nativeAmount.isZero()
      ? null
      : await this.findUsdRate(client, input.currency, input.observedAt)
    const costIsCovered = nativeAmount.isZero() || rate !== null
    await this.writeCost(client, transactionId, kind, {
      nativeAmount,
      nativeCurrency: input.currency,
      observedAt: input.observedAt,
      reasonCode: costIsCovered ? undefined : 'usd_rate_pending',
      status: costIsCovered
        ? TransactionEconomicCostStatus.CONFIRMED
        : TransactionEconomicCostStatus.PENDING,
      ...(rate
        ? { usdAmount: nativeAmount.times(rate), usdRate: rate }
        : nativeAmount.isZero() ? { usdAmount: new Prisma.Decimal(0) } : {}),
    })
  }
}
