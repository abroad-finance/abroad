// @deprecated This file is deprecated. Use the new API client in src/api/index.ts instead.

import { getAuth } from "firebase/auth";

/**
 * This API client provides functions to call:
 * - AcceptTransaction
 * - GetTransactionStatus
 * - GetQuote
 * - GetReverseQuote
 * - OnboardUser
 * - CheckKyc
 * - GetBanks
 */

// --- TypeScript interfaces generated from OpenAPI schema ---

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

export interface Transaction {
  onChainId: string;
  quoteId: string;
  createdAt: string;
  status: TransactionStatus;
  bankCode: string;
  accountNumber: string;
  partnerUserId: string;
  id: string;
}

export interface QuoteInTransaction {
  targetCurrency: string;
  targetAmount: number;
  sourceAmount: number;
  paymentMethod: string;
  network: string;
  id: string;
  cryptoCurrency: string;
}

export interface TransactionWithQuote extends Transaction {
  quote: QuoteInTransaction;
}

export interface PaginatedTransactionList {
  page: number;
  pageSize: number;
  total: number;
  transactions: TransactionWithQuote[];
}

export interface QuoteResponse {
  expiration_time: number;
  quote_id: string;
  value: number;
}

export type CryptoCurrency = "USDC";
export type BlockchainNetwork = "STELLAR" | "SOLANA";
export type PaymentMethod = "NEQUI" | "MOVII";
export type TargetCurrency = "COP";

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

export interface CreatePartnerUserRequest {
  account_number: string;
  bank: string;
  payment_method: PaymentMethod;
  user_id: string;
}

export interface CreatePartnerUserResponse {
  accountNumber: string | null;
  bank: string | null;
  createdAt: string;
  id: string;
  kycStatus: KycStatus;
  paymentMethod: PaymentMethod | null;
  updatedAt: string;
  userId: string;
}

export interface PaginatedPartnerUsers {
  page: number;
  pageSize: number;
  total: number;
  users: Array<{
    userId: string;
    updatedAt: string;
    paymentMethod: PaymentMethod | null;
    kycStatus: KycStatus;
    id: string;
    createdAt: string;
    bank: string | null;
    accountNumber: string | null;
  }>;
}

// --- End of Type definitions ---

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "https://api.abroad.finance";

async function apiRequest<T>(endpoint: string, options: RequestInit): Promise<T> {
  const auth = getAuth();
  const user = auth.currentUser;
  let token: string | null = null;

  if (user) {
    try {
      token = await user.getIdToken();
    } catch (error) {
      console.error("Error getting Firebase ID token:", error);
      // Handle token retrieval error, e.g., redirect to login or show an error message
      throw new Error("Failed to get authentication token.");
    }
  }

  // Initialize headers as a Record<string, string> for easier manipulation
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    // Spread existing headers from options if they exist
    ...(options.headers as Record<string, string> || {})
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`; // Now type-safe
  }

  // Correctly structure the fetch call
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options, // Spread the original options (method, body, etc.)
    headers: headers // Pass the modified headers object
  });

  if (!response.ok) {
    const errorBody = await response.text();
    // Consider more specific error handling based on status codes
    if (response.status === 401 || response.status === 403) {
      // Handle authentication/authorization errors, e.g., redirect to login
      console.error("Authentication/Authorization error:", errorBody);
    }
    throw new Error(`API request failed: ${response.status} ${errorBody}`);
  }

  // Handle cases where the response might be empty (e.g., 204 No Content)
  const responseText = await response.text();
  try {
    return JSON.parse(responseText) as T;
  } catch (e) {
    // If parsing fails and responseText is empty, return undefined or handle as appropriate
    if (!responseText) {
      // Explicitly return undefined if the response is empty and cannot be parsed
      // Adjust this based on how your API handles empty successful responses
      return undefined as T;
    }
    throw new Error(`Failed to parse API response: ${e}`);
  }
}

// Accept a transaction (POST /transaction)
export async function acceptTransaction(
  data: AcceptTransactionRequest
): Promise<AcceptTransactionResponse> {
  return await apiRequest<AcceptTransactionResponse>("/transaction", {
    method: "POST",
    body: JSON.stringify(data)
  });
}

// Get transaction status (GET /transaction/{transactionId})
export async function getTransactionStatus(
  transactionId: string
): Promise<TransactionStatusResponse> {
  return await apiRequest<TransactionStatusResponse>(`/transaction/${transactionId}`, {
    method: "GET"
  });
}

// List partner transactions (GET /transactions/list)
export async function listPartnerTransactions(
  page?: number,
  pageSize?: number
): Promise<PaginatedTransactionList> {
  const params = [];
  if (page) params.push(`page=${page}`);
  if (pageSize) params.push(`pageSize=${pageSize}`);
  const query = params.length ? `?${params.join("&")}` : "";
  return await apiRequest<PaginatedTransactionList>(`/transactions/list${query}`, {
    method: "GET"
  });
}

// Get a quote (POST /quote)
export async function getQuote(
  data: QuoteRequest
): Promise<QuoteResponse> {
  return await apiRequest<QuoteResponse>("/quote", {
    method: "POST",
    body: JSON.stringify(data)
  });
}

// Get a reverse quote (POST /quote/reverse)
export async function getReverseQuote(
  data: ReverseQuoteRequest
): Promise<QuoteResponse> {
  return await apiRequest<QuoteResponse>("/quote/reverse", {
    method: "POST",
    body: JSON.stringify(data)
  });
}

// Get available banks (GET /payments/banks)
export async function getBanks(
  paymentMethod?: PaymentMethod
): Promise<BanksResponse> {
  const queryParams = paymentMethod ? `?paymentMethod=${paymentMethod}` : '';
  return await apiRequest<BanksResponse>(`/payments/banks${queryParams}`, {
    method: "GET"
  });
}

// Onboard a user (POST /payments/onboard)
export async function onboardUser(
  data: OnboardRequest
): Promise<OnboardResponse> {
  return await apiRequest<OnboardResponse>("/payments/onboard", {
    method: "POST",
    body: JSON.stringify(data)
  });
}

// Create a partner user (POST /partnerUser)
export async function createPartnerUser(
  data: CreatePartnerUserRequest
): Promise<CreatePartnerUserResponse> {
  return await apiRequest<CreatePartnerUserResponse>("/partnerUser", {
    method: "POST",
    body: JSON.stringify(data)
  });
}

// List partner users (GET /partnerUser/list)
export async function listPartnerUsers(
  page?: number,
  pageSize?: number
): Promise<PaginatedPartnerUsers> {
  const params = [];
  if (page) params.push(`page=${page}`);
  if (pageSize) params.push(`pageSize=${pageSize}`);
  const query = params.length ? `?${params.join("&")}` : "";
  return await apiRequest<PaginatedPartnerUsers>(`/partnerUser/list${query}`, {
    method: "GET"
  });
}

// Check KYC status (POST /kyc)
export async function checkKyc(
  data: KycRequest
): Promise<KycResponse> {
  return await apiRequest<KycResponse>("/kyc", {
    method: "POST",
    body: JSON.stringify(data)
  });
}