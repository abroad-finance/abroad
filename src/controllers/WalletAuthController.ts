// src/controllers/WalletAuthController.ts
import { inject } from 'inversify'
import {
  Body,
  Controller,
  Post,
  Res,
  Response,
  Route,
  SuccessResponse,
  TsoaResponse,
} from 'tsoa'
import { z } from 'zod'

import { IWalletAuthService } from '../interfaces'
import { TYPES } from '../types'

const addressSchema = z.object({ address: z.string().min(1) })
const verifySchema = z.object({ address: z.string().min(1), signature: z.string().min(1) })

@Route('walletAuth')
export class WalletAuthController extends Controller {
  constructor(@inject(TYPES.IWalletAuthService) private walletAuth: IWalletAuthService) {
    super()
  }

  /** Request a nonce challenge for signing */
  @Post('challenge')
  @SuccessResponse('200', 'Nonce generated')
  public async requestNonce(@Body() body: { address: string }): Promise<{ nonce: string }> {
    const parsed = addressSchema.safeParse(body)
    if (!parsed.success) {
      this.setStatus(400)
      throw new Error('Invalid address')
    }
    const nonce = await this.walletAuth.createChallenge(parsed.data.address)
    return { nonce }
  }

  /** Verify signed challenge and return a JWT */
  @Post('verify')
  @Response<401, { reason: string }>(401, 'Unauthorized')
  @SuccessResponse('200', 'Authenticated')
  public async verify(
    @Body() body: { address: string; signature: string },
    @Res() unauthorized: TsoaResponse<401, { reason: string }>,
  ): Promise<{ token: string }> {
    const parsed = verifySchema.safeParse(body)
    if (!parsed.success) {
      this.setStatus(400)
      throw new Error('Invalid payload')
    }
    const { address, signature } = parsed.data
    const ok = await this.walletAuth.verifySignature(address, signature)
    if (!ok) {
      return unauthorized(401, { reason: 'Invalid signature' })
    }
    const token = this.walletAuth.generateToken(address)
    return { token }
  }
}
