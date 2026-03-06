import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as Linking from 'expo-linking';
import { AuthProvider, useAuth } from '../src/contexts/AuthContext';
import { ResearchProvider } from '../src/contexts/ResearchContext';
import { useRouter } from 'expo-router';
import 'react-native-url-polyfill/auto';

SplashScreen.preventAutoHideAsync();

function RootLayoutInner() {
  const { session, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading) {
      SplashScreen.hideAsync();
      if (!session) {
        router.replace('/login');
      } else {
        router.replace('/(tabs)/');
      }
    }
  }, [session, isLoading, router]);

  // Handle deep links from iOS Share Extension:
  // histodb://share?url=https://tiktok.com/...
  useEffect(() => {
    const handleUrl = (event: { url: string }) => {
      const parsed = Linking.parse(event.url);
      if (parsed.hostname === 'share' && parsed.queryParams?.url) {
        // Navigate to research tab with the shared URL
        router.push({
          pathname: '/(tabs)/research',
          params: { sharedUrl: parsed.queryParams.url as string },
        });
      }
    };

    const subscription = Linking.addEventListener('url', handleUrl);

    // Handle initial URL (app opened from share sheet)
    Linking.getInitialURL().then(url => {
      if (url) handleUrl({ url });
    });

    return () => subscription.remove();
  }, [router]);

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0F1223' } }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="(modals)/event-detail"
        options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
      />
      <Stack.Screen
        name="(modals)/session-detail"
        options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <ResearchProvider>
        <StatusBar style="light" />
        <RootLayoutInner />
      </ResearchProvider>
    </AuthProvider>
  );
}
