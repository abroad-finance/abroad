/**
 * This API client provides functions to call:
 * - AcceptTransaction
 * - GetTransactionStatus
 * - GetQuote
 * - GetReverseQuote
 * - OnboardUser
 * - CheckKyc
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

export interface QuoteResponse {
  expiration_time: number;
  quote_id: string;
  value: number;
}

export interface QuoteRequest {
  target_currency: "COP";
  payment_method: "NEQUI" | "MOVII";
  network: "STELLAR" | "SOLANA";
  crypto_currency: "USDC";
  amount: number;
}

export interface ReverseQuoteRequest {
  target_currency: "COP";
  source_amount: number;
  payment_method: "NEQUI" | "MOVII";
  network: "STELLAR" | "SOLANA";
  crypto_currency: "USDC";
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
const API_BASE_URL = "https://api.sandbox.abroad.finance";

// API key for authentication (replace with your API key or configure via env)
const API_KEY = "test";

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