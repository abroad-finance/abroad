/**
 * This API client provides functions to call:
 * - AcceptTransaction
 * - GetTransactionStatus
 * - GetQuote
 * - GetReverseQuote
 * - OnboardUser
 * - CheckKyc
 * - GetBanks
 *
 * It uses fetch and attaches an API key via the "X-API-Key" header.
 */

// Define TypeScript interfaces based on the OpenAPI schemas

export interface AcceptTransactionRequest {
  account_number: string;
  bank_code: string;
  quote_id: string;
  user_id: string;
}

export interface AcceptTransactionResponse {
  id: string;
  transaction_reference: string;
}

export type TransactionStatus = 
  | "AWAITING_PAYMENT"
  | "PROCESSING_PAYMENT"
  | "PAYMENT_FAILED"
  | "PAYMENT_COMPLETED"
  | "WRONG_AMOUNT";

export interface TransactionStatusResponse {
  id: string;
  on_chain_tx_hash: string | null;
  status: TransactionStatus;
  transaction_reference: string;
  user_id: string;
}

export type TargetCurrency = "COP";
export type PaymentMethod = "NEQUI" | "MOVII";
export type BlockchainNetwork = "STELLAR" | "SOLANA";
export type CryptoCurrency = "USDC";

export interface QuoteRequest {
  target_currency: TargetCurrency;
  payment_method: PaymentMethod;
  network: BlockchainNetwork;
  crypto_currency: CryptoCurrency;
  amount: number;
}

export interface ReverseQuoteRequest {
  target_currency: TargetCurrency;
  source_amount: number;
  payment_method: PaymentMethod;
  network: BlockchainNetwork;
  crypto_currency: CryptoCurrency;
}

export interface Bank {
  bankCode: number;
  bankName: string;
}

export interface BanksResponse {
  banks: Bank[];
}

export interface OnboardResponse {
  message?: string;
  success: boolean;
}

export interface OnboardRequest {
  account: string;
}

export type KycStatus = "PENDING" | "APPROVED" | "REJECTED" | "PENDING_APPROVAL";

export interface KycResponse {
  kyc_link: string;
  kyc_status: KycStatus;
  user_id: string;
}

export interface KycRequest {
  user_id: string;
}

// --- End of Type definitions ---

// Base URL for the API (can be set via an environment variable)
const API_BASE_URL = "https://abroad-api-910236263183.us-east1.run.app";

// API key for authentication (replace with your API key or configure via env)
const API_KEY = "2CcBg9rdjoYxsYAcUpkbCd6PvToAkBLIEBPcbMw3cV6G8yVovrIq3pnuPEsmkSeRPBWCrT2sPqivYU7fQRYhXy3uaD1f0DHa8wTnrqzBgu5NRIfBlCJZKYWuSt9kTwc9";

// Generic function to make API requests
async function apiRequest<T>(endpoint: string, options: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": API_KEY,
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`API request failed: ${response.status} ${errorBody}`);
  }

  return (await response.json()) as T;
}

// Function to accept a transaction (POST /transaction)
export async function acceptTransaction(
  data: AcceptTransactionRequest
): Promise<AcceptTransactionResponse> {
  return await apiRequest<AcceptTransactionResponse>("/transaction", {
    method: "POST",
    body: JSON.stringify(data)
  });
}

// Function to get transaction status (GET /transaction/{transactionId})
export async function getTransactionStatus(
  transactionId: string
): Promise<TransactionStatusResponse> {
  return await apiRequest<TransactionStatusResponse>(`/transaction/${transactionId}`, {
    method: "GET"
  });
}

// Function to get a quote (POST /quote)
export async function getQuote(
  data: QuoteRequest
): Promise<QuoteResponse> {
  return await apiRequest<QuoteResponse>("/quote", {
    method: "POST",
    body: JSON.stringify(data)
  });
}

// Function to get a reverse quote (POST /quote/reverse)
export async function getReverseQuote(
  data: ReverseQuoteRequest
): Promise<QuoteResponse> {
  return await apiRequest<QuoteResponse>("/quote/reverse", {
    method: "POST",
    body: JSON.stringify(data)
  });
}

// Function to onboard a user (POST /payments/onboard)
export async function onboardUser(
  data: OnboardRequest
): Promise<OnboardResponse> {
  return await apiRequest<OnboardResponse>("/payments/onboard", {
    method: "POST",
    body: JSON.stringify(data)
  });
}

// Function to check KYC status (POST /kyc)
export async function checkKyc(
  data: KycRequest
): Promise<KycResponse> {
  return await apiRequest<KycResponse>("/kyc", {
    method: "POST",
    body: JSON.stringify(data)
  });
}

// Function to get available banks (GET /payments/banks)
export async function getBanks(
  paymentMethod?: PaymentMethod
): Promise<BanksResponse> {
  const queryParams = paymentMethod ? `?paymentMethod=${paymentMethod}` : '';
  return await apiRequest<BanksResponse>(`/payments/banks${queryParams}`, {
    method: "GET"
  });
}