// src/controllers/TransactionController.ts

import { Request as RequestExpress } from 'express'
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

import { TransactionAcceptanceService, TransactionValidationError } from '../services/TransactionAcceptanceService'
import { TransactionStatusService } from '../services/TransactionStatusService'
import { TYPES } from '../types'
import { type AcceptTransactionRequest, acceptTransactionRequestSchema, type AcceptTransactionResponse, type TransactionStatusResponse } from './transaction/contracts'

@Route('transaction')
@Security('ApiKeyAuth')
@Security('BearerAuth')
export class TransactionController extends Controller {
  private readonly transactionAcceptanceService: TransactionAcceptanceService
  private readonly transactionStatusService: TransactionStatusService
  constructor(
    @inject(TYPES.TransactionAcceptanceService)
    transactionAcceptanceService: TransactionAcceptanceService,
    @inject(TYPES.TransactionStatusService)
    transactionStatusService: TransactionStatusService,
  ) {
    super()
    this.transactionAcceptanceService = transactionAcceptanceService
    this.transactionStatusService = transactionStatusService
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
    const partnerContext = {
      id: String(partner.id),
      isKybApproved: Boolean(partner.isKybApproved),
      needsKyc: Boolean(partner.needsKyc),
      webhookUrl: typeof partner.webhookUrl === 'string' ? partner.webhookUrl : '',
    }

    try {
      const response = await this.transactionAcceptanceService.acceptTransaction(
        {
          accountNumber,
          bankCode,
          qrCode,
          quoteId,
          redirectUrl,
          taxId,
          userId,
        },
        partnerContext,
      )

      return {
        id: response.id,
        kycLink: response.kycLink,
        transaction_reference: response.transactionReference,
      }
    }
    catch (error) {
      if (error instanceof TransactionValidationError) {
        return badRequestResponse(400, { reason: error.reason })
      }
      throw error
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
    const partnerId = String(request.user.id)
    const status = await this.transactionStatusService.getStatus(transactionId, partnerId)

    return {
      id: status.id,
      kycLink: status.kycLink,
      on_chain_tx_hash: status.onChainTxHash,
      status: status.status,
      transaction_reference: status.transactionReference,
      user_id: status.userId,
    }
  }
}
