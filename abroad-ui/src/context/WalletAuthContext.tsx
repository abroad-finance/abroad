import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { walletAuth } from '../services/walletAuth';
import { kit } from '../services/stellarKit';
import { WalletNetwork } from '@creit.tech/stellar-wallets-kit';

interface WalletAuthState {
  token: string | null;
  authenticateWithWallet: () => Promise<void>;
  address: string | null;
  walletId: string | null;
  setWalletId: (walletId: string) => void;
  logout: () => void;
}

const WalletAuthContext = createContext<WalletAuthState>({ token: null, authenticateWithWallet: async () => { }, address: null, walletId: null, setWalletId: () => { }, logout: () => { } });

const signMessage = async (message: string): Promise<string> => {
  const response = await kit.signTransaction(message, { networkPassphrase: WalletNetwork.PUBLIC })
  return response.signedTxXdr;
}
export const WalletAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'));
  const [address, setAddress] = useState<string | null>(null);
  const [walletId, setWalletId] = useState<string | null>(() => localStorage.getItem('selectedWalletId'));

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

  const handleSetWalletId = useCallback((newWalletId: string) => {
    setWalletId(newWalletId);
    localStorage.setItem('selectedWalletId', newWalletId);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('selectedWalletId');
    setToken(null);
    setAddress(null);
    setWalletId(null);
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
    <WalletAuthContext.Provider value={{ token, authenticateWithWallet, address, walletId, setWalletId: handleSetWalletId, logout }}>
      {children}
    </WalletAuthContext.Provider>
  );
};

export const useWalletAuth = () => useContext(WalletAuthContext);

