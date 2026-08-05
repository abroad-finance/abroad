/**
 * Validation for what an onramp needs from the customer beyond a payout: how
 * much BRL they will pay.
 *
 * Nothing identifying the payer is collected. The payer does not have to be the
 * person receiving the crypto, and the delivery goes to whatever wallet was
 * given, so there is nothing here to match a tax id against.
 */

export type OnrampAmountError = 'above-maximum' | 'below-minimum' | 'malformed' | 'required'

export type OnrampFormErrors = {
  fiatAmount?: OnrampAmountError
}

export type OnrampFormLimits = {
  maxAmount: null | number
  minAmount: null | number
}

/** BRL settles to two decimal places. */
export const parseFiatAmount = (value: string): null | number => {
  const trimmed = value.trim()
  // Stripping a sign rather than rejecting it would silently turn "-5" into a
  // 5 BRL purchase, so a signed amount is refused outright.
  if (/[-+]/.test(trimmed)) return null

  const raw = trimmed.replace(/[^0-9.,]/g, '')
  if (!raw) return null

  // pt-BR entry uses "." for thousands and "," for decimals.
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw

  const parsed = Number.parseFloat(normalized)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.round(parsed * 100) / 100
}

export const validateOnrampForm = (
  input: { fiatAmount: string },
  limits: OnrampFormLimits,
): OnrampFormErrors => {
  const errors: OnrampFormErrors = {}

  const trimmedAmount = input.fiatAmount.trim()
  if (!trimmedAmount) {
    errors.fiatAmount = 'required'
    return errors
  }

  const parsed = parseFiatAmount(trimmedAmount)
  if (parsed === null) {
    errors.fiatAmount = 'malformed'
  }
  else if (limits.minAmount !== null && parsed < limits.minAmount) {
    errors.fiatAmount = 'below-minimum'
  }
  else if (limits.maxAmount !== null && parsed > limits.maxAmount) {
    errors.fiatAmount = 'above-maximum'
  }

  return errors
}

export const hasOnrampFormErrors = (errors: OnrampFormErrors): boolean =>
  Object.keys(errors).length > 0
