import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

import { _36EnumsTargetCurrency as TargetCurrency } from '../../api'

/** Merge Tailwind classes safely, resolving conflicts with tailwind-merge. */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))
import { WalletType } from '../../interfaces/IWalletFactory'

// Minimal safe type-guard for objects that have a string `message` property.
export const hasMessage = (v: unknown): v is { message: string } => typeof v === 'object' && v !== null && 'message' in v && typeof (v as Record<string, unknown>)['message'] === 'string'

export const getWalletTypeByDevice = (): WalletType => {
  const isMobile = typeof window !== 'undefined' && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  return isMobile ? 'wallet-connect' : 'stellar-kit'
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
