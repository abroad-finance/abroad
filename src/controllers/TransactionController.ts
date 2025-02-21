// src/controllers/TransactionController.ts
import {
  Controller,
  Get,
  Path,
  Route,
  Security,
  Response,
  SuccessResponse,
} from "tsoa";
import { Post, Body } from "tsoa";
import { TransactionStatus } from "@prisma/client";
import { NotFound } from "http-errors";
import { prismaClientProvider } from "../container";

interface TransactionStatusResponse {
  transaction_reference: string;
  status: string;
  on_chain_tx_hash: string | null;
}

interface AcceptTransactionRequest {
  quote_id: string;
  user_id: string;
  account_number: string;
}

interface AcceptTransactionResponse {
  transaction_reference: string;
}

@Route("transaction")
@Security("ApiKeyAuth")
export class TransactionController extends Controller {
  /**
   * Retrieves the status of a transaction by its reference.
   *
   * @param transactionReference - The unique transaction reference
   * @returns The transaction status, on-chain tx hash.
   */
  @Get("{transactionReference}")
  @SuccessResponse("200", "Transaction status retrieved")
  @Response("400", "Bad Request")
  @Response("401", "Unauthorized")
  @Response("404", "Not Found")
  @Response("500", "Internal Server Error")
  public async getTransactionStatus(
    @Path() transactionReference: string,
  ): Promise<TransactionStatusResponse> {
    const prismaClient = await prismaClientProvider.getClient();
    const transaction = await prismaClient.transaction.findUnique({
      where: { id: transactionReference },
    });

    if (!transaction) {
      throw new NotFound("Transaction not found");
    }

    return {
      transaction_reference: transaction.id,
      status: transaction.status,
      on_chain_tx_hash: transaction.onChainId,
    };
  }

  /**
   * Accepts a transaction based on a quote.
   *
   * @param requestBody - Includes the `quote_id`, `user_id`, and local `account_number`.
   * @returns A `transaction_reference` (used on-chain as a memo) and an `expiration_time`.
   */
  @Post()
  @SuccessResponse("200", "Transaction accepted")
  @Response("400", "Bad Request")
  @Response("401", "Unauthorized")
  @Response("404", "Not Found")
  @Response("500", "Internal Server Error")
  public async acceptTransaction(
    @Body() requestBody: AcceptTransactionRequest,
  ): Promise<AcceptTransactionResponse> {
    const {
      quote_id: quoteId,
      user_id: userId,
      account_number: accountNumber,
    } = requestBody;
    const prismaClient = await prismaClientProvider.getClient();
    const transaction = await prismaClient.transaction.create({
      data: {
        accountNumber,
        status: TransactionStatus.AWAITING_PAYMENT,
        partnerUserId: userId,
        quoteId: quoteId,
      },
    });

    return {
      transaction_reference: transaction.id,
    };
  }
}
