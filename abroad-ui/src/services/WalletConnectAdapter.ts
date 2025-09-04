import { type ISupportedWallet } from '@creit.tech/stellar-wallets-kit'
import { WalletConnectModal } from '@walletconnect/modal'
import SignClient from '@walletconnect/sign-client'
import { getSdkError } from '@walletconnect/utils'

// src/wallet/adapters/WalletConnectAdapter.ts
import type { IWallet, SignOpts } from '../interfaces/IWallet'

const STELLAR_CHAIN = 'stellar:pubnet' // CAIP-2 for Stellar mainnet
const WC_METHOD_SIGN = 'stellar_signXDR'
const SESSION_STORE_KEY = 'wc:stellar:session'

const isMobile
  = typeof window !== 'undefined'
    && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

type WCDeps = {
  metadata: {
    description: string
    icons: string[]
    name: string
    url: string
  }
  projectId: string
  // Optional, but recommended for desktop QR
  qrModal?: WalletConnectModal
}

export class WalletConnectAdapter implements IWallet {
  private client?: SignClient
  private topic?: string

  constructor(private readonly deps: WCDeps) {}

  async disconnect(): Promise<void> {
    const client = await this.ensureClient()
    if (this.topic) {
      await client.disconnect({
        reason: getSdkError('USER_DISCONNECTED'),
        topic: this.topic,
      })
      this.topic = undefined
      if (typeof localStorage !== 'undefined') localStorage.removeItem(SESSION_STORE_KEY)
    }
  }

  async getAddress(): Promise<{ address: string }> {
    await this.connectIfNeeded()
    if (!this.client) throw new Error('WalletConnect client not initialized')
    if (!this.topic) throw new Error('No active WalletConnect session')
    const ns = this.client.session.get(this.topic)?.namespaces?.stellar
    const caip10 = ns?.accounts?.[0]
    if (!caip10) throw new Error('No Stellar account in session')
    return { address: this.caip10ToAddress(caip10) }
  }

  // For WC: immediately start/connect. Caller's onWalletSelected will receive a pseudo-option.
  async openModal(params: {
    modalTitle?: string
    notAvailableText?: string
    onClosed?: (err: Error) => void
    onWalletSelected: (option: ISupportedWallet) => void
  }): Promise<void> {
    try {
      await this.connectIfNeeded(/* autoOpenUri */ true)

      // Satisfy the kit's shape: id, name, icon, url, isAvailable, type
      const wcWallet: ISupportedWallet = {
        icon: 'https://lobstr.co/favicon.ico', // any valid icon URL
        id: 'walletconnect', // any stable id is fine here; setWallet() is a no-op in this adapter
        isAvailable: true,
        name: 'WalletConnect (Lobstr)',
        type: 'WALLET_CONNECT',
        url: 'https://lobstr.co', // landing page for the wallet
      }

      params.onWalletSelected(wcWallet)
    }
    catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      params.onClosed?.(err)
      throw err
    }
  }

  // setWallet is a no-op for direct WC (wallet choice happens on the mobile device)
  setWallet(): void {
    // Intentionally empty
  }

  async signTransaction(
    xdr: string,
    opts?: SignOpts,
  ): Promise<{ signedTxXdr: string, signerAddress?: string }> {
    await this.connectIfNeeded()
    if (!this.client) throw new Error('WalletConnect client not initialized')
    if (!this.topic) throw new Error('No active WalletConnect session')
    const result = await this.client.request<{ signedXDR: string }>({
      chainId: STELLAR_CHAIN,
      request: {
        method: WC_METHOD_SIGN,
        params: { xdr },
      },
      topic: this.topic,
    })
    if (opts?.submit) {
      await fetch(`${(opts.submitUrl ?? '').replace(/\/$/, '')}/transactions`, {
        body: `tx=${encodeURIComponent(result.signedXDR)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        method: 'POST',
      })
    }
    // Address can be derived from the current session
    const ns = this.client.session.get(this.topic)?.namespaces?.stellar
    const addr = ns?.accounts?.length ? this.caip10ToAddress(ns.accounts[0]) : undefined
    return { signedTxXdr: result.signedXDR, signerAddress: addr }
  }

  private caip10ToAddress(caip10: string): string {
    // "stellar:pubnet:GABC...XYZ" -> take the 3rd segment
    const parts = caip10.split(':')
    return parts[2] ?? ''
  }

  private async connectIfNeeded(autoOpenUri = true) {
    const client = await this.ensureClient()
    if (this.topic) return

    const { approval, uri } = await client.connect({
      requiredNamespaces: {
        stellar: {
          chains: [STELLAR_CHAIN],
          events: [],
          methods: [WC_METHOD_SIGN],
        },
      },
    })

    // If pairing URI is provided, handle it
    if (uri) {
      if (isMobile && autoOpenUri) {
        // Your requirement: auto-open the URI on mobile (WalletConnect deep link)
        window.location.assign(uri)
      }
      else if (this.deps.qrModal) {
        await this.deps.qrModal.openModal({ uri })
      }
    }

    const session = await approval()
    this.topic = session.topic
    // Persist session (auto-reconnect on reload)
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SESSION_STORE_KEY, JSON.stringify({ topic: this.topic }))
    }

    if (this.deps.qrModal) {
      this.deps.qrModal.closeModal()
    }
  }

  private async ensureClient() {
    if (!this.client) {
      this.client = await SignClient.init({
        metadata: this.deps.metadata,
        projectId: this.deps.projectId,
      })
      // Restore persisted session if any
      const raw = typeof localStorage !== 'undefined' && localStorage.getItem(SESSION_STORE_KEY)
      if (raw) {
        try {
          const { topic } = JSON.parse(raw) as { topic?: string }
          if (topic && this.client.session.get(topic)) {
            this.topic = topic
          }
          else if (typeof localStorage !== 'undefined') {
            localStorage.removeItem(SESSION_STORE_KEY)
          }
        }
        catch {
          if (typeof localStorage !== 'undefined') localStorage.removeItem(SESSION_STORE_KEY)
        }
      }
    }
    return this.client
  }
}
