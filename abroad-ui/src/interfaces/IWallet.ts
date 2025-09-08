export interface IWallet {
  readonly address: null | string

  connect(): Promise<void>

  disconnect(): Promise<void>

  signTransaction(
    { message }: { message: string },
  ): Promise<{ signedTxXdr: string, signerAddress?: string }>

  readonly walletId: null | string
}
