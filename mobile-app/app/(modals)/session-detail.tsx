import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useResearch } from '../../src/contexts/ResearchContext';
import { useAuth } from '../../src/contexts/AuthContext';
import { analyzeUrl } from '../../src/services/api';
import { supabase } from '../../src/services/supabase';
import { ResearchSession, CapturedItem, TrailEntry } from '../../src/types';
import { colors, spacing, radius, typography } from '../../src/theme';
import { detectSourceFromUrl } from '../../src/theme';

export default function SessionDetailScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const { session: authSession } = useAuth();
  const { allSessions, activeSession, endSession } = useResearch();

  const [session, setSession] = useState<ResearchSession | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState<{ done: number; total: number } | null>(null);
  const [activeView, setActiveView] = useState<'trail' | 'captures'>('captures');

  useEffect(() => {
    // Find session from context first, then fetch from Supabase if needed
    const found = allSessions.find(s => s.id === sessionId) ??
      (activeSession?.id === sessionId ? activeSession : null);
    if (found) {
      setSession(found);
    } else {
      loadSession();
    }
  }, [sessionId, allSessions, activeSession]);

  const loadSession = async () => {
    const { data } = await supabase
      .from('research_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();
    if (data) setSession(data as ResearchSession);
  };

  const handleAnalyzeAndSave = async () => {
    if (!session || !authSession) return;

    const captures = session.captured_items.filter(c => c.type === 'url' && c.url);
    const trailUrls = session.trail.map(t => t.url).filter(Boolean);
    const allUrls = [...new Set([...captures.map(c => c.url!), ...trailUrls])];

    if (allUrls.length === 0) {
      Alert.alert('Nothing to Analyze', 'There are no captured URLs in this session to analyze.');
      return;
    }

    Alert.alert(
      'Analyze & Save',
      `This will analyze ${allUrls.length} URLs and save them as events. The backend may take a moment to wake up.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start Analysis',
          onPress: async () => {
            setIsAnalyzing(true);
            setAnalyzeProgress({ done: 0, total: allUrls.length });
            let saved = 0;

            for (const url of allUrls) {
              try {
                const result = await analyzeUrl({ url });
                if (result.record_id) {
                  await supabase.from('events').insert([{
                    id: result.record_id,
                    title: result.title ?? 'Untitled',
                    description: '',
                    ai_summary: result.ai_summary,
                    topics: result.topics ?? [],
                    people: result.people ?? [],
                    organizations: result.organizations ?? [],
                    links: [url],
                    main_link: url,
                    source_type: 'Research Session',
                    source: url,
                    uploaded_by: authSession.username,
                    is_public: false,
                    event_status: 'unverified',
                    ai_analyzed: true,
                    date_uploaded: new Date().toISOString(),
                  }]);
                  saved++;
                }
              } catch {
                // Continue with next URL on error
              }
              setAnalyzeProgress(prev => prev ? { ...prev, done: prev.done + 1 } : null);
            }

            // Mark session as analyzed
            await supabase
              .from('research_sessions')
              .update({ status: 'analyzed' })
              .eq('id', session.id);

            setIsAnalyzing(false);
            setAnalyzeProgress(null);
            Alert.alert('Done!', `${saved} event${saved !== 1 ? 's' : ''} saved from this session.`);
            router.back();
          },
        },
      ]
    );
  };

  if (!session) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.blue} size="large" style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  const isActive = session.status === 'active' || session.status === 'paused';
  const canAnalyze = session.status === 'ended' || session.status === 'paused';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-down" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{session.session_name}</Text>
        {isActive && (
          <TouchableOpacity
            style={styles.endBtn}
            onPress={() => Alert.alert('End Session', 'End this session?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'End', style: 'destructive', onPress: () => { endSession(); router.back(); } },
            ])}
          >
            <Ionicons name="stop-circle" size={16} color={colors.red} />
            <Text style={styles.endBtnText}>End</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Session Stats */}
        <View style={styles.statsGrid}>
          <StatBox label="Pages" value={session.trail.length} icon="footsteps" color={colors.blue} />
          <StatBox label="Captures" value={session.captured_items.length} icon="bookmark" color={colors.purple} />
          <StatBox
            label="Status"
            value={session.status.charAt(0).toUpperCase() + session.status.slice(1)}
            icon="radio-button-on"
            color={session.status === 'active' ? colors.green : session.status === 'analyzed' ? colors.blue : colors.textMuted}
          />
          <StatBox
            label="Started"
            value={new Date(session.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            icon="calendar"
            color={colors.textMuted}
          />
        </View>

        {/* Analyze & Save */}
        {canAnalyze && !isAnalyzing && (
          <TouchableOpacity style={styles.analyzeBtn} onPress={handleAnalyzeAndSave}>
            <Ionicons name="sparkles" size={20} color="#000" />
            <View style={{ flex: 1 }}>
              <Text style={styles.analyzeBtnTitle}>Analyze & Save to Events</Text>
              <Text style={styles.analyzeBtnSub}>
                AI will process each URL and create event records
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#00000080" />
          </TouchableOpacity>
        )}

        {/* Analysis Progress */}
        {isAnalyzing && analyzeProgress && (
          <View style={styles.progressBox}>
            <ActivityIndicator color={colors.purple} size="small" />
            <View style={{ flex: 1 }}>
              <Text style={styles.progressText}>
                Analyzing {analyzeProgress.done + 1} of {analyzeProgress.total}…
              </Text>
              <View style={styles.progressBar}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${(analyzeProgress.done / analyzeProgress.total) * 100}%` },
                  ]}
                />
              </View>
            </View>
          </View>
        )}

        {/* Tab switcher */}
        <View style={styles.viewTabs}>
          <TouchableOpacity
            style={[styles.viewTab, activeView === 'captures' && styles.viewTabActive]}
            onPress={() => setActiveView('captures')}
          >
            <Ionicons name="bookmark" size={14} color={activeView === 'captures' ? colors.blue : colors.textMuted} />
            <Text style={[styles.viewTabText, activeView === 'captures' && { color: colors.blue }]}>
              Captures ({session.captured_items.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.viewTab, activeView === 'trail' && styles.viewTabActive]}
            onPress={() => setActiveView('trail')}
          >
            <Ionicons name="footsteps" size={14} color={activeView === 'trail' ? colors.blue : colors.textMuted} />
            <Text style={[styles.viewTabText, activeView === 'trail' && { color: colors.blue }]}>
              Trail ({session.trail.length})
            </Text>
          </TouchableOpacity>
        </View>

        {/* Captures List */}
        {activeView === 'captures' && (
          <>
            {session.captured_items.length === 0 ? (
              <EmptyState icon="bookmark-outline" text="No captures yet." />
            ) : (
              session.captured_items.map(item => (
                <CaptureRow key={item.id} item={item} />
              ))
            )}
          </>
        )}

        {/* Trail List */}
        {activeView === 'trail' && (
          <>
            {session.trail.length === 0 ? (
              <EmptyState icon="footsteps-outline" text="No trail entries yet." />
            ) : (
              session.trail.map((entry, i) => (
                <TrailRow key={entry.id} entry={entry} index={i + 1} />
              ))
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatBox({ label, value, icon, color }: { label: string; value: string | number; icon: string; color: string }) {
  return (
    <View style={styles.statBox}>
      <Ionicons name={icon as never} size={16} color={color} />
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function CaptureRow({ item }: { item: CapturedItem }) {
  const source = item.url ? detectSourceFromUrl(item.url) : { name: 'Web', color: colors.blue };
  return (
    <View style={styles.captureRow}>
      <View style={[styles.captureIconWrap, { backgroundColor: source.color + '20' }]}>
        <Ionicons
          name={item.type === 'text' ? 'text' : item.type === 'video' ? 'videocam' : 'link'}
          size={14}
          color={source.color}
        />
      </View>
      <View style={styles.captureContent}>
        {item.url && (
          <TouchableOpacity onPress={() => Linking.openURL(item.url!)}>
            <Text style={styles.captureUrl} numberOfLines={1}>{item.url}</Text>
          </TouchableOpacity>
        )}
        {item.text && (
          <Text style={styles.captureText} numberOfLines={3}>{item.text}</Text>
        )}
        {item.timecode && (
          <Text style={styles.captureTimecode}>⏱ {item.timecode}{item.timecodeEnd ? ` → ${item.timecodeEnd}` : ''}</Text>
        )}
        <View style={styles.captureFooter}>
          <View style={[styles.sourcePill, { borderColor: source.color + '40', backgroundColor: source.color + '15' }]}>
            <Text style={[styles.sourcePillText, { color: source.color }]}>{source.name}</Text>
          </View>
          <Text style={styles.captureTime}>{new Date(item.timestamp).toLocaleTimeString()}</Text>
        </View>
      </View>
    </View>
  );
}

function TrailRow({ entry, index }: { entry: TrailEntry; index: number }) {
  return (
    <TouchableOpacity
      style={styles.trailRow}
      onPress={() => entry.url && Linking.openURL(entry.url)}
    >
      <Text style={styles.trailIndex}>{index}</Text>
      <View style={styles.trailContent}>
        <Text style={styles.trailTitle} numberOfLines={1}>{entry.title ?? entry.url}</Text>
        <Text style={styles.trailUrl} numberOfLines={1}>{entry.url}</Text>
      </View>
      <Ionicons name="open-outline" size={14} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.emptyState}>
      <Ionicons name={icon as never} size={36} color={colors.textMuted} />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { padding: 4 },
  headerTitle: { flex: 1, fontSize: typography.base, fontWeight: typography.bold, color: colors.textPrimary },
  endBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.redLight,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.sm,
  },
  endBtnText: { fontSize: typography.sm, color: colors.red, fontWeight: typography.semibold },
  scroll: { padding: spacing.md, paddingBottom: 40 },
  statsGrid: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  statBox: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    alignItems: 'center',
    gap: 3,
  },
  statValue: { fontSize: typography.md, fontWeight: typography.bold },
  statLabel: { fontSize: 10, color: colors.textMuted, textAlign: 'center' },
  analyzeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.purple,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  analyzeBtnTitle: { fontSize: typography.base, fontWeight: typography.bold, color: '#000' },
  analyzeBtnSub: { fontSize: 11, color: '#00000080' },
  progressBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.purpleLight,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  progressText: { fontSize: typography.sm, color: colors.textPrimary, marginBottom: 6 },
  progressBar: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: colors.purple, borderRadius: 2 },
  viewTabs: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  viewTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
    borderRadius: radius.sm,
  },
  viewTabActive: { backgroundColor: colors.surfaceElevated },
  viewTabText: { fontSize: typography.sm, color: colors.textMuted, fontWeight: typography.medium },
  captureRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.xs,
  },
  captureIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureContent: { flex: 1, gap: 4 },
  captureUrl: { fontSize: typography.sm, color: colors.blue, fontFamily: 'monospace' },
  captureText: { fontSize: typography.sm, color: colors.textSecondary, lineHeight: 18 },
  captureTimecode: { fontSize: 11, color: colors.purple, fontFamily: 'monospace' },
  captureFooter: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 },
  sourcePill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  sourcePillText: { fontSize: 10, fontWeight: typography.semibold },
  captureTime: { fontSize: 10, color: colors.textMuted, marginLeft: 'auto' },
  trailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  trailIndex: {
    fontSize: 11,
    color: colors.textMuted,
    width: 20,
    textAlign: 'center',
    fontFamily: 'monospace',
  },
  trailContent: { flex: 1 },
  trailTitle: { fontSize: typography.sm, color: colors.textPrimary, fontWeight: typography.medium },
  trailUrl: { fontSize: 11, color: colors.textMuted, fontFamily: 'monospace' },
  emptyState: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.sm },
  emptyText: { fontSize: typography.sm, color: colors.textMuted },
});
