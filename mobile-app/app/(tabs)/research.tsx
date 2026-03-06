import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  Modal,
  SafeAreaView as RNSafeAreaView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useResearch } from '../../src/contexts/ResearchContext';
import { useAuth } from '../../src/contexts/AuthContext';
import { ClipboardCapture } from '../../src/components/ClipboardCapture';
import { ResearchSessionCard } from '../../src/components/ResearchSessionCard';
import { useClipboardMonitor } from '../../src/hooks/useClipboardMonitor';
import { analyzeUrl } from '../../src/services/api';
import { supabase } from '../../src/services/supabase';
import { colors, spacing, radius, typography } from '../../src/theme';

export default function ResearchScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ sharedUrl?: string }>();
  const { session } = useAuth();
  const {
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
  } = useResearch();

  const [detectedUrl, setDetectedUrl] = useState<string | null>(null);
  const [quickUrl, setQuickUrl] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showNewSession, setShowNewSession] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // Handle URL shared from iOS Share Extension or deep link
  useEffect(() => {
    if (params.sharedUrl) {
      setDetectedUrl(params.sharedUrl);
    }
  }, [params.sharedUrl]);

  // Clipboard detection — fires when app comes to foreground
  useClipboardMonitor({
    enabled: true,
    onUrlDetected: useCallback((url: string) => {
      setDetectedUrl(url);
    }, []),
  });

  const handleAddToSession = async (url: string) => {
    if (!activeSession) return;
    await addCapture({ type: 'url', url, source: 'clipboard' });
    await addTrailEntry({ url, title: url });
    Alert.alert('Added', 'URL added to your research session.');
  };

  const handleQuickAnalyze = async (url: string) => {
    if (!url) return;
    setIsAnalyzing(true);
    try {
      const result = await analyzeUrl({ url });
      if (result.record_id) {
        // Save to Supabase events table
        await supabase.from('events').insert([{
          id: result.record_id,
          title: result.title ?? 'Analyzed Event',
          description: '',
          ai_summary: result.ai_summary,
          topics: result.topics ?? [],
          people: result.people ?? [],
          organizations: result.organizations ?? [],
          links: [url],
          main_link: url,
          source_type: 'URL',
          source: url,
          uploaded_by: session?.username,
          is_public: false,
          event_status: 'unverified',
          ai_analyzed: true,
          date_uploaded: new Date().toISOString(),
        }]);
        Alert.alert('Saved!', `"${result.title}" has been analyzed and saved to your events.`);
      } else {
        Alert.alert('Error', result.error ?? 'Analysis failed. Try again.');
      }
    } catch {
      Alert.alert('Error', 'Could not reach the analysis server. It may be waking up — try again in 30 seconds.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleQuickCapture = async () => {
    const url = quickUrl.trim();
    if (!url) return;
    setQuickUrl('');
    if (activeSession) {
      await handleAddToSession(url);
    } else {
      Alert.alert(
        'No Active Session',
        'Would you like to analyze this URL and save it as an event?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Analyze & Save', onPress: () => handleQuickAnalyze(url) },
        ]
      );
    }
  };

  const handleStartSession = async () => {
    const name = newSessionName.trim() || `Research ${new Date().toLocaleDateString()}`;
    setShowNewSession(false);
    setNewSessionName('');
    await startSession(name);
  };

  const handleEndSession = () => {
    Alert.alert(
      'End Session',
      'Are you sure you want to end this research session?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'End Session', style: 'destructive', onPress: endSession },
      ]
    );
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadSessions().finally(() => setRefreshing(false));
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.blue} />}
      >
        {/* Header */}
        <Text style={styles.headerTitle}>Research</Text>

        {/* Clipboard / Share URL Detection Banner */}
        {detectedUrl && (
          <ClipboardCapture
            url={detectedUrl}
            hasActiveSession={!!activeSession}
            onAddToSession={handleAddToSession}
            onQuickAnalyze={handleQuickAnalyze}
            onDismiss={() => setDetectedUrl(null)}
          />
        )}

        {/* Active Session Panel */}
        {activeSession ? (
          <ActiveSessionPanel
            session={activeSession}
            onPause={pauseSession}
            onEnd={handleEndSession}
            onViewDetail={() =>
              router.push({
                pathname: '/(modals)/session-detail',
                params: { sessionId: activeSession.id },
              })
            }
          />
        ) : (
          <TouchableOpacity
            style={styles.startSessionBtn}
            onPress={() => setShowNewSession(true)}
          >
            <Ionicons name="flask" size={22} color={colors.purple} />
            <View style={styles.startSessionInfo}>
              <Text style={styles.startSessionTitle}>Start Research Session</Text>
              <Text style={styles.startSessionSub}>
                Track pages, capture links from TikTok, YouTube, Instagram, X and more
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        )}

        {/* Quick Capture Field */}
        <View style={styles.captureSection}>
          <Text style={styles.captureSectionTitle}>Quick Capture</Text>
          <Text style={styles.captureSectionSub}>
            Paste any URL — or copy a link from TikTok/Instagram/YouTube/X and come back here
          </Text>
          <View style={styles.captureRow}>
            <TextInput
              style={styles.captureInput}
              value={quickUrl}
              onChangeText={setQuickUrl}
              placeholder="https://..."
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="send"
              onSubmitEditing={handleQuickCapture}
            />
            <TouchableOpacity
              style={[styles.captureBtn, !quickUrl.trim() && styles.captureBtnDisabled]}
              onPress={handleQuickCapture}
              disabled={!quickUrl.trim() || isAnalyzing}
            >
              {isAnalyzing ? (
                <ActivityIndicator size="small" color="#000" />
              ) : (
                <Ionicons name="arrow-up" size={18} color="#000" />
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* iOS Shortcut tip */}
        <View style={styles.tipBox}>
          <Ionicons name="flash" size={14} color={colors.yellow} />
          <Text style={styles.tipText}>
            <Text style={{ fontWeight: typography.bold, color: colors.yellow }}>Pro tip: </Text>
            Create an iOS Shortcut to capture links from ANY app with one tap. Go to Shortcuts app → New Shortcut → "Get URLs from Input" → "Open URL" with{' '}
            <Text style={{ fontFamily: 'monospace', fontSize: 11 }}>histodb://share?url=[URL]</Text>.
            Add it to your Share Sheet for instant capture.
          </Text>
        </View>

        {/* Recent Sessions */}
        <View style={styles.sessionsHeader}>
          <Text style={styles.sectionTitle}>Recent Sessions</Text>
          <Text style={styles.sessionsCount}>{allSessions.length} sessions</Text>
        </View>

        {isLoadingSessions ? (
          <ActivityIndicator color={colors.blue} style={{ marginTop: spacing.lg }} />
        ) : allSessions.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="flask-outline" size={40} color={colors.textMuted} />
            <Text style={styles.emptyText}>No research sessions yet.</Text>
            <Text style={styles.emptySubText}>Start a session to track your research trail.</Text>
          </View>
        ) : (
          allSessions.map(s => (
            <ResearchSessionCard
              key={s.id}
              session={s}
              onPress={() =>
                router.push({
                  pathname: '/(modals)/session-detail',
                  params: { sessionId: s.id },
                })
              }
              onResume={s.status === 'paused' ? () => resumeSession(s.id) : undefined}
            />
          ))
        )}
      </ScrollView>

      {/* New Session Modal */}
      <Modal
        visible={showNewSession}
        transparent
        animationType="slide"
        onRequestClose={() => setShowNewSession(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.newSessionSheet}>
            <Text style={styles.newSessionTitle}>New Research Session</Text>
            <TextInput
              style={styles.newSessionInput}
              value={newSessionName}
              onChangeText={setNewSessionName}
              placeholder={`Research ${new Date().toLocaleDateString()}`}
              placeholderTextColor={colors.textMuted}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleStartSession}
            />
            <View style={styles.newSessionActions}>
              <TouchableOpacity
                style={styles.newSessionCancel}
                onPress={() => setShowNewSession(false)}
              >
                <Text style={styles.newSessionCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.newSessionStart} onPress={handleStartSession}>
                <Ionicons name="flask" size={16} color="#000" />
                <Text style={styles.newSessionStartText}>Start Session</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function ActiveSessionPanel({
  session,
  onPause,
  onEnd,
  onViewDetail,
}: {
  session: { session_name: string; started_at: string; trail: unknown[]; captured_items: unknown[]; status: string };
  onPause: () => void;
  onEnd: () => void;
  onViewDetail: () => void;
}) {
  const duration = Math.floor(
    (Date.now() - new Date(session.started_at).getTime()) / 60000
  );

  return (
    <View style={styles.activePanel}>
      <View style={styles.activePanelHeader}>
        <View style={styles.activePulse}>
          <View style={styles.activeDot} />
          <Text style={styles.activeLiveText}>LIVE</Text>
        </View>
        <Text style={styles.activePanelName} numberOfLines={1}>{session.session_name}</Text>
      </View>

      <View style={styles.activeStats}>
        <StatItem value={session.trail.length} label="Pages" />
        <StatItem value={session.captured_items.length} label="Captures" />
        <StatItem value={`${duration}m`} label="Duration" />
      </View>

      <View style={styles.activeActions}>
        <TouchableOpacity style={styles.activeActionBtn} onPress={onViewDetail}>
          <Ionicons name="list" size={16} color={colors.blue} />
          <Text style={styles.activeActionText}>View Trail</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.activeActionBtn} onPress={onPause}>
          <Ionicons name="pause" size={16} color={colors.yellow} />
          <Text style={[styles.activeActionText, { color: colors.yellow }]}>Pause</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.activeActionBtn, styles.endBtn]} onPress={onEnd}>
          <Ionicons name="stop" size={16} color={colors.red} />
          <Text style={[styles.activeActionText, { color: colors.red }]}>End</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function StatItem({ value, label }: { value: string | number; label: string }) {
  return (
    <View style={styles.statItem}>
      <Text style={styles.statItemValue}>{value}</Text>
      <Text style={styles.statItemLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.md, paddingBottom: 32 },
  headerTitle: { fontSize: typography.xxl, fontWeight: typography.bold, color: colors.textPrimary, marginBottom: spacing.md },

  // Active session
  activePanel: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.green + '40',
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  activePanelHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  activePulse: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.greenLight,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.green },
  activeLiveText: { fontSize: 10, fontWeight: typography.bold, color: colors.green, letterSpacing: 0.5 },
  activePanelName: { flex: 1, fontSize: typography.base, fontWeight: typography.bold, color: colors.textPrimary },
  activeStats: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  statItem: {
    flex: 1,
    backgroundColor: colors.surfaceHighlight,
    borderRadius: radius.md,
    padding: spacing.sm,
    alignItems: 'center',
  },
  statItemValue: { fontSize: typography.lg, fontWeight: typography.bold, color: colors.textPrimary },
  statItemLabel: { fontSize: 10, color: colors.textMuted },
  activeActions: { flexDirection: 'row', gap: spacing.xs },
  activeActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 9,
    backgroundColor: colors.surfaceHighlight,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  endBtn: { borderColor: colors.redLight, backgroundColor: colors.redLight },
  activeActionText: { fontSize: typography.sm, fontWeight: typography.medium, color: colors.blue },

  // Start session
  startSessionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.purpleLight,
    borderWidth: 1,
    borderColor: colors.purple + '40',
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  startSessionInfo: { flex: 1 },
  startSessionTitle: { fontSize: typography.base, fontWeight: typography.bold, color: colors.textPrimary },
  startSessionSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },

  // Quick capture
  captureSection: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  captureSectionTitle: { fontSize: typography.base, fontWeight: typography.bold, color: colors.textPrimary, marginBottom: 2 },
  captureSectionSub: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm },
  captureRow: { flexDirection: 'row', gap: spacing.sm },
  captureInput: {
    flex: 1,
    backgroundColor: colors.surfaceHighlight,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: typography.sm,
    color: colors.textPrimary,
    fontFamily: 'monospace',
  },
  captureBtn: {
    width: 44,
    height: 44,
    backgroundColor: colors.blue,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureBtnDisabled: { opacity: 0.4 },

  // iOS tip
  tipBox: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.yellowLight,
    borderWidth: 1,
    borderColor: colors.yellow + '40',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  tipText: { flex: 1, fontSize: 12, color: colors.textSecondary, lineHeight: 18 },

  // Sessions list
  sessionsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  sectionTitle: { fontSize: typography.md, fontWeight: typography.bold, color: colors.textPrimary },
  sessionsCount: { fontSize: typography.sm, color: colors.textMuted },
  emptyState: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.xs },
  emptyText: { fontSize: typography.base, color: colors.textSecondary, fontWeight: typography.medium },
  emptySubText: { fontSize: typography.sm, color: colors.textMuted },

  // New session modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  newSessionSheet: {
    backgroundColor: colors.surfaceElevated,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: 40,
    gap: spacing.md,
  },
  newSessionTitle: { fontSize: typography.lg, fontWeight: typography.bold, color: colors.textPrimary },
  newSessionInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 48,
    fontSize: typography.base,
    color: colors.textPrimary,
  },
  newSessionActions: { flexDirection: 'row', gap: spacing.sm },
  newSessionCancel: {
    flex: 1,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  newSessionCancelText: { color: colors.textSecondary, fontSize: typography.base },
  newSessionStart: {
    flex: 2,
    flexDirection: 'row',
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.purple,
    borderRadius: radius.md,
  },
  newSessionStartText: { color: '#000', fontSize: typography.base, fontWeight: typography.bold },
});
