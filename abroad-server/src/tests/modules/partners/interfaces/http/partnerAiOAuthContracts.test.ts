import {
  parsePartnerAiAuthorizationRequest,
  parsePartnerAiClientRegistration,
  parsePartnerAiRedirect,
  parsePartnerAiTokenGrant,
  parsePartnerAiTokenRevocation,
} from '../../../../../modules/partners/interfaces/http/partnerAiOAuthContracts'

const codeChallenge = 'a'.repeat(43)

describe('partner AI OAuth contracts', () => {
  it('accepts only HTTPS or loopback redirect destinations and returns a safe host label', () => {
    expect(parsePartnerAiRedirect('https://assistant.example/oauth/callback?workspace=one')).toEqual({
      destinationHost: 'assistant.example',
      uri: 'https://assistant.example/oauth/callback?workspace=one',
    })
    expect(parsePartnerAiRedirect('http://127.0.0.1:49152/callback')).toEqual({
      destinationHost: 'This device',
      uri: 'http://127.0.0.1:49152/callback',
    })
    expect(parsePartnerAiRedirect('http://[::1]:49152/callback')).toEqual({
      destinationHost: 'This device',
      uri: 'http://[::1]:49152/callback',
    })
  })

  it.each([
    'http://assistant.example/callback',
    'https://user:password@assistant.example/callback',
    'https://assistant.example/callback#fragment',
    'https://assistant.example/callback#',
    'ftp://assistant.example/callback',
    'assistant://oauth/callback',
    'not a URL',
  ])('rejects unsafe redirect %s', (redirectUri) => {
    expect(parsePartnerAiRedirect(redirectUri)).toBeNull()
  })

  it('normalizes safe registration metadata and grants no client secret', () => {
    const result = parsePartnerAiClientRegistration({
      client_name: '  ＡＩ Assistant  ',
      client_uri: 'https://assistant.example/about',
      grant_types: ['authorization_code', 'refresh_token'],
      redirect_uris: ['https://assistant.example/oauth/callback'],
      response_types: ['code'],
      scope: 'account:read docs:read offline_access',
      token_endpoint_auth_method: 'none',
    })

    expect(result).toEqual({
      clientName: 'AI Assistant',
      clientUri: 'https://assistant.example/about',
      redirectUris: [{
        destinationHost: 'assistant.example',
        uri: 'https://assistant.example/oauth/callback',
      }],
      scopes: ['account:read', 'docs:read', 'offline_access'],
    })
    expect(JSON.stringify(result)).not.toContain('client_secret')
  })

  it.each([
    {
      client_name: 'Assistant\u202Etrusted',
      redirect_uris: ['https://assistant.example/callback'],
    },
    {
      client_name: 'Assistant',
      redirect_uris: ['https://assistant.example/callback', 'https://assistant.example:443/callback'],
    },
    {
      client_name: 'Assistant',
      redirect_uris: ['https://assistant.example/callback'],
      scope: 'account:read account:read',
    },
    {
      client_name: 'Assistant',
      redirect_uris: ['https://assistant.example/callback'],
      scope: 'docs:read',
    },
    {
      client_name: 'Assistant',
      redirect_uris: ['https://assistant.example/callback'],
      scope: 'account:read funds:write',
    },
    {
      client_name: 'Assistant',
      client_uri: 'https://assistant.example/about#',
      redirect_uris: ['https://assistant.example/callback'],
    },
  ])('rejects ambiguous or unsafe client registration metadata', (metadata) => {
    expect(parsePartnerAiClientRegistration(metadata)).toBeNull()
  })

  it('requires an exact resource, PKCE S256, an exact redirect, and allowlisted scopes', () => {
    const input = {
      client_id: 'abroad_mcp_client_public',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      redirect_uri: 'https://assistant.example/callback',
      resource: 'https://api.abroad.finance/mcp',
      response_type: 'code',
      scope: 'account:read transactions:read',
      state: 'opaque-client-state',
    }

    expect(parsePartnerAiAuthorizationRequest(input)).toEqual({
      clientId: input.client_id,
      codeChallenge,
      redirectUri: input.redirect_uri,
      resource: input.resource,
      scopes: ['account:read', 'transactions:read'],
      state: input.state,
    })
    expect(parsePartnerAiAuthorizationRequest({
      ...input,
      resource: 'https://api.abroad.finance/other',
    })).toBeNull()
    expect(parsePartnerAiAuthorizationRequest({
      ...input,
      code_challenge_method: 'plain',
    })).toBeNull()
    expect(parsePartnerAiAuthorizationRequest({
      ...input,
      scope: 'account:read transactions:write',
    })).toBeNull()
    expect(parsePartnerAiAuthorizationRequest({
      ...input,
      state: ['ambiguous', 'state'],
    })).toBeNull()
  })

  it('parses strict authorization-code, refresh, and revocation form bodies', () => {
    expect(parsePartnerAiTokenGrant({
      client_id: 'abroad_mcp_client_public',
      code: 'c'.repeat(43),
      code_verifier: 'v'.repeat(43),
      grant_type: 'authorization_code',
      redirect_uri: 'https://assistant.example/callback',
      resource: 'https://api.abroad.finance/mcp',
    })).toEqual(expect.objectContaining({ grant_type: 'authorization_code' }))
    expect(parsePartnerAiTokenGrant({
      client_id: 'abroad_mcp_client_public',
      grant_type: 'refresh_token',
      refresh_token: 'r'.repeat(43),
      resource: 'https://api.abroad.finance/mcp',
      scope: 'account:read',
    })).toEqual(expect.objectContaining({ grant_type: 'refresh_token' }))
    expect(parsePartnerAiTokenGrant({
      client_id: 'abroad_mcp_client_public',
      code: 'c'.repeat(43),
      code_verifier: 'v'.repeat(43),
      extra: 'not allowed',
      grant_type: 'authorization_code',
      redirect_uri: 'https://assistant.example/callback',
      resource: 'https://api.abroad.finance/mcp',
    })).toBeNull()
    expect(parsePartnerAiTokenRevocation({
      client_id: 'abroad_mcp_client_public',
      token: 't'.repeat(43),
      token_type_hint: 'access_token',
    })).toEqual(expect.objectContaining({ token_type_hint: 'access_token' }))
  })
})
