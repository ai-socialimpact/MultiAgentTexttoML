import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

interface AuthContextType {
  user: User | null;
  isAuthReady: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        // Ensure user document exists
        try {
          const userRef = doc(db, 'users', currentUser.uid);
          let userExists = false;
          try {
            const userSnap = await getDoc(userRef);
            userExists = userSnap.exists();
          } catch (error) {
            handleFirestoreError(error, OperationType.GET, `users/${currentUser.uid}`);
          }

          if (!userExists) {
            try {
              await setDoc(userRef, {
                userId: currentUser.uid,
                email: currentUser.email || '',
                name: currentUser.displayName || ''
              });
            } catch (error) {
              handleFirestoreError(error, OperationType.WRITE, `users/${currentUser.uid}`);
            }
          }
        } catch (err) {
          console.error('Failed to sync user document:', err);
        }
      }
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const login = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    }
  };

  const logout = () => signOut(auth);

  return (
    <AuthContext.Provider value={{ user, isAuthReady, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
