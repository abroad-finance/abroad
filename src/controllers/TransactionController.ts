// src/controllers/TransactionController.ts
import {
  Controller,
  Get,
  Path,
  Route,
  Security,
  Response,
  SuccessResponse,
  Request,
} from "tsoa";
import { Post, Body } from "tsoa";
import { TransactionStatus } from "@prisma/client";
import { NotFound } from "http-errors";
import { Request as RequestExpress } from "express";
import { inject } from "inversify";
import { TYPES } from "../types";
import { IDatabaseClientProvider } from "../interfaces/IDatabaseClientProvider";
import { IPartnerService } from "../interfaces";

interface TransactionStatusResponse {
  transaction_reference: string;
  status: TransactionStatus;
  on_chain_tx_hash: string | null;
  id: string;
  user_id: string;
}

interface AcceptTransactionRequest {
  quote_id: string;
  user_id: string;
  account_number: string;
}

interface AcceptTransactionResponse {
  transaction_reference: string;
  id: string;
}

function uuidToBase64(uuid: string): string {
  // Remove hyphens from the UUID
  const hex = uuid.replace(/-/g, "");
  // Convert hex string to a Buffer
  const buffer = Buffer.from(hex, "hex");
  // Encode the Buffer to a Base64 string
  return buffer.toString("base64");
}

@Route("transaction")
@Security("ApiKeyAuth")
export class TransactionController extends Controller {
  constructor(
    @inject(TYPES.IDatabaseClientProvider)
    private prismaClientProvider: IDatabaseClientProvider,
    @inject(TYPES.IPartnerService) private partnerService: IPartnerService,
  ) {
    super();
  }

  /**
   * Retrieves the status of a transaction by its id.
   *
   * @param transactionId - The unique transaction id
   * @returns The transaction status, on-chain tx hash.
   */
  @Get("{transactionId}")
  @SuccessResponse("200", "Transaction status retrieved")
  @Response("400", "Bad Request")
  @Response("401", "Unauthorized")
  @Response("404", "Not Found")
  @Response("500", "Internal Server Error")
  public async getTransactionStatus(
    @Path() transactionId: string,
    @Request() request: RequestExpress,
  ): Promise<TransactionStatusResponse> {
    const partner = await this.partnerService.getPartnerFromRequest(request);

    const prismaClient = await this.prismaClientProvider.getClient();
    const transaction = await prismaClient.transaction.findUnique({
      where: { id: transactionId },
      include: {
        quote: true,
        partnerUser: true,
      },
    });

    if (!transaction) {
      throw new NotFound("Transaction not found");
    }

    if (transaction.quote.partnerId !== partner.id) {
      throw new NotFound("Transaction not found");
    }

    const transaction_reference = uuidToBase64(transaction.id);

    return {
      transaction_reference: transaction_reference,
      status: transaction.status,
      on_chain_tx_hash: transaction.onChainId,
      id: transaction.id,
      user_id: transaction.partnerUser.userId,
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
    const prismaClient = await this.prismaClientProvider.getClient();

    const transaction = await prismaClient.$transaction(async (prisma) => {
      const quote = await prisma.quote.findUnique({
        where: { id: quoteId },
      });

      if (!quote) {
        throw new NotFound("Quote not found");
      }

      const partnerUser = await prisma.partnerUser.upsert({
        where: {
          partnerId_userId: {
            partnerId: quote.partnerId,
            userId: userId,
          },
        },
        create: {
          partnerId: quote.partnerId,
          userId: userId,
        },
        update: {},
      });

      const transaction = await prisma.transaction.create({
        data: {
          accountNumber,
          status: TransactionStatus.AWAITING_PAYMENT,
          partnerUserId: partnerUser.id,
          quoteId: quoteId,
        },
      });

      return {
        ...transaction,
        reference: uuidToBase64(transaction.id),
      };
    });

    return {
      transaction_reference: transaction.reference,
      id: transaction.id,
    };
  }
}
