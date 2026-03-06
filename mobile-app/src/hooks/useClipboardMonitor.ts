import { useEffect, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../config';

const URL_REGEX = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&/=]*)/i;

interface UseClipboardMonitorOptions {
  enabled?: boolean;
  onUrlDetected: (url: string) => void;
}

/**
 * Monitors the clipboard for URLs whenever the app comes to the foreground.
 * This is the primary mechanism for capturing links from TikTok, Instagram,
 * YouTube, X, and any other app — user copies a link and switches back here.
 */
export function useClipboardMonitor({ enabled = true, onUrlDetected }: UseClipboardMonitorOptions) {
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const callbackRef = useRef(onUrlDetected);
  callbackRef.current = onUrlDetected;

  const checkClipboard = useCallback(async () => {
    if (!enabled) return;
    try {
      const content = await Clipboard.getStringAsync();
      if (!content || !URL_REGEX.test(content)) return;

      // Avoid re-triggering for the same URL
      const lastSeen = await AsyncStorage.getItem(STORAGE_KEYS.LAST_CLIPBOARD);
      if (content === lastSeen) return;

      await AsyncStorage.setItem(STORAGE_KEYS.LAST_CLIPBOARD, content);
      const url = content.match(URL_REGEX)?.[0];
      if (url) callbackRef.current(url);
    } catch {
      // Clipboard access can fail in some environments — fail silently
    }
  }, [enabled]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      // Fire when app comes back to foreground from background/inactive
      if (
        appState.current.match(/inactive|background/) &&
        nextState === 'active'
      ) {
        checkClipboard();
      }
      appState.current = nextState;
    });

    return () => subscription.remove();
  }, [checkClipboard]);

  // Also check immediately on mount (in case app was opened via share)
  useEffect(() => {
    checkClipboard();
  }, [checkClipboard]);
}

/** Clear the saved "last seen" clipboard entry so the same URL can be re-detected */
export async function clearClipboardHistory() {
  await AsyncStorage.removeItem(STORAGE_KEYS.LAST_CLIPBOARD);
}
