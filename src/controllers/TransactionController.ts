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

import { IPartnerService } from '../interfaces'
import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
import { IPaymentServiceFactory } from '../interfaces/IPaymentServiceFactory'
import { TYPES } from '../types'
import { KycUseCase } from '../useCases/kycUseCase'

interface AcceptTransactionRequest {
  account_number: string
  bank_code: string
  quote_id: string
  user_id: string
}

interface AcceptTransactionResponse {
  id: string
  transaction_reference: string
}

interface TransactionStatusResponse {
  id: string
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
    @inject(TYPES.IPartnerService) private partnerService: IPartnerService,
    @inject(TYPES.IPaymentServiceFactory) private paymentServiceFactory: IPaymentServiceFactory,
    @inject(TYPES.KycUseCase) private kycUseCase: KycUseCase,
  ) {
    super()
  }

  /**
   * Accepts a transaction based on a quote.
   *
   * @param requestBody - Includes the `quote_id`, `user_id`, and local `account_number`.
   * @returns A `transaction_reference` (used on-chain as a memo) and an `expiration_time`.
   */
  @Post()
  @Response<400, { reason: string }>(400, 'Bad Request')
  @SuccessResponse('200', 'Transaction accepted')
  public async acceptTransaction(
    @Body() requestBody: AcceptTransactionRequest,
    @Request() request: RequestExpress,
    @Res() badRequestResponse: TsoaResponse<400, { reason: string }>,
  ): Promise<AcceptTransactionResponse> {
    const {
      account_number: accountNumber,
      bank_code: bankCode,
      quote_id: quoteId,
      user_id: userId,
    } = requestBody

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
      return badRequestResponse(400, { reason: 'User account is invalid or not linked to the payment method' })
    }

    const partnerUser = await prismaClient.partnerUser.upsert({
      create: {
        accountNumber: accountNumber,
        bank: bankCode,
        partnerId: quote.partnerId,
        paymentMethod: quote.paymentMethod,
        userId: userId,
      },
      update: {
        accountNumber: accountNumber,
        bank: bankCode,
        paymentMethod: quote.paymentMethod,
      },
      where: {
        partnerId_userId: {
          partnerId: quote.partnerId,
          userId: userId,
        },
      },
    })

    // TODO: Uncomment this when KYC is implemented
    // const { status } = await this.kycUseCase.getKycStatus({ partnerId: partner.id, userId })

    // if (status !== KycStatus.APPROVED) {
    //   return badRequestResponse(400, { reason: 'KYC not approved' })
    // }

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

    try {
      const transaction = await prismaClient.transaction.create({
        data: {
          accountNumber,
          bankCode,
          partnerUserId: partnerUser.id,
          quoteId: quoteId,
          status: TransactionStatus.AWAITING_PAYMENT,
        },
      })

      return {
        id: transaction.id,
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

    return {
      id: transaction.id,
      on_chain_tx_hash: transaction.onChainId,
      status: transaction.status,
      transaction_reference: transaction_reference,
      user_id: transaction.partnerUser.userId,
    }
  }
}
