import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { walletAuth } from '../services/walletAuth';
import { kit } from '../services/stellarKit';

interface WalletAuthState {
  token: string | null;
  authenticateWithWallet: () => Promise<void>;
  address: string | null;
  logout: () => Promise<void>;
}

const WalletAuthContext = createContext<WalletAuthState>({ token: null, authenticateWithWallet: async () => { }, address: null, logout: async () => { } });

export const WalletAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'));
  const [address, setAddress] = useState<string | null>(null);

  const authenticateWithWallet = useCallback(async () => {
    if (
      !token
    ) {
      try {
        const { address } = await kit.getAddress();
        const newToken = await walletAuth(address);
        localStorage.setItem('token', newToken);
        setToken(newToken);
        setAddress(address);
      } catch (err) {
        console.trace('Wallet authentication failed', err);
      }
    }
  }, [token]);

  const logout = useCallback(async () => {
    try {
      console.log('Starting wallet logout process...');
      
      // Clear local storage first
      localStorage.removeItem('token');
      console.log('Token removed from localStorage');
      
      // Reset state
      setToken(null);
      setAddress(null);
      console.log('State reset');
      
      // Disconnect wallet kit
      try {
        await kit.disconnect();
        console.log('StellarKit disconnected successfully');
      } catch (kitError) {
        console.warn('StellarKit disconnect failed, but continuing logout:', kitError);
      }
      
      console.log('Wallet disconnected successfully');
    } catch (err) {
      console.error('Error during logout:', err);
      // Still clear local state even if other operations fail
      localStorage.removeItem('token');
      setToken(null);
      setAddress(null);
    }
  }, []);

  useEffect(() => {
    // Only try to reconnect if we have a token and no current address
    if (token && !address) {
      kit.getAddress().then(({ address }) => {
        if (!address) return;
        setAddress(address);
      }).catch(err => {
        console.error('Failed to get address from StellarKit', err);
        logout();
      });
    }
  }, [address, token, logout]);






  return (
    <WalletAuthContext.Provider value={{ token, authenticateWithWallet, address, logout }}>
      {children}
    </WalletAuthContext.Provider>
  );
};

export const useWalletAuth = () => useContext(WalletAuthContext);

