import React, { createContext, useContext, useEffect, useState } from 'react';
import { useBlux } from '@bluxcc/react';
import { walletAuth } from '../services/walletAuth';

interface WalletAuthState {
  token: string | null;
}

const WalletAuthContext = createContext<WalletAuthState>({ token: null });

export const WalletAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isAuthenticated } = useBlux();
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'));

  useEffect(() => {
    async function doAuth() {
      if (
        isAuthenticated &&
        user?.wallet?.address &&
        typeof (user.wallet as any).signMessage === 'function'
      ) {
        try {
          const newToken = await walletAuth(user.wallet.address, {
            signMessage: (user.wallet as any).signMessage,
          });
          localStorage.setItem('token', newToken);
          setToken(newToken);
        } catch (err) {
          console.error('Wallet authentication failed', err);
        }
      }
    }
    doAuth();
  }, [isAuthenticated, user]);

  return (
    <WalletAuthContext.Provider value={{ token }}>
      {children}
    </WalletAuthContext.Provider>
  );
};

export const useWalletAuth = () => useContext(WalletAuthContext);

