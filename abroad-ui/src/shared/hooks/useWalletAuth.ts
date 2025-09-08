import { useContext } from 'react'

import { WalletAuthContext } from '../../contexts/WalletAuthContext'

export const useWalletAuth = () => useContext(WalletAuthContext)
