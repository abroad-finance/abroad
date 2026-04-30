/**
 * Shared country configurations
 * Consolidated from multiple duplicated definitions across the codebase
 */

/**
 * Country config for transaction details (used in TransactionDetail, TxDetailSheet)
 */
export const COUNTRY_CONFIG: Record<string, { currency: string, flagUrl: string, location?: string, name?: string, rail: string, symbol: string }> = {
  br: {
    currency: 'BRL',
    flagUrl: 'https://hatscripts.github.io/circle-flags/flags/br.svg',
    location: 'Brazil',
    name: 'Brazil',
    rail: 'PIX',
    symbol: 'R$',
  },
  co: {
    currency: 'COP',
    flagUrl: 'https://hatscripts.github.io/circle-flags/flags/co.svg',
    location: 'Colombia',
    name: 'Colombia',
    rail: 'Bre-B',
    symbol: '$',
  },
}

/**
 * Country config keyed by currency code (used in TransactionDetail for COP/BRL)
 */
export const COUNTRY_CONFIG_BY_CURRENCY: Record<string, { currency: string, flagUrl: string, location: string, name: string, rail: string, symbol: string }> = {
  BRL: {
    currency: 'BRL',
    flagUrl: 'https://hatscripts.github.io/circle-flags/flags/br.svg',
    location: 'Brazil',
    name: 'BRL',
    rail: 'PIX',
    symbol: 'R$',
  },
  COP: {
    currency: 'COP',
    flagUrl: 'https://hatscripts.github.io/circle-flags/flags/co.svg',
    location: 'Colombia',
    name: 'COP',
    rail: 'Bre-B',
    symbol: '$',
  },
}

/**
 * Simplified country config for recent transactions (used in HomeScreen)
 */
export const RECENT_COUNTRY_CONFIG: Record<string, { currency: string, flagUrl: string, symbol: string }> = {
  BRL: { currency: 'BRL', flagUrl: 'https://hatscripts.github.io/circle-flags/flags/br.svg', symbol: 'R$' },
  COP: { currency: 'COP', flagUrl: 'https://hatscripts.github.io/circle-flags/flags/co.svg', symbol: '$' },
}

/**
 * Currency to flag URL map (used in HomeScreen)
 */
export const CURRENCY_FLAG_URL: Record<string, string> = {
  BRL: 'https://hatscripts.github.io/circle-flags/flags/br.svg',
  COP: 'https://hatscripts.github.io/circle-flags/flags/co.svg',
}

/**
 * Country data with exchange rate info (used in HomeScreen)
 */
export const COUNTRIES: Record<string, { decimals: number, rate: number }> = {
  BRL: { decimals: 2, rate: 5.82 },
  COP: { decimals: 0, rate: 4198.5 },
}

/**
 * Flag URLs for all supported countries
 */
export const FLAG_URLS = {
  br: 'https://hatscripts.github.io/circle-flags/flags/br.svg',
  BRL: 'https://hatscripts.github.io/circle-flags/flags/br.svg',
  co: 'https://hatscripts.github.io/circle-flags/flags/co.svg',
  COP: 'https://hatscripts.github.io/circle-flags/flags/co.svg',
} as const
