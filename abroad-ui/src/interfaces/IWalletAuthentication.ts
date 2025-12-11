export interface IWalletAuthentication {
  authenticate(address: string, signMessage: (message: string) => Promise<string>): Promise<{ token: string }>
  getAuthToken({ address, signedMessage }: { address: string
    signedMessage: string }): Promise<{ token: string }>
  getChallengeMessage({ address }: { address: string }): Promise<{ message: string }>
  jwtToken: null | string
  onTokenChange?: (listener: (token: null | string) => void) => () => void
  refreshAuthToken({ token }: { token: string }): Promise<{ token: string }>
  setJwtToken: (token: null | string) => void
}
