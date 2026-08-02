import { Request, Response, Router, urlencoded } from 'express'

import { PartnerAiAbuseProtectionService, PartnerAiRateLimitError } from '../../application/PartnerAiAbuseProtectionService'
import { PartnerAiAuthorizationService } from '../../application/PartnerAiAuthorizationService'
import { PARTNER_AI_DOCUMENTATION_URL, PARTNER_AI_MCP_RESOURCE_URL, PARTNER_AI_OAUTH_ISSUER, PARTNER_AI_PORTAL_URL } from '../../application/partnerAiConfiguration'
import { PartnerAiOAuthError, PartnerAiPortalError } from '../../application/PartnerAiErrors'
import { partnerAiScopeNames } from '../../application/partnerAiScopes'
import { PartnerAiTokenService } from '../../application/PartnerAiTokenService'
import { parsePartnerAiAuthorizationRequest, parsePartnerAiClientRegistration, parsePartnerAiTokenGrant, parsePartnerAiTokenRevocation } from './partnerAiOAuthContracts'
import { readPartnerPortalClientIp } from './partnerPortalClientIp'

const formParser = urlencoded({
  extended: false,
  limit: '16kb',
  parameterLimit: 20,
})

export class PartnerAiOAuthRouter {
  public readonly router: Router

  public constructor(
    private readonly authorizationService: PartnerAiAuthorizationService,
    private readonly tokenService: PartnerAiTokenService,
    private readonly abuseProtectionService: PartnerAiAbuseProtectionService,
  ) {
    this.router = Router()
    this.router.get('/.well-known/oauth-protected-resource/mcp', (_request, response) => {
      response.json({
        authorization_servers: [PARTNER_AI_OAUTH_ISSUER],
        bearer_methods_supported: ['header'],
        resource: PARTNER_AI_MCP_RESOURCE_URL,
        resource_documentation: PARTNER_AI_DOCUMENTATION_URL,
        scopes_supported: partnerAiScopeNames,
      })
    })
    this.router.get('/.well-known/oauth-authorization-server', (_request, response) => {
      response.json({
        authorization_endpoint: `${PARTNER_AI_OAUTH_ISSUER}/oauth/authorize`,
        code_challenge_methods_supported: ['S256'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        issuer: PARTNER_AI_OAUTH_ISSUER,
        registration_endpoint: `${PARTNER_AI_OAUTH_ISSUER}/oauth/register`,
        response_types_supported: ['code'],
        revocation_endpoint: `${PARTNER_AI_OAUTH_ISSUER}/oauth/revoke`,
        scopes_supported: partnerAiScopeNames,
        token_endpoint: `${PARTNER_AI_OAUTH_ISSUER}/oauth/token`,
        token_endpoint_auth_methods_supported: ['none'],
      })
    })
    this.router.post('/oauth/register', (request, response) => {
      void this.register(request, response)
    })
    this.router.get('/oauth/authorize', (request, response) => {
      void this.authorize(request, response)
    })
    this.router.post('/oauth/token', formParser, (request, response) => {
      void this.token(request, response)
    })
    this.router.post('/oauth/revoke', formParser, (request, response) => {
      void this.revoke(request, response)
    })
  }

  private async authorize(request: Request, response: Response): Promise<void> {
    this.setNoStore(response)
    const input = parsePartnerAiAuthorizationRequest(request.query)
    if (!input) {
      response.redirect(302, this.portalErrorUrl('unsupported-client'))
      return
    }
    try {
      const portalUrl = await this.authorizationService.createAuthorizationRequest(
        input,
        readPartnerPortalClientIp(request),
      )
      response.redirect(302, portalUrl)
    }
    catch (error) {
      if (error instanceof PartnerAiRateLimitError) {
        response.set('Retry-After', String(error.retryAfterSeconds))
        response.redirect(302, this.portalErrorUrl('temporarily-unavailable'))
        return
      }
      if (error instanceof PartnerAiPortalError) {
        response.redirect(302, this.portalErrorUrl('unsupported-client'))
        return
      }
      response.redirect(302, this.portalErrorUrl('server-error'))
    }
  }

  private oauthError(response: Response, error: PartnerAiOAuthError): void {
    const status = error.code === 'server_error'
      ? 500
      : error.code === 'temporarily_unavailable'
        ? 503
        : error.code === 'invalid_client'
          ? 401
          : 400
    response.status(status).json({
      error: error.code,
      error_description: error.message,
    })
  }

  private portalErrorUrl(error: 'server-error' | 'temporarily-unavailable' | 'unsupported-client'): string {
    const url = new URL(PARTNER_AI_PORTAL_URL)
    url.searchParams.set('error', error)
    return url.toString()
  }

  private async register(request: Request, response: Response): Promise<void> {
    this.setNoStore(response)
    const input = parsePartnerAiClientRegistration(request.body as unknown)
    if (!input) {
      response.status(400).json({
        error: 'invalid_client_metadata',
        error_description: 'Client registration metadata is invalid',
      })
      return
    }
    try {
      const result = await this.authorizationService.registerClient(
        input,
        readPartnerPortalClientIp(request),
      )
      response.status(201).json(result)
    }
    catch (error) {
      if (error instanceof PartnerAiRateLimitError) {
        response.set('Retry-After', String(error.retryAfterSeconds))
        response.status(429).json({
          error: 'temporarily_unavailable',
          error_description: 'Client registration is temporarily limited',
        })
        return
      }
      response.status(500).json({
        error: 'server_error',
        error_description: 'Client registration could not be completed',
      })
    }
  }

  private async revoke(request: Request, response: Response): Promise<void> {
    this.setNoStore(response)
    const input = parsePartnerAiTokenRevocation(request.body as unknown)
    if (!input) {
      this.oauthError(response, new PartnerAiOAuthError('invalid_request'))
      return
    }
    try {
      await this.abuseProtectionService.assertTokenRequestAllowed(
        readPartnerPortalClientIp(request),
        input.client_id,
      )
      await this.tokenService.revoke(input)
      response.status(200).json({})
    }
    catch (error) {
      if (error instanceof PartnerAiRateLimitError) {
        response.set('Retry-After', String(error.retryAfterSeconds))
        this.oauthError(response, new PartnerAiOAuthError('temporarily_unavailable'))
        return
      }
      this.oauthError(response, new PartnerAiOAuthError('server_error'))
    }
  }

  private setNoStore(response: Response): void {
    response.set({
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache',
    })
  }

  private async token(request: Request, response: Response): Promise<void> {
    this.setNoStore(response)
    const grant = parsePartnerAiTokenGrant(request.body as unknown)
    if (!grant) {
      this.oauthError(response, new PartnerAiOAuthError('invalid_request'))
      return
    }
    try {
      response.status(200).json(await this.tokenService.exchange(
        grant,
        readPartnerPortalClientIp(request),
      ))
    }
    catch (error) {
      if (error instanceof PartnerAiRateLimitError) {
        response.set('Retry-After', String(error.retryAfterSeconds))
        this.oauthError(response, new PartnerAiOAuthError('temporarily_unavailable'))
        return
      }
      if (error instanceof PartnerAiOAuthError) {
        this.oauthError(response, error)
        return
      }
      this.oauthError(response, new PartnerAiOAuthError('server_error'))
    }
  }
}
