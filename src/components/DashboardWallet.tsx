import React, { useState } from 'react'

const DashboardWallet: React.FC = () => {
  const [isConnected, setIsConnected] = useState(false)

  const handleWalletConnection = () => {
    setIsConnected(!isConnected)
  }

  return (
    <div className="dashboard-wallet">
      <h2 className="balance">
        $
        {isConnected ? '12,500' : '0'}
      </h2>
      <p className="wallet-message">
        {isConnected
          ? 'Total available balance in your wallet'
          : 'Please connect your wallet in order to start operations'}
      </p>
      <button
        className="wallet-button"
        onClick={handleWalletConnection}
      >
        {isConnected ? 'disconnect your wallet' : 'connect your wallet'}
      </button>
    </div>
  )
}

export default DashboardWallet
