import { z } from 'zod'

import type {
  PartnerAiAuthorizationInput,
  PartnerAiClientRegistrationInput,
  PartnerAiRedirect,
  PartnerAiTokenGrant,
  PartnerAiTokenRevocation,
} from '../../application/PartnerAiOAuthTypes'

import { PARTNER_AI_MCP_RESOURCE_URL } from '../../application/partnerAiConfiguration'
import { parsePartnerAiScopes, partnerAiScopeNames } from '../../application/partnerAiScopes'

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/
const CLIENT_ID_PATTERN = /^[A-Za-z0-9._~-]+$/
const LOOPBACK_REDIRECT_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost'])
const UNSAFE_CLIENT_NAME_PATTERN = /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/u
const MAX_REDIRECT_URI_LENGTH = 2_048

export const parsePartnerAiRedirect = (value: string): null | PartnerAiRedirect => {
  if (!value || value.length > MAX_REDIRECT_URI_LENGTH || value.includes('#')) return null
  try {
    const url = new URL(value)
    const loopback = url.protocol === 'http:' && LOOPBACK_REDIRECT_HOSTS.has(url.hostname)
    if (
      (url.protocol !== 'https:' && !loopback)
      || url.username.length > 0
      || url.password.length > 0
      || url.hash.length > 0
    ) {
      return null
    }
    return {
      destinationHost: loopback ? 'This device' : url.hostname,
      uri: url.toString(),
    }
  }
  catch {
    return null
  }
}

const safeClientUriSchema = z.string().trim().url().max(MAX_REDIRECT_URI_LENGTH).refine((value) => {
  try {
    const url = new URL(value)
    return (
      !value.includes('#')
      && url.protocol === 'https:'
      && url.username.length === 0
      && url.password.length === 0
      && url.hash.length === 0
    )
  }
  catch {
    return false
  }
}, 'Client URI must be a safe HTTPS URL')

const partnerAiClientRegistrationSchema = z.object({
  client_name: z.string().trim().min(1).max(80).transform(value => value.normalize('NFKC')).refine(
    value => !UNSAFE_CLIENT_NAME_PATTERN.test(value),
    'Client name contains unsafe display characters',
  ),
  client_uri: safeClientUriSchema.optional(),
  grant_types: z.array(z.enum(['authorization_code', 'refresh_token'])).min(1).max(2).optional(),
  redirect_uris: z.array(z.string().trim().min(1).max(MAX_REDIRECT_URI_LENGTH)).min(1).max(5),
  response_types: z.array(z.literal('code')).min(1).max(1).optional(),
  scope: z.string().trim().max(512).optional(),
  token_endpoint_auth_method: z.literal('none').optional(),
}).strict()

export const parsePartnerAiClientRegistration = (
  value: unknown,
): null | PartnerAiClientRegistrationInput => {
  const parsed = partnerAiClientRegistrationSchema.safeParse(value)
  if (!parsed.success) return null
  const redirectUris = parsed.data.redirect_uris.map(parsePartnerAiRedirect)
  if (redirectUris.some(redirect => redirect === null)) return null
  const canonicalRedirectUris = redirectUris
    .filter((redirect): redirect is PartnerAiRedirect => redirect !== null)
  if (new Set(canonicalRedirectUris.map(redirect => redirect.uri)).size !== canonicalRedirectUris.length) {
    return null
  }
  const grantTypes = parsed.data.grant_types ?? ['authorization_code', 'refresh_token']
  if (!grantTypes.includes('authorization_code')) return null
  const scopes = parsed.data.scope
    ? parsePartnerAiScopes(parsed.data.scope)
    : [...partnerAiScopeNames]
  if (!scopes) return null
  return {
    clientName: parsed.data.client_name,
    clientUri: parsed.data.client_uri,
    redirectUris: canonicalRedirectUris,
    scopes,
  }
}

const authorizationRequestSchema = z.object({
  client_id: z.string().trim().min(8).max(256).regex(CLIENT_ID_PATTERN),
  code_challenge: z.string().min(43).max(128).regex(BASE64URL_PATTERN),
  code_challenge_method: z.literal('S256'),
  redirect_uri: z.string().trim().min(1).max(MAX_REDIRECT_URI_LENGTH),
  resource: z.literal(PARTNER_AI_MCP_RESOURCE_URL),
  response_type: z.literal('code'),
  scope: z.string().trim().min(1).max(512),
  state: z.string().min(1).max(512).optional(),
}).strict()

export const parsePartnerAiAuthorizationRequest = (
  query: Readonly<Record<string, unknown>>,
): null | PartnerAiAuthorizationInput => {
  const parsed = authorizationRequestSchema.safeParse(query)
  if (!parsed.success) return null
  const scopes = parsePartnerAiScopes(parsed.data.scope)
  if (!scopes) return null
  return {
    clientId: parsed.data.client_id,
    codeChallenge: parsed.data.code_challenge,
    redirectUri: parsed.data.redirect_uri,
    resource: parsed.data.resource,
    scopes,
    state: parsed.data.state,
  }
}

const authorizationCodeGrantSchema = z.object({
  client_id: z.string().trim().min(8).max(256).regex(CLIENT_ID_PATTERN),
  code: z.string().trim().min(32).max(256),
  code_verifier: z.string().min(43).max(128).regex(BASE64URL_PATTERN),
  grant_type: z.literal('authorization_code'),
  redirect_uri: z.string().trim().min(1).max(MAX_REDIRECT_URI_LENGTH),
  resource: z.literal(PARTNER_AI_MCP_RESOURCE_URL),
}).strict()

const refreshTokenGrantSchema = z.object({
  client_id: z.string().trim().min(8).max(256).regex(CLIENT_ID_PATTERN),
  grant_type: z.literal('refresh_token'),
  refresh_token: z.string().trim().min(32).max(256),
  resource: z.literal(PARTNER_AI_MCP_RESOURCE_URL),
  scope: z.string().trim().max(512).optional(),
}).strict()

const partnerAiTokenGrantSchema = z.discriminatedUnion('grant_type', [
  authorizationCodeGrantSchema,
  refreshTokenGrantSchema,
])

export const parsePartnerAiTokenGrant = (value: unknown): null | PartnerAiTokenGrant => {
  const parsed = partnerAiTokenGrantSchema.safeParse(value)
  return parsed.success ? parsed.data as PartnerAiTokenGrant : null
}

const tokenRevocationSchema = z.object({
  client_id: z.string().trim().min(8).max(256).regex(CLIENT_ID_PATTERN),
  token: z.string().trim().min(32).max(256),
  token_type_hint: z.enum(['access_token', 'refresh_token']).optional(),
}).strict()

export const parsePartnerAiTokenRevocation = (value: unknown): null | PartnerAiTokenRevocation => {
  const parsed = tokenRevocationSchema.safeParse(value)
  return parsed.success ? parsed.data as PartnerAiTokenRevocation : null
}
