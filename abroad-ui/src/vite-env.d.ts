/// <reference types="vite/client" />
/// <reference types="vitest" />
/// <reference types="@testing-library/jest-dom" />

declare const __ABROAD_UI_VERSION__: string

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
