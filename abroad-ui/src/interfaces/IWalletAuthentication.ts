export interface IWalletAuthentication {
  authenticate(params: { address: string
    chainId: string
    signMessage: (message: string) => Promise<string> }): Promise<{ token: string }>
  getAuthToken(params: { address: string
    challengeToken?: string
    chainId: string
    signedMessage: string }): Promise<{ token: string }>
  getChallengeMessage(params: { address: string
    chainId: string }): Promise<{ challengeToken?: string, message: string }>
  jwtToken: null | string
  onTokenChange?: (listener: (token: null | string) => void) => () => void
  refreshAuthToken(params: { token: string }): Promise<{ token: string }>
  setJwtToken: (token: null | string) => void
}
