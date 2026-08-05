import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge Tailwind classes safely, resolving conflicts with tailwind-merge. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

import { WalletType } from '../../interfaces/IWalletFactory'
import { sessionStore } from '../../services/auth/sessionStore'

export const getWalletTypeByDevice = (): WalletType => {
  // 1. Prioridad máxima: MiniPay (si está disponible)
  if (typeof window !== 'undefined' && (window as unknown as { ethereum?: { isMiniPay?: boolean } }).ethereum?.isMiniPay) {
    return 'mini-pay'
  }

  // 2. Si hay sesión guardada, usar esa wallet
  const session = sessionStore.get()
  if (session?.walletId) {
    return session.walletId as WalletType
  }

  // 3. No fallback por dispositivo - requerir selección explícita de wallet
  // Retornar stellar-kit como default seguro, pero la UI debe pedir al usuario seleccionar
  return 'stellar-kit'
}

/** Extract a string `reason` from an error body, if present. */
export const extractReason = (body: unknown): null | string => {
  if (body && typeof body === 'object' && 'reason' in body) {
    const reason = (body as { reason?: unknown }).reason
    if (typeof reason === 'string') return reason
  }
  return null
}

/** Resolve the locale for a target currency code. */
export const localeForCurrency = (currency: string): string =>
  currency === 'BRL' ? 'pt-BR' : 'es-CO'

/** Resolve Intl.NumberFormat options for a target currency. */
export const numberFormatOptions = (currency: string): Intl.NumberFormatOptions => {
  const decimals = currency === 'COP' ? 0 : 2
  return { maximumFractionDigits: decimals, minimumFractionDigits: decimals }
}
