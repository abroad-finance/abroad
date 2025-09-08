export interface IWalletAuthentication {
  getAuthToken({ address, signedMessage }: { address: string, signedMessage: string }): Promise<{ token: string }>
  getChallengeMessage({ address }: { address: string }): Promise<{ message: string }>
  refreshAuthToken({ token }: { token: string }): Promise<{ token: string }>
}
