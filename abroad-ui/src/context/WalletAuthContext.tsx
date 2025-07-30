import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { walletAuth } from '../services/walletAuth';
import { kit } from '../services/stellarKit';

interface WalletAuthState {
  token: string | null;
  authenticateWithWallet: () => Promise<void>;
  address: string | null;
  walletName: string | null;
  logout: () => Promise<void>;
}

const WalletAuthContext = createContext<WalletAuthState>({ token: null, authenticateWithWallet: async () => { }, address: null, walletName: null, logout: async () => { } });

export const WalletAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'));
  const [address, setAddress] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);

  const logout = useCallback(async () => {
    try {
      await kit.disconnect();
    } catch (kitError) {
      console.warn('StellarKit disconnect failed, but continuing logout:', kitError);
    } finally {
      localStorage.removeItem('token');
      localStorage.removeItem('selectedWalletName');
      setToken(null);
      setAddress(null);
      setWalletName(null);
    }
  }, []);

  const authenticateWithWallet = useCallback(async () => {
    if (!token) {
      try {
        // This will trigger the wallet selection modal if not already connected
        const { address } = await kit.getAddress();
        const newToken = await walletAuth(address);
        localStorage.setItem('token', newToken);
        setToken(newToken);
        setAddress(address);

        // Try to get wallet name using getCurrentWallet
        try {
          type KitWithCurrent = { getCurrentWallet?: () => { id?: string; name?: string } };
          const kitWithCurrent = kit as KitWithCurrent;
          const currentWallet = kitWithCurrent.getCurrentWallet?.();
          if (currentWallet && (currentWallet.id || currentWallet.name)) {
            // Prioritize ID over name for more reliable identification
            const walletIdentifier = currentWallet.id || currentWallet.name || '';
            if (walletIdentifier) {
              setWalletName(walletIdentifier);
              localStorage.setItem('selectedWalletName', walletIdentifier);
            }
          }
        } catch {
          console.log('Could not get wallet info from kit');
        }
      } catch (err) {
        console.trace('Wallet authentication failed', err);
      }
    }
  }, [token]);

  useEffect(() => {
    // Only try to reconnect if we have a token and no current address
    if (token && !address) {
      kit.getAddress().then(({ address }) => {
        if (!address) return;
        setAddress(address);
        
        // Try to get wallet name from kit first, then fallback to localStorage
        try {
          type KitWithCurrent = { getCurrentWallet?: () => { id?: string; name?: string } };
          const kitWithCurrent = kit as KitWithCurrent;
          const currentWallet = kitWithCurrent.getCurrentWallet?.();
          if (currentWallet && (currentWallet.name || currentWallet.id)) {
            const walletName = currentWallet.name || currentWallet.id || '';
            if (walletName) {
              setWalletName(walletName);
              localStorage.setItem('selectedWalletName', walletName);
            }
          } else {
            // Fallback to localStorage
            const storedWalletName = localStorage.getItem('selectedWalletName');
            if (storedWalletName) {
              setWalletName(storedWalletName);
            }
          }
        } catch {
          // Fallback to localStorage if kit access fails
          const storedWalletName = localStorage.getItem('selectedWalletName');
          if (storedWalletName) {
            setWalletName(storedWalletName);
          }
        }
      }).catch(err => {
        console.error('Failed to get address from StellarKit', err);
        logout();
      });
    }
  }, [address, token, logout]);






  return (
    <WalletAuthContext.Provider value={{ token, authenticateWithWallet, address, walletName, logout }}>
      {children}
    </WalletAuthContext.Provider>
  );
};

export const useWalletAuth = () => useContext(WalletAuthContext);

