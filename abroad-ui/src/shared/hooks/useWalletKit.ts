import { useMemo } from 'react'

import { ITypes } from '../../interfaces/ITypes'
import { IWalletFactory } from '../../interfaces/IWalletFactory'
import { iocContainer } from '../../ioc'
import { getWalletTypeByDevice } from '../utils'

export const useWalletKit = () => {
  const kit = useMemo(() => {
    const walletFactory = iocContainer.get<IWalletFactory>(ITypes.IWalletFactory)
    const walletType = getWalletTypeByDevice()
    return walletFactory.getWalletHandler(walletType)
  }, [])

  return useMemo(() => ({ kit }), [kit])
}
