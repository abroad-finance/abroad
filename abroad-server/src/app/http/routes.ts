/* tslint:disable */
/* eslint-disable */
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import type { TsoaRoute } from '@tsoa/runtime';
import {  fetchMiddlewares, ExpressTemplateService } from '@tsoa/runtime';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { WebhookController } from './../../modules/webhooks/interfaces/http/WebhookController';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { ConversionController } from './../../modules/treasury/interfaces/http/ConversionController';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { TransactionsController } from './../../modules/transactions/interfaces/http/TransactionsController';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { TransactionController } from './../../modules/transactions/interfaces/http/TransactionController';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { PublicTransactionsController } from './../../modules/transactions/interfaces/http/PublicTransactionsController';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { QuoteController } from './../../modules/quotes/interfaces/http/QuoteController';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { SolanaPaymentsController } from './../../modules/payments/interfaces/http/SolanaPaymentsController';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { QrDecoderController } from './../../modules/payments/interfaces/http/QrDecoderController';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { PaymentsController } from './../../modules/payments/interfaces/http/PaymentsController';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { PartnerUserController } from './../../modules/partners/interfaces/http/PartnerUserController';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { PartnerController } from './../../modules/partners/interfaces/http/PartnerController';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { WalletAuthController } from './../../modules/auth/interfaces/http/WalletAuthController';
import { expressAuthentication } from './authentication';
// @ts-ignore - no great way to install types from subpackage
import { iocContainer } from './../container/index';
import type { IocContainer, IocContainerFactory } from '@tsoa/runtime';
import type { Request as ExRequest, Response as ExResponse, RequestHandler, Router } from 'express';

const expressAuthenticationRecasted = expressAuthentication as (req: ExRequest, securityName: string, scopes?: string[], res?: ExResponse) => Promise<any>;


// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

const models: TsoaRoute.Models = {
    "WebhookResponse": {
        "dataType": "refAlias",
        "type": {"dataType":"nestedObjectLiteral","nestedProperties":{"success":{"dataType":"boolean","required":true},"message":{"dataType":"string"}},"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "Record_string.unknown_": {
        "dataType": "refAlias",
        "type": {"dataType":"nestedObjectLiteral","nestedProperties":{},"additionalProperties":{"dataType":"any"},"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "TriggerConversionResponse": {
        "dataType": "refObject",
        "properties": {
            "converted_amount": {"dataType":"double"},
            "estimated_fiat_amount": {"dataType":"double"},
            "message": {"dataType":"string"},
            "success": {"dataType":"boolean","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "_36_Enums.TransactionStatus": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":["AWAITING_PAYMENT"]},{"dataType":"enum","enums":["PROCESSING_PAYMENT"]},{"dataType":"enum","enums":["PAYMENT_FAILED"]},{"dataType":"enum","enums":["PAYMENT_EXPIRED"]},{"dataType":"enum","enums":["PAYMENT_COMPLETED"]},{"dataType":"enum","enums":["WRONG_AMOUNT"]}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "DefaultSelection_Prisma._36_TransactionPayload_": {
        "dataType": "refAlias",
        "type": {"dataType":"nestedObjectLiteral","nestedProperties":{"qrCode":{"dataType":"string","required":true},"externalId":{"dataType":"string","required":true},"taxId":{"dataType":"string","required":true},"refundOnChainId":{"dataType":"string","required":true},"onChainId":{"dataType":"string","required":true},"quoteId":{"dataType":"string","required":true},"createdAt":{"dataType":"datetime","required":true},"status":{"ref":"_36_Enums.TransactionStatus","required":true},"bankCode":{"dataType":"string","required":true},"accountNumber":{"dataType":"string","required":true},"partnerUserId":{"dataType":"string","required":true},"id":{"dataType":"string","required":true}},"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "Transaction": {
        "dataType": "refAlias",
        "type": {"ref":"DefaultSelection_Prisma._36_TransactionPayload_","validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "_36_Enums.TargetCurrency": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":["COP"]},{"dataType":"enum","enums":["BRL"]}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "TargetCurrency": {
        "dataType": "refAlias",
        "type": {"ref":"_36_Enums.TargetCurrency","validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "PaginatedTransactionList": {
        "dataType": "refObject",
        "properties": {
            "page": {"dataType":"double","required":true},
            "pageSize": {"dataType":"double","required":true},
            "total": {"dataType":"double","required":true},
            "transactions": {"dataType":"array","array":{"dataType":"intersection","subSchemas":[{"ref":"Transaction"},{"dataType":"nestedObjectLiteral","nestedProperties":{"quote":{"dataType":"nestedObjectLiteral","nestedProperties":{"targetCurrency":{"ref":"TargetCurrency","required":true},"targetAmount":{"dataType":"double","required":true},"sourceAmount":{"dataType":"double","required":true},"paymentMethod":{"dataType":"string","required":true},"network":{"dataType":"string","required":true},"id":{"dataType":"string","required":true},"cryptoCurrency":{"dataType":"string","required":true}},"required":true}}}]},"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "AcceptTransactionResponse": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":[null]},{"dataType":"string"}],"required":true},
            "kycLink": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":[null]},{"dataType":"string"}],"required":true},
            "transaction_reference": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":[null]},{"dataType":"string"}],"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "AcceptTransactionRequest": {
        "dataType": "refObject",
        "properties": {
            "account_number": {"dataType":"string","required":true},
            "bank_code": {"dataType":"string"},
            "qr_code": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":[null]},{"dataType":"string"}]},
            "quote_id": {"dataType":"string","required":true},
            "redirectUrl": {"dataType":"string"},
            "tax_id": {"dataType":"string"},
            "user_id": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "TransactionStatus": {
        "dataType": "refAlias",
        "type": {"ref":"_36_Enums.TransactionStatus","validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "TransactionStatusResponse": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
            "kycLink": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":[null]},{"dataType":"string"}],"required":true},
            "on_chain_tx_hash": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":[null]},{"dataType":"string"}],"required":true},
            "status": {"ref":"TransactionStatus","required":true},
            "transaction_reference": {"dataType":"string","required":true},
            "user_id": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ExpiredTransactionsSummary": {
        "dataType": "refAlias",
        "type": {"dataType":"nestedObjectLiteral","nestedProperties":{"updatedTransactionIds":{"dataType":"array","array":{"dataType":"string"},"required":true},"updated":{"dataType":"double","required":true},"expired":{"dataType":"double","required":true},"awaiting":{"dataType":"double","required":true}},"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "CheckUnprocessedStellarResponse": {
        "dataType": "refAlias",
        "type": {"dataType":"nestedObjectLiteral","nestedProperties":{"startPagingToken":{"dataType":"union","subSchemas":[{"dataType":"enum","enums":[null]},{"dataType":"string"}],"required":true},"scannedPayments":{"dataType":"double","required":true},"missingTransactions":{"dataType":"double","required":true},"enqueued":{"dataType":"double","required":true},"endPagingToken":{"dataType":"union","subSchemas":[{"dataType":"enum","enums":[null]},{"dataType":"string"}],"required":true},"alreadyProcessed":{"dataType":"double","required":true}},"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "QuoteResponse": {
        "dataType": "refObject",
        "properties": {
            "expiration_time": {"dataType":"double","required":true},
            "quote_id": {"dataType":"string","required":true},
            "value": {"dataType":"double","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "_36_Enums.CryptoCurrency": {
        "dataType": "refAlias",
        "type": {"dataType":"enum","enums":["USDC"],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "CryptoCurrency": {
        "dataType": "refAlias",
        "type": {"ref":"_36_Enums.CryptoCurrency","validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "_36_Enums.BlockchainNetwork": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":["STELLAR"]},{"dataType":"enum","enums":["SOLANA"]}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "BlockchainNetwork": {
        "dataType": "refAlias",
        "type": {"ref":"_36_Enums.BlockchainNetwork","validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "_36_Enums.PaymentMethod": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":["PIX"]},{"dataType":"enum","enums":["BREB"]}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "PaymentMethod": {
        "dataType": "refAlias",
        "type": {"ref":"_36_Enums.PaymentMethod","validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "QuoteRequest": {
        "dataType": "refAlias",
        "type": {"dataType":"nestedObjectLiteral","nestedProperties":{"target_currency":{"ref":"TargetCurrency","required":true},"payment_method":{"ref":"PaymentMethod","required":true},"network":{"ref":"BlockchainNetwork","required":true},"crypto_currency":{"ref":"CryptoCurrency","required":true},"amount":{"dataType":"double","required":true}},"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ReverseQuoteRequest": {
        "dataType": "refAlias",
        "type": {"dataType":"nestedObjectLiteral","nestedProperties":{"target_currency":{"ref":"TargetCurrency","required":true},"source_amount":{"dataType":"double","required":true},"payment_method":{"ref":"PaymentMethod","required":true},"network":{"ref":"BlockchainNetwork","required":true},"crypto_currency":{"ref":"CryptoCurrency","required":true}},"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "SolanaPaymentNotificationRequest": {
        "dataType": "refObject",
        "properties": {
            "on_chain_tx": {"dataType":"string","required":true},
            "transaction_id": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "PixDecoded": {
        "dataType": "refObject",
        "properties": {
            "account": {"dataType":"string"},
            "amount": {"dataType":"string"},
            "currency": {"dataType":"string"},
            "name": {"dataType":"string"},
            "taxId": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":[null]},{"dataType":"string"}]},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "BankSummary": {
        "dataType": "refAlias",
        "type": {"dataType":"nestedObjectLiteral","nestedProperties":{"bankName":{"dataType":"string","required":true},"bankCode":{"dataType":"double","required":true}},"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "BanksResult": {
        "dataType": "refObject",
        "properties": {
            "banks": {"dataType":"array","array":{"dataType":"refAlias","ref":"BankSummary"},"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "BanksResponse": {
        "dataType": "refAlias",
        "type": {"ref":"BanksResult","validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "SupportedPaymentMethod": {
        "dataType": "refAlias",
        "type": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":["PIX"]},{"dataType":"enum","enums":["BREB"]}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "LiquidityResult": {
        "dataType": "refObject",
        "properties": {
            "liquidity": {"dataType":"double","required":true},
            "message": {"dataType":"string"},
            "success": {"dataType":"boolean","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "LiquidityResponse": {
        "dataType": "refAlias",
        "type": {"ref":"LiquidityResult","validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "OnboardResult": {
        "dataType": "refObject",
        "properties": {
            "message": {"dataType":"string"},
            "success": {"dataType":"boolean","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "OnboardResponse": {
        "dataType": "refAlias",
        "type": {"ref":"OnboardResult","validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "OnboardRequest": {
        "dataType": "refObject",
        "properties": {
            "account": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "PartnerUserDto": {
        "dataType": "refObject",
        "properties": {
            "createdAt": {"dataType":"datetime","required":true},
            "id": {"dataType":"string","required":true},
            "kycToken": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":[null]},{"dataType":"string"}],"required":true},
            "updatedAt": {"dataType":"datetime","required":true},
            "userId": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "CreatePartnerUserRequest": {
        "dataType": "refObject",
        "properties": {
            "kycExternalToken": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":[null]},{"dataType":"string"}]},
            "userId": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "PaginatedPartnerUsers": {
        "dataType": "refObject",
        "properties": {
            "page": {"dataType":"double","required":true},
            "pageSize": {"dataType":"double","required":true},
            "total": {"dataType":"double","required":true},
            "users": {"dataType":"array","array":{"dataType":"refObject","ref":"PartnerUserDto"},"required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "UpdatePartnerUserRequest": {
        "dataType": "refObject",
        "properties": {
            "kycExternalToken": {"dataType":"union","subSchemas":[{"dataType":"enum","enums":[null]},{"dataType":"string"}]},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "CreatePartnerResponse": {
        "dataType": "refObject",
        "properties": {
            "id": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "CreatePartnerRequest": {
        "dataType": "refObject",
        "properties": {
            "company": {"dataType":"string","required":true},
            "country": {"dataType":"string","required":true},
            "email": {"dataType":"string","required":true},
            "firstName": {"dataType":"string","required":true},
            "lastName": {"dataType":"string","required":true},
            "password": {"dataType":"string","required":true},
            "phone": {"dataType":"string"},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "Pick_Partner.createdAt-or-id-or-name_": {
        "dataType": "refAlias",
        "type": {"dataType":"nestedObjectLiteral","nestedProperties":{"name":{"dataType":"string","required":true},"id":{"dataType":"string","required":true},"createdAt":{"dataType":"datetime","required":true}},"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "PartnerInfoResponse": {
        "dataType": "refAlias",
        "type": {"dataType":"intersection","subSchemas":[{"ref":"Pick_Partner.createdAt-or-id-or-name_"},{"dataType":"nestedObjectLiteral","nestedProperties":{"phone":{"dataType":"string"},"needsKyc":{"dataType":"boolean"},"lastName":{"dataType":"string"},"isKybApproved":{"dataType":"boolean"},"firstName":{"dataType":"string"},"email":{"dataType":"string"},"country":{"dataType":"string"}}}],"validators":{}},
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ChallengeResponse": {
        "dataType": "refObject",
        "properties": {
            "xdr": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ChallengeRequest": {
        "dataType": "refObject",
        "properties": {
            "address": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "RefreshResponse": {
        "dataType": "refObject",
        "properties": {
            "token": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "RefreshRequest": {
        "dataType": "refObject",
        "properties": {
            "token": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "VerifyResponse": {
        "dataType": "refObject",
        "properties": {
            "token": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "VerifyRequest": {
        "dataType": "refObject",
        "properties": {
            "address": {"dataType":"string","required":true},
            "signedXDR": {"dataType":"string","required":true},
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
};
const templateService = new ExpressTemplateService(models, {"noImplicitAdditionalProperties":"throw-on-extras","bodyCoercion":true});

// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa




export function RegisterRoutes(app: Router) {

    // ###########################################################################################################
    //  NOTE: If you do not see routes for all of your controllers in this file, then you might not have informed tsoa of where to look
    //      Please look into the "controllerPathGlobs" config option described in the readme: https://github.com/lukeautry/tsoa
    // ###########################################################################################################


    
        const argsWebhookController_handlePersonaWebhook: Record<string, TsoaRoute.ParameterSchema> = {
                body: {"in":"body","name":"body","required":true,"ref":"Record_string.unknown_"},
                request: {"in":"request","name":"request","required":true,"dataType":"object"},
                badRequest: {"in":"res","name":"400","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"success":{"dataType":"enum","enums":[false],"required":true},"message":{"dataType":"string","required":true}}},
                notFound: {"in":"res","name":"404","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"success":{"dataType":"enum","enums":[false],"required":true},"message":{"dataType":"string","required":true}}},
                serverError: {"in":"res","name":"500","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"success":{"dataType":"enum","enums":[false],"required":true},"message":{"dataType":"string","required":true}}},
        };
        app.post('/webhook/persona',
            ...(fetchMiddlewares<RequestHandler>(WebhookController)),
            ...(fetchMiddlewares<RequestHandler>(WebhookController.prototype.handlePersonaWebhook)),

            async function WebhookController_handlePersonaWebhook(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsWebhookController_handlePersonaWebhook, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<WebhookController>(WebhookController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'handlePersonaWebhook',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 200,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWebhookController_handleTransferoWebhook: Record<string, TsoaRoute.ParameterSchema> = {
                body: {"in":"body","name":"body","required":true,"ref":"Record_string.unknown_"},
                request: {"in":"request","name":"request","required":true,"dataType":"object"},
                badRequest: {"in":"res","name":"400","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"success":{"dataType":"enum","enums":[false],"required":true},"message":{"dataType":"string","required":true}}},
                serverError: {"in":"res","name":"500","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"success":{"dataType":"enum","enums":[false],"required":true},"message":{"dataType":"string","required":true}}},
        };
        app.post('/webhook/transfero',
            ...(fetchMiddlewares<RequestHandler>(WebhookController)),
            ...(fetchMiddlewares<RequestHandler>(WebhookController.prototype.handleTransferoWebhook)),

            async function WebhookController_handleTransferoWebhook(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsWebhookController_handleTransferoWebhook, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<WebhookController>(WebhookController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'handleTransferoWebhook',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 200,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsConversionController_triggerBrlConversions: Record<string, TsoaRoute.ParameterSchema> = {
                body: {"in":"body","name":"body","required":true,"ref":"Record_string.unknown_"},
                _req: {"in":"request","name":"_req","required":true,"dataType":"object"},
                badRequest: {"in":"res","name":"400","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"reason":{"dataType":"string","required":true}}},
        };
        app.post('/conversions/brl/trigger',
            ...(fetchMiddlewares<RequestHandler>(ConversionController)),
            ...(fetchMiddlewares<RequestHandler>(ConversionController.prototype.triggerBrlConversions)),

            async function ConversionController_triggerBrlConversions(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsConversionController_triggerBrlConversions, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<ConversionController>(ConversionController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'triggerBrlConversions',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 200,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsTransactionsController_listConfirmedPartnerTransactions: Record<string, TsoaRoute.ParameterSchema> = {
                page: {"default":1,"in":"query","name":"page","dataType":"double"},
                pageSize: {"default":20,"in":"query","name":"pageSize","dataType":"double"},
                request: {"in":"request","name":"request","required":true,"dataType":"object"},
                badRequest: {"in":"res","name":"400","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"reason":{"dataType":"string","required":true}}},
        };
        app.get('/transactions/list/confirmed',
            authenticateMiddleware([{"ApiKeyAuth":[]},{"BearerAuth":[]}]),
            ...(fetchMiddlewares<RequestHandler>(TransactionsController)),
            ...(fetchMiddlewares<RequestHandler>(TransactionsController.prototype.listConfirmedPartnerTransactions)),

            async function TransactionsController_listConfirmedPartnerTransactions(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsTransactionsController_listConfirmedPartnerTransactions, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<TransactionsController>(TransactionsController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'listConfirmedPartnerTransactions',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 200,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsTransactionsController_listPartnerTransactions: Record<string, TsoaRoute.ParameterSchema> = {
                page: {"default":1,"in":"query","name":"page","dataType":"double"},
                pageSize: {"default":20,"in":"query","name":"pageSize","dataType":"double"},
                externalUserId: {"in":"query","name":"externalUserId","required":true,"dataType":"string"},
                request: {"in":"request","name":"request","required":true,"dataType":"object"},
                badRequest: {"in":"res","name":"400","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"reason":{"dataType":"string","required":true}}},
        };
        app.get('/transactions/list',
            authenticateMiddleware([{"ApiKeyAuth":[]},{"BearerAuth":[]}]),
            ...(fetchMiddlewares<RequestHandler>(TransactionsController)),
            ...(fetchMiddlewares<RequestHandler>(TransactionsController.prototype.listPartnerTransactions)),

            async function TransactionsController_listPartnerTransactions(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsTransactionsController_listPartnerTransactions, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<TransactionsController>(TransactionsController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'listPartnerTransactions',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 200,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsTransactionController_acceptTransaction: Record<string, TsoaRoute.ParameterSchema> = {
                requestBody: {"in":"body","name":"requestBody","required":true,"ref":"AcceptTransactionRequest"},
                request: {"in":"request","name":"request","required":true,"dataType":"object"},
                badRequestResponse: {"in":"res","name":"400","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"reason":{"dataType":"string","required":true}}},
        };
        app.post('/transaction',
            authenticateMiddleware([{"ApiKeyAuth":[]},{"BearerAuth":[]}]),
            ...(fetchMiddlewares<RequestHandler>(TransactionController)),
            ...(fetchMiddlewares<RequestHandler>(TransactionController.prototype.acceptTransaction)),

            async function TransactionController_acceptTransaction(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsTransactionController_acceptTransaction, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<TransactionController>(TransactionController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'acceptTransaction',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 200,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsTransactionController_getTransactionStatus: Record<string, TsoaRoute.ParameterSchema> = {
                transactionId: {"in":"path","name":"transactionId","required":true,"dataType":"string"},
                request: {"in":"request","name":"request","required":true,"dataType":"object"},
        };
        app.get('/transaction/:transactionId',
            authenticateMiddleware([{"ApiKeyAuth":[]},{"BearerAuth":[]}]),
            ...(fetchMiddlewares<RequestHandler>(TransactionController)),
            ...(fetchMiddlewares<RequestHandler>(TransactionController.prototype.getTransactionStatus)),

            async function TransactionController_getTransactionStatus(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsTransactionController_getTransactionStatus, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<TransactionController>(TransactionController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'getTransactionStatus',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 200,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsPublicTransactionsController_checkExpiredTransactions: Record<string, TsoaRoute.ParameterSchema> = {
        };
        app.post('/transactions/check-expired',
            ...(fetchMiddlewares<RequestHandler>(PublicTransactionsController)),
            ...(fetchMiddlewares<RequestHandler>(PublicTransactionsController.prototype.checkExpiredTransactions)),

            async function PublicTransactionsController_checkExpiredTransactions(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsPublicTransactionsController_checkExpiredTransactions, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<PublicTransactionsController>(PublicTransactionsController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'checkExpiredTransactions',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 200,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsPublicTransactionsController_checkUnprocessedStellarTransactions: Record<string, TsoaRoute.ParameterSchema> = {
        };
        app.post('/transactions/check-unprocessed-stellar',
            ...(fetchMiddlewares<RequestHandler>(PublicTransactionsController)),
            ...(fetchMiddlewares<RequestHandler>(PublicTransactionsController.prototype.checkUnprocessedStellarTransactions)),

            async function PublicTransactionsController_checkUnprocessedStellarTransactions(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsPublicTransactionsController_checkUnprocessedStellarTransactions, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<PublicTransactionsController>(PublicTransactionsController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'checkUnprocessedStellarTransactions',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 200,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsQuoteController_getQuote: Record<string, TsoaRoute.ParameterSchema> = {
                requestBody: {"in":"body","name":"requestBody","required":true,"ref":"QuoteRequest"},
                request: {"in":"request","name":"request","required":true,"dataType":"object"},
                badRequestResponse: {"in":"res","name":"400","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"reason":{"dataType":"string","required":true}}},
                apiKey: {"in":"header","name":"X-API-Key","dataType":"string"},
        };
        app.post('/quote',
            ...(fetchMiddlewares<RequestHandler>(QuoteController)),
            ...(fetchMiddlewares<RequestHandler>(QuoteController.prototype.getQuote)),

            async function QuoteController_getQuote(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsQuoteController_getQuote, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<QuoteController>(QuoteController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'getQuote',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 200,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsQuoteController_getReverseQuote: Record<string, TsoaRoute.ParameterSchema> = {
                requestBody: {"in":"body","name":"requestBody","required":true,"ref":"ReverseQuoteRequest"},
                request: {"in":"request","name":"request","required":true,"dataType":"object"},
                badRequestResponse: {"in":"res","name":"400","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"reason":{"dataType":"string","required":true}}},
                apiKey: {"in":"header","name":"X-API-Key","dataType":"string"},
        };
        app.post('/quote/reverse',
            ...(fetchMiddlewares<RequestHandler>(QuoteController)),
            ...(fetchMiddlewares<RequestHandler>(QuoteController.prototype.getReverseQuote)),

            async function QuoteController_getReverseQuote(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsQuoteController_getReverseQuote, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<QuoteController>(QuoteController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'getReverseQuote',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 200,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsSolanaPaymentsController_notifyPayment: Record<string, TsoaRoute.ParameterSchema> = {
                requestBody: {"in":"body","name":"requestBody","required":true,"ref":"SolanaPaymentNotificationRequest"},
                badRequestResponse: {"in":"res","name":"400","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"reason":{"dataType":"string","required":true}}},
                notFoundResponse: {"in":"res","name":"404","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"reason":{"dataType":"string","required":true}}},
        };
        app.post('/solana/payments/notify',
            authenticateMiddleware([{"ApiKeyAuth":[]},{"BearerAuth":[]}]),
            ...(fetchMiddlewares<RequestHandler>(SolanaPaymentsController)),
            ...(fetchMiddlewares<RequestHandler>(SolanaPaymentsController.prototype.notifyPayment)),

            async function SolanaPaymentsController_notifyPayment(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsSolanaPaymentsController_notifyPayment, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<SolanaPaymentsController>(SolanaPaymentsController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'notifyPayment',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 202,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsQrDecoderController_decodeQrCodeBR: Record<string, TsoaRoute.ParameterSchema> = {
                badRequestResponse: {"in":"res","name":"400","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"reason":{"dataType":"string","required":true}}},
                qrCode: {"in":"query","name":"qrCode","required":true,"dataType":"string"},
        };
        app.get('/qr-decoder/br',
            ...(fetchMiddlewares<RequestHandler>(QrDecoderController)),
            ...(fetchMiddlewares<RequestHandler>(QrDecoderController.prototype.decodeQrCodeBR)),

            async function QrDecoderController_decodeQrCodeBR(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsQrDecoderController_decodeQrCodeBR, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<QrDecoderController>(QrDecoderController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'decodeQrCodeBR',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsPaymentsController_getBanks: Record<string, TsoaRoute.ParameterSchema> = {
                paymentMethod: {"in":"query","name":"paymentMethod","ref":"SupportedPaymentMethod"},
        };
        app.get('/payments/banks',
            authenticateMiddleware([{"ApiKeyAuth":[]},{"BearerAuth":[]}]),
            ...(fetchMiddlewares<RequestHandler>(PaymentsController)),
            ...(fetchMiddlewares<RequestHandler>(PaymentsController.prototype.getBanks)),

            async function PaymentsController_getBanks(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsPaymentsController_getBanks, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<PaymentsController>(PaymentsController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'getBanks',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 200,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsPaymentsController_getLiquidity: Record<string, TsoaRoute.ParameterSchema> = {
                paymentMethod: {"in":"query","name":"paymentMethod","ref":"SupportedPaymentMethod"},
        };
        app.get('/payments/liquidity',
            authenticateMiddleware([{"ApiKeyAuth":[]},{"BearerAuth":[]}]),
            ...(fetchMiddlewares<RequestHandler>(PaymentsController)),
            ...(fetchMiddlewares<RequestHandler>(PaymentsController.prototype.getLiquidity)),

            async function PaymentsController_getLiquidity(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsPaymentsController_getLiquidity, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<PaymentsController>(PaymentsController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'getLiquidity',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 200,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsPaymentsController_onboardUser: Record<string, TsoaRoute.ParameterSchema> = {
                requestBody: {"in":"body","name":"requestBody","required":true,"ref":"OnboardRequest"},
        };
        app.post('/payments/onboard',
            authenticateMiddleware([{"ApiKeyAuth":[]},{"BearerAuth":[]}]),
            ...(fetchMiddlewares<RequestHandler>(PaymentsController)),
            ...(fetchMiddlewares<RequestHandler>(PaymentsController.prototype.onboardUser)),

            async function PaymentsController_onboardUser(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsPaymentsController_onboardUser, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<PaymentsController>(PaymentsController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'onboardUser',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 200,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsPartnerUserController_createPartnerUser: Record<string, TsoaRoute.ParameterSchema> = {
                body: {"in":"body","name":"body","required":true,"ref":"CreatePartnerUserRequest"},
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                badRequest: {"in":"res","name":"400","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"reason":{"dataType":"string","required":true}}},
        };
        app.post('/partnerUser',
            authenticateMiddleware([{"BearerAuth":[]},{"ApiKeyAuth":[]}]),
            ...(fetchMiddlewares<RequestHandler>(PartnerUserController)),
            ...(fetchMiddlewares<RequestHandler>(PartnerUserController.prototype.createPartnerUser)),

            async function PartnerUserController_createPartnerUser(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsPartnerUserController_createPartnerUser, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<PartnerUserController>(PartnerUserController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'createPartnerUser',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 201,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsPartnerUserController_listPartnerUsers: Record<string, TsoaRoute.ParameterSchema> = {
                page: {"default":1,"in":"query","name":"page","dataType":"double"},
                pageSize: {"default":20,"in":"query","name":"pageSize","dataType":"double"},
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                badRequest: {"in":"res","name":"400","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"reason":{"dataType":"string","required":true}}},
        };
        app.get('/partnerUser',
            authenticateMiddleware([{"BearerAuth":[]},{"ApiKeyAuth":[]}]),
            ...(fetchMiddlewares<RequestHandler>(PartnerUserController)),
            ...(fetchMiddlewares<RequestHandler>(PartnerUserController.prototype.listPartnerUsers)),

            async function PartnerUserController_listPartnerUsers(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsPartnerUserController_listPartnerUsers, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<PartnerUserController>(PartnerUserController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'listPartnerUsers',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 200,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsPartnerUserController_updatePartnerUser: Record<string, TsoaRoute.ParameterSchema> = {
                userId: {"in":"path","name":"userId","required":true,"dataType":"string"},
                body: {"in":"body","name":"body","required":true,"ref":"UpdatePartnerUserRequest"},
                req: {"in":"request","name":"req","required":true,"dataType":"object"},
                res: {"in":"res","name":"404","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"reason":{"dataType":"string","required":true}}},
        };
        app.patch('/partnerUser/:userId',
            authenticateMiddleware([{"BearerAuth":[]},{"ApiKeyAuth":[]}]),
            ...(fetchMiddlewares<RequestHandler>(PartnerUserController)),
            ...(fetchMiddlewares<RequestHandler>(PartnerUserController.prototype.updatePartnerUser)),

            async function PartnerUserController_updatePartnerUser(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsPartnerUserController_updatePartnerUser, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<PartnerUserController>(PartnerUserController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'updatePartnerUser',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 200,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsPartnerController_createPartner: Record<string, TsoaRoute.ParameterSchema> = {
                body: {"in":"body","name":"body","required":true,"ref":"CreatePartnerRequest"},
                badRequest: {"in":"res","name":"400","required":true,"dataType":"nestedObjectLiteral","nestedProperties":{"reason":{"dataType":"string","required":true}}},
                created: {"in":"res","name":"201","required":true,"ref":"CreatePartnerResponse"},
        };
        app.post('/partner',
            ...(fetchMiddlewares<RequestHandler>(PartnerController)),
            ...(fetchMiddlewares<RequestHandler>(PartnerController.prototype.createPartner)),

            async function PartnerController_createPartner(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsPartnerController_createPartner, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<PartnerController>(PartnerController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'createPartner',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 201,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsPartnerController_getPartnerInfo: Record<string, TsoaRoute.ParameterSchema> = {
                request: {"in":"request","name":"request","required":true,"dataType":"object"},
        };
        app.get('/partner',
            authenticateMiddleware([{"BearerAuth":[]},{"ApiKeyAuth":[]}]),
            ...(fetchMiddlewares<RequestHandler>(PartnerController)),
            ...(fetchMiddlewares<RequestHandler>(PartnerController.prototype.getPartnerInfo)),

            async function PartnerController_getPartnerInfo(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsPartnerController_getPartnerInfo, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<PartnerController>(PartnerController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'getPartnerInfo',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: 200,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWalletAuthController_challenge: Record<string, TsoaRoute.ParameterSchema> = {
                body: {"in":"body","name":"body","required":true,"ref":"ChallengeRequest"},
        };
        app.post('/walletAuth/challenge',
            ...(fetchMiddlewares<RequestHandler>(WalletAuthController)),
            ...(fetchMiddlewares<RequestHandler>(WalletAuthController.prototype.challenge)),

            async function WalletAuthController_challenge(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsWalletAuthController_challenge, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<WalletAuthController>(WalletAuthController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'challenge',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWalletAuthController_refresh: Record<string, TsoaRoute.ParameterSchema> = {
                body: {"in":"body","name":"body","required":true,"ref":"RefreshRequest"},
        };
        app.post('/walletAuth/refresh',
            ...(fetchMiddlewares<RequestHandler>(WalletAuthController)),
            ...(fetchMiddlewares<RequestHandler>(WalletAuthController.prototype.refresh)),

            async function WalletAuthController_refresh(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsWalletAuthController_refresh, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<WalletAuthController>(WalletAuthController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'refresh',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        const argsWalletAuthController_verify: Record<string, TsoaRoute.ParameterSchema> = {
                body: {"in":"body","name":"body","required":true,"ref":"VerifyRequest"},
        };
        app.post('/walletAuth/verify',
            ...(fetchMiddlewares<RequestHandler>(WalletAuthController)),
            ...(fetchMiddlewares<RequestHandler>(WalletAuthController.prototype.verify)),

            async function WalletAuthController_verify(request: ExRequest, response: ExResponse, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            let validatedArgs: any[] = [];
            try {
                validatedArgs = templateService.getValidatedArgs({ args: argsWalletAuthController_verify, request, response });

                const container: IocContainer = typeof iocContainer === 'function' ? (iocContainer as IocContainerFactory)(request) : iocContainer;

                const controller: any = await container.get<WalletAuthController>(WalletAuthController);
                if (typeof controller['setStatus'] === 'function') {
                controller.setStatus(undefined);
                }

              await templateService.apiHandler({
                methodName: 'verify',
                controller,
                response,
                next,
                validatedArgs,
                successStatus: undefined,
              });
            } catch (err) {
                return next(err);
            }
        });
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa


    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

    function authenticateMiddleware(security: TsoaRoute.Security[] = []) {
        return async function runAuthenticationMiddleware(request: any, response: any, next: any) {

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            // keep track of failed auth attempts so we can hand back the most
            // recent one.  This behavior was previously existing so preserving it
            // here
            const failedAttempts: any[] = [];
            const pushAndRethrow = (error: any) => {
                failedAttempts.push(error);
                throw error;
            };

            const secMethodOrPromises: Promise<any>[] = [];
            for (const secMethod of security) {
                if (Object.keys(secMethod).length > 1) {
                    const secMethodAndPromises: Promise<any>[] = [];

                    for (const name in secMethod) {
                        secMethodAndPromises.push(
                            expressAuthenticationRecasted(request, name, secMethod[name], response)
                                .catch(pushAndRethrow)
                        );
                    }

                    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

                    secMethodOrPromises.push(Promise.all(secMethodAndPromises)
                        .then(users => { return users[0]; }));
                } else {
                    for (const name in secMethod) {
                        secMethodOrPromises.push(
                            expressAuthenticationRecasted(request, name, secMethod[name], response)
                                .catch(pushAndRethrow)
                        );
                    }
                }
            }

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa

            try {
                request['user'] = await Promise.any(secMethodOrPromises);

                // Response was sent in middleware, abort
                if (response.writableEnded) {
                    return;
                }

                next();
            }
            catch(err) {
                // Show most recent error as response
                const error = failedAttempts.pop();
                error.status = error.status || 401;

                // Response was sent in middleware, abort
                if (response.writableEnded) {
                    return;
                }
                next(error);
            }

            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        }
    }

    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
}

// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
