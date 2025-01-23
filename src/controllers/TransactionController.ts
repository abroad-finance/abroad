import {
    Controller,
    Get,
    Path,
    Route,
    Security,
    Response,
    SuccessResponse,
} from 'tsoa';
import { Post, Body } from 'tsoa';

interface TransactionStatusResponse {
    transaction_reference: string;
    status: string;
    on_chain_tx_hash: string;
    amount: string;
}

interface AcceptTransactionRequest {
    quote_id: string;
    user_id: string;
    account_number: string;
}

interface AcceptTransactionResponse {
    transaction_reference: string;
    expiration_time: number;
}

@Route('transaction')
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


    /**
     * Accepts a transaction based on a quote. 
     * 
     * @param requestBody - Includes the `quote_id`, `user_id`, and local `account_number`.
     * @returns A `transaction_reference` (used on-chain as a memo) and an `expiration_time`.
     */
    @Post()
    @SuccessResponse('200', 'Transaction accepted')
    @Response('400', 'Bad Request')
    @Response('401', 'Unauthorized')
    @Response('404', 'Not Found')
    @Response('500', 'Internal Server Error')
    public async acceptTransaction(
        @Body() requestBody: AcceptTransactionRequest
    ): Promise<AcceptTransactionResponse> {

        // Dummy response
        return {
            transaction_reference: 'TX123REF',
            expiration_time: 1697041800,
        };
    }
}
