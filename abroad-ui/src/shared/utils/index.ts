import { WalletType } from '../../interfaces/IWalletFactory'

// Minimal safe type-guard for objects that have a string `message` property.
export const hasMessage = (v: unknown): v is { message: string } => typeof v === 'object' && v !== null && 'message' in v && typeof (v as Record<string, unknown>)['message'] === 'string'

export const getWalletTypeByDevice = (): WalletType => {
  const isMobile = typeof window !== 'undefined' && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  return isMobile ? 'wallet-connect' : 'stellar-kit'
}
