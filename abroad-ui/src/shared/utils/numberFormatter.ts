/**
 * Utility functions for number formatting to reduce cognitive complexity
 * in useWebSwapController.ts
 */

/**
 * Formats a number string with thousands separator (dot for COP style)
 * Uses iterative approach to avoid ReDoS vulnerabilities
 * @param value - String value to format (digits only)
 * @returns Formatted string with dot separators
 */
export function formatWithThousandsSeparator(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 3) {
    return digits
  }

  let result = ''
  let count = 0
  for (let i = digits.length - 1; i >= 0; i--) {
    result = digits[i] + result
    count++
    if (count === 3 && i > 0) {
      result = '.' + result
      count = 0
    }
  }
  return result
}

/**
 * Removes thousands separators and converts to number
 * @param value - String value with possible dot separators and comma decimal
 * @returns Numeric value
 */
export function parseFormattedNumber(value: string): number {
  const cleaned = value.replace(/\./g, '').replace(/,/g, '.')
  return parseFloat(cleaned)
}

/**
 * Checks if a formatted number value is valid (positive)
 * @param value - String value to validate
 * @returns true if value represents a positive number
 */
export function isPositiveNumber(value: string): boolean {
  const numeric = parseFormattedNumber(value)
  return !Number.isNaN(numeric) && numeric > 0
}

/**
 * Gets minimum amount based on currency
 * @param currency - Target currency (COP or BRL)
 * @returns Minimum allowed amount
 */
export function getMinimumAmount(currency: string): number {
  switch (currency) {
    case 'COP':
      return 5000
    case 'BRL':
      return 1
    default:
      return 0
  }
}

/**
 * Checks if amount is below minimum for currency
 * @param amount - Amount to check
 * @param currency - Target currency
 * @returns true if amount is below minimum
 */
export function isBelowMinimum(amount: string, currency: string): boolean {
  const numeric = parseFormattedNumber(amount)
  if (numeric <= 0) return false
  return numeric < getMinimumAmount(currency)
}
