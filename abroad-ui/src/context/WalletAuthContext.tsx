import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { walletAuth } from '../services/walletAuth';
import { kit } from '../services/stellarKit';
import { WalletNetwork } from '@creit.tech/stellar-wallets-kit';
import { PENDING_TX_KEY } from '../constants';

interface WalletAuthState {
  token: string | null;
  authenticateWithWallet: (walletId: string) => Promise<void>;
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
  const [token, _setToken] = useState<string | null>(() => localStorage.getItem('token'));
  const [address, _setAddress] = useState<string | null>(null);
  const [walletId, _setWalletId] = useState<string | null>(() => localStorage.getItem('selectedWalletId'));

  const setToken = useCallback((newToken: string | null) => {
    _setToken(newToken);
    if (newToken) {
      localStorage.setItem('token', newToken);
    } else {
      localStorage.removeItem('token');
    }
  }, []);

  const setAddress = useCallback((newAddress: string | null) => {
    _setAddress(newAddress);
    if (newAddress) {
      localStorage.setItem('address', newAddress);
    } else {
      localStorage.removeItem('address');
    }
  }, []);

  const setWalletId = useCallback((newWalletId: string | null) => {
    _setWalletId(newWalletId);

    if (newWalletId) {
      kit.setWallet(newWalletId);
      localStorage.setItem('selectedWalletId', newWalletId);
    } else {
      localStorage.removeItem('selectedWalletId');
    }
  }, []);

  const authenticateWithWallet = useCallback(async (walletId: string) => {
    if (
      !token
    ) {
      try {
        setWalletId(walletId);

        const { address } = await kit.getAddress();
        const newToken = await walletAuth(address, {
          signMessage
        });

        setToken(newToken);
        setAddress(address);
      } catch (err) {
        console.trace('Wallet authentication failed', err);
      }
    }
  }, [setAddress, setToken, setWalletId, token]);

  const handleSetWalletId = useCallback((newWalletId: string) => {
    setWalletId(newWalletId);
    localStorage.setItem('selectedWalletId', newWalletId);
  }, [setWalletId]);

  const logout = useCallback(() => {
    setToken(null);
    setAddress(null);
    setWalletId(null);
    localStorage.getItem(PENDING_TX_KEY);
    kit.disconnect();
  }, [setAddress, setToken, setWalletId]);

  useEffect(() => {
    if (!token || !walletId) {
      return;
    }
    kit.setWallet(walletId);
    kit.getAddress().then(({ address }) => {
      setAddress(address);
    }).catch(err => {
      console.error('Failed to get address from StellarKit', err);
      logout();
    });
  }, [logout, setAddress, token, walletId]);

  return (
    <WalletAuthContext.Provider value={{ token, authenticateWithWallet, address, walletId, setWalletId: handleSetWalletId, logout }}>
      {children}
    </WalletAuthContext.Provider>
  );
};

export const useWalletAuth = () => useContext(WalletAuthContext);

