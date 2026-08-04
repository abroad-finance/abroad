import {
  fireEvent,
  render,
  screen,
} from '@testing-library/react'
import {
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { ConnectWalletChainModal } from '../components/ui/ConnectWalletChainModal'

vi.mock('@tolgee/react', () => ({
  useTranslate: () => ({
    t: (_key: string, fallback: string, params?: Record<string, string>) => (
      Object.entries(params ?? {}).reduce(
        (value, [name, replacement]) => value.replace(`{${name}}`, replacement),
        fallback,
      )
    ),
  }),
}))

const options = [
  {
    chainKey: 'stellar:pubnet',
    chainLabel: 'Stellar',
    key: 'stellar-usdc',
    sourceAsset: 'USDC',
    walletLabel: 'Stellar-compatible wallets',
  },
  {
    chainKey: 'solana:mainnet',
    chainLabel: 'Solana',
    key: 'solana-usdc',
    sourceAsset: 'USDC',
    walletLabel: 'WalletConnect-compatible wallets',
  },
  {
    chainKey: 'celo:mainnet',
    chainLabel: 'Celo',
    key: 'celo-usdt',
    sourceAsset: 'USDT',
    walletLabel: 'WalletConnect-compatible wallets',
  },
]

describe('ConnectWalletChainModal', () => {
  it('leads with the source asset, discloses compatible networks, and requires confirmation', () => {
    const onClose = vi.fn()
    const onConnectRequest = vi.fn()
    const onSelectSource = vi.fn()
    render(
      <ConnectWalletChainModal
        onClose={onClose}
        onConnectRequest={onConnectRequest}
        onSelectSource={onSelectSource}
        open={true}
        options={options}
      />,
    )

    expect(screen.getByRole('heading', { name: 'What do you want to pay with?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /USDC/ })).toHaveTextContent('Compatible networks: Stellar, Solana')
    expect(screen.queryByRole('button', { name: /Stellar-compatible wallets/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /USDC/ }))
    expect(screen.getByRole('heading', { name: 'Choose a compatible network' })).toBeInTheDocument()
    const confirm = screen.getByRole('button', { name: 'Choose a network' })
    expect(confirm).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /Stellar-compatible wallets/ }))
    expect(screen.getByText('Pay with USDC on Stellar. Your wallet will open next.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Connect and use USDC' }))

    expect(onSelectSource).toHaveBeenCalledWith('stellar-usdc')
    expect(onConnectRequest).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledWith('selected')
  })

  it('reports dismissal without selecting or opening a wallet', () => {
    const onClose = vi.fn()
    const onConnectRequest = vi.fn()
    const onSelectSource = vi.fn()
    render(
      <ConnectWalletChainModal
        onClose={onClose}
        onConnectRequest={onConnectRequest}
        onSelectSource={onSelectSource}
        open={true}
        options={options}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close wallet selector' }))
    expect(onClose).toHaveBeenCalledWith('dismissed')
    expect(onSelectSource).not.toHaveBeenCalled()
    expect(onConnectRequest).not.toHaveBeenCalled()
  })
})
