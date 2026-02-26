import { PublicKey } from '@solana/web3.js'
import { Keypair, StrKey, WebAuth } from '@stellar/stellar-sdk'
import bs58 from 'bs58'
import { ethers } from 'ethers'
import { inject } from 'inversify'
import jwt from 'jsonwebtoken'
import { Body, Controller, Post, Route } from 'tsoa'
import nacl from 'tweetnacl'

import { UserError, ValidationError } from '../../../../core/errors'
import { TYPES } from '../../../../app/container/types'
import { ISecretManager } from '../../../../platform/secrets/ISecretManager'

const CHALLENGE_TTL_MS = 5 * 60 * 1000

type ChallengeEntry = {
  expiresAt: number
  message: string
}

const challenges = new Map<string, ChallengeEntry>()

interface ChallengeRequest {
  address: string
  chainId?: string
}

interface ChallengeResponse {
  challengeToken: string
  format: 'utf8' | 'xdr'
  message: string
  xdr?: string
}

interface RefreshRequest { token: string }
interface RefreshResponse { token: string }

interface VerifyRequest {
  address: string
  challengeToken?: string
  chainId?: string
  signature?: string
  signedXDR?: string
}

interface VerifyResponse { token: string }

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
    const {
      STELLAR_HOME_DOMAIN,
      STELLAR_NETWORK_PASSPHRASE,
      STELLAR_SEP_JWT_SECRET,
      STELLAR_SERVER_KP,
      STELLAR_WEB_AUTH_DOMAIN,
    } = await this.getSecrets()
    const resolvedChainId = this.resolveChainId(body.chainId, body.address, STELLAR_NETWORK_PASSPHRASE)
    const key = this.challengeKey(resolvedChainId, body.address)

    if (this.isStellarChain(resolvedChainId)) {
      if (!StrKey.isValidEd25519PublicKey(body.address)) {
        throw new ValidationError('Invalid Stellar address')
      }

      let xdr: string
      try {
        xdr = WebAuth.buildChallengeTx(
          STELLAR_SERVER_KP,
          body.address,
          STELLAR_HOME_DOMAIN,
          300,
          STELLAR_NETWORK_PASSPHRASE,
          STELLAR_WEB_AUTH_DOMAIN,
        )
      }
      catch {
        throw new ValidationError('Unable to build Stellar challenge for this address')
      }

      challenges.set(key, { expiresAt: Date.now() + CHALLENGE_TTL_MS, message: xdr })
      const challengeToken = this.createChallengeToken(STELLAR_SEP_JWT_SECRET, key, xdr)
      return {
        challengeToken,
        format: 'xdr',
        message: xdr,
        xdr,
      }
    }

    const message = this.buildChallengeMessage(resolvedChainId, body.address)
    challenges.set(key, { expiresAt: Date.now() + CHALLENGE_TTL_MS, message })
    const challengeToken = this.createChallengeToken(STELLAR_SEP_JWT_SECRET, key, message)
    return {
      challengeToken,
      format: 'utf8',
      message,
    }
  }

  @Post('refresh')
  public async refresh(
    @Body() body: RefreshRequest,
  ): Promise<RefreshResponse> {
    const { STELLAR_SEP_JWT_SECRET } = await this.getSecrets()
    try {
      const payload = jwt.verify(body.token, STELLAR_SEP_JWT_SECRET, { ignoreExpiration: true }) as jwt.JwtPayload
      const newToken = jwt.sign(
        { signers: payload.signers, sub: payload.sub },
        STELLAR_SEP_JWT_SECRET,
        { expiresIn: '1h' },
      )
      return { token: newToken }
    }
    catch {
      throw new UserError('Invalid token', undefined, 401)
    }
  }

  @Post('verify')
  public async verify(
    @Body() body: VerifyRequest,
  ): Promise<VerifyResponse> {
    const { STELLAR_HOME_DOMAIN, STELLAR_NETWORK_PASSPHRASE, STELLAR_SEP_JWT_SECRET, STELLAR_SERVER_KP, STELLAR_WEB_AUTH_DOMAIN } = await this.getSecrets()
    const resolvedChainId = this.resolveChainId(body.chainId, body.address, STELLAR_NETWORK_PASSPHRASE)
    const key = this.challengeKey(resolvedChainId, body.address)
    const outstandingMessage = this.resolveOutstandingChallenge(
      STELLAR_SEP_JWT_SECRET,
      key,
      body.challengeToken,
    )

    if (!outstandingMessage) {
      throw new ValidationError('No outstanding challenge for this account')
    }

    if (this.isStellarChain(resolvedChainId)) {
      if (!body.signedXDR) {
        throw new ValidationError('Signed XDR is required')
      }

      const signers = WebAuth.verifyChallengeTxSigners(
        body.signedXDR,
        STELLAR_SERVER_KP.publicKey(),
        STELLAR_NETWORK_PASSPHRASE,
        [body.address],
        STELLAR_HOME_DOMAIN,
        STELLAR_WEB_AUTH_DOMAIN,
      )
      if (signers.length === 0) {
        throw new UserError('Missing or invalid client signature', undefined, 401)
      }

      challenges.delete(key)
      const token = jwt.sign(
        { signers, sub: `${resolvedChainId}:${body.address}` },
        STELLAR_SEP_JWT_SECRET,
        { expiresIn: '1h' },
      )
      return { token }
    }

    if (!body.signature) {
      throw new ValidationError('Signature is required')
    }

    const verified = this.verifyNonStellarSignature(resolvedChainId, body.address, outstandingMessage, body.signature)
    if (!verified) {
      throw new UserError('Invalid signature', undefined, 401)
    }

    challenges.delete(key)
    const token = jwt.sign(
      { sub: `${resolvedChainId}:${body.address}` },
      STELLAR_SEP_JWT_SECRET,
      { expiresIn: '1h' },
    )
    return { token }
  }

  private createChallengeToken(secret: string, subject: string, message: string): string {
    return jwt.sign(
      {
        msg: message,
        typ: 'wallet_challenge',
      },
      secret,
      {
        expiresIn: Math.floor(CHALLENGE_TTL_MS / 1000),
        subject,
      },
    )
  }

  private resolveOutstandingChallenge(secret: string, key: string, challengeToken?: string): null | string {
    if (challengeToken && challengeToken.trim().length > 0) {
      try {
        const payload = jwt.verify(challengeToken, secret) as jwt.JwtPayload & {
          msg?: string
          typ?: string
        }
        if (payload.typ === 'wallet_challenge' && payload.sub === key && typeof payload.msg === 'string' && payload.msg.length > 0) {
          return payload.msg
        }
      }
      catch {
        // Fall back to in-memory challenge for backward compatibility.
      }
    }

    const outstanding = challenges.get(key)
    if (!outstanding || outstanding.expiresAt < Date.now()) {
      challenges.delete(key)
      return null
    }

    return outstanding.message
  }

  private buildChallengeMessage(chainId: string, address: string): string {
    const issuedAt = new Date().toISOString()
    const nonce = ethers.utils.hexlify(ethers.utils.randomBytes(12))
    return [
      'Abroad authentication',
      `Chain: ${chainId}`,
      `Address: ${address}`,
      `Nonce: ${nonce}`,
      `Issued At: ${issuedAt}`,
    ].join('\n')
  }

  private challengeKey(chainId: string, address: string): string {
    return `${chainId}:${address}`
  }

  private decodeSignature(signature: string): null | Uint8Array {
    const trimmed = signature.trim()
    if (!trimmed) return null

    const hex = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed
    if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) {
      return Uint8Array.from(Buffer.from(hex, 'hex'))
    }

    try {
      const asBase64 = Buffer.from(trimmed, 'base64')
      if (asBase64.length > 0) {
        return Uint8Array.from(asBase64)
      }
    }
    catch {
      // ignore
    }

    try {
      const asBase58 = bs58.decode(trimmed)
      if (asBase58.length > 0) {
        return Uint8Array.from(asBase58)
      }
    }
    catch {
      return null
    }

    return null
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
      STELLAR_SERVER_KP, ...secrets,
    }
  }

  private isStellarChain(chainId: string): boolean {
    return chainId.startsWith('stellar:')
  }

  private resolveChainId(chainId: string | undefined, address: string, passphrase: string): string {
    if (chainId && chainId.trim().length > 0) return chainId.trim()

    if (StrKey.isValidEd25519PublicKey(address)) {
      return this.resolveStellarChainId(passphrase)
    }

    if (ethers.utils.isAddress(address)) {
      return 'eip155:1'
    }

    if (this.isValidSolanaAddress(address)) {
      return 'solana:mainnet'
    }

    throw new ValidationError('chainId is required for this wallet address')
  }

  private resolveStellarChainId(passphrase: string): string {
    if (passphrase.toLowerCase().includes('test')) {
      return 'stellar:testnet'
    }
    return 'stellar:pubnet'
  }

  private isValidSolanaAddress(address: string): boolean {
    try {
      void new PublicKey(address)
      return true
    }
    catch {
      return false
    }
  }

  private verifyEvmSignature(address: string, message: string, signature: string): boolean {
    try {
      const recovered = ethers.utils.verifyMessage(message, signature)
      return recovered.toLowerCase() === address.toLowerCase()
    }
    catch {
      return false
    }
  }

  private verifyNonStellarSignature(chainId: string, address: string, message: string, signature: string): boolean {
    if (chainId.startsWith('eip155:')) {
      return this.verifyEvmSignature(address, message, signature)
    }

    if (chainId.startsWith('solana:')) {
      return this.verifySolanaSignature(address, message, signature)
    }

    return false
  }

  private verifySolanaSignature(address: string, message: string, signature: string): boolean {
    try {
      const publicKey = new PublicKey(address)
      const signatureBytes = this.decodeSignature(signature)
      if (!signatureBytes) {
        return false
      }
      const messageBytes = Buffer.from(message, 'utf8')
      return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey.toBytes())
    }
    catch {
      return false
    }
  }
}
