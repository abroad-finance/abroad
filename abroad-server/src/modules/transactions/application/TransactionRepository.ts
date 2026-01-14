import { Prisma, PrismaClient, TransactionStatus } from '@prisma/client'

import { IDatabaseClientProvider } from '../../../platform/persistence/IDatabaseClientProvider'
import { transactionNotificationInclude, TransactionWithRelations } from './transactionNotificationTypes'
import { InvalidTransactionTransitionError, resolveTransition, TransactionTransitionName } from './TransactionStateMachine'

export type RefundAttemptResult
  = | { reason?: string, success: false, transactionId?: string }
    | { success: true, transactionId?: string }

export type RefundReservation
  = | { attempts: number, outcome: 'in_flight' }
    | { attempts: number, outcome: 'reserved' }
    | { outcome: 'already_refunded', refundOnChainId?: string }
    | { outcome: 'missing' }

type RefundContext = {
  attempts: number
  lastError?: string
  reason?: string
  refundTransactionId?: string
  status: 'failed' | 'pending' | 'succeeded'
  trigger?: string
}

type TransactionClient = Awaited<ReturnType<IDatabaseClientProvider['getClient']>> | Prisma.TransactionClient

export class TransactionRepository {
  public constructor(private readonly dbProvider: IDatabaseClientProvider) {}

  public async applyDepositReceived(
    prismaClient: TransactionClient,
    params: {
      idempotencyKey: string
      onChainId: string
      transactionId: string
    },
  ): Promise<TransactionWithRelations | undefined> {
    const updated = await this.applyTransition(prismaClient, {
      data: {
        onChainId: params.onChainId,
      },
      idempotencyKey: params.idempotencyKey,
      name: 'deposit_received',
      transactionId: params.transactionId,
    })

    return updated ?? undefined
  }

  public async applyExpiration(
    prismaClient: TransactionClient,
    params: { idempotencyKey: string, transactionId: string },
  ): Promise<null | TransactionWithRelations> {
    return this.applyTransition(prismaClient, {
      idempotencyKey: params.idempotencyKey,
      name: 'expired',
      transactionId: params.transactionId,
    })
  }

  public async applyTransition(
    prismaClient: TransactionClient,
    params: {
      context?: Prisma.InputJsonValue
      data?: Prisma.TransactionUpdateInput
      idempotencyKey: string
      name: TransactionTransitionName
      transactionId: string
    },
  ): Promise<null | TransactionWithRelations> {
    return this.withTransaction(prismaClient, async (tx) => {
      const existing = await tx.transactionTransition.findUnique({
        where: {
          transactionId_idempotencyKey: {
            idempotencyKey: params.idempotencyKey,
            transactionId: params.transactionId,
          },
        },
      })
      if (existing) {
        return this.loadTransaction(tx, params.transactionId)
      }

      const current = await tx.transaction.findUnique({
        include: transactionNotificationInclude,
        where: { id: params.transactionId },
      })
      if (!current) return null

      let toStatus: TransactionStatus
      try {
        toStatus = resolveTransition(current.status, params.name)
      }
      catch (error) {
        if (error instanceof InvalidTransactionTransitionError) {
          return null
        }
        throw error
      }

      const updated = await tx.transaction.update({
        data: {
          ...params.data,
          status: toStatus,
        },
        include: transactionNotificationInclude,
        where: { id: params.transactionId },
      })

      await tx.transactionTransition.create({
        data: {
          context: params.context,
          event: params.name,
          fromStatus: current.status,
          idempotencyKey: params.idempotencyKey,
          toStatus,
          transactionId: params.transactionId,
        },
      })

      return updated
    })
  }

  public async findByExternalId(externalId: string): Promise<null | TransactionWithRelations> {
    const client = await this.dbProvider.getClient()
    return client.transaction.findUnique({
      include: transactionNotificationInclude,
      where: { externalId },
    })
  }

  public async findRefundState(transactionId: string): Promise<null | {
    id: string
    onChainId: null | string
    refundOnChainId: null | string
    status: TransactionStatus
  }> {
    const client = await this.dbProvider.getClient()
    return client.transaction.findUnique({
      select: {
        id: true,
        onChainId: true,
        refundOnChainId: true,
        status: true,
      },
      where: { id: transactionId },
    })
  }

  public async getClient(): Promise<Awaited<ReturnType<IDatabaseClientProvider['getClient']>>> {
    return this.dbProvider.getClient()
  }

  public async markExchangeHandoff(
    prismaClient: TransactionClient,
    transactionId: string,
  ): Promise<void> {
    await prismaClient.transaction.updateMany({
      data: { exchangeHandoffAt: new Date() },
      where: { exchangeHandoffAt: null, id: transactionId },
    })
  }

  public async persistExternalId(
    prismaClient: TransactionClient,
    transactionId: string,
    externalId: string,
  ): Promise<void> {
    await prismaClient.transaction.update({
      data: { externalId },
      where: { id: transactionId },
    })
  }

  public async recordOnChainIdIfMissing(
    prismaClient: TransactionClient,
    transactionId: string,
    onChainId: string,
  ): Promise<boolean> {
    const result = await prismaClient.transaction.updateMany({
      data: { onChainId },
      where: { id: transactionId, onChainId: null },
    })
    return result.count > 0
  }

  public async recordRefundOnChainId(
    prismaClient: TransactionClient,
    transactionId: string,
    refundTransactionId: string,
  ): Promise<void> {
    await prismaClient.transaction.updateMany({
      data: { refundOnChainId: refundTransactionId },
      where: { id: transactionId, refundOnChainId: null },
    })
  }

  public async recordRefundOutcome(
    prismaClient: TransactionClient,
    params: { idempotencyKey: string, refundResult: RefundAttemptResult, transactionId: string },
  ): Promise<void> {
    await this.withTransaction(prismaClient, async (tx) => {
      const transaction = await tx.transaction.findUnique({
        select: { refundOnChainId: true, status: true },
        where: { id: params.transactionId },
      })

      if (!transaction) {
        return
      }

      const existingTransition = await tx.transactionTransition.findUnique({
        where: {
          transactionId_idempotencyKey: {
            idempotencyKey: params.idempotencyKey,
            transactionId: params.transactionId,
          },
        },
      })

      const context = this.parseRefundContext(existingTransition?.context)
      const status: RefundContext['status'] = params.refundResult.success ? 'succeeded' : 'failed'
      const attempts = context.attempts > 0 ? context.attempts : 1
      const updatedContext: RefundContext = {
        ...context,
        attempts,
        lastError: params.refundResult.success ? undefined : params.refundResult.reason ?? context.lastError,
        reason: context.reason,
        refundTransactionId: params.refundResult.success
          ? params.refundResult.transactionId ?? context.refundTransactionId
          : context.refundTransactionId,
        status,
      }

      await tx.transactionTransition.upsert({
        create: {
          context: this.serializeRefundContext(updatedContext),
          event: 'refund',
          fromStatus: transaction.status,
          idempotencyKey: params.idempotencyKey,
          toStatus: transaction.status,
          transactionId: params.transactionId,
        },
        update: {
          context: this.serializeRefundContext(updatedContext),
          fromStatus: existingTransition?.fromStatus ?? transaction.status,
          toStatus: existingTransition?.toStatus ?? transaction.status,
        },
        where: {
          transactionId_idempotencyKey: {
            idempotencyKey: params.idempotencyKey,
            transactionId: params.transactionId,
          },
        },
      })

      if (params.refundResult.success && params.refundResult.transactionId) {
        await tx.transaction.updateMany({
          data: { refundOnChainId: params.refundResult.transactionId },
          where: { id: params.transactionId, refundOnChainId: null },
        })
      }
    })
  }

  public async reserveRefund(
    prismaClient: TransactionClient,
    params: { idempotencyKey: string, reason: string, transactionId: string, trigger?: string },
  ): Promise<RefundReservation> {
    return this.withTransaction(prismaClient, async (tx) => {
      const transaction = await tx.transaction.findUnique({
        select: { id: true, refundOnChainId: true, status: true },
        where: { id: params.transactionId },
      })

      if (!transaction) {
        return { outcome: 'missing' }
      }

      if (transaction.refundOnChainId) {
        return { outcome: 'already_refunded', refundOnChainId: transaction.refundOnChainId }
      }

      const existingTransition = await tx.transactionTransition.findUnique({
        where: {
          transactionId_idempotencyKey: {
            idempotencyKey: params.idempotencyKey,
            transactionId: params.transactionId,
          },
        },
      })

      if (!existingTransition) {
        await tx.transactionTransition.create({
          data: {
            context: this.serializeRefundContext({
              attempts: 1,
              reason: params.reason,
              status: 'pending',
              trigger: params.trigger,
            }),
            event: 'refund',
            fromStatus: transaction.status,
            idempotencyKey: params.idempotencyKey,
            toStatus: transaction.status,
            transactionId: params.transactionId,
          },
        })

        return { attempts: 1, outcome: 'reserved' }
      }

      const context = this.parseRefundContext(existingTransition.context)
      if (context.status === 'pending') {
        return { attempts: context.attempts, outcome: 'in_flight' }
      }

      if (context.status === 'succeeded') {
        return {
          attempts: context.attempts,
          outcome: 'already_refunded',
          refundOnChainId: context.refundTransactionId ?? transaction.refundOnChainId ?? undefined,
        }
      }

      const attempts = context.attempts + 1
      await tx.transactionTransition.update({
        data: {
          context: this.serializeRefundContext({
            ...context,
            attempts,
            lastError: context.lastError,
            reason: params.reason ?? context.reason,
            status: 'pending',
            trigger: params.trigger ?? context.trigger,
          }),
          fromStatus: existingTransition.fromStatus,
          toStatus: existingTransition.toStatus,
        },
        where: {
          transactionId_idempotencyKey: {
            idempotencyKey: params.idempotencyKey,
            transactionId: params.transactionId,
          },
        },
      })

      return { attempts, outcome: 'reserved' }
    })
  }

  public async updateStatus(
    prismaClient: TransactionClient,
    transactionId: string,
    status: TransactionStatus,
  ): Promise<TransactionWithRelations> {
    return prismaClient.transaction.update({
      data: { status },
      include: transactionNotificationInclude,
      where: { id: transactionId },
    })
  }

  private async loadTransaction(
    prismaClient: TransactionClient,
    transactionId: string,
  ): Promise<null | TransactionWithRelations> {
    return prismaClient.transaction.findUnique({
      include: transactionNotificationInclude,
      where: { id: transactionId },
    })
  }

  private parseRefundContext(raw: null | Prisma.JsonValue | undefined): RefundContext {
    if (!raw || typeof raw !== 'object') {
      return { attempts: 0, status: 'pending' }
    }

    const context = raw as Record<string, unknown>
    const attempts = Number.isFinite(context.attempts) ? Number(context.attempts) : 0
    const status = context.status === 'succeeded' || context.status === 'failed' ? context.status : 'pending'

    const refundTransactionId = typeof context.refundTransactionId === 'string' ? context.refundTransactionId : undefined
    const reason = typeof context.reason === 'string' ? context.reason : undefined
    const trigger = typeof context.trigger === 'string' ? context.trigger : undefined
    const lastError = typeof context.lastError === 'string' ? context.lastError : undefined

    return {
      attempts,
      lastError,
      reason,
      refundTransactionId,
      status,
      trigger,
    }
  }

  private serializeRefundContext(context: RefundContext): Prisma.InputJsonValue {
    return {
      attempts: context.attempts,
      ...(context.lastError !== undefined ? { lastError: context.lastError } : {}),
      ...(context.reason !== undefined ? { reason: context.reason } : {}),
      ...(context.refundTransactionId !== undefined ? { refundTransactionId: context.refundTransactionId } : {}),
      status: context.status,
      ...(context.trigger !== undefined ? { trigger: context.trigger } : {}),
    }
  }

  private async withTransaction<T>(
    client: TransactionClient,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const maybeClient = client as Prisma.TransactionClient & { $transaction?: PrismaClient['$transaction'] }
    if (typeof maybeClient.$transaction === 'function') {
      return maybeClient.$transaction(fn)
    }
    return fn(maybeClient)
  }
}
