import { sha512_224 } from 'js-sha512'

const clientDomainBrand: unique symbol = Symbol('ClientDomain')

export type ClientDomain = string & { readonly [clientDomainBrand]: 'ClientDomain' }
type ClientDomainRecord = {
  clientDomain: null | string
  clientDomainHash: null | string
}

const CLIENT_DOMAIN_PATTERN = /^[a-z0-9.-]+$/

const tryParseUrl = (value: string): null | URL => {
  try {
    return new URL(value)
  }
  catch {
    return null
  }
}

const normalizeHostnameCandidate = (value: string): null | string => {
  const normalizedValue = value.trim().toLowerCase()
  if (!normalizedValue) {
    return null
  }

  const parsedUrl = tryParseUrl(normalizedValue) ?? tryParseUrl(`https://${normalizedValue}`)
  const hostnameCandidate = parsedUrl?.hostname ?? normalizedValue.split(/[/?#]/, 1)[0] ?? ''
  const normalizedHostname = hostnameCandidate.trim().toLowerCase().replace(/\.$/, '')

  if (!normalizedHostname || !CLIENT_DOMAIN_PATTERN.test(normalizedHostname)) {
    return null
  }

  return normalizedHostname
}

export const parseClientDomain = (value: string): ClientDomain | null => {
  const normalizedHostname = normalizeHostnameCandidate(value)
  return normalizedHostname ? normalizedHostname as ClientDomain : null
}

export const clientDomainToString = (clientDomain: ClientDomain): string => clientDomain

export const hashClientDomain = (clientDomain: ClientDomain): string => (
  sha512_224(clientDomainToString(clientDomain))
)

export const normalizeClientDomainInput = (
  value: null | string | undefined,
): ClientDomainRecord => {
  const normalizedValue = typeof value === 'string' ? value.trim() : ''
  if (!normalizedValue) {
    return {
      clientDomain: null,
      clientDomainHash: null,
    }
  }

  const clientDomain = parseClientDomain(normalizedValue)
  if (!clientDomain) {
    throw new Error('Client domain is invalid')
  }

  return {
    clientDomain: clientDomainToString(clientDomain),
    clientDomainHash: hashClientDomain(clientDomain),
  }
}
