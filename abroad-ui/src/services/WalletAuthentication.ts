import type { IWalletAuthentication } from '../interfaces/IWalletAuthentication'

import { challenge, refresh, verify } from '../api'

export class WalletAuthentication implements IWalletAuthentication {
  async getAuthToken({ address, signedMessage }: { address: string, signedMessage: string }): Promise<{ token: string }> {
    const res = await verify({ address, signedXDR: signedMessage })
    if (res.status !== 200) throw new Error('Failed to verify signature')
    return { token: res.data.token }
  }

  async getChallengeMessage({ address }: { address: string }): Promise<{ message: string }> {
    const res = await challenge({ address })
    if (res.status !== 200) throw new Error('Failed to fetch challenge')
    return { message: res.data.xdr }
  }

  async refreshAuthToken({ token }: { token: string }): Promise<{ token: string }> {
    const res = await refresh({ token })
    if (res.status !== 200) throw new Error('Failed to refresh token')
    return { token: res.data.token }
  }
}
