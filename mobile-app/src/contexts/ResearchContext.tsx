import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../services/supabase';
import { ResearchSession, CapturedItem, TrailEntry } from '../types';
import { STORAGE_KEYS } from '../config';
import { useAuth } from './AuthContext';

interface ResearchContextValue {
  activeSession: ResearchSession | null;
  allSessions: ResearchSession[];
  isLoadingSessions: boolean;
  startSession: (name: string) => Promise<void>;
  pauseSession: () => Promise<void>;
  resumeSession: (sessionId: string) => Promise<void>;
  endSession: () => Promise<void>;
  addCapture: (item: Omit<CapturedItem, 'id' | 'timestamp'>) => Promise<void>;
  addTrailEntry: (entry: Omit<TrailEntry, 'id' | 'timestamp'>) => Promise<void>;
  loadSessions: () => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
}

const ResearchContext = createContext<ResearchContextValue | null>(null);

export function ResearchProvider({ children }: { children: React.ReactNode }) {
  const { session: authSession } = useAuth();
  const [activeSession, setActiveSession] = useState<ResearchSession | null>(null);
  const [allSessions, setAllSessions] = useState<ResearchSession[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);

  // Restore active session from storage on mount
  useEffect(() => {
    (async () => {
      const saved = await AsyncStorage.getItem(STORAGE_KEYS.ACTIVE_RESEARCH_SESSION);
      if (saved) setActiveSession(JSON.parse(saved));
    })();
  }, []);

  // Save active session to storage whenever it changes
  useEffect(() => {
    if (activeSession) {
      AsyncStorage.setItem(STORAGE_KEYS.ACTIVE_RESEARCH_SESSION, JSON.stringify(activeSession));
    } else {
      AsyncStorage.removeItem(STORAGE_KEYS.ACTIVE_RESEARCH_SESSION);
    }
  }, [activeSession]);

  const loadSessions = useCallback(async () => {
    if (!authSession) return;
    setIsLoadingSessions(true);
    try {
      const { data } = await supabase
        .from('research_sessions')
        .select('*')
        .eq('uploaded_by', authSession.username)
        .order('started_at', { ascending: false })
        .limit(20);
      if (data) setAllSessions(data as ResearchSession[]);
    } finally {
      setIsLoadingSessions(false);
    }
  }, [authSession]);

  useEffect(() => {
    if (authSession) loadSessions();
  }, [authSession, loadSessions]);

  const generateId = () => `CAP-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;

  const startSession = useCallback(async (name: string) => {
    if (!authSession) return;
    const now = new Date().toISOString();
    const newSession: ResearchSession = {
      id: crypto.randomUUID?.() ?? generateId(),
      uploaded_by: authSession.username,
      session_name: name,
      started_at: now,
      trail: [],
      captured_items: [],
      status: 'active',
    };

    const { data, error } = await supabase
      .from('research_sessions')
      .insert([{
        uploaded_by: newSession.uploaded_by,
        session_name: newSession.session_name,
        started_at: newSession.started_at,
        trail: [],
        captured_items: [],
        status: 'active',
      }])
      .select()
      .single();

    if (!error && data) {
      setActiveSession(data as ResearchSession);
      setAllSessions(prev => [data as ResearchSession, ...prev]);
    }
  }, [authSession]);

  const pauseSession = useCallback(async () => {
    if (!activeSession) return;
    const updated = { ...activeSession, status: 'paused' as const };
    await supabase
      .from('research_sessions')
      .update({ status: 'paused' })
      .eq('id', activeSession.id);
    setActiveSession(updated);
    setAllSessions(prev => prev.map(s => s.id === updated.id ? updated : s));
  }, [activeSession]);

  const resumeSession = useCallback(async (sessionId: string) => {
    const found = allSessions.find(s => s.id === sessionId);
    if (!found) return;
    const updated = { ...found, status: 'active' as const };
    await supabase
      .from('research_sessions')
      .update({ status: 'active' })
      .eq('id', sessionId);
    setActiveSession(updated);
    setAllSessions(prev => prev.map(s => s.id === sessionId ? updated : s));
  }, [allSessions]);

  const endSession = useCallback(async () => {
    if (!activeSession) return;
    const now = new Date().toISOString();
    const updated = { ...activeSession, status: 'ended' as const, ended_at: now };
    await supabase
      .from('research_sessions')
      .update({ status: 'ended', ended_at: now })
      .eq('id', activeSession.id);
    setActiveSession(null);
    setAllSessions(prev => prev.map(s => s.id === updated.id ? updated : s));
  }, [activeSession]);

  const addCapture = useCallback(async (item: Omit<CapturedItem, 'id' | 'timestamp'>) => {
    if (!activeSession) return;
    const newItem: CapturedItem = {
      ...item,
      id: generateId(),
      timestamp: new Date().toISOString(),
    };
    const updatedCaptures = [...activeSession.captured_items, newItem];
    const updated = { ...activeSession, captured_items: updatedCaptures };
    await supabase
      .from('research_sessions')
      .update({ captured_items: updatedCaptures })
      .eq('id', activeSession.id);
    setActiveSession(updated);
    setAllSessions(prev => prev.map(s => s.id === updated.id ? updated : s));
  }, [activeSession]);

  const addTrailEntry = useCallback(async (entry: Omit<TrailEntry, 'id' | 'timestamp'>) => {
    if (!activeSession) return;
    const newEntry: TrailEntry = {
      ...entry,
      id: generateId(),
      timestamp: new Date().toISOString(),
    };
    const updatedTrail = [...activeSession.trail, newEntry];
    const updated = { ...activeSession, trail: updatedTrail };
    await supabase
      .from('research_sessions')
      .update({ trail: updatedTrail })
      .eq('id', activeSession.id);
    setActiveSession(updated);
  }, [activeSession]);

  const deleteSession = useCallback(async (sessionId: string) => {
    await supabase.from('research_sessions').delete().eq('id', sessionId);
    setAllSessions(prev => prev.filter(s => s.id !== sessionId));
    if (activeSession?.id === sessionId) setActiveSession(null);
  }, [activeSession]);

  return (
    <ResearchContext.Provider
      value={{
        activeSession,
        allSessions,
        isLoadingSessions,
        startSession,
        pauseSession,
        resumeSession,
        endSession,
        addCapture,
        addTrailEntry,
        loadSessions,
        deleteSession,
      }}
    >
      {children}
    </ResearchContext.Provider>
  );
}

export function useResearch() {
  const ctx = useContext(ResearchContext);
  if (!ctx) throw new Error('useResearch must be used within ResearchProvider');
  return ctx;
}
