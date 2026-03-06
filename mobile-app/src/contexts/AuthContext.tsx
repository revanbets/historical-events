import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import { supabase } from '../services/supabase';
import { AppSession, User } from '../types';
import { STORAGE_KEYS } from '../config';

// Hardcoded test accounts — matches web app's HARDCODED_USERS
const HARDCODED_USERS: User[] = [
  { username: 'owner', role: 'owner', karma: 0, created_at: '' },
  { username: 'admin', role: 'admin', karma: 0, created_at: '' },
  { username: 'testuser', role: 'user', karma: 0, created_at: '' },
];
const HARDCODED_PASSWORDS: Record<string, string> = {
  owner: 'owner123',
  admin: 'admin123',
  testuser: 'test123',
};

interface AuthContextValue {
  session: AppSession | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<{ error?: string }>;
  logout: () => Promise<void>;
  biometricsAvailable: boolean;
  biometricsEnabled: boolean;
  setBiometricsEnabled: (enabled: boolean) => Promise<void>;
  loginWithBiometrics: () => Promise<{ error?: string }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AppSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const [biometricsEnabled, setBiometricsEnabledState] = useState(false);

  // Restore session on app launch
  useEffect(() => {
    (async () => {
      try {
        const [saved, bioEnabled, bioSupported] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.SESSION),
          AsyncStorage.getItem(STORAGE_KEYS.BIOMETRICS_ENABLED),
          LocalAuthentication.hasHardwareAsync(),
        ]);
        if (saved) setSession(JSON.parse(saved));
        setBiometricsEnabled(bioEnabled === 'true');
        if (bioSupported) {
          const enrolled = await LocalAuthentication.isEnrolledAsync();
          setBiometricsAvailable(enrolled);
        }
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const trimUser = username.trim().toLowerCase();

    // Check hardcoded test accounts first
    const hardcoded = HARDCODED_USERS.find(u => u.username === trimUser);
    if (hardcoded && HARDCODED_PASSWORDS[trimUser] === password) {
      const sess: AppSession = {
        username: hardcoded.username,
        role: hardcoded.role,
        karma: hardcoded.karma,
      };
      await AsyncStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(sess));
      setSession(sess);
      return {};
    }

    // Check real users in Supabase
    try {
      const { data, error } = await supabase
        .from('users')
        .select('username, role, karma')
        .eq('username', trimUser)
        .eq('password', password)
        .single();

      if (error || !data) return { error: 'Invalid username or password.' };

      const sess: AppSession = {
        username: data.username,
        role: data.role as AppSession['role'],
        karma: data.karma ?? 0,
      };
      await AsyncStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify(sess));
      setSession(sess);
      return {};
    } catch {
      return { error: 'Could not reach the server. Check your connection.' };
    }
  }, []);

  const logout = useCallback(async () => {
    await AsyncStorage.multiRemove([
      STORAGE_KEYS.SESSION,
      STORAGE_KEYS.ACTIVE_RESEARCH_SESSION,
    ]);
    setSession(null);
  }, []);

  const setBiometricsEnabled = useCallback(async (enabled: boolean) => {
    await AsyncStorage.setItem(STORAGE_KEYS.BIOMETRICS_ENABLED, String(enabled));
    setBiometricsEnabledState(enabled);
  }, []);

  const loginWithBiometrics = useCallback(async () => {
    const saved = await AsyncStorage.getItem(STORAGE_KEYS.SESSION);
    if (!saved) return { error: 'No saved session for biometric login. Please log in with your password first.' };

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Log in to HistoDB',
      fallbackLabel: 'Use Password',
    });

    if (result.success) {
      const sess = JSON.parse(saved) as AppSession;
      setSession(sess);
      return {};
    }
    return { error: 'Biometric authentication failed.' };
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        isLoading,
        login,
        logout,
        biometricsAvailable,
        biometricsEnabled,
        setBiometricsEnabled,
        loginWithBiometrics,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
