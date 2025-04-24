import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User, onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from '../services/firebase';

type AuthContextType = {
  user: User | null;
  setUser: (user: User | null) => void;
  logout: () => Promise<void>;
  initializing: boolean; // add initializing flag
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  setUser: () => {},
  logout: async () => {},
  initializing: true,
});

const SESSION_STORAGE_KEY = 'firebaseUser';

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(() => {
    const storedUser = sessionStorage.getItem(SESSION_STORAGE_KEY);
    try {
      return storedUser ? JSON.parse(storedUser) : null;
    } catch (error) {
      console.error("Failed to parse user from session storage", error);
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
  });

  // add initializing state
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(firebaseUser));
      } else {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
      }
      // mark initialization complete
      setInitializing(false);
    });
    return () => unsubscribe();
  }, []);

  const logout = async () => {
    await signOut(auth);
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  };

  return (
    <AuthContext.Provider value={{ user, setUser, logout, initializing }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
