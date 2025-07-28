import { Body, Controller, Post, Route } from 'tsoa';
import { randomBytes } from 'crypto';
import { ethers } from 'ethers';
import jwt from 'jsonwebtoken';

const challenges = new Map<string, string>();

interface ChallengeRequest {
  address: string;
}

interface ChallengeResponse {
  nonce: string;
}

interface VerifyRequest {
  address: string;
  signature: string;
}

interface VerifyResponse {
  token: string;
}

@Route('walletAuth')
export class WalletAuthController extends Controller {
  /**
   * Request a nonce challenge for the provided wallet address.
   */
  @Post('challenge')
  public async challenge(
    @Body() body: ChallengeRequest,
  ): Promise<ChallengeResponse> {
    const nonce = `0x${randomBytes(16).toString('hex')}`;
    challenges.set(body.address.toLowerCase(), nonce);
    return { nonce };
  }

  /**
   * Verify a signed challenge and issue a JWT token if valid.
   */
  @Post('verify')
  public async verify(
    @Body() body: VerifyRequest,
  ): Promise<VerifyResponse> {
    const expectedNonce = challenges.get(body.address.toLowerCase());
    if (!expectedNonce) {
      this.setStatus(400);
      throw new Error('No challenge for address');
    }

    const recovered = ethers.verifyMessage(expectedNonce, body.signature);
    if (recovered.toLowerCase() !== body.address.toLowerCase()) {
      this.setStatus(401);
      throw new Error('Invalid signature');
    }

    challenges.delete(body.address.toLowerCase());
    const secret = process.env.JWT_SECRET || 'secret';
    const token = jwt.sign({ address: body.address.toLowerCase() }, secret, {
      expiresIn: '1h',
    });
    return { token };
  }
}

