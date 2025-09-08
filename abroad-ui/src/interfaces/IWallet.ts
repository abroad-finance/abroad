export interface IWallet {
  connect(): Promise<{ authToken: string }>

  disconnect(): Promise<void>

  getAddress(): Promise<{ address: string }>

  signTransaction(
    { message }: { message: string },
  ): Promise<{ signedTxXdr: string, signerAddress?: string }>
}
