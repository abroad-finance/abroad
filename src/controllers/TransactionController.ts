import { TransactionStatus } from '@prisma/client'
import { Request as RequestExpress } from 'express'
import { NotFound } from 'http-errors'
import { inject } from 'inversify'
// src/controllers/TransactionController.ts
import {
  Controller,
  Get,
  Path,
  Request,
  Response,
  Route,
  Security,
  SuccessResponse,
} from 'tsoa'
import { Body, Post } from 'tsoa'

import { IPartnerService } from '../interfaces'
import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
import { TYPES } from '../types'

interface AcceptTransactionRequest {
  account_number: string
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
export class TransactionController extends Controller {
  constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private prismaClientProvider: IDatabaseClientProvider,
    @inject(TYPES.IPartnerService) private partnerService: IPartnerService,
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
  @Response('400', 'Bad Request')
  @Response('401', 'Unauthorized')
  @Response('404', 'Not Found')
  @Response('500', 'Internal Server Error')
  @SuccessResponse('200', 'Transaction accepted')
  public async acceptTransaction(
    @Body() requestBody: AcceptTransactionRequest,
  ): Promise<AcceptTransactionResponse> {
    const {
      account_number: accountNumber,
      quote_id: quoteId,
      user_id: userId,
    } = requestBody
    const prismaClient = await this.prismaClientProvider.getClient()

    const transaction = await prismaClient.$transaction(async (prisma) => {
      const quote = await prisma.quote.findUnique({
        where: { id: quoteId },
      })

      if (!quote) {
        throw new NotFound('Quote not found')
      }

      const partnerUser = await prisma.partnerUser.upsert({
        create: {
          partnerId: quote.partnerId,
          userId: userId,
        },
        update: {},
        where: {
          partnerId_userId: {
            partnerId: quote.partnerId,
            userId: userId,
          },
        },
      })

      const transaction = await prisma.transaction.create({
        data: {
          accountNumber,
          partnerUserId: partnerUser.id,
          quoteId: quoteId,
          status: TransactionStatus.AWAITING_PAYMENT,
        },
      })

      return {
        ...transaction,
        reference: uuidToBase64(transaction.id),
      }
    })

    return {
      id: transaction.id,
      transaction_reference: transaction.reference,
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
    const partner = await this.partnerService.getPartnerFromRequest(request)

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
