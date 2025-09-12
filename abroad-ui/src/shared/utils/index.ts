import { _36EnumsTargetCurrency as TargetCurrency } from '../../api'
import { WalletType } from '../../interfaces/IWalletFactory'

// Minimal safe type-guard for objects that have a string `message` property.
export const hasMessage = (v: unknown): v is { message: string } => typeof v === 'object' && v !== null && 'message' in v && typeof (v as Record<string, unknown>)['message'] === 'string'

export const getWalletTypeByDevice = (): WalletType => {
  const isMobile = typeof window !== 'undefined' && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  return isMobile ? 'wallet-connect' : 'stellar-kit'
}

export const formatMoney = (currency: TargetCurrency | string, amount: string): string => {
  // Normalize currency: if a string is provided, try to parse it into the TargetCurrency enum
  let cur: TargetCurrency | undefined
  if (typeof currency === 'string') {
    const s = currency.trim()
    if (s.length === 0) return amount

    const upper = s.toUpperCase()
    // Try to match enum key (e.g. 'BRL')
    if ((TargetCurrency as any)[upper]) {
      cur = (TargetCurrency as any)[upper] as TargetCurrency
    }
    else {
      // Try to match enum value case-insensitively
      const vals = Object.values(TargetCurrency).filter(v => typeof v === 'string') as string[]
      const found = vals.find(v => v.toUpperCase() === upper)
      if (found) cur = found as unknown as TargetCurrency
    }
  }
  else {
    cur = currency
  }

  // If we couldn't parse the currency, return raw amount
  if (!cur) return amount
  // Parse a safe number from the amount string
  const n = Number(String(amount).replace(/,/g, ''))
  if (!Number.isFinite(n)) return amount

  const abs = Math.abs(n)

  switch (cur) {
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
