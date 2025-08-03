import { Keypair, WebAuth } from '@stellar/stellar-sdk'
import { inject } from 'inversify'
import jwt from 'jsonwebtoken'
import { Body, Controller, Post, Route } from 'tsoa'

import { ISecretManager } from '../interfaces/ISecretManager'
import { TYPES } from '../types'

const challenges = new Map<string, string>()

interface ChallengeRequest { address: string }
interface ChallengeResponse { xdr: string }

interface VerifyRequest { address: string, signedXDR: string }
interface VerifyResponse { token: string }

interface RefreshRequest { token: string }
interface RefreshResponse { token: string }

@Route('walletAuth')
export class WalletAuthController extends Controller {
  constructor(
    @inject(TYPES.ISecretManager)
    private secretManager: ISecretManager,
  ) {
    super()
  }

  @Post('challenge')
  public async challenge(
    @Body() body: ChallengeRequest,
  ): Promise<ChallengeResponse> {
    const { STELLAR_HOME_DOMAIN, STELLAR_NETWORK_PASSPHRASE, STELLAR_SERVER_KP, STELLAR_WEB_AUTH_DOMAIN } = await this.getSecrets()
    const xdr = WebAuth.buildChallengeTx(
      STELLAR_SERVER_KP,
      body.address,
      STELLAR_HOME_DOMAIN,
      300,
      STELLAR_NETWORK_PASSPHRASE,
      STELLAR_WEB_AUTH_DOMAIN,
    )
    challenges.set(body.address, xdr)
    return { xdr }
  }

  @Post('verify')
  public async verify(
    @Body() body: VerifyRequest,
  ): Promise<VerifyResponse> {
    const outstanding = challenges.get(body.address)
    if (!outstanding) {
      this.setStatus(400)
      throw new Error('No outstanding challenge for this account')
    }

    const { STELLAR_HOME_DOMAIN, STELLAR_NETWORK_PASSPHRASE, STELLAR_SEP_JWT_SECRET, STELLAR_SERVER_KP, STELLAR_WEB_AUTH_DOMAIN } = await this.getSecrets()

    const signers = WebAuth.verifyChallengeTxSigners(
      body.signedXDR,
      STELLAR_SERVER_KP.publicKey(),
      STELLAR_NETWORK_PASSPHRASE,
      [body.address],
      STELLAR_HOME_DOMAIN,
      STELLAR_WEB_AUTH_DOMAIN,
    )
    if (signers.length === 0) {
      this.setStatus(401)
      throw new Error('Missing or invalid client signature')
    }
    challenges.delete(body.address)
    const token = jwt.sign(
      { signers, sub: body.address },
      STELLAR_SEP_JWT_SECRET,
      { expiresIn: '1h' },
    )
    return { token }
  }

  @Post('refresh')
  public async refresh(
    @Body() body: RefreshRequest,
  ): Promise<RefreshResponse> {
    const { STELLAR_SEP_JWT_SECRET } = await this.getSecrets()
    try {
      const payload = jwt.verify(body.token, STELLAR_SEP_JWT_SECRET) as jwt.JwtPayload
      const newToken = jwt.sign(
        { signers: payload.signers, sub: payload.sub },
        STELLAR_SEP_JWT_SECRET,
        { expiresIn: '1h' },
      )
      return { token: newToken }
    } catch {
      this.setStatus(401)
      throw new Error('Invalid token')
    }
  }

  private async getSecrets() {
    const secrets = await this.secretManager.getSecrets([
      'STELLAR_PRIVATE_KEY',
      'STELLAR_NETWORK_PASSPHRASE',
      'STELLAR_HOME_DOMAIN',
      'STELLAR_WEB_AUTH_DOMAIN',
      'STELLAR_SEP_JWT_SECRET',
    ])
    const STELLAR_SERVER_KP = Keypair.fromSecret(secrets.STELLAR_PRIVATE_KEY)
    return {
      STELLAR_SERVER_KP, ...secrets }
  }
}
