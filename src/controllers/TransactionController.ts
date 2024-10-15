import { Body, Controller, Get, Post, Route, Tags, Path, Header } from "tsoa";

interface TransactionStatusResponse {
  transactionId: string;
  status: "pending" | "completed" | "canceled";
}

interface CancelTransactionResponse {
  transactionId: string;
  status: "canceled";
}

interface AcceptQuoteRequest {
  quote_id: string;
}

interface AcceptQuoteResponse {
  transactionId: string;
}

// Simulate a simple in-memory database for transactions
const transactionDatabase: {
  [transactionId: string]: TransactionStatusResponse;
} = {};

@Route("transaction")
@Tags("Transaction")
export class TransactionController extends Controller {
  /**
   * Checks the status of a transaction by transaction ID.
   *
   * @param transactionId The ID of the transaction to check.
   * @param apiKey The API key used for authentication.
   *
   * @returns The status of the transaction.
   */
  @Get("/{transactionId}/status")
  public async checkTransactionStatus(
    @Path() transactionId: string,
    @Header("X-API-KEY") apiKey?: string
  ): Promise<TransactionStatusResponse> {
    // Verify the API key
    if (!apiKey || apiKey !== process.env.EXPECTED_API_KEY) {
      throw new Error("Invalid or missing API key");
    }

    // Retrieve the transaction from the database
    const transaction = transactionDatabase[transactionId];

    if (!transaction) {
      throw new Error("Transaction not found");
    }

    return transaction;
  }

  /**
   * Cancels a transaction by transaction ID.
   *
   * @param transactionId The ID of the transaction to cancel.
   * @param apiKey The API key used for authentication.
   *
   * @returns The updated status of the transaction.
   */
  @Post("/{transactionId}/cancel")
  public async cancelTransaction(
    @Path() transactionId: string,
    @Header("X-API-KEY") apiKey?: string
  ): Promise<CancelTransactionResponse> {
    // Verify the API key
    if (!apiKey || apiKey !== process.env.EXPECTED_API_KEY) {
      throw new Error("Invalid or missing API key");
    }

    // Retrieve the transaction from the database
    const transaction = transactionDatabase[transactionId];

    if (!transaction) {
      throw new Error("Transaction not found");
    }

    if (
      transaction.status === "canceled" ||
      transaction.status === "completed"
    ) {
      throw new Error("Transaction cannot be canceled");
    }

    // Update the transaction status to canceled
    transaction.status = "canceled";

    return {
      transactionId,
      status: transaction.status,
    };
  }
}
