import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Linking,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../src/services/supabase';
import { analyzeEvent } from '../../src/services/api';
import { Event } from '../../src/types';
import { colors, spacing, radius, typography, researchLevelConfig, eventStatusConfig } from '../../src/theme';

const BLOCKED_USERS_KEY = 'hdb_blocked_users';

export default function EventDetailScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const router = useRouter();
  const [event, setEvent] = useState<Event | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
    if (eventId) loadEvent(eventId);
  }, [eventId]);

  const loadEvent = async (id: string) => {
    setIsLoading(true);
    const { data } = await supabase.from('events').select('*').eq('id', id).single();
    if (data) setEvent(data as Event);
    setIsLoading(false);
  };

  const handleAnalyze = async () => {
    if (!event) return;
    setIsAnalyzing(true);
    try {
      await analyzeEvent(event.id);
      await loadEvent(event.id);
      Alert.alert('Done', 'AI analysis complete.');
    } catch {
      Alert.alert('Error', 'Analysis failed. The server may be waking up — try again in 30 seconds.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.blue} size="large" style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  if (!event) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorState}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.textMuted} />
          <Text style={styles.errorText}>Event not found.</Text>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const statusConfig = eventStatusConfig[event.event_status ?? 'unverified'];
  const levelConfig = researchLevelConfig.find(l => l.level === event.research_level);

  const formattedDate = event.date
    ? new Date(event.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    : 'Unknown date';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header bar */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="chevron-down" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
        <Text style={styles.headerLabel} numberOfLines={1}>{event.id}</Text>
        <View style={[styles.statusPill, { backgroundColor: statusConfig.bg }]}>
          <Text style={[styles.statusText, { color: statusConfig.color }]}>{statusConfig.label}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Date + Research Level */}
        <View style={styles.metaRow}>
          <View style={styles.dateRow}>
            <Ionicons name="calendar-outline" size={13} color={colors.textMuted} />
            <Text style={styles.date}>{formattedDate}</Text>
          </View>
          {levelConfig && (
            <View style={[styles.levelBadge, { backgroundColor: levelConfig.color + '20', borderColor: levelConfig.color + '50' }]}>
              <View style={styles.levelDots}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <View key={i} style={[styles.levelDot, { backgroundColor: i < event.research_level ? levelConfig.color : colors.border }]} />
                ))}
              </View>
              <Text style={[styles.levelLabel, { color: levelConfig.color }]}>
                Level {event.research_level} · {levelConfig.label}
              </Text>
            </View>
          )}
        </View>

        {/* Title */}
        <Text style={styles.title}>{event.title}</Text>

        {/* Major event badge */}
        {event.is_major_event && (
          <View style={styles.majorBadge}>
            <Ionicons name="star" size={12} color={colors.yellow} />
            <Text style={styles.majorBadgeText}>Major Event</Text>
          </View>
        )}

        {/* AI Summary */}
        {event.ai_summary ? (
          <Section title="AI Summary" icon="sparkles" iconColor={colors.purple}>
            <Text style={styles.bodyText}>{event.ai_summary}</Text>
          </Section>
        ) : (
          <TouchableOpacity
            style={styles.analyzePrompt}
            onPress={handleAnalyze}
            disabled={isAnalyzing}
          >
            {isAnalyzing ? (
              <ActivityIndicator size="small" color={colors.purple} />
            ) : (
              <Ionicons name="sparkles" size={16} color={colors.purple} />
            )}
            <Text style={styles.analyzePromptText}>
              {isAnalyzing ? 'Analyzing…' : 'Generate AI Summary'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Description */}
        {event.description ? (
          <Section title="Description" icon="document-text">
            <Text style={styles.bodyText}>{event.description}</Text>
          </Section>
        ) : null}

        {/* Topics */}
        {event.topics && event.topics.length > 0 && (
          <Section title="Topics" icon="pricetags" iconColor={colors.blue}>
            <View style={styles.chipsWrap}>
              {event.topics.map(t => (
                <View key={t} style={[styles.chip, styles.topicChip]}>
                  <Text style={[styles.chipText, { color: colors.blue }]}>{t}</Text>
                </View>
              ))}
            </View>
          </Section>
        )}

        {/* People */}
        {event.people && event.people.length > 0 && (
          <Section title="People" icon="people" iconColor={colors.purple}>
            <View style={styles.chipsWrap}>
              {event.people.map(p => (
                <View key={p} style={[styles.chip, styles.personChip]}>
                  <Text style={[styles.chipText, { color: colors.purple }]}>{p}</Text>
                </View>
              ))}
            </View>
          </Section>
        )}

        {/* Organizations */}
        {event.organizations && event.organizations.length > 0 && (
          <Section title="Organizations" icon="business" iconColor={colors.green}>
            <View style={styles.chipsWrap}>
              {event.organizations.map(o => (
                <View key={o} style={[styles.chip, styles.orgChip]}>
                  <Text style={[styles.chipText, { color: colors.green }]}>{o}</Text>
                </View>
              ))}
            </View>
          </Section>
        )}

        {/* Source info */}
        <Section title="Source" icon="link">
          <View style={styles.sourceInfo}>
            {event.source_type && <InfoPair label="Type" value={event.source_type} />}
            {event.uploaded_by && <InfoPair label="Uploaded by" value={event.uploaded_by} />}
            {event.date_uploaded && (
              <InfoPair
                label="Date uploaded"
                value={new Date(event.date_uploaded).toLocaleDateString()}
              />
            )}
          </View>
        </Section>

        {/* Links */}
        {((event.links && event.links.length > 0) || event.main_link) && (
          <Section title="Links" icon="open-outline">
            {event.main_link && (
              <LinkRow url={event.main_link} label="Primary Link" />
            )}
            {event.links?.filter(l => l !== event.main_link).map((link, i) => (
              <LinkRow key={i} url={link} />
            ))}
          </Section>
        )}

        {/* Video transcription */}
        {event.transcription && (
          <Section title="Transcription" icon="mic">
            <Text style={styles.transcriptText} numberOfLines={20}>{event.transcription}</Text>
          </Section>
        )}

        {/* AI Analyze button (if not yet analyzed) */}
        {!event.ai_analyzed && (
          <TouchableOpacity
            style={styles.fullAnalyzeBtn}
            onPress={handleAnalyze}
            disabled={isAnalyzing}
          >
            {isAnalyzing ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <>
                <Ionicons name="sparkles" size={18} color="#000" />
                <Text style={styles.fullAnalyzeBtnText}>Run Full AI Analysis</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {/* Content moderation — Apple UGC Guideline 1.2 */}
        <View style={styles.moderationSection}>
          <View style={styles.moderationDivider} />
          <TouchableOpacity
            style={styles.moderationBtn}
            onPress={() => {
              const subject = encodeURIComponent(`Content Report: ${event.id}`);
              const body = encodeURIComponent(`I would like to report the following content:\n\nEvent ID: ${event.id}\nEvent Title: ${event.title}\n\nReason for report:\n`);
              const mailto = `mailto:revanbets@gmail.com?subject=${subject}&body=${body}`;
              Linking.openURL(mailto).catch(() =>
                Alert.alert('Error', 'Could not open email client.')
              );
            }}
          >
            <Ionicons name="flag-outline" size={16} color={colors.red} />
            <Text style={styles.moderationBtnText}>Report Content</Text>
          </TouchableOpacity>

          {event.uploaded_by && (
            <TouchableOpacity
              style={styles.moderationBtn}
              onPress={() =>
                Alert.alert(
                  'Block User',
                  `Are you sure you want to block "${event.uploaded_by}"? You will no longer see content from this user.`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Block',
                      style: 'destructive',
                      onPress: async () => {
                        try {
                          const raw = await AsyncStorage.getItem(BLOCKED_USERS_KEY);
                          const blocked: string[] = raw ? JSON.parse(raw) : [];
                          if (!blocked.includes(event.uploaded_by!)) {
                            blocked.push(event.uploaded_by!);
                            await AsyncStorage.setItem(BLOCKED_USERS_KEY, JSON.stringify(blocked));
                          }
                        } catch {}
                        Alert.alert('User Blocked', `"${event.uploaded_by}" has been blocked. You can manage blocked users in your account settings.`);
                        router.back();
                      },
                    },
                  ],
                )
              }
            >
              <Ionicons name="person-remove-outline" size={16} color={colors.red} />
              <Text style={styles.moderationBtnText}>Block User</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({
  title,
  icon,
  iconColor = colors.textMuted,
  children,
}: {
  title: string;
  icon: string;
  iconColor?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Ionicons name={icon as never} size={14} color={iconColor} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function InfoPair({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoPair}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function LinkRow({ url, label }: { url: string; label?: string }) {
  return (
    <TouchableOpacity
      style={styles.linkRow}
      onPress={() => Linking.openURL(url).catch(() => Alert.alert('Error', 'Could not open link.'))}
    >
      <Ionicons name="link-outline" size={14} color={colors.blue} />
      <Text style={styles.linkText} numberOfLines={1}>{label ?? url}</Text>
      <Ionicons name="open-outline" size={12} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  headerBtn: { padding: 4 },
  headerLabel: { flex: 1, fontSize: 12, color: colors.textMuted, fontFamily: 'monospace' },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  statusText: { fontSize: 10, fontWeight: typography.bold },
  scroll: { padding: spacing.md, paddingBottom: 48 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  date: { fontSize: typography.xs, color: colors.textMuted },
  levelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  levelDots: { flexDirection: 'row', gap: 2 },
  levelDot: { width: 5, height: 5, borderRadius: 2.5 },
  levelLabel: { fontSize: 10, fontWeight: typography.semibold },
  title: {
    fontSize: typography.xxl,
    fontWeight: typography.bold,
    color: colors.textPrimary,
    lineHeight: 32,
    marginBottom: spacing.sm,
  },
  majorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: colors.yellowLight,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginBottom: spacing.md,
  },
  majorBadgeText: { fontSize: 11, color: colors.yellow, fontWeight: typography.bold },
  analyzePrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.purpleLight,
    borderWidth: 1,
    borderColor: colors.purple + '40',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  analyzePromptText: { fontSize: typography.sm, color: colors.purple, fontWeight: typography.medium },
  section: {
    marginBottom: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: spacing.sm,
  },
  sectionTitle: { fontSize: typography.sm, fontWeight: typography.bold, color: colors.textMuted, letterSpacing: 0.3 },
  bodyText: { fontSize: typography.sm, color: colors.textSecondary, lineHeight: 22 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  topicChip: { backgroundColor: colors.blueDim, borderColor: 'rgba(96,165,250,0.3)' },
  personChip: { backgroundColor: colors.purpleLight, borderColor: 'rgba(167,139,250,0.3)' },
  orgChip: { backgroundColor: colors.greenLight, borderColor: 'rgba(52,211,153,0.3)' },
  chipText: { fontSize: 12, fontWeight: typography.medium },
  sourceInfo: { gap: spacing.xs },
  infoPair: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  infoLabel: { fontSize: typography.sm, color: colors.textMuted },
  infoValue: { fontSize: typography.sm, color: colors.textSecondary, fontWeight: typography.medium },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  linkText: { flex: 1, fontSize: typography.sm, color: colors.blue },
  transcriptText: { fontSize: typography.xs, color: colors.textMuted, lineHeight: 18 },
  fullAnalyzeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.purple,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  fullAnalyzeBtnText: { fontSize: typography.base, fontWeight: typography.bold, color: '#000' },
  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  errorText: { fontSize: typography.base, color: colors.textMuted },
  backBtn: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md },
  backBtnText: { fontSize: typography.base, color: colors.blue },
  moderationSection: {
    marginTop: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  moderationDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginBottom: spacing.sm,
  },
  moderationBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.redLight,
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.2)',
    borderRadius: radius.md,
  },
  moderationBtnText: {
    fontSize: typography.sm,
    color: colors.red,
    fontWeight: typography.medium,
  },
});
