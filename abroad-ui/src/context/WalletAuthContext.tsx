import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { walletAuth } from '../services/walletAuth';
import { kit } from '../services/stellarKit';
import { WalletNetwork } from '@creit.tech/stellar-wallets-kit';

interface WalletAuthState {
  token: string | null;
  authenticateWithWallet: () => Promise<void>;
  address: string | null;
  logout: () => void;
}

const WalletAuthContext = createContext<WalletAuthState>({ token: null, authenticateWithWallet: async () => { }, address: null, logout: () => { } });

const signMessage = async (message: string): Promise<string> => {
  const response = await kit.signTransaction(message, { networkPassphrase: WalletNetwork.PUBLIC })
  return response.signedTxXdr;
}
export const WalletAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'));
  const [address, setAddress] = useState<string | null>(null);

  const authenticateWithWallet = useCallback(async () => {
    if (
      !token
    ) {
      try {
        const { address } = await kit.getAddress();
        const newToken = await walletAuth(address, {
          signMessage
        });
        localStorage.setItem('token', newToken);
        setToken(newToken);
        setAddress(address);
      } catch (err) {
        console.trace('Wallet authentication failed', err);
      }
    }
  }, [token]);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    setToken(null);
    setAddress(null);
    kit.disconnect();
  }, []);

  useEffect(() => {
    kit.getAddress().then(({ address }) => {
      if (!address) return;
      authenticateWithWallet()
    }).catch(err => {
      console.error('Failed to get address from StellarKit', err);
      logout();
    });
  }, [authenticateWithWallet, logout]);






  return (
    <WalletAuthContext.Provider value={{ token, authenticateWithWallet, address, logout }}>
      {children}
    </WalletAuthContext.Provider>
  );
};

export const useWalletAuth = () => useContext(WalletAuthContext);

