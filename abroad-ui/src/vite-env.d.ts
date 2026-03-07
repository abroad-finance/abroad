/// <reference types="vite/client" />
/// <reference types="vitest" />
/// <reference types="@testing-library/jest-dom" />

interface EthereumRequestArguments {
  method: string
  params?: Array<unknown> | Record<string, unknown>
}

interface MiniPayEthereumProvider {
  isMiniPay?: boolean
  request<TResult = unknown>(args: EthereumRequestArguments): Promise<TResult>
}

interface Window {
  ethereum?: MiniPayEthereumProvider
}
