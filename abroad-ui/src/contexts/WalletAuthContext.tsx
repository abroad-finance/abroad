import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { walletAuth, refreshWalletAuthToken } from '../services/walletAuth';
import { kit } from '../services/stellarKit';
import { WalletNetwork } from '@creit.tech/stellar-wallets-kit';
import { PENDING_TX_KEY } from '../constants';

interface WalletAuthState {
  token: string | null;
  kycUrl: string | null;
  setKycUrl: (url: string) => void;
  authenticateWithWallet: (walletId: string) => Promise<void>;
  address: string | null;
  walletId: string | null;
  logout: () => void;
}

const WalletAuthContext = createContext<WalletAuthState>({ 
  token: null, 
  kycUrl: null, 
  authenticateWithWallet: async () => { }, 
  setKycUrl: () => {},
  address: null, walletId: null, 
  logout: () => { } ,
});

const signMessage = async (message: string): Promise<string> => {
  const response = await kit.signTransaction(message, { networkPassphrase: WalletNetwork.PUBLIC })
  return response.signedTxXdr;
}
export const WalletAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, _setToken] = useState<string | null>(() => localStorage.getItem('token'));
  const [ kycUrl, _setKycUrl ] = useState<string | null>(() => localStorage.getItem('kycUrl'))
  const [address, _setAddress] = useState<string | null>(() => localStorage.getItem('address'));
  const [walletId, _setWalletId] = useState<string | null>(() => localStorage.getItem('selectedWalletId'));

  const setToken = useCallback((newToken: string | null) => {
    _setToken(newToken);
    if (newToken) {
      localStorage.setItem('token', newToken);
    } else {
      localStorage.removeItem('token');
    }
  }, []);

  const setKycUrl = useCallback((url: string | null) => {
    _setKycUrl(url);
    if (url) {
      localStorage.setItem('kycUrl', url);
    } else {
      localStorage.removeItem('kycUrl');
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

  const logout = useCallback(() => {
    setToken(null);
    setAddress(null);
    setWalletId(null);
    setKycUrl(null);
    localStorage.removeItem(PENDING_TX_KEY);
    kit.disconnect();
  }, [setAddress, setKycUrl, setToken, setWalletId]);

  const refreshToken = useCallback(async () => {
    if (!token) return;
    try {
      const newToken = await refreshWalletAuthToken(token);
      setToken(newToken);
    } catch (err) {
      console.error('Failed to refresh wallet token', err);
      logout();
    }
  }, [logout, setToken, token]);


  useEffect(() => {
    if (!walletId) {
      logout()
      return;
    }
    kit.setWallet(walletId);
  }, [walletId, logout]);

  useEffect(() => {
    if (!token) {
      return;
    }
    const payload = JSON.parse(atob(token.split('.')[1])) as { exp?: number };
    if (!payload.exp) {
      return;
    }
    const timeout = payload.exp * 1000 - Date.now() - 60000;
    if (timeout <= 0) {
      refreshToken();
      return;
    }
    const id = setTimeout(refreshToken, timeout);
    return () => clearTimeout(id);
  }, [refreshToken, token]);

  // at mount check the url params for token
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');
    const address = urlParams.get('address');
    if (urlToken && address) {
      setToken(urlToken);
      setAddress(address);
      localStorage.setItem('token', urlToken);
      localStorage.setItem('address', address);
      urlParams.delete('token');
      urlParams.delete('address');
      window.history.replaceState({}, '', `${window.location.pathname}?${urlParams.toString()}`);
    }
  }, [setAddress, setToken]);

  return (
    <WalletAuthContext.Provider value={{ token, kycUrl, setKycUrl, authenticateWithWallet, address, walletId, logout }}>
      {children}
    </WalletAuthContext.Provider>
  );
};

export const useWalletAuth = () => useContext(WalletAuthContext);

