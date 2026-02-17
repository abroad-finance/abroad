export interface IWallet {
  readonly address: null | string

  readonly chainId: null | string

  connect(options?: WalletConnectOptions): Promise<void>

  disconnect(): Promise<void>

  request?<TResult>(request: WalletConnectRequest): Promise<TResult>

  signTransaction(
    { message }: { message: string },
  ): Promise<{ signedTxXdr: string
    signerAddress?: string }>

  readonly walletId: null | string
}

export type WalletConnectMetadata = {
  chainId: string
  events: string[]
  methods: string[]
  namespace: string
}

export type WalletConnectOptions = {
  chainId?: string
  silentRestore?: boolean
  walletConnect?: WalletConnectMetadata
}

export type WalletConnectRequest = {
  chainId: string
  method: string
  params: Array<unknown> | Record<string, unknown>
}
