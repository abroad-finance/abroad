import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

import { _36EnumsTargetCurrency as TargetCurrency } from '../../api'

/** Merge Tailwind classes safely, resolving conflicts with tailwind-merge. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

import { WalletType } from '../../interfaces/IWalletFactory'
import { sessionStore } from '../../services/auth/sessionStore'

// Minimal safe type-guard for objects that have a string `message` property.
export const hasMessage = (v: unknown): v is { message: string } => typeof v === 'object' && v !== null && 'message' in v && typeof (v as Record<string, unknown>)['message'] === 'string'

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

export const formatMoney = (currency: TargetCurrency, amount: string): string => {
  // Parse a safe number from the amount string
  const n = Number(String(amount).replace(/,/g, ''))
  if (!Number.isFinite(n)) return amount

  const abs = Math.abs(n)

  switch (currency) {
    case TargetCurrency.BRL: {
      const formatted = new Intl.NumberFormat('pt-BR', { currency: 'BRL', style: 'currency' }).format(abs)
      return formatted
    }
    case TargetCurrency.COP: {
      const formatted = new Intl.NumberFormat('es-CO', {
        currency: 'COP', maximumFractionDigits: 0, minimumFractionDigits: 0, style: 'currency',
      }).format(abs)
      return formatted
    }
    default: {
      return amount
    }
  }
}
