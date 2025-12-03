// src/controllers/TransactionController.ts

import { TransactionStatus } from '@prisma/client'
import { Request as RequestExpress } from 'express'
import { NotFound } from 'http-errors'
import { inject } from 'inversify'
import {
  Controller,
  Get,
  Path,
  Request,
  Res,
  Response,
  Route,
  Security,
  SuccessResponse,
  TsoaResponse,
} from 'tsoa'
import { Body, Post } from 'tsoa'
import { z } from 'zod'

import { IQueueHandler, QueueName } from '../interfaces'
import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
import { IKycService } from '../interfaces/IKycService'
import { IPaymentServiceFactory } from '../interfaces/IPaymentServiceFactory'
import { IWebhookNotifier, WebhookEvent } from '../interfaces/IWebhookNotifier'
import { TYPES } from '../types'

const acceptTransactionRequestSchema = z.object({
  account_number: z.string().min(1, 'Account number is required'),
  bank_code: z.string().min(1, 'Bank code is required'),
  qr_code: z.string().nullable().optional(),
  quote_id: z.string().min(1, 'Quote ID is required'),
  redirectUrl: z.string().optional(),
  tax_id: z.string().optional(),
  user_id: z.string().min(1, 'User ID is required'),
})

interface AcceptTransactionRequest {
  account_number: string
  bank_code: string
  qr_code?: null | string
  quote_id: string
  redirectUrl?: string
  tax_id?: string
  user_id: string
}

interface AcceptTransactionResponse {
  id: null | string
  kycLink: null | string
  transaction_reference: null | string
}

interface TransactionStatusResponse {
  id: string
  kycLink: null | string
  on_chain_tx_hash: null | string
  status: TransactionStatus
  transaction_reference: string
  user_id: string
}

function uuidToBase64(uuid: string): string {
  // Remove hyphens from the UUID
  const hex = uuid.replace(/-/g, '')
  // Convert hex string to a Buffer
  const buffer = Buffer.from(hex, 'hex')
  // Encode the Buffer to a Base64 string
  return buffer.toString('base64')
}

@Route('transaction')
@Security('ApiKeyAuth')
@Security('BearerAuth')
export class TransactionController extends Controller {
  constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private prismaClientProvider: IDatabaseClientProvider,
    @inject(TYPES.IPaymentServiceFactory) private paymentServiceFactory: IPaymentServiceFactory,
    @inject(TYPES.IKycService) private kycService: IKycService,
    @inject(TYPES.IWebhookNotifier) private webhookNotifier: IWebhookNotifier,
    @inject(TYPES.IQueueHandler) private queueHandler: IQueueHandler,
  ) {
    super()
  }

  /**
   * Accepts a transaction based on a quote.
   *
   * @param requestBody - Includes the `quote_id`, `user_id`, and local `account_number`.
   * @returns A `transaction_reference` (used for on-chain matching) and an `expiration_time`.
   */
  @Post()
  @Response<400, { reason: string }>(400, 'Bad Request')
  @SuccessResponse('200', 'Transaction accepted')
  public async acceptTransaction(
    @Body() requestBody: AcceptTransactionRequest,
    @Request() request: RequestExpress,
    @Res() badRequestResponse: TsoaResponse<400, { reason: string }>,
  ): Promise<AcceptTransactionResponse> {
    const parsed = acceptTransactionRequestSchema.safeParse(requestBody)
    if (!parsed.success) {
      return badRequestResponse(400, { reason: parsed.error.message })
    }
    const {
      account_number: accountNumber,
      bank_code: bankCode,
      qr_code: qrCode,
      quote_id: quoteId,
      redirectUrl: redirectUrl,
      tax_id: taxId,
      user_id: userId,
    } = parsed.data

    const partner = request.user

    const prismaClient = await this.prismaClientProvider.getClient()

    const quote = await prismaClient.quote.findUnique({
      where: { id: quoteId, partnerId: partner.id },
    })

    if (!quote) {
      return badRequestResponse(400, { reason: 'Quote not found' })
    }

    const paymentService = this.paymentServiceFactory.getPaymentService(quote.paymentMethod)
    const isAccountValid = await paymentService.verifyAccount({ account: accountNumber, bankCode })

    if (!isAccountValid) {
      return badRequestResponse(400, { reason: 'User account is invalid.' })
    }

    const partnerUser = await prismaClient.partnerUser.upsert({
      create: {
        partnerId: quote.partnerId,
        userId: userId,
      },
      update: {
      },
      where: {
        partnerId_userId: {
          partnerId: quote.partnerId,
          userId: userId,
        },
      },
    })

    const userTransactionsMonthly = await prismaClient.transaction.findMany({
      include: { quote: true },
      where: {
        createdAt: {
          gte: new Date(new Date().setDate(new Date().getDate() - 30)),
        },
        partnerUserId: partnerUser.id,
        quote: {
          paymentMethod: quote.paymentMethod,
        },
        status: TransactionStatus.PAYMENT_COMPLETED,
      },
    })

    const totalUserAmountMonthly = userTransactionsMonthly.reduce((acc, transaction) => acc + transaction.quote.sourceAmount, 0) + quote.sourceAmount
    const link = await this.kycService.getKycLink({
      amount: totalUserAmountMonthly,
      country: quote.country,
      redirectUrl: redirectUrl,
      userId: partnerUser.id,
    })

    if (partner.needsKyc && link) {
      return {
        id: null,
        kycLink: link,
        transaction_reference: null,
      }
    }

    const userTransactionsToday = await prismaClient.transaction.findMany({
      include: { quote: true },
      where: {
        createdAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
        },
        partnerUserId: partnerUser.id,
        quote: {
          paymentMethod: quote.paymentMethod,
        },
        status: TransactionStatus.PAYMENT_COMPLETED,
      },
    })

    if (userTransactionsToday.length >= paymentService.MAX_USER_TRANSACTIONS_PER_DAY) {
      return badRequestResponse(400, { reason: 'User has reached the maximum number of transactions for today' })
    }

    const totalUserAmount = userTransactionsToday.reduce((acc, transaction) => acc + transaction.quote.targetAmount, 0)

    if (totalUserAmount + quote.targetAmount > paymentService.MAX_TOTAL_AMOUNT_PER_DAY) {
      return badRequestResponse(400, { reason: 'User has reached the maximum amount for today' })
    }

    const transactionsToday = await prismaClient.transaction.findMany({
      include: { quote: true },
      where: {
        createdAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
        },
        quote: {
          paymentMethod: quote.paymentMethod,
        },
        status: TransactionStatus.PAYMENT_COMPLETED,
      },
    })

    const totalAmountToday = transactionsToday.reduce((acc, transaction) => acc + transaction.quote.targetAmount, 0)

    if (totalAmountToday + quote.targetAmount > paymentService.MAX_TOTAL_AMOUNT_PER_DAY) {
      return badRequestResponse(400, { reason: 'This payment method has reached the maximum amount for today' })
    }

    let availableLiquidity = 0
    try {
      availableLiquidity = await paymentService.getLiquidity()
    }
    catch (err) {
      console.warn('Failed to fetch payment service liquidity', err)
      availableLiquidity = 0
    }

    if (quote.targetAmount > availableLiquidity) {
      return badRequestResponse(400, { reason: 'This payment method does not have enough liquidity for the requested amount' })
    }

    // Enforce max total for partners without KYB approval
    if (!partner.isKybApproved) {
      const partnerTransactions = await prismaClient.transaction.findMany({
        include: { partnerUser: true, quote: true },
        where: {
          partnerUser: { partnerId: partner.id },
          status: TransactionStatus.PAYMENT_COMPLETED,
        },
      })
      const partnerTotalAmount = partnerTransactions.reduce((sum, tx) => sum + tx.quote.sourceAmount, 0)
      if (partnerTotalAmount + quote.sourceAmount > 100) {
        return badRequestResponse(400, { reason: 'Partner KYB not approved. Maximum total amount of $100 allowed.' })
      }
    }

    try {
      const transaction = await prismaClient.transaction.create({
        data: {
          accountNumber,
          bankCode,
          partnerUserId: partnerUser.id,
          qrCode,
          quoteId: quoteId,
          status: TransactionStatus.AWAITING_PAYMENT,
          taxId,
        },
      })
      this.webhookNotifier.notifyWebhook(partner.webhookUrl, { data: transaction, event: WebhookEvent.TRANSACTION_CREATED })

      // Publish websocket notification with full transaction payload
      try {
        const full = await prismaClient.transaction.findUnique({
          include: {
            partnerUser: { include: { partner: true } },
            quote: true,
          },
          where: { id: transaction.id },
        })
        await this.queueHandler.postMessage(QueueName.USER_NOTIFICATION, {
          payload: JSON.stringify(full ?? transaction),
          type: 'transaction.created',
          userId: partnerUser.userId,
        })
      }
      catch (notifyErr) {
        console.warn('[TransactionController] Failed to publish transaction.created notification', notifyErr)
      }

      return {
        id: transaction.id,
        kycLink: null,
        transaction_reference: uuidToBase64(transaction.id),
      }
    }
    catch (error) {
      console.warn('Error creating transaction:', error)
      return badRequestResponse(400, { reason: 'Transaction creation failed' })
    }
  }

  /**
   * Retrieves the status of a transaction by its id.
   *
   * @param transactionId - The unique transaction id
   * @returns The transaction status, on-chain tx hash.
   */
  @Get('{transactionId}')
  @Response('400', 'Bad Request')
  @Response('401', 'Unauthorized')
  @Response('404', 'Not Found')
  @Response('500', 'Internal Server Error')
  @SuccessResponse('200', 'Transaction status retrieved')
  public async getTransactionStatus(
    @Path() transactionId: string,
    @Request() request: RequestExpress,
  ): Promise<TransactionStatusResponse> {
    const partner = request.user

    const prismaClient = await this.prismaClientProvider.getClient()
    const transaction = await prismaClient.transaction.findUnique({
      include: {
        partnerUser: true,
        quote: true,
      },
      where: { id: transactionId },
    })

    if (!transaction) {
      throw new NotFound('Transaction not found')
    }

    if (transaction.quote.partnerId !== partner.id) {
      throw new NotFound('Transaction not found')
    }

    const transaction_reference = uuidToBase64(transaction.id)

    const kyc = await prismaClient.partnerUserKyc.findFirst({
      orderBy: { createdAt: 'desc' },
      where: { partnerUserId: transaction.partnerUserId },
    })

    return {
      id: transaction.id,
      kycLink: kyc?.status !== 'APPROVED' ? kyc?.link ?? null : null,
      on_chain_tx_hash: transaction.onChainId,
      status: transaction.status,
      transaction_reference: transaction_reference,
      user_id: transaction.partnerUser.userId,
    }
  }
}
