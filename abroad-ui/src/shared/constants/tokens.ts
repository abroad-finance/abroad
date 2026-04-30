/**
 * Shared token configurations
 * Consolidated from multiple duplicated definitions across the codebase
 */

// Token icon URLs - defined inline to avoid circular dependency with index.ts
const USDC_TOKEN_ICON = 'https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDC%20Token.svg'
const USDT_TOKEN_ICON = 'https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDT-token.svg'

/**
 * Token icon URLs map
 */
export const TOKEN_ICON_URLS: Record<string, string> = {
  USDC: USDC_TOKEN_ICON,
  USDT: USDT_TOKEN_ICON,
}

/**
 * Token icon map for transaction details (alias for TOKEN_ICON_URLS)
 */
export const TOKEN_ICON_MAP: Record<string, string> = {
  USDC: USDC_TOKEN_ICON,
  USDT: USDT_TOKEN_ICON,
}
