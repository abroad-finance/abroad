import type { PartnerAiScopeName } from './partnerAiScopes'

export type PartnerAiAuthorizationCodeGrant = {
  client_id: string
  code: string
  code_verifier: string
  grant_type: 'authorization_code'
  redirect_uri: string
  resource: string
}

export type PartnerAiAuthorizationInput = {
  clientId: string
  codeChallenge: string
  redirectUri: string
  resource: string
  scopes: PartnerAiScopeName[]
  state?: string
}

export type PartnerAiClientRegistrationInput = {
  clientName: string
  clientUri?: string
  redirectUris: PartnerAiRedirect[]
  scopes: PartnerAiScopeName[]
}

export type PartnerAiRedirect = {
  destinationHost: string
  uri: string
}

export type PartnerAiRefreshTokenGrant = {
  client_id: string
  grant_type: 'refresh_token'
  refresh_token: string
  resource: string
  scope?: string
}

export type PartnerAiTokenGrant = PartnerAiAuthorizationCodeGrant | PartnerAiRefreshTokenGrant

export type PartnerAiTokenRevocation = {
  client_id: string
  token: string
  token_type_hint?: 'access_token' | 'refresh_token'
}
