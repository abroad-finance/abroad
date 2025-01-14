// src/controllers/AcceptTransactionController.ts
import { Controller, Post, Route, Body, Security, Response, SuccessResponse } from 'tsoa';

interface AcceptTransactionRequest {
    quote_id: string;
    user_id: string;
    account_number: string;
}

interface AcceptTransactionResponse {
    transaction_reference: string;
    expiration_time: number;
}

@Route('accept-transaction')
@Security('ApiKeyAuth')
export class AcceptTransactionController extends Controller {

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
