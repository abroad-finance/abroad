import type { Prisma } from '@prisma/client'

import {
  BridgeBatchStatus,
  BridgeLegStatus,
  DeliveryAttemptStatus,
  FlowDirection,
  FlowInstanceStatus,
  OpsIncidentSeverity,
  OpsWorkStatus,
  OutboxStatus,
  TransactionStatus,
} from '@prisma/client'
import { inject, injectable } from 'inversify'

import { TYPES } from '../../../app/container/types'
import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { classifyOpsFailure, OpsFailureCategory } from '../../transactions/application/OpsFailureClassifier'
import { OpsTreasuryService } from '../../treasury/application/OpsTreasuryService'
import { OpsIncidentAffectedResource, OpsIncidentContext, serializeIncidentContext } from './contracts/OpsIncidentContracts'
import { OpsAuditService } from './OpsAuditService'

const AUTO_FINGERPRINT_PREFIX = 'ops-auto:v1:'
const DETECTION_WINDOW_MS = 60 * 60 * 1_000
const FLOW_STALE_MS = 30 * 60 * 1_000
const BRIDGE_STALE_MS = 60 * 60 * 1_000
const MAX_SOURCE_ROWS = 500
const MAX_AFFECTED_LINKS = 20

type DetectedIncident = {
  affectedCount: number
  context: OpsIncidentContext
  fingerprint: string
  firstSeenAt: Date
  kind: string
  lastSeenAt: Date
  occurrenceCount: number
  severity: OpsIncidentSeverity
  summary: string
  title: string
}

type GroupAccumulator = {
  affected: Map<string, OpsIncidentAffectedResource>
  affectedIds: Set<string>
  dimensions: Map<string, string>
  firstSeenAt: Date
  lastSeenAt: Date
  occurrences: number
}

type SyncResult = {
  active: number
  created: number
  reopened: number
  resolved: number
}

const severityForCount = (
  count: number,
  baseline: OpsIncidentSeverity,
): OpsIncidentSeverity => {
  if (baseline === OpsIncidentSeverity.CRITICAL) return baseline
  if (count >= 10) return OpsIncidentSeverity.CRITICAL
  if (count >= 3 && baseline === OpsIncidentSeverity.WARNING) return OpsIncidentSeverity.HIGH
  return baseline
}

const labelForCategory: Readonly<Record<OpsFailureCategory, string>> = {
  DESTINATION: 'Destination failures',
  FLOW_EXECUTION: 'Flow execution failures',
  LIQUIDITY: 'Liquidity failures',
  NETWORK: 'Network failures',
  PRICING: 'Pricing failures',
  PROVIDER_REJECTED: 'Provider rejections',
  PROVIDER_UNAVAILABLE: 'Provider availability failures',
  RATE_LIMIT: 'Provider throttling',
  REFUND: 'Refund failures',
  UNKNOWN: 'Unclassified flow failures',
  WEBHOOK: 'Webhook failures',
}

const describeDirection = (direction: FlowDirection): string => (
  direction === FlowDirection.FIAT_TO_CRYPTO ? 'Onramp' : 'Payout'
)

const isJsonObject = (value: Prisma.JsonValue): value is Prisma.JsonObject => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const jsonString = (value: Prisma.JsonValue, key: string): null | string => {
  if (!isJsonObject(value)) return null
  const candidate = value[key]
  return typeof candidate === 'string' && candidate.length <= 80 ? candidate : null
}

/**
 * A flow snapshot is shaped `{ definition, steps }`, so provider fields have to
 * be read a level down. Reading them off the root silently yields null and
 * collapses every flow incident into a single `UNKNOWN` provider group.
 */
const snapshotDefinitionString = (value: Prisma.JsonValue, key: string): null | string => {
  if (!isJsonObject(value)) return null
  const definition = value.definition
  if (definition === undefined) return null
  return jsonString(definition, key)
}

const encodeQuery = (path: string, values: Readonly<Record<string, string>>): string => {
  const params = new URLSearchParams(values)
  return `${path}?${params.toString()}`
}

@injectable()
export class OpsIncidentDetectionService {
  public constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private readonly databaseClientProvider: IDatabaseClientProvider,
    @inject(OpsTreasuryService)
    private readonly treasuryService: OpsTreasuryService,
    @inject(OpsAuditService)
    private readonly auditService: OpsAuditService,
  ) {}

  public async detect(now = new Date()): Promise<DetectedIncident[]> {
    const client = await this.databaseClientProvider.getClient()
    const since = new Date(now.getTime() - DETECTION_WINDOW_MS)
    const flowStaleBefore = new Date(now.getTime() - FLOW_STALE_MS)
    const bridgeStaleBefore = new Date(now.getTime() - BRIDGE_STALE_MS)
    const [
      flows,
      failedTransactions,
      failedWebhooks,
      bridgeLegs,
      failedBatches,
      deliveryAttempts,
      onrampObligations,
      treasury,
    ] = await Promise.all([
      client.flowInstance.findMany({
        orderBy: { updatedAt: 'desc' },
        select: {
          createdAt: true,
          flowSnapshot: true,
          id: true,
          status: true,
          steps: {
            orderBy: { updatedAt: 'desc' },
            select: { error: true, stepType: true, updatedAt: true },
            take: 1,
            where: { status: 'FAILED' },
          },
          transactionId: true,
          updatedAt: true,
        },
        take: MAX_SOURCE_ROWS,
        where: {
          OR: [
            { status: FlowInstanceStatus.FAILED, updatedAt: { gte: since } },
            { status: FlowInstanceStatus.WAITING, updatedAt: { lt: flowStaleBefore } },
          ],
        },
      }),
      client.transaction.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true,
          id: true,
          quote: { select: { direction: true, paymentMethod: true } },
        },
        take: MAX_SOURCE_ROWS,
        where: { createdAt: { gte: since }, status: TransactionStatus.PAYMENT_FAILED },
      }),
      client.outboxEvent.findMany({
        orderBy: { updatedAt: 'desc' },
        select: { id: true, partnerId: true, transactionId: true, updatedAt: true },
        take: MAX_SOURCE_ROWS,
        where: { status: OutboxStatus.FAILED, type: 'webhook', updatedAt: { gte: since } },
      }),
      client.bridgePendingTransfer.findMany({
        orderBy: { updatedAt: 'desc' },
        select: {
          amount: true,
          batchId: true,
          createdAt: true,
          destNetwork: true,
          id: true,
          status: true,
          transactionId: true,
          updatedAt: true,
        },
        take: MAX_SOURCE_ROWS,
        where: {
          OR: [
            { status: BridgeLegStatus.FAILED, updatedAt: { gte: since } },
            { createdAt: { lt: bridgeStaleBefore }, status: BridgeLegStatus.PENDING },
          ],
        },
      }),
      client.bridgeBatch.findMany({
        orderBy: { updatedAt: 'desc' },
        select: { createdAt: true, destNetwork: true, id: true, updatedAt: true },
        take: MAX_SOURCE_ROWS,
        where: { status: BridgeBatchStatus.FAILED, updatedAt: { gte: since } },
      }),
      // The onramp's delivery leg has no other ops surface: a dead or stranded
      // attempt is otherwise only visible as a generic stale flow.
      client.deliveryAttempt.findMany({
        orderBy: { preparedAt: 'desc' },
        select: {
          asset: true,
          expiresAt: true,
          failureCode: true,
          id: true,
          network: true,
          preparedAt: true,
          status: true,
          transactionId: true,
        },
        take: MAX_SOURCE_ROWS,
        where: {
          OR: [
            {
              preparedAt: { gte: since },
              status: { in: [DeliveryAttemptStatus.FAILED, DeliveryAttemptStatus.EXPIRED] },
            },
            {
              expiresAt: { lt: now },
              status: { in: [DeliveryAttemptStatus.PREPARED, DeliveryAttemptStatus.SUBMITTED] },
            },
          ],
        },
      }),
      client.transaction.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          quote: { select: { cryptoCurrency: true, network: true, sourceAmount: true } },
        },
        take: MAX_SOURCE_ROWS,
        where: {
          quote: { direction: FlowDirection.FIAT_TO_CRYPTO },
          status: TransactionStatus.PROCESSING_PAYMENT,
        },
      }),
      this.treasuryService.getBalances(),
    ])

    const detected: DetectedIncident[] = []
    const flowGroups = new Map<string, GroupAccumulator>()
    for (const flow of flows) {
      const isStale = flow.status === FlowInstanceStatus.WAITING
      const failure = isStale
        ? null
        : classifyOpsFailure(flow.steps.map(step => step.error))
      const category = isStale ? 'QUEUE' : failure?.category ?? 'UNKNOWN'
      const provider = snapshotDefinitionString(flow.flowSnapshot, 'payoutProvider')
        ?? snapshotDefinitionString(flow.flowSnapshot, 'pricingProvider')
        ?? 'UNKNOWN'
      const groupKey = `${category}:${provider}`
      this.addToGroup(flowGroups, groupKey, {
        at: flow.updatedAt,
        dimensions: { 'Failure mode': category, 'Provider': provider },
        resource: {
          id: flow.id,
          label: `Flow ${flow.id.slice(0, 8)}`,
          path: `/ops/flows/${encodeURIComponent(flow.id)}`,
          type: 'FLOW',
        },
      })
    }
    for (const [groupKey, group] of flowGroups) {
      const [category, provider] = groupKey.split(':')
      const failureCategory = category as OpsFailureCategory
      const isQueue = category === 'QUEUE'
      const kind = isQueue ? 'QUEUE' : category
      detected.push(this.buildDetection({
        baselineSeverity: isQueue ? OpsIncidentSeverity.WARNING : OpsIncidentSeverity.HIGH,
        filters: [{
          label: 'Open affected flows',
          path: encodeQuery('/ops/flows', isQueue
            ? { failure: 'STUCK_WAITING', payoutProvider: provider }
            : { failure: 'FAILED_FLOW', payoutProvider: provider }),
        }],
        fingerprint: `flow:${category}:${provider}`,
        group,
        kind,
        summary: `${group.occurrences} ${isQueue ? 'stalled' : 'failed'} flow${group.occurrences === 1 ? '' : 's'} detected for ${provider}.`,
        title: isQueue ? `Stalled ${provider} flows` : `${labelForCategory[failureCategory]} · ${provider}`,
      }))
    }

    const paymentGroups = new Map<string, GroupAccumulator>()
    for (const transaction of failedTransactions) {
      const provider = transaction.quote.paymentMethod
      const direction = transaction.quote.direction
      // Grouping on the provider alone reports an onramp delivery failure as a
      // payout failure on the same rail, which sends the operator to the wrong
      // side of the corridor.
      this.addToGroup(paymentGroups, `${direction}:${provider}`, {
        at: transaction.createdAt,
        dimensions: { Direction: describeDirection(direction), Provider: provider },
        resource: {
          id: transaction.id,
          label: `Transaction ${transaction.id.slice(0, 8)}`,
          path: `/ops/transactions/${encodeURIComponent(transaction.id)}`,
          type: 'TRANSACTION',
        },
      })
    }
    for (const [groupKey, group] of paymentGroups) {
      const [direction, provider] = groupKey.split(':')
      const isOnramp = direction === FlowDirection.FIAT_TO_CRYPTO
      detected.push(this.buildDetection({
        baselineSeverity: OpsIncidentSeverity.HIGH,
        filters: [{
          label: isOnramp ? 'Open failed onramps' : 'Open failed transactions',
          path: encodeQuery('/ops/transactions', {
            direction,
            provider,
            status: TransactionStatus.PAYMENT_FAILED,
          }),
        }],
        fingerprint: `payment:${direction}:${provider}`,
        group,
        kind: 'PROVIDER',
        summary: isOnramp
          ? `${group.occurrences} recent onramp transaction${group.occurrences === 1 ? '' : 's'} funded through ${provider} failed to deliver.`
          : `${group.occurrences} recent payout transaction${group.occurrences === 1 ? '' : 's'} failed for ${provider}.`,
        title: isOnramp ? `Failed ${provider} onramp deliveries` : `Failed ${provider} payouts`,
      }))
    }

    const webhookGroups = new Map<string, GroupAccumulator>()
    for (const delivery of failedWebhooks) {
      const partnerId = delivery.partnerId ?? 'UNSCOPED'
      this.addToGroup(webhookGroups, partnerId, {
        at: delivery.updatedAt,
        dimensions: { Partner: partnerId },
        resource: delivery.transactionId
          ? {
              id: delivery.transactionId,
              label: `Transaction ${delivery.transactionId.slice(0, 8)}`,
              path: `/ops/transactions/${encodeURIComponent(delivery.transactionId)}`,
              type: 'TRANSACTION',
            }
          : undefined,
      })
    }
    for (const [partnerId, group] of webhookGroups) {
      detected.push(this.buildDetection({
        baselineSeverity: OpsIncidentSeverity.WARNING,
        filters: [{
          label: 'Open failed deliveries',
          path: encodeQuery('/ops/transactions', {
            ...(partnerId === 'UNSCOPED' ? {} : { partnerId }),
            webhookStatus: OutboxStatus.FAILED,
          }),
        }],
        fingerprint: `webhook:${partnerId}`,
        group,
        kind: 'WEBHOOK',
        summary: `${group.occurrences} recent partner webhook deliver${group.occurrences === 1 ? 'y' : 'ies'} exhausted delivery attempts.`,
        title: 'Partner webhook delivery failures',
      }))
    }

    const bridgeGroups = new Map<string, GroupAccumulator>()
    for (const leg of bridgeLegs) {
      const mode = leg.status === BridgeLegStatus.FAILED ? 'FAILED' : 'SLA'
      this.addToGroup(bridgeGroups, `${mode}:${leg.destNetwork}`, {
        at: leg.updatedAt,
        dimensions: { Network: leg.destNetwork, State: mode },
        resource: {
          id: leg.id,
          label: `Bridge leg ${leg.id.slice(0, 8)}`,
          path: encodeQuery('/ops/treasury/bridge', { legId: leg.id }),
          type: 'BRIDGE_LEG',
        },
      })
    }
    for (const batch of failedBatches) {
      this.addToGroup(bridgeGroups, `FAILED:${batch.destNetwork}`, {
        at: batch.updatedAt,
        dimensions: { Network: batch.destNetwork, State: 'FAILED' },
        resource: {
          id: batch.id,
          label: `Bridge batch ${batch.id.slice(0, 8)}`,
          path: `/ops/treasury/bridge/batches/${encodeURIComponent(batch.id)}`,
          type: 'BRIDGE_BATCH',
        },
      })
    }
    for (const [groupKey, group] of bridgeGroups) {
      const [mode, network] = groupKey.split(':')
      detected.push(this.buildDetection({
        baselineSeverity: mode === 'FAILED' ? OpsIncidentSeverity.HIGH : OpsIncidentSeverity.WARNING,
        filters: [{
          label: 'Open bridge settlement',
          path: encodeQuery('/ops/treasury/bridge', { network, status: mode }),
        }],
        fingerprint: `bridge:${mode}:${network}`,
        group,
        kind: 'BRIDGE',
        summary: `${group.occurrences} bridge item${group.occurrences === 1 ? '' : 's'} ${mode === 'FAILED' ? 'failed' : 'exceeded the expected pending SLA'} on ${network}.`,
        title: mode === 'FAILED' ? `Failed ${network} bridge settlement` : `Delayed ${network} bridge settlement`,
      }))
    }

    const deliveryGroups = new Map<string, GroupAccumulator>()
    for (const attempt of deliveryAttempts) {
      const isStranded = attempt.status === DeliveryAttemptStatus.PREPARED
        || attempt.status === DeliveryAttemptStatus.SUBMITTED
      const mode = isStranded ? 'STRANDED' : attempt.status
      this.addToGroup(deliveryGroups, `${mode}:${attempt.network}:${attempt.asset}`, {
        at: attempt.preparedAt,
        dimensions: {
          'Asset': attempt.asset,
          'Failure code': attempt.failureCode ?? 'None recorded',
          'Network': attempt.network,
        },
        resource: {
          id: attempt.transactionId,
          label: `Transaction ${attempt.transactionId.slice(0, 8)}`,
          path: `/ops/transactions/${encodeURIComponent(attempt.transactionId)}`,
          type: 'TRANSACTION',
        },
      })
    }
    for (const [groupKey, group] of deliveryGroups) {
      const [mode, network, asset] = groupKey.split(':')
      const isStranded = mode === 'STRANDED'
      detected.push(this.buildDetection({
        // A stranded envelope is past its expiry, so the delivery can never be
        // included on chain: the customer has paid and holds nothing.
        baselineSeverity: isStranded ? OpsIncidentSeverity.CRITICAL : OpsIncidentSeverity.HIGH,
        filters: [{
          label: 'Open affected onramps',
          path: encodeQuery('/ops/transactions', {
            direction: FlowDirection.FIAT_TO_CRYPTO,
            network,
          }),
        }],
        fingerprint: `delivery:${mode}:${network}:${asset}`,
        group,
        kind: 'DELIVERY',
        summary: isStranded
          ? `${group.occurrences} onramp ${asset} deliver${group.occurrences === 1 ? 'y' : 'ies'} on ${network} passed the envelope expiry without confirming and need reconciliation.`
          : `${group.occurrences} onramp ${asset} deliver${group.occurrences === 1 ? 'y' : 'ies'} on ${network} ${mode === 'EXPIRED' ? 'expired' : 'failed'}.`,
        title: isStranded
          ? `Stranded ${asset} onramp deliveries · ${network}`
          : `Failed ${asset} onramp deliveries · ${network}`,
      }))
    }

    const obligationsByWallet = new Map<string, { amount: number, ids: string[] }>()
    for (const transaction of onrampObligations) {
      const key = `${transaction.quote.network}:${transaction.quote.cryptoCurrency}`
      const entry = obligationsByWallet.get(key) ?? { amount: 0, ids: [] }
      entry.amount += Number(transaction.quote.sourceAmount)
      entry.ids.push(transaction.id)
      obligationsByWallet.set(key, entry)
    }
    for (const [key, entry] of obligationsByWallet) {
      const [network, asset] = key.split(':')
      const cell = treasury.cells.find(item => (
        item.venue === `${network}_HOT_WALLET` && item.currency === asset
      ))
      // Only a successful balance read can prove a shortfall; an unreadable
      // venue already raises its own incident and must not be read as zero.
      if (!cell) continue
      const held = cell.availableAmount ?? cell.amount
      if (held >= entry.amount) continue
      const group = this.singleGroup(now, {
        Asset: asset,
        Held: held.toFixed(6),
        Network: network,
        Owed: entry.amount.toFixed(6),
      })
      group.occurrences = entry.ids.length
      detected.push(this.buildDetection({
        baselineSeverity: OpsIncidentSeverity.CRITICAL,
        filters: [{
          label: 'Open treasury venue',
          path: encodeQuery('/ops/treasury', { venue: `${network}_HOT_WALLET` }),
        }],
        fingerprint: `onramp-inventory:${network}:${asset}`,
        group,
        kind: 'TREASURY',
        summary: `${entry.ids.length} accepted onramp${entry.ids.length === 1 ? '' : 's'} owe ${entry.amount.toFixed(6)} ${asset} but the ${network} hot wallet holds ${held.toFixed(6)}.`,
        title: `${asset} onramp delivery float short · ${network}`,
      }))
    }

    for (const venueError of treasury.errors) {
      const group = this.singleGroup(now, { Provider: venueError.venue })
      detected.push(this.buildDetection({
        baselineSeverity: OpsIncidentSeverity.HIGH,
        filters: [{ label: 'Open treasury venue', path: encodeQuery('/ops/treasury', { venue: venueError.venue }) }],
        fingerprint: `treasury-unavailable:${venueError.venue}`,
        group,
        kind: 'PROVIDER',
        summary: `${venueError.venue} did not return a usable balance snapshot; other venue data remains available.`,
        title: `${venueError.venue} balance unavailable`,
      }))
    }
    for (const cell of treasury.cells) {
      if (cell.posture.state !== 'CRITICAL' && cell.posture.state !== 'WARNING') continue
      const group = this.singleGroup(treasury.capturedAt, {
        'Currency': cell.currency,
        'Owner team': cell.posture.ownerTeam ?? 'Unassigned',
        'Venue': cell.venue,
      })
      detected.push(this.buildDetection({
        baselineSeverity: cell.posture.state === 'CRITICAL'
          ? OpsIncidentSeverity.CRITICAL
          : OpsIncidentSeverity.WARNING,
        filters: [{ label: 'Open treasury posture', path: cell.posture.alertPath }],
        fingerprint: `treasury-threshold:${cell.venue}:${cell.currency}`,
        group,
        kind: 'TREASURY',
        summary: `${cell.venue} ${cell.currency} is below its configured available-balance or runway threshold.`,
        title: `${cell.currency} runway alert · ${cell.venue}`,
      }))
    }

    return detected
  }

  public async sync(now = new Date()): Promise<SyncResult> {
    const detections = await this.detect(now)
    const client = await this.databaseClientProvider.getClient()
    return client.$transaction(async (transaction) => {
      const existingRows = await transaction.opsIncident.findMany({
        select: {
          fingerprint: true,
          firstSeenAt: true,
          id: true,
          resolvedAt: true,
          runbookId: true,
          status: true,
        },
        where: { fingerprint: { startsWith: AUTO_FINGERPRINT_PREFIX } },
      })
      const existingByFingerprint = new Map(existingRows.map(row => [row.fingerprint, row]))
      const runbooks = await transaction.opsRunbook.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, incidentKinds: true },
        where: { active: true },
      })
      let created = 0
      let reopened = 0
      const activeFingerprints: string[] = []

      for (const detection of detections) {
        const fingerprint = `${AUTO_FINGERPRINT_PREFIX}${detection.fingerprint}`
        activeFingerprints.push(fingerprint)
        const existing = existingByFingerprint.get(fingerprint)
        const shouldReopen = Boolean(
          existing?.status === OpsWorkStatus.RESOLVED
          && existing.resolvedAt
          && detection.lastSeenAt > existing.resolvedAt,
        )
        const runbookId = existing?.runbookId
          ?? runbooks.find(runbook => runbook.incidentKinds.includes(detection.kind))?.id
          ?? null
        const persisted = await transaction.opsIncident.upsert({
          create: {
            affectedCount: detection.affectedCount,
            context: serializeIncidentContext(detection.context),
            fingerprint,
            firstSeenAt: detection.firstSeenAt,
            kind: detection.kind,
            lastSeenAt: detection.lastSeenAt,
            occurrenceCount: detection.occurrenceCount,
            runbookId,
            severity: detection.severity,
            summary: detection.summary,
            title: detection.title,
          },
          update: {
            affectedCount: detection.affectedCount,
            context: serializeIncidentContext(detection.context),
            firstSeenAt: existing && existing.firstSeenAt < detection.firstSeenAt
              ? existing.firstSeenAt
              : detection.firstSeenAt,
            kind: detection.kind,
            lastSeenAt: detection.lastSeenAt,
            occurrenceCount: detection.occurrenceCount,
            ...(shouldReopen
              ? {
                  acknowledgedAt: null,
                  resolvedAt: null,
                  status: OpsWorkStatus.OPEN,
                  version: { increment: 1 },
                }
              : {}),
            runbookId,
            severity: detection.severity,
            summary: detection.summary,
            title: detection.title,
          },
          where: { fingerprint },
        })
        if (!existing) {
          created += 1
          await this.auditService.recordSystem({
            action: 'incident.detected',
            metadata: { kind: detection.kind, severity: detection.severity },
            resourceId: persisted.id,
            resourceType: 'ops_incident',
          }, transaction)
        }
        else if (shouldReopen) {
          reopened += 1
          await this.auditService.recordSystem({
            action: 'incident.reopened',
            metadata: { kind: detection.kind, severity: detection.severity },
            resourceId: existing.id,
            resourceType: 'ops_incident',
          }, transaction)
        }
      }

      const missing = existingRows.filter(row => (
        row.status !== OpsWorkStatus.RESOLVED
        && !activeFingerprints.includes(row.fingerprint)
      ))
      for (const incident of missing) {
        await transaction.opsIncident.update({
          data: {
            resolvedAt: now,
            status: OpsWorkStatus.RESOLVED,
            version: { increment: 1 },
          },
          where: { id: incident.id },
        })
        await this.auditService.recordSystem({
          action: 'incident.auto_resolved',
          resourceId: incident.id,
          resourceType: 'ops_incident',
        }, transaction)
      }
      return {
        active: detections.length,
        created,
        reopened,
        resolved: missing.length,
      }
    })
  }

  private addToGroup(
    groups: Map<string, GroupAccumulator>,
    key: string,
    input: {
      at: Date
      dimensions: Readonly<Record<string, string>>
      resource?: OpsIncidentAffectedResource
    },
  ): void {
    const existing = groups.get(key) ?? {
      affected: new Map<string, OpsIncidentAffectedResource>(),
      affectedIds: new Set<string>(),
      dimensions: new Map<string, string>(),
      firstSeenAt: input.at,
      lastSeenAt: input.at,
      occurrences: 0,
    }
    existing.firstSeenAt = input.at < existing.firstSeenAt ? input.at : existing.firstSeenAt
    existing.lastSeenAt = input.at > existing.lastSeenAt ? input.at : existing.lastSeenAt
    existing.occurrences += 1
    for (const [label, value] of Object.entries(input.dimensions)) {
      existing.dimensions.set(label, value)
    }
    if (input.resource) {
      const resourceKey = `${input.resource.type}:${input.resource.id}`
      existing.affectedIds.add(resourceKey)
      if (existing.affected.size < MAX_AFFECTED_LINKS) {
        existing.affected.set(resourceKey, input.resource)
      }
    }
    groups.set(key, existing)
  }

  private buildDetection(input: {
    baselineSeverity: OpsIncidentSeverity
    filters: OpsIncidentContext['filters']
    fingerprint: string
    group: GroupAccumulator
    kind: string
    summary: string
    title: string
  }): DetectedIncident {
    return {
      affectedCount: input.group.affectedIds.size,
      context: {
        affected: [...input.group.affected.values()],
        dimensions: [...input.group.dimensions].map(([label, value]) => ({ label, value })),
        filters: input.filters,
      },
      fingerprint: input.fingerprint,
      firstSeenAt: input.group.firstSeenAt,
      kind: input.kind,
      lastSeenAt: input.group.lastSeenAt,
      occurrenceCount: input.group.occurrences,
      severity: severityForCount(input.group.occurrences, input.baselineSeverity),
      summary: input.summary,
      title: input.title,
    }
  }

  private singleGroup(at: Date, dimensions: Readonly<Record<string, string>>): GroupAccumulator {
    return {
      affected: new Map<string, OpsIncidentAffectedResource>(),
      affectedIds: new Set<string>(),
      dimensions: new Map(Object.entries(dimensions)),
      firstSeenAt: at,
      lastSeenAt: at,
      occurrences: 1,
    }
  }
}
