export type WalletConnectionIssue = {
  code: WalletConnectionIssueCode
  retryable: boolean
}

export type WalletConnectionIssueCode
  = | 'disconnected'
    | 'network'
    | 'rejected'
    | 'timeout'
    | 'unknown'
    | 'unsupported-network'
    | 'unsupported-wallet'

const readErrorCode = (error: unknown): null | number | string => {
  if (!error || typeof error !== 'object' || Array.isArray(error)) return null
  const code = Reflect.get(error, 'code')
  return typeof code === 'number' || typeof code === 'string' ? code : null
}

const readMessage = (error: unknown): string => (
  error instanceof Error ? error.message.toLowerCase().slice(0, 500) : ''
)

export const classifyWalletConnectionFailure = (error: unknown): WalletConnectionIssue => {
  const code = readErrorCode(error)
  const message = readMessage(error)
  if (
    code === 4001
    || message.includes('user rejected')
    || message.includes('user denied')
    || message.includes('cancelled by user')
    || message.includes('canceled by user')
  ) {
    return { code: 'rejected', retryable: true }
  }
  if (message.includes('unsupported chain') || message.includes('unsupported network') || code === 4902) {
    return { code: 'unsupported-network', retryable: false }
  }
  if (message.includes('unsupported wallet') || message.includes('wallet not found')) {
    return { code: 'unsupported-wallet', retryable: false }
  }
  if (message.includes('timed out') || message.includes('timeout')) {
    return { code: 'timeout', retryable: true }
  }
  if (message.includes('disconnect') || code === 4900) {
    return { code: 'disconnected', retryable: true }
  }
  if (message.includes('network') || message.includes('fetch') || message.includes('offline')) {
    return { code: 'network', retryable: true }
  }
  return { code: 'unknown', retryable: true }
}
