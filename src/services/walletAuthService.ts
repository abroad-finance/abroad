import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { Keypair } from '@stellar/stellar-sdk'
import { injectable } from 'inversify'
import 'reflect-metadata'

import { IWalletAuthService } from '../interfaces'

interface Challenge {
  nonce: string
  expires: number
}

@injectable()
export class WalletAuthService implements IWalletAuthService {
  private challenges = new Map<string, Challenge>()

  async createChallenge(address: string): Promise<string> {
    const nonce = crypto.randomBytes(16).toString('hex')
    this.challenges.set(address.toLowerCase(), {
      nonce,
      expires: Date.now() + 5 * 60 * 1000,
    })
    return nonce
  }

  async verifySignature(address: string, signature: string): Promise<boolean> {
    const record = this.challenges.get(address.toLowerCase())
    if (!record) return false
    if (Date.now() > record.expires) {
      this.challenges.delete(address.toLowerCase())
      return false
    }
    let valid = false
    try {
      const keypair = Keypair.fromPublicKey(address)
      const sigBuf = Buffer.from(signature, 'base64')
      const msgBuf = Buffer.from(record.nonce)
      valid = keypair.verify(msgBuf, sigBuf)
    } catch {
      return false
    }
    if (valid) {
      this.challenges.delete(address.toLowerCase())
    }
    return valid
  }

  generateToken(address: string): string {
    const secret = process.env.JWT_SECRET || 'change_this_secret'
    return jwt.sign({ address }, secret, { expiresIn: '1h' })
  }
}
