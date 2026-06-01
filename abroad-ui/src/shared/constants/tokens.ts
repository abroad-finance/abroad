/**
 * Shared token configurations
 * Consolidated from multiple duplicated definitions across the codebase
 */

// Token icon URLs - defined inline to avoid circular dependency with index.ts
const USDC_TOKEN_ICON = 'https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDC%20Token.svg'
const USDT_TOKEN_ICON = 'https://storage.googleapis.com/cdn-abroad/Icons/Tokens/USDT-token.svg'

/**
 * Token icon lookup map
 */
export const TOKEN_ICONS: Record<string, string> = {
  USDC: USDC_TOKEN_ICON,
  USDT: USDT_TOKEN_ICON,
}
