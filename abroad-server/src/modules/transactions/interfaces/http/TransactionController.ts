// src/modules/transactions/interfaces/http/TransactionController.ts
import { TransactionOrigin } from '@prisma/client'
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

import { TYPES } from '../../../../app/container/types'
import { requireAuthenticatedPartner } from '../../../../app/http/authenticationContext'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'
import { PaymentContextService } from '../../../payments/application/PaymentContextService'
import { TransactionAcceptanceService, TransactionValidationError } from '../../application/TransactionAcceptanceService'
import { TransactionStatusService } from '../../application/TransactionStatusService'
import { type AcceptTransactionRequest, acceptTransactionRequestSchema, type AcceptTransactionResponse, type TransactionStatusResponse } from './contracts'

@Route('transaction')
export class TransactionController extends Controller {
  private readonly paymentContextService: PaymentContextService
  private readonly transactionAcceptanceService: TransactionAcceptanceService
  private readonly transactionStatusService: TransactionStatusService
  constructor(
    @inject(TYPES.TransactionAcceptanceService)
    transactionAcceptanceService: TransactionAcceptanceService,
    @inject(TYPES.TransactionStatusService)
    transactionStatusService: TransactionStatusService,
    @inject(PaymentContextService)
    paymentContextService: PaymentContextService,
    @inject(TYPES.IDatabaseClientProvider)
    private readonly dbProvider: IDatabaseClientProvider,
  ) {
    super()
    this.transactionAcceptanceService = transactionAcceptanceService
    this.transactionStatusService = transactionStatusService
    this.paymentContextService = paymentContextService
  }

  /**
   * Accepts a transaction based on a quote.
   *
   * @param requestBody - Includes the `quote_id`, `user_id`, and local `account_number`.
   * @returns A `transaction_reference` (used for on-chain matching) and an `expiration_time`.
   */
  @Post()
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Security('ApiKeyAuth', ['transactions:write'])
  @Security('BearerAuth')
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
      qr_code: qrCode,
      quote_id: quoteId,
      redirectUrl: redirectUrl,
      tax_id: taxId,
      user_id: userId,
    } = parsed.data
    const normalizedAccountNumber = accountNumber?.trim() ?? ''
    const normalizedQrCode = qrCode?.trim() || null

    const partner = requireAuthenticatedPartner(request.user)
    const partnerContext = {
      id: String(partner.id),
      isKybApproved: Boolean(partner.isKybApproved),
      needsKyc: Boolean(partner.needsKyc),
      origin: partner.authenticationSource === 'SEP_24'
        ? TransactionOrigin.SEP_24
        : TransactionOrigin.DIRECT,
      webhookUrl: typeof partner.webhookUrl === 'string' ? partner.webhookUrl : '',
    }

    try {
      const response = await this.transactionAcceptanceService.acceptTransaction(
        {
          accountNumber: normalizedAccountNumber,
          qrCode: normalizedQrCode,
          quoteId,
          redirectUrl,
          taxId,
          userId,
        },
        partnerContext,
      )

      const paymentContext = response.id && !response.kycRequired
        ? await this.buildPaymentContext(response.id, response.transactionReference)
        : null

      return {
        id: response.id,
        kycRequired: response.kycRequired,
        payment_context: paymentContext,
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
  @Security('ApiKeyAuth', ['transactions:read'])
  @Security('BearerAuth')
  @SuccessResponse('200', 'Transaction status retrieved')
  public async getTransactionStatus(
    @Path() transactionId: string,
    @Request() request: RequestExpress,
  ): Promise<TransactionStatusResponse> {
    const partnerId = String(requireAuthenticatedPartner(request.user).id)
    const status = await this.transactionStatusService.getStatus(transactionId, partnerId)

    return {
      id: status.id,
      kycRequired: status.kycRequired,
      on_chain_tx_hash: status.onChainTxHash,
      status: status.status,
      transaction_reference: status.transactionReference,
      user_id: status.userId,
    }
  }

  private async buildPaymentContext(transactionId: string, transactionReference: null | string) {
    const prisma = await this.dbProvider.getClient()
    const transaction = await prisma.transaction.findUnique({
      include: { quote: true },
      where: { id: transactionId },
    })

    if (!transaction) {
      return null
    }

    return this.paymentContextService.build({
      amount: transaction.quote.sourceAmount,
      blockchain: transaction.quote.network,
      cryptoCurrency: transaction.quote.cryptoCurrency,
      transactionReference,
    })
  }
}
