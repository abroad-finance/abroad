// src/wallet/adapters/WalletConnectAdapter.ts

import { WalletConnectModal } from '@walletconnect/modal'
import SignClient from '@walletconnect/sign-client'
import { getSdkError } from '@walletconnect/utils'
import { inject } from 'inversify'

import type { IWallet } from '../../interfaces/IWallet'
import type { IWalletAuthentication } from '../../interfaces/IWalletAuthentication'

import { ITypes } from '../../interfaces/ITypes'
import { WALLET_CONNECT_ID } from '../../shared/constants'

const STELLAR_CHAIN = 'stellar:pubnet'
const WC_METHOD_SIGN = 'stellar_signXDR'
const SESSION_STORE_KEY = 'wc:stellar:session'

type WCDeps = {
  metadata: {
    description: string
    icons: string[]
    name: string
    url: string
  }
  projectId: string
  qrModal: WalletConnectModal
}

export class WalletConnectAdapter implements IWallet {
  private client?: SignClient
  private readonly deps: WCDeps = {
    metadata: {
      description: 'Abroad bridges USDC on Stellar with real-time payment networks around the world, enabling seamless crypto-fiat payments. You will be able to pay anywhere in Brazil and Colombia with your USDC.',
      icons: ['https://storage.googleapis.com/cdn-abroad/Icons/Favicon/Abroad_Badge_transparent.png'],
      name: 'Abroad',
      url: 'https://app.abroad.finance',
    },
    projectId: WALLET_CONNECT_ID,
    qrModal: new WalletConnectModal({ projectId: WALLET_CONNECT_ID }),
  }

  private topic?: string

  constructor(
    @inject(ITypes.IWalletAuthentication) private walletAuth: IWalletAuthentication,
  ) { }

  connect: IWallet['connect'] = async () => {
    const client = await this.ensureClient()

    const { approval, uri } = await client.connect({
      requiredNamespaces: {
        stellar: {
          chains: [STELLAR_CHAIN],
          events: [],
          methods: [WC_METHOD_SIGN],
        },
      },
    })

    if (!uri) {
      throw new Error('No WalletConnect URI')
    }

    await this.deps.qrModal.openModal({ uri })

    const session = await approval()
    this.topic = session.topic
    // Persist session (auto-reconnect on reload)
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SESSION_STORE_KEY, JSON.stringify({ topic: this.topic }))
    }

    this.deps.qrModal.closeModal()

    const { address } = await this.getAddress()
    const { message } = await this.walletAuth.getChallengeMessage({ address })
    const { signedTxXdr } = await this.signTransaction({ message })
    const { token } = await this.walletAuth.getAuthToken({ address, signedMessage: signedTxXdr })

    return { authToken: token }
  }

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
    if (!this.client) throw new Error('WalletConnect client not initialized')
    if (!this.topic) throw new Error('No active WalletConnect session')
    const ns = this.client.session.get(this.topic)?.namespaces?.stellar
    const caip10 = ns?.accounts?.[0]
    if (!caip10) throw new Error('No Stellar account in session')
    return { address: this.caip10ToAddress(caip10) }
  }

  signTransaction: IWallet['signTransaction'] = async (
    { message },
  ) => {
    if (!this.client) throw new Error('WalletConnect client not initialized')
    if (!this.topic) throw new Error('No active WalletConnect session')
    const result = await this.client.request<{ signedXDR: string }>({
      chainId: STELLAR_CHAIN,
      request: {
        method: WC_METHOD_SIGN,
        params: { message },
      },
      topic: this.topic,
    })
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
