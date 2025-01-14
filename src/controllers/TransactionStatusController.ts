import {
    Controller,
    Get,
    Path,
    Route,
    Security,
    Response,
    SuccessResponse,
} from 'tsoa';

interface TransactionStatusResponse {
    transaction_reference: string;
    status: string;
    on_chain_tx_hash: string;
    amount: string;
}

@Route('transaction-status')
@Security('ApiKeyAuth')
export class TransactionStatusController extends Controller {
    /**
   * Retrieves the status of a transaction by its reference.
   * 
   * @param transactionReference - The unique transaction reference (e.g., TX123REF).
   * @returns The transaction status, on-chain tx hash, and amount.
   */
    @Get('{transactionReference}')
    @SuccessResponse('200', 'Transaction status retrieved')
    @Response('400', 'Bad Request')
    @Response('401', 'Unauthorized')
    @Response('404', 'Not Found')
    @Response('500', 'Internal Server Error')
    public async getTransactionStatus(
        @Path() transactionReference: string
    ): Promise<TransactionStatusResponse> {
        // Return dummy data; in a real implementation, you'd fetch
        // the transaction info from a database or another source.
        return {
            transaction_reference: transactionReference,
            status: 'pending',                // e.g., "pending", "confirmed", "failed"
            on_chain_tx_hash: '0xabc123...',  // a dummy on-chain hash
            amount: '12.34',                  // dummy amount
        };
    }
}
