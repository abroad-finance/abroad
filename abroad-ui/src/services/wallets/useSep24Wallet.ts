import { useEffect, useState } from 'react'

import { IWallet } from '../../interfaces/IWallet'
import { IWalletAuthentication } from '../../interfaces/IWalletAuthentication'

export const useSep24Wallet = ({ walletAuthentication }: {
  walletAuthentication: IWalletAuthentication
}): IWallet => {
  const [address, setAddress] = useState<null | string>(null)

  const connect = async () => {
    // The SEP-24 wallet is connected via URL parameters, so nothing to do here
    return
  }

  const disconnect = async () => {
    // The SEP-24 wallet is connected via URL parameters, so nothing to do here
    return
  }

  const signTransaction: IWallet['signTransaction'] = async () => {
    window.close()
    return {
      signedTxXdr: '',
      signerAddress: undefined,
    }
  }

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const urlToken = urlParams.get('token')
    const address = urlParams.get('address')
    if (urlToken && address) {
      walletAuthentication.setJwtToken(urlToken)
      setAddress(address)
      window.history.replaceState({}, '', `${window.location.pathname}?${urlParams.toString()}`)
    }
  }, [walletAuthentication])

  return {
    address,
    connect,
    disconnect,
    signTransaction,
    walletId: 'sep24',
  }
}
