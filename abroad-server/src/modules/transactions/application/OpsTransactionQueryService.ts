import {
  BlockchainNetwork,
  CryptoCurrency,
  FlowInstanceStatus,
  FlowStepStatus,
  OpsPriority,
  OpsWorkStatus,
  OutboxStatus,
  PaymentMethod,
  Prisma,
  TargetCurrency,
  TransactionStatus,
} from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { classifyOpsFailure, OpsFailureGuidance } from './OpsFailureClassifier'

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100
const MAX_QUERY_LENGTH = 200
const MAX_DELIVERIES = 40
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

const summaryInclude = {
  opsCase: {
    include: {
      owner: { select: { displayName: true, id: true } },
    },
  },
  partnerUser: {
    select: {
      partner: { select: { id: true, name: true } },
      userId: true,
    },
  },
  quote: true,
} satisfies Prisma.TransactionInclude

const detailInclude = {
  opsCase: {
    include: {
      handoffs: {
        include: {
          actor: { select: { displayName: true, id: true } },
          fromUser: { select: { displayName: true, id: true } },
          toUser: { select: { displayName: true, id: true } },
        },
        orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
      },
      notes: {
        include: { author: { select: { displayName: true, id: true } } },
        orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
      },
      owner: { select: { displayName: true, id: true } },
    },
  },
  partnerUser: {
    select: {
      partner: { select: { id: true, name: true } },
      userId: true,
    },
  },
  quote: true,
  transitions: { orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }] },
} satisfies Prisma.TransactionInclude

const flowInclude = {
  steps: { orderBy: { stepOrder: 'asc' as const } },
} satisfies Prisma.FlowInstanceInclude

const deliverySelect = {
  attempts: true,
  availableAt: true,
  createdAt: true,
  id: true,
  lastAttemptDurationMs: true,
  lastError: true,
  lastHttpStatus: true,
  payload: true,
  status: true,
  transactionId: true,
  updatedAt: true,
  webhookEvent: true,
  webhookPurpose: true,
} satisfies Prisma.OutboxEventSelect

export type OpsAttentionFilter
  = | 'ALL'
    | 'FLOW_FAILED'
    | 'PAYMENT_FAILED'
    | 'PROOF_MISSING'
    | 'REFUND_PENDING'
    | 'WEBHOOK_FAILED'
export type OpsProofSummaryDto = {
  receiptEligible: boolean
  status: 'AVAILABLE' | 'MISSING' | 'NOT_APPLICABLE' | 'PENDING'
}
export type OpsRefundSummaryDto = {
  onChainId: null | string
  status: 'COMPLETED' | 'FAILED' | 'NOT_APPLICABLE' | 'NOT_STARTED' | 'PROCESSING'
}
export type OpsTransactionDetailDto = OpsTransactionSummaryDto & {
  case: null | OpsTransactionCaseDetailDto
  evidence: OpsEvidenceEventDto[]
  failure: null | OpsFailureGuidance
  identifiers: {
    /** On-chain destination of a FIAT_TO_CRYPTO delivery. Null on a payout. */
    destinationAddress: null | string
    externalId: null | string
    flowInstanceId: null | string
    onChainId: null | string
    /** Provider deposit backing a FIAT_TO_CRYPTO transaction. Null on a payout. */
    pixDepositId: null | string
    pixEndToEndId: null | string
    quoteId: string
    refundOnChainId: null | string
    transactionId: string
  }
  latestEvent: OpsEvidenceEventDto
  payoutDestinationHint: null | string
  summary: string
  webhookDeliveries: Array<{
    attempts: number
    durationMs: null | number
    event: string
    httpStatus: null | number
    id: string
    occurredAt: Date
    purpose: string
    status: OutboxStatus
  }>
}

export type OpsTransactionEvidenceExportDto = {
  evidence: OpsEvidenceEventDto[]
  exportedAt: Date
  failure: null | OpsFailureGuidance
  identifiers: OpsTransactionDetailDto['identifiers']
  partner: OpsTransactionSummaryDto['partner']
  quote: OpsTransactionQuoteDto
  refund: OpsRefundSummaryDto
  status: TransactionStatus
  webhook: OpsWebhookSummaryDto
}

export type OpsTransactionFilteredEvidenceExportDto = {
  exportedAt: Date
  filterDimensions: string[]
  items: OpsTransactionSummaryDto[]
  total: number
  truncated: boolean
}

export type OpsTransactionListResponse = {
  items: OpsTransactionSummaryDto[]
  page: number
  pageSize: number
  statusCounts: Array<{ count: number, status: TransactionStatus }>
  total: number
}

type CorrelatedTransactionIds = {
  failedFlow: string[]
  query: string[]
}

type DeliveryRow = Prisma.OutboxEventGetPayload<{ select: typeof deliverySelect }>

type DetailRow = Prisma.TransactionGetPayload<{ include: typeof detailInclude }>

type FlowRow = Prisma.FlowInstanceGetPayload<{ include: typeof flowInclude }>

type NormalizedFilters = Omit<OpsTransactionSearchFilters, 'createdFrom' | 'createdTo' | 'page' | 'pageSize' | 'query'> & {
  createdFrom?: Date
  createdTo?: Date
  page: number
  pageSize: number
  query?: string
}

type OpsCaseSummaryDto = {
  id: string
  owner: null | { displayName: string, id: string }
  priority: OpsPriority
  status: OpsWorkStatus
  team: null | string
  updatedAt: Date
  version: number
}

type OpsEvidenceEventDto = {
  category: 'CASE' | 'CHAIN' | 'FLOW' | 'PROOF' | 'PROVIDER' | 'QUOTE' | 'REFUND' | 'TRANSACTION' | 'WEBHOOK'
  description: string
  id: string
  occurredAt: Date
  state: 'FAILED' | 'INFO' | 'PENDING' | 'SUCCEEDED' | 'WARNING'
  title: string
}

type OpsFlowSummaryDto = {
  currentStepOrder: null | number
  id: string
  status: FlowInstanceStatus
  updatedAt: Date
}

type OpsSlaDto = {
  ageMinutes: number
  state: 'AT_RISK' | 'BREACHED' | 'COMPLETE' | 'WITHIN_TARGET'
  targetMinutes: null | number
}

type OpsTransactionCaseDetailDto = OpsCaseSummaryDto & {
  handoffs: Array<{
    actor: { displayName: string, id: string }
    createdAt: Date
    fromTeam: null | string
    fromUser: null | { displayName: string, id: string }
    id: string
    note: string
    toTeam: null | string
    toUser: null | { displayName: string, id: string }
  }>
  notes: Array<{
    author: { displayName: string, id: string }
    body: string
    createdAt: Date
    id: string
    kind: 'ESCALATION' | 'NOTE' | 'RESOLUTION'
  }>
}

type OpsTransactionQuoteDto = {
  country: string
  cryptoCurrency: CryptoCurrency
  network: BlockchainNetwork
  paymentMethod: PaymentMethod
  quoteId: string
  sourceAmount: number
  targetAmount: number
  targetCurrency: TargetCurrency
}

type OpsTransactionSearchFilters = {
  attention?: OpsAttentionFilter
  caseOwnerId?: string
  caseStatus?: OpsWorkStatus
  createdFrom?: string
  createdTo?: string
  cryptoCurrency?: CryptoCurrency
  network?: BlockchainNetwork
  page?: number
  pageSize?: number
  partnerId?: string
  paymentMethod?: PaymentMethod
  proofStatus?: OpsProofSummaryDto['status']
  query?: string
  refundStatus?: OpsRefundSummaryDto['status']
  status?: TransactionStatus
  targetCurrency?: TargetCurrency
  webhookStatus?: OutboxStatus
}

type OpsTransactionSummaryDto = {
  attentionReasons: Array<'FLOW_FAILED' | 'PAYMENT_FAILED' | 'PROOF_MISSING' | 'REFUND_PENDING' | 'WEBHOOK_FAILED'>
  case: null | OpsCaseSummaryDto
  createdAt: Date
  flow: null | OpsFlowSummaryDto
  id: string
  partner: { id: string, name: string }
  proof: OpsProofSummaryDto
  provider: { code: PaymentMethod, label: string }
  quote: OpsTransactionQuoteDto
  refund: OpsRefundSummaryDto
  sla: OpsSlaDto
  status: TransactionStatus
  webhook: OpsWebhookSummaryDto
}

type OpsWebhookSummaryDto = {
  attempts: number
  httpStatus: null | number
  lastAttemptAt: Date | null
  status: 'FAILED' | 'NONE' | 'PENDING' | 'SUCCEEDED'
}

type SummaryContext = {
  deliveries: DeliveryRow[]
  flow: FlowRow | null
  now: Date
}

type SummaryRow = Prisma.TransactionGetPayload<{ include: typeof summaryInclude }>

export class OpsTransactionNotFoundError extends Error {
  public constructor(message = 'Transaction not found') {
    super(message)
    this.name = 'OpsTransactionNotFoundError'
  }
}

export class OpsTransactionQueryValidationError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'OpsTransactionQueryValidationError'
  }
}

const transactionStatuses = Object.values(TransactionStatus)

@injectable()
export class OpsTransactionQueryService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
  ) {}

  public async getById(transactionId: string, now = new Date()): Promise<OpsTransactionDetailDto> {
    const prismaClient = await this.databaseClientProvider.getClient()
    const transaction = await prismaClient.transaction.findUnique({
      include: detailInclude,
      where: { id: transactionId },
    })
    if (!transaction) throw new OpsTransactionNotFoundError()

    const [flow, deliveries] = await Promise.all([
      prismaClient.flowInstance.findUnique({
        include: flowInclude,
        where: { transactionId },
      }),
      this.listDeliveries(prismaClient, [transactionId]),
    ])
    const transactionDeliveries = deliveries.filter(delivery => this.belongsToTransaction(delivery, transactionId))
    const summary = this.toSummary(transaction, { deliveries: transactionDeliveries, flow, now })
    const evidence = await this.buildEvidence(prismaClient, transaction, flow, transactionDeliveries)
    const failure = this.toFailure(transaction, flow, transactionDeliveries)

    return {
      ...summary,
      case: this.toCaseDetail(transaction.opsCase),
      evidence,
      failure,
      identifiers: {
        destinationAddress: transaction.destinationAddress,
        externalId: transaction.externalId,
        flowInstanceId: flow?.id ?? null,
        onChainId: transaction.onChainId,
        pixDepositId: transaction.pixDepositId,
        pixEndToEndId: transaction.pixEndToEndId,
        quoteId: transaction.quoteId,
        refundOnChainId: transaction.refundOnChainId,
        transactionId: transaction.id,
      },
      latestEvent: evidence.at(-1) ?? this.createdEvidence(transaction),
      payoutDestinationHint: this.maskDestination(transaction.accountNumber),
      summary: this.toHumanSummary(transaction),
      webhookDeliveries: transactionDeliveries.map(delivery => ({
        attempts: Math.max(1, delivery.attempts),
        durationMs: delivery.lastAttemptDurationMs,
        event: delivery.webhookEvent ?? 'transaction notification',
        httpStatus: delivery.lastHttpStatus,
        id: delivery.id,
        occurredAt: delivery.updatedAt,
        purpose: delivery.webhookPurpose ?? 'TRANSACTION',
        status: delivery.status,
      })),
    }
  }

  public async getEvidenceExport(transactionId: string): Promise<OpsTransactionEvidenceExportDto> {
    const detail = await this.getById(transactionId)
    return {
      evidence: detail.evidence,
      exportedAt: new Date(),
      failure: detail.failure,
      identifiers: detail.identifiers,
      partner: detail.partner,
      quote: detail.quote,
      refund: detail.refund,
      status: detail.status,
      webhook: detail.webhook,
    }
  }

  public async getFilteredEvidenceExport(
    filters: OpsTransactionSearchFilters,
  ): Promise<OpsTransactionFilteredEvidenceExportDto> {
    const filterDimensions = Object.entries(filters)
      .filter(([key, value]) => !['page', 'pageSize'].includes(key) && value !== undefined)
      .map(([key]) => key)
      .sort()
    const result = await this.search({
      ...filters,
      page: 1,
      pageSize: MAX_PAGE_SIZE,
    })

    return {
      exportedAt: new Date(),
      filterDimensions,
      items: result.items,
      total: result.total,
      truncated: result.total > result.items.length,
    }
  }

  public async search(filters: OpsTransactionSearchFilters, now = new Date()): Promise<OpsTransactionListResponse> {
    const normalized = this.normalizeFilters(filters)
    const prismaClient = await this.databaseClientProvider.getClient()
    const correlatedTransactionIds = await this.resolveCorrelatedTransactionIds(prismaClient, normalized)
    const baseWhere = this.buildWhere(normalized, correlatedTransactionIds, false)
    const resultWhere = this.buildWhere(normalized, correlatedTransactionIds, true)

    const [rows, total, statusGroups] = await Promise.all([
      prismaClient.transaction.findMany({
        include: summaryInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (normalized.page - 1) * normalized.pageSize,
        take: normalized.pageSize,
        where: resultWhere,
      }),
      prismaClient.transaction.count({ where: resultWhere }),
      prismaClient.transaction.groupBy({
        _count: { _all: true },
        by: ['status'],
        where: baseWhere,
      }),
    ])

    const transactionIds = rows.map(row => row.id)
    const [flows, deliveries] = await Promise.all([
      prismaClient.flowInstance.findMany({
        include: flowInclude,
        where: { transactionId: { in: transactionIds } },
      }),
      this.listDeliveries(prismaClient, transactionIds),
    ])
    const flowByTransaction = new Map(flows.map(flow => [flow.transactionId, flow]))
    const deliveriesByTransaction = new Map<string, DeliveryRow[]>()
    for (const transactionId of transactionIds) {
      deliveriesByTransaction.set(
        transactionId,
        deliveries.filter(delivery => this.belongsToTransaction(delivery, transactionId)),
      )
    }
    const statusCountMap = new Map(statusGroups.map(group => [group.status, group._count._all]))

    return {
      items: rows.map(row => this.toSummary(row, {
        deliveries: deliveriesByTransaction.get(row.id) ?? [],
        flow: flowByTransaction.get(row.id) ?? null,
        now,
      })),
      page: normalized.page,
      pageSize: normalized.pageSize,
      statusCounts: transactionStatuses.map(status => ({ count: statusCountMap.get(status) ?? 0, status })),
      total,
    }
  }

  private attentionWhere(
    attention: Exclude<OpsAttentionFilter, 'ALL'>,
    correlatedTransactionIds: CorrelatedTransactionIds,
  ): Prisma.TransactionWhereInput {
    if (attention === 'PAYMENT_FAILED') return { status: TransactionStatus.PAYMENT_FAILED }
    if (attention === 'PROOF_MISSING') return this.proofWhere('MISSING')
    if (attention === 'REFUND_PENDING') return this.refundWhere('NOT_STARTED')
    if (attention === 'WEBHOOK_FAILED') {
      return { outboxEvents: { some: { status: OutboxStatus.FAILED, type: 'webhook' } } }
    }
    return correlatedTransactionIds.failedFlow.length > 0
      ? { id: { in: correlatedTransactionIds.failedFlow } }
      : { id: { in: [] } }
  }

  private belongsToTransaction(delivery: DeliveryRow, transactionId: string): boolean {
    if (delivery.transactionId === transactionId) return true
    if (!this.isJsonObject(delivery.payload)) return false
    const payload = delivery.payload.payload
    if (!this.isJsonObject(payload)) return false
    const data = payload.data
    return this.isJsonObject(data) && data.id === transactionId
  }

  private async buildEvidence(
    prismaClient: import('@prisma/client').PrismaClient | Prisma.TransactionClient,
    transaction: DetailRow,
    flow: FlowRow | null,
    deliveries: DeliveryRow[],
  ): Promise<OpsEvidenceEventDto[]> {
    const signals = flow
      ? await prismaClient.flowSignal.findMany({
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { consumedAt: true, createdAt: true, eventType: true, id: true },
          where: { flowInstanceId: flow.id },
        })
      : []
    const events: OpsEvidenceEventDto[] = [
      {
        category: 'QUOTE',
        description: `${transaction.quote.sourceAmount} ${transaction.quote.cryptoCurrency} to ${transaction.quote.targetAmount} ${transaction.quote.targetCurrency}`,
        id: `quote:${transaction.quoteId}`,
        occurredAt: transaction.quote.createdAt,
        state: 'INFO',
        title: 'Quote created',
      },
      this.createdEvidence(transaction),
    ]

    if (transaction.onChainId) {
      events.push({
        category: 'CHAIN',
        description: `${transaction.quote.cryptoCurrency} receipt linked on ${transaction.quote.network}`,
        id: `chain:${transaction.id}`,
        occurredAt: transaction.createdAt,
        state: 'SUCCEEDED',
        title: 'On-chain payment recorded',
      })
    }
    events.push(...transaction.transitions.map(transition => ({
      category: transition.event === 'refund' ? 'REFUND' as const : 'TRANSACTION' as const,
      description: `${this.humanize(transition.fromStatus)} → ${this.humanize(transition.toStatus)}`,
      id: `transition:${transition.id}`,
      occurredAt: transition.createdAt,
      state: transition.toStatus === TransactionStatus.PAYMENT_COMPLETED
        ? 'SUCCEEDED' as const
        : transition.toStatus === TransactionStatus.PAYMENT_FAILED
          ? 'FAILED' as const
          : 'INFO' as const,
      title: this.humanize(transition.event),
    })))

    if (transaction.externalId) {
      events.push({
        category: 'PROVIDER',
        description: `${this.providerLabel(transaction.quote.paymentMethod)} assigned a payout reference`,
        id: `provider:${transaction.id}`,
        occurredAt: transaction.exchangeHandoffAt ?? transaction.createdAt,
        state: transaction.status === TransactionStatus.PAYMENT_FAILED ? 'FAILED' : 'INFO',
        title: 'Provider payout tracked',
      })
    }
    if (flow) {
      events.push(...flow.steps.flatMap((step): OpsEvidenceEventDto[] => {
        const stepEvents: OpsEvidenceEventDto[] = []
        if (step.startedAt) {
          stepEvents.push({
            category: 'FLOW',
            description: `Attempt ${Math.max(1, step.attempts)} of ${step.maxAttempts}`,
            id: `flow-step-start:${step.id}`,
            occurredAt: step.startedAt,
            state: step.status === FlowStepStatus.FAILED ? 'FAILED' : 'INFO',
            title: `${this.humanize(step.stepType)} started`,
          })
        }
        if (step.endedAt) {
          stepEvents.push({
            category: 'FLOW',
            description: `Step ${step.stepOrder} ${this.humanize(step.status).toLowerCase()}`,
            id: `flow-step-end:${step.id}`,
            occurredAt: step.endedAt,
            state: step.status === FlowStepStatus.SUCCEEDED
              ? 'SUCCEEDED'
              : step.status === FlowStepStatus.FAILED
                ? 'FAILED'
                : 'INFO',
            title: this.humanize(step.stepType),
          })
        }
        return stepEvents
      }))
      events.push(...signals.map(signal => ({
        category: 'FLOW' as const,
        description: signal.consumedAt ? 'Signal matched to execution' : 'Signal awaiting a matching step',
        id: `flow-signal:${signal.id}`,
        occurredAt: signal.createdAt,
        state: signal.consumedAt ? 'SUCCEEDED' as const : 'PENDING' as const,
        title: this.humanize(signal.eventType),
      })))
    }
    events.push(...deliveries.map(delivery => ({
      category: 'WEBHOOK' as const,
      description: this.webhookDescription(delivery),
      id: `webhook:${delivery.id}`,
      occurredAt: delivery.updatedAt,
      state: delivery.status === OutboxStatus.DELIVERED
        ? 'SUCCEEDED' as const
        : delivery.status === OutboxStatus.FAILED
          ? 'FAILED' as const
          : 'PENDING' as const,
      title: delivery.webhookEvent ? this.humanize(delivery.webhookEvent) : 'Partner notification',
    })))
    if (transaction.pixEndToEndId) {
      events.push({
        category: 'PROOF',
        description: 'PIX end-to-end evidence recorded; receipt retrieval is available to authorized operators.',
        id: `proof:${transaction.id}`,
        occurredAt: transaction.transitions.at(-1)?.createdAt ?? transaction.createdAt,
        state: 'SUCCEEDED',
        title: 'PIX proof recorded',
      })
    }
    if (transaction.refundOnChainId) {
      events.push({
        category: 'REFUND',
        description: `Refund evidence recorded on ${transaction.quote.network}`,
        id: `refund:${transaction.id}`,
        occurredAt: transaction.transitions.at(-1)?.createdAt ?? transaction.createdAt,
        state: 'SUCCEEDED',
        title: 'Refund completed',
      })
    }
    if (transaction.opsCase) {
      events.push({
        category: 'CASE',
        description: `${this.humanize(transaction.opsCase.priority)} priority · ${this.humanize(transaction.opsCase.status)}`,
        id: `case:${transaction.opsCase.id}`,
        occurredAt: transaction.opsCase.createdAt,
        state: transaction.opsCase.status === OpsWorkStatus.RESOLVED ? 'SUCCEEDED' : 'INFO',
        title: 'Operations case opened',
      })
      events.push(...transaction.opsCase.notes.map(note => ({
        category: 'CASE' as const,
        description: `${this.humanize(note.kind)} added by ${note.author.displayName}`,
        id: `case-note:${note.id}`,
        occurredAt: note.createdAt,
        state: note.kind === 'ESCALATION' ? 'WARNING' as const : 'INFO' as const,
        title: 'Case updated',
      })))
      events.push(...transaction.opsCase.handoffs.map(handoff => ({
        category: 'CASE' as const,
        description: `Ownership handed off by ${handoff.actor.displayName}`,
        id: `case-handoff:${handoff.id}`,
        occurredAt: handoff.createdAt,
        state: 'INFO' as const,
        title: 'Case handed off',
      })))
    }

    return events.sort((left, right) => (
      left.occurredAt.getTime() - right.occurredAt.getTime() || left.id.localeCompare(right.id)
    ))
  }

  private buildWhere(
    filters: NormalizedFilters,
    correlatedTransactionIds: CorrelatedTransactionIds,
    includeStatus: boolean,
  ): Prisma.TransactionWhereInput {
    const and: Prisma.TransactionWhereInput[] = []
    const createdAt = this.createdAtFilter(filters.createdFrom, filters.createdTo)
    if (createdAt) and.push({ createdAt })
    if (includeStatus && filters.status) and.push({ status: filters.status })
    if (filters.partnerId) and.push({ partnerUser: { partnerId: filters.partnerId } })
    if (filters.caseOwnerId) and.push({ opsCase: { ownerUserId: filters.caseOwnerId } })
    if (filters.caseStatus) and.push({ opsCase: { status: filters.caseStatus } })
    if (filters.cryptoCurrency || filters.network || filters.paymentMethod || filters.targetCurrency) {
      and.push({
        quote: {
          cryptoCurrency: filters.cryptoCurrency,
          network: filters.network,
          paymentMethod: filters.paymentMethod,
          targetCurrency: filters.targetCurrency,
        },
      })
    }
    if (filters.proofStatus) and.push(this.proofWhere(filters.proofStatus))
    if (filters.refundStatus) and.push(this.refundWhere(filters.refundStatus))
    if (filters.webhookStatus) and.push({ outboxEvents: { some: { status: filters.webhookStatus, type: 'webhook' } } })
    if (filters.query) {
      and.push({
        OR: [
          { id: { contains: filters.query, mode: 'insensitive' } },
          { quoteId: { contains: filters.query, mode: 'insensitive' } },
          { onChainId: { contains: filters.query, mode: 'insensitive' } },
          { refundOnChainId: { contains: filters.query, mode: 'insensitive' } },
          { pixEndToEndId: { contains: filters.query, mode: 'insensitive' } },
          { externalId: { contains: filters.query, mode: 'insensitive' } },
          { partnerUser: { userId: { contains: filters.query, mode: 'insensitive' } } },
          { partnerUser: { partner: { id: { contains: filters.query, mode: 'insensitive' } } } },
          { partnerUser: { partner: { name: { contains: filters.query, mode: 'insensitive' } } } },
          ...(correlatedTransactionIds.query.length > 0 ? [{ id: { in: correlatedTransactionIds.query } }] : []),
        ],
      })
    }
    if (filters.attention && filters.attention !== 'ALL') {
      and.push(this.attentionWhere(filters.attention, correlatedTransactionIds))
    }
    else if (filters.attention === 'ALL') {
      and.push({
        OR: [
          { status: TransactionStatus.PAYMENT_FAILED },
          this.proofWhere('MISSING'),
          this.refundWhere('NOT_STARTED'),
          { outboxEvents: { some: { status: OutboxStatus.FAILED, type: 'webhook' } } },
          ...(correlatedTransactionIds.failedFlow.length > 0 ? [{ id: { in: correlatedTransactionIds.failedFlow } }] : []),
        ],
      })
    }
    return and.length === 0 ? {} : { AND: and }
  }

  private createdAtFilter(createdFrom?: Date, createdTo?: Date): Prisma.DateTimeFilter | undefined {
    if (!createdFrom && !createdTo) return undefined
    return {
      ...(createdFrom ? { gte: createdFrom } : {}),
      ...(createdTo ? { lt: createdTo } : {}),
    }
  }

  private createdEvidence(transaction: DetailRow): OpsEvidenceEventDto {
    return {
      category: 'TRANSACTION',
      description: `${this.providerLabel(transaction.quote.paymentMethod)} payout requested`,
      id: `transaction:${transaction.id}`,
      occurredAt: transaction.createdAt,
      state: 'INFO',
      title: 'Transaction created',
    }
  }

  private humanize(value: string): string {
    return value
      .replace(/[._-]+/g, ' ')
      .toLowerCase()
      .replace(/(^|\s)\S/g, character => character.toUpperCase())
  }

  private isJsonObject(value: Prisma.JsonValue | undefined): value is Prisma.JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  private async listDeliveries(
    prismaClient: import('@prisma/client').PrismaClient | Prisma.TransactionClient,
    transactionIds: readonly string[],
  ): Promise<DeliveryRow[]> {
    if (transactionIds.length === 0) return []
    return prismaClient.outboxEvent.findMany({
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: deliverySelect,
      take: Math.min(MAX_DELIVERIES * transactionIds.length, 2_000),
      where: {
        OR: [
          { transactionId: { in: [...transactionIds] } },
          ...transactionIds.map(transactionId => ({
            payload: { equals: transactionId, path: ['payload', 'data', 'id'] },
            transactionId: null,
          })),
        ],
        type: 'webhook',
      },
    })
  }

  private maskDestination(value: string): null | string {
    const normalized = value.trim()
    if (!normalized) return null
    return normalized.length <= 4 ? '••••' : `•••• ${normalized.slice(-4)}`
  }

  private normalizeFilters(filters: OpsTransactionSearchFilters): NormalizedFilters {
    const page = filters.page ?? 1
    const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE
    if (!Number.isInteger(page) || page < 1) {
      throw new OpsTransactionQueryValidationError('Page must be a positive integer')
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
      throw new OpsTransactionQueryValidationError(`Page size must be between 1 and ${MAX_PAGE_SIZE}`)
    }
    const query = filters.query?.trim() || undefined
    if (query && query.length > MAX_QUERY_LENGTH) {
      throw new OpsTransactionQueryValidationError(`Search must be ${MAX_QUERY_LENGTH} characters or fewer`)
    }
    const createdFrom = this.parseCalendarDate(filters.createdFrom, false)
    const createdTo = this.parseCalendarDate(filters.createdTo, true)
    if (createdFrom && createdTo && createdFrom >= createdTo) {
      throw new OpsTransactionQueryValidationError('Start date must be on or before end date')
    }
    return { ...filters, createdFrom, createdTo, page, pageSize, query }
  }

  private parseCalendarDate(value: string | undefined, endExclusive: boolean): Date | undefined {
    if (!value) return undefined
    const match = ISO_DATE_PATTERN.exec(value)
    if (!match) throw new OpsTransactionQueryValidationError('Dates must use YYYY-MM-DD format')
    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    const date = new Date(Date.UTC(year, month - 1, day))
    if (
      date.getUTCFullYear() !== year
      || date.getUTCMonth() !== month - 1
      || date.getUTCDate() !== day
    ) {
      throw new OpsTransactionQueryValidationError('Date is not a valid calendar day')
    }
    if (endExclusive) date.setUTCDate(date.getUTCDate() + 1)
    return date
  }

  private proofWhere(status: OpsProofSummaryDto['status']): Prisma.TransactionWhereInput {
    if (status === 'AVAILABLE') {
      return { pixEndToEndId: { not: null }, quote: { paymentMethod: PaymentMethod.PIX } }
    }
    if (status === 'MISSING') {
      return {
        pixEndToEndId: null,
        quote: { paymentMethod: PaymentMethod.PIX },
        status: TransactionStatus.PAYMENT_COMPLETED,
      }
    }
    if (status === 'PENDING') {
      return {
        pixEndToEndId: null,
        quote: { paymentMethod: PaymentMethod.PIX },
        status: { not: TransactionStatus.PAYMENT_COMPLETED },
      }
    }
    return { quote: { paymentMethod: { not: PaymentMethod.PIX } } }
  }

  private providerLabel(paymentMethod: PaymentMethod): string {
    const labels: Readonly<Record<PaymentMethod, string>> = {
      [PaymentMethod.BREB]: 'Bre-B payout provider',
      [PaymentMethod.MOVII]: 'Movii (legacy)',
      [PaymentMethod.NEQUI]: 'Nequi (legacy)',
      [PaymentMethod.PIX]: 'Transfero Ultra',
    }
    return labels[paymentMethod]
  }

  private refundWhere(status: OpsRefundSummaryDto['status']): Prisma.TransactionWhereInput {
    const refundRelevant = [
      TransactionStatus.PAYMENT_EXPIRED,
      TransactionStatus.PAYMENT_FAILED,
      TransactionStatus.WRONG_AMOUNT,
    ]
    if (status === 'COMPLETED') return { refundOnChainId: { not: null } }
    if (status === 'FAILED') {
      return {
        refundOnChainId: null,
        transitions: { some: { context: { equals: 'failed', path: ['status'] }, event: 'refund' } },
      }
    }
    if (status === 'PROCESSING') {
      return {
        refundOnChainId: null,
        transitions: { some: { context: { equals: 'pending', path: ['status'] }, event: 'refund' } },
      }
    }
    if (status === 'NOT_STARTED') {
      return {
        refundOnChainId: null,
        status: { in: refundRelevant },
        transitions: { none: { event: 'refund' } },
      }
    }
    return { refundOnChainId: null, status: { notIn: refundRelevant } }
  }

  private async resolveCorrelatedTransactionIds(
    prismaClient: import('@prisma/client').PrismaClient | Prisma.TransactionClient,
    filters: NormalizedFilters,
  ): Promise<CorrelatedTransactionIds> {
    const [queryFlows, failedFlows] = await Promise.all([
      filters.query
        ? prismaClient.flowInstance.findMany({
            select: { transactionId: true },
            take: 2_000,
            where: {
              OR: [
                { id: { contains: filters.query, mode: 'insensitive' } },
                { transactionId: { contains: filters.query, mode: 'insensitive' } },
              ],
            },
          })
        : [],
      filters.attention === 'FLOW_FAILED' || filters.attention === 'ALL'
        ? prismaClient.flowInstance.findMany({
            select: { transactionId: true },
            take: 2_000,
            where: { status: FlowInstanceStatus.FAILED },
          })
        : [],
    ])
    return {
      failedFlow: [...new Set(failedFlows.map(flow => flow.transactionId))],
      query: [...new Set(queryFlows.map(flow => flow.transactionId))],
    }
  }

  private toAttentionReasons(
    transaction: DetailRow | SummaryRow,
    flow: FlowRow | null,
    deliveries: readonly DeliveryRow[],
  ): OpsTransactionSummaryDto['attentionReasons'] {
    const reasons: OpsTransactionSummaryDto['attentionReasons'] = []
    if (transaction.status === TransactionStatus.PAYMENT_FAILED) reasons.push('PAYMENT_FAILED')
    if (
      transaction.quote.paymentMethod === PaymentMethod.PIX
      && transaction.status === TransactionStatus.PAYMENT_COMPLETED
      && !transaction.pixEndToEndId
    ) reasons.push('PROOF_MISSING')
    const refundRelevantStatuses: readonly TransactionStatus[] = [
      TransactionStatus.PAYMENT_EXPIRED,
      TransactionStatus.PAYMENT_FAILED,
      TransactionStatus.WRONG_AMOUNT,
    ]
    if (
      refundRelevantStatuses.includes(transaction.status)
      && !transaction.refundOnChainId
    ) reasons.push('REFUND_PENDING')
    if (flow?.status === FlowInstanceStatus.FAILED) reasons.push('FLOW_FAILED')
    if (deliveries.some(delivery => delivery.status === OutboxStatus.FAILED)) reasons.push('WEBHOOK_FAILED')
    return reasons
  }

  private toCaseDetail(value: DetailRow['opsCase']): null | OpsTransactionCaseDetailDto {
    if (!value) return null
    return {
      ...this.toCaseSummary(value),
      handoffs: value.handoffs.map(handoff => ({
        actor: handoff.actor,
        createdAt: handoff.createdAt,
        fromTeam: handoff.fromTeam,
        fromUser: handoff.fromUser,
        id: handoff.id,
        note: handoff.note,
        toTeam: handoff.toTeam,
        toUser: handoff.toUser,
      })),
      notes: value.notes.map(note => ({
        author: note.author,
        body: note.body,
        createdAt: note.createdAt,
        id: note.id,
        kind: note.kind,
      })),
    }
  }

  private toCaseSummary(value: NonNullable<DetailRow['opsCase'] | SummaryRow['opsCase']>): OpsCaseSummaryDto {
    return {
      id: value.id,
      owner: value.owner,
      priority: value.priority,
      status: value.status,
      team: value.team,
      updatedAt: value.updatedAt,
      version: value.version,
    }
  }

  private toFailure(
    transaction: DetailRow,
    flow: FlowRow | null,
    deliveries: readonly DeliveryRow[],
  ): null | OpsFailureGuidance {
    const hasFailure = transaction.status === TransactionStatus.PAYMENT_FAILED
      || flow?.status === FlowInstanceStatus.FAILED
      || deliveries.some(delivery => delivery.status === OutboxStatus.FAILED)
      || this.toRefund(transaction).status === 'FAILED'
    if (!hasFailure) return null
    return classifyOpsFailure([
      ...transaction.transitions.map(transition => transition.context),
      ...(flow?.steps.map(step => step.error) ?? []),
      ...deliveries.map(delivery => delivery.lastError),
    ])
  }

  private toHumanSummary(transaction: DetailRow): string {
    const action = transaction.status === TransactionStatus.PAYMENT_COMPLETED
      ? 'completed'
      : transaction.status === TransactionStatus.PAYMENT_FAILED
        ? 'failed'
        : 'is in progress'
    return `${transaction.quote.targetAmount} ${transaction.quote.targetCurrency} ${this.providerLabel(transaction.quote.paymentMethod)} payout ${action} for ${transaction.partnerUser.partner.name}.`
  }

  private toProof(transaction: DetailRow | SummaryRow): OpsProofSummaryDto {
    if (transaction.quote.paymentMethod !== PaymentMethod.PIX) {
      return { receiptEligible: false, status: 'NOT_APPLICABLE' }
    }
    const receiptEligible = transaction.status === TransactionStatus.PAYMENT_COMPLETED && Boolean(transaction.externalId)
    if (transaction.pixEndToEndId) return { receiptEligible, status: 'AVAILABLE' }
    if (transaction.status === TransactionStatus.PAYMENT_COMPLETED) return { receiptEligible, status: 'MISSING' }
    return { receiptEligible, status: 'PENDING' }
  }

  private toRefund(transaction: DetailRow | SummaryRow): OpsRefundSummaryDto {
    if (transaction.refundOnChainId) {
      return { onChainId: transaction.refundOnChainId, status: 'COMPLETED' }
    }
    const refundRelevantStatuses: readonly TransactionStatus[] = [
      TransactionStatus.PAYMENT_EXPIRED,
      TransactionStatus.PAYMENT_FAILED,
      TransactionStatus.WRONG_AMOUNT,
    ]
    const relevant = refundRelevantStatuses.includes(transaction.status)
    if (!relevant) return { onChainId: null, status: 'NOT_APPLICABLE' }
    if (!('transitions' in transaction)) return { onChainId: null, status: 'NOT_STARTED' }
    const refundTransition = [...transaction.transitions].reverse().find(item => item.event === 'refund')
    if (!refundTransition || !this.isJsonObject(refundTransition.context)) {
      return { onChainId: null, status: 'NOT_STARTED' }
    }
    const state = refundTransition.context.status
    if (state === 'pending') return { onChainId: null, status: 'PROCESSING' }
    if (state === 'failed') return { onChainId: null, status: 'FAILED' }
    if (state === 'succeeded') return { onChainId: null, status: 'COMPLETED' }
    return { onChainId: null, status: 'NOT_STARTED' }
  }

  private toSla(transaction: DetailRow | SummaryRow, now: Date): OpsSlaDto {
    const terminalStatuses: readonly TransactionStatus[] = [
      TransactionStatus.PAYMENT_COMPLETED,
      TransactionStatus.PAYMENT_EXPIRED,
      TransactionStatus.PAYMENT_FAILED,
      TransactionStatus.WRONG_AMOUNT,
    ]
    const terminal = terminalStatuses.includes(transaction.status)
    const ageMinutes = Math.max(0, Math.floor((now.getTime() - transaction.createdAt.getTime()) / 60_000))
    if (terminal) return { ageMinutes, state: 'COMPLETE', targetMinutes: null }
    const targetMinutes = transaction.status === TransactionStatus.PROCESSING_PAYMENT ? 15 : 60
    return {
      ageMinutes,
      state: ageMinutes > targetMinutes
        ? 'BREACHED'
        : ageMinutes >= Math.floor(targetMinutes * 0.75)
          ? 'AT_RISK'
          : 'WITHIN_TARGET',
      targetMinutes,
    }
  }

  private toSummary(
    transaction: DetailRow | SummaryRow,
    context: SummaryContext,
  ): OpsTransactionSummaryDto {
    return {
      attentionReasons: this.toAttentionReasons(transaction, context.flow, context.deliveries),
      case: transaction.opsCase ? this.toCaseSummary(transaction.opsCase) : null,
      createdAt: transaction.createdAt,
      flow: context.flow
        ? {
            currentStepOrder: context.flow.currentStepOrder,
            id: context.flow.id,
            status: context.flow.status,
            updatedAt: context.flow.updatedAt,
          }
        : null,
      id: transaction.id,
      partner: transaction.partnerUser.partner,
      proof: this.toProof(transaction),
      provider: {
        code: transaction.quote.paymentMethod,
        label: this.providerLabel(transaction.quote.paymentMethod),
      },
      quote: {
        country: transaction.quote.country,
        cryptoCurrency: transaction.quote.cryptoCurrency,
        network: transaction.quote.network,
        paymentMethod: transaction.quote.paymentMethod,
        quoteId: transaction.quoteId,
        sourceAmount: transaction.quote.sourceAmount,
        targetAmount: transaction.quote.targetAmount,
        targetCurrency: transaction.quote.targetCurrency,
      },
      refund: this.toRefund(transaction),
      sla: this.toSla(transaction, context.now),
      status: transaction.status,
      webhook: this.toWebhook(context.deliveries),
    }
  }

  private toWebhook(deliveries: readonly DeliveryRow[]): OpsWebhookSummaryDto {
    const latest = deliveries[0]
    if (!latest) return { attempts: 0, httpStatus: null, lastAttemptAt: null, status: 'NONE' }
    const status = deliveries.some(delivery => delivery.status === OutboxStatus.FAILED)
      ? 'FAILED'
      : latest.status === OutboxStatus.DELIVERED
        ? 'SUCCEEDED'
        : 'PENDING'
    return {
      attempts: deliveries.reduce((total, delivery) => total + Math.max(1, delivery.attempts), 0),
      httpStatus: latest.lastHttpStatus,
      lastAttemptAt: latest.updatedAt,
      status,
    }
  }

  private webhookDescription(delivery: DeliveryRow): string {
    const attempts = Math.max(1, delivery.attempts)
    if (delivery.status === OutboxStatus.DELIVERED) {
      return `Delivered after ${attempts} attempt${attempts === 1 ? '' : 's'}`
    }
    if (delivery.status === OutboxStatus.FAILED) {
      return `Delivery failed after ${attempts} attempt${attempts === 1 ? '' : 's'}${delivery.lastHttpStatus ? ` · HTTP ${delivery.lastHttpStatus}` : ''}`
    }
    return `Delivery queued · ${attempts} attempt${attempts === 1 ? '' : 's'} recorded`
  }
}
