export interface IWalletAuthService {
  createChallenge(address: string): Promise<string>
  verifySignature(address: string, signature: string): Promise<boolean>
  generateToken(address: string): string
}
