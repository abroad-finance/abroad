/**
 * Tipos de error estandarizados para todas las implementaciones de wallet
 */

export enum WalletErrorCode {
  CHAIN_NOT_SUPPORTED = 'CHAIN_NOT_SUPPORTED',
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  DISCONNECT_FAILED = 'DISCONNECT_FAILED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  SIGNATURE_FAILED = 'SIGNATURE_FAILED',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  UNKNOWN = 'UNKNOWN',
  USER_REJECTED = 'USER_REJECTED',
}

export interface WalletError {
  chainId?: string
  code: WalletErrorCode
  details?: unknown
  message: string
  walletId?: string
}

export function createWalletError(
  code: WalletErrorCode,
  message: string,
  options?: { chainId?: string, details?: unknown, walletId?: string },
): WalletError {
  return {
    chainId: options?.chainId,
    code,
    details: options?.details,
    message,
    walletId: options?.walletId,
  }
}

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err) {
    const m = err as { message: unknown }
    if (typeof m.message === 'string') return m.message
  }
  return String(err)
}
