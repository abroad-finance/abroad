/**
 * Tipos de error estandarizados para todas las implementaciones de wallet
 */

export enum WalletErrorCode {
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  DISCONNECT_FAILED = 'DISCONNECT_FAILED',
  SIGNATURE_FAILED = 'SIGNATURE_FAILED',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  CHAIN_NOT_SUPPORTED = 'CHAIN_NOT_SUPPORTED',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  USER_REJECTED = 'USER_REJECTED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  UNKNOWN = 'UNKNOWN',
}

export interface WalletError {
  code: WalletErrorCode
  message: string
  details?: unknown
  walletId?: string
  chainId?: string
}

export function createWalletError(
  code: WalletErrorCode,
  message: string,
  options?: { details?: unknown; walletId?: string; chainId?: string },
): WalletError {
  return {
    code,
    message,
    details: options?.details,
    walletId: options?.walletId,
    chainId: options?.chainId,
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
