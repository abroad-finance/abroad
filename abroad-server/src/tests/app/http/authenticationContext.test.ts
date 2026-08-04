import { OpsRole } from '@prisma/client'

import type { AuthenticatedPartner } from '../../../modules/partners/application/contracts/IPartnerService'

import { requireAuthenticatedWalletPrincipal, requireNamedOpsPrincipal } from '../../../app/http/authenticationContext'
import { ApplicationError, mapErrorToHttpResponse } from '../../../core/errors'
import { OpsLegacyPrincipal, OpsUserPrincipal } from '../../../modules/operations/application/opsIdentity'

const legacyPrincipal: OpsLegacyPrincipal = {
  authTime: null,
  displayName: 'Legacy Ops key',
  email: null,
  kind: 'ops_legacy',
  permissions: ['incidents:read'],
  role: null,
  sessionVersion: null,
  userId: null,
}

const namedPrincipal: OpsUserPrincipal = {
  authTime: new Date('2026-08-02T21:00:00.000Z'),
  displayName: 'Ops Viewer',
  email: 'viewer@abroad.finance',
  kind: 'ops_user',
  permissions: ['incidents:read'],
  role: OpsRole.VIEWER,
  sessionVersion: 1,
  userId: 'ops-user-1',
}

describe('authenticationContext', () => {
  const partner = { id: 'partner-1' } as unknown as import('@prisma/client').Partner
  const invalidWalletAuthentications: AuthenticatedPartner[] = [
    { ...partner, authenticationSource: 'API_KEY' },
    {
      ...partner,
      authenticatedSubject: 'stellar:pubnet:GABC',
      authenticationSource: 'SEP_24',
    },
    { ...partner, authenticationSource: 'WALLET' },
  ]

  it('returns the authenticated named Ops principal unchanged', () => {
    expect(requireNamedOpsPrincipal(namedPrincipal)).toBe(namedPrincipal)
  })

  it('maps a valid legacy principal on a named-only route to HTTP 403', () => {
    const error = (() => {
      try {
        requireNamedOpsPrincipal(legacyPrincipal)
        return null
      }
      catch (caught: unknown) {
        return caught
      }
    })()

    expect(error).toBeInstanceOf(ApplicationError)
    expect(mapErrorToHttpResponse(error)).toEqual({
      body: {
        code: 'ops_named_identity_required',
        message: 'Named Ops authentication is required',
        reason: 'Named Ops authentication is required',
      },
      status: 403,
    })
  })

  it('returns a wallet principal only when provenance and verified subject are present', () => {
    const walletPrincipal: AuthenticatedPartner = {
      ...partner,
      authenticatedSubject: 'stellar:pubnet:GABC',
      authenticationSource: 'WALLET',
    }

    expect(requireAuthenticatedWalletPrincipal(walletPrincipal)).toBe(walletPrincipal)
  })

  it.each(invalidWalletAuthentications)(
    'rejects non-wallet or subjectless partner authentication',
    (authentication) => {
      expect(() => requireAuthenticatedWalletPrincipal(authentication)).toThrow(
        'Authenticated wallet context is unavailable',
      )
    },
  )
})
