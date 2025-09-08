export interface IWallet {
  readonly address: null | string
  connect(): Promise<{ authToken: string }>

  disconnect(): Promise<void>

  signTransaction(
    { message }: { message: string },
  ): Promise<{ signedTxXdr: string, signerAddress?: string }>

  readonly walletId: null | string
}
