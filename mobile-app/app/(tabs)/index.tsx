import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/contexts/AuthContext';
import { useResearch } from '../../src/contexts/ResearchContext';
import { supabase } from '../../src/services/supabase';
import { EventCard } from '../../src/components/EventCard';
import { Event, Notification } from '../../src/types';
import { colors, spacing, radius, typography } from '../../src/theme';

export default function HomeScreen() {
  const { session } = useAuth();
  const { activeSession, allSessions } = useResearch();
  const router = useRouter();

  const [recentEvents, setRecentEvents] = useState<Event[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [stats, setStats] = useState({ total: 0, myUploads: 0, unread: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    if (!session) return;
    try {
      const [eventsRes, notifRes, myRes] = await Promise.all([
        supabase.from('events').select('*').order('date_uploaded', { ascending: false }).limit(5),
        supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(10),
        supabase.from('events').select('id', { count: 'exact' }).eq('uploaded_by', session.username),
      ]);

      if (eventsRes.data) setRecentEvents(eventsRes.data as Event[]);
      if (notifRes.data) setNotifications(notifRes.data as Notification[]);

      const unread = (notifRes.data as Notification[])?.filter(
        n => !n.read_by?.includes(session.username) && !n.dismissed_by?.includes(session.username)
      ).length ?? 0;

      setStats({
        total: eventsRes.count ?? eventsRes.data?.length ?? 0,
        myUploads: myRes.count ?? 0,
        unread,
      });
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, [session]);

  const onRefresh = () => { setRefreshing(true); load(); };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.blue} size="large" style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.blue} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Welcome back,</Text>
            <Text style={styles.username}>{session?.username}</Text>
          </View>
          <View style={[styles.roleBadge, session?.role === 'owner' && styles.roleBadgeOwner]}>
            <Text style={styles.roleText}>{session?.role?.toUpperCase()}</Text>
          </View>
        </View>

        {/* Active Research Session Banner */}
        {activeSession && (
          <TouchableOpacity
            style={styles.activeSessionBanner}
            onPress={() => router.push('/(tabs)/research')}
          >
            <View style={styles.activeDot} />
            <View style={styles.activeSessionInfo}>
              <Text style={styles.activeSessionLabel}>Active Research Session</Text>
              <Text style={styles.activeSessionName} numberOfLines={1}>{activeSession.session_name}</Text>
            </View>
            <View style={styles.activeSessionStats}>
              <Text style={styles.activeStatNum}>{activeSession.trail.length}</Text>
              <Text style={styles.activeStatLabel}>pages</Text>
            </View>
            <View style={styles.activeSessionStats}>
              <Text style={styles.activeStatNum}>{activeSession.captured_items.length}</Text>
              <Text style={styles.activeStatLabel}>captures</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        )}

        {/* Stats Row */}
        <View style={styles.statsRow}>
          <StatCard icon="library" value={stats.total} label="Total Events" color={colors.blue} />
          <StatCard icon="cloud-upload" value={stats.myUploads} label="My Uploads" color={colors.green} />
          <StatCard icon="notifications" value={stats.unread} label="Unread" color={colors.orange} />
        </View>

        {/* Quick Actions */}
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.quickActions}>
          <QuickAction
            icon="search"
            label="Browse Events"
            color={colors.blue}
            onPress={() => router.push('/(tabs)/events')}
          />
          <QuickAction
            icon="flask"
            label="Research"
            color={colors.purple}
            onPress={() => router.push('/(tabs)/research')}
          />
          <QuickAction
            icon="add-circle"
            label="Add Source"
            color={colors.green}
            onPress={() => router.push('/(tabs)/upload')}
          />
          <QuickAction
            icon="person"
            label="Profile"
            color={colors.orange}
            onPress={() => router.push('/(tabs)/account')}
          />
        </View>

        {/* Recent Events */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Events</Text>
          <TouchableOpacity onPress={() => router.push('/(tabs)/events')}>
            <Text style={styles.seeAll}>See all →</Text>
          </TouchableOpacity>
        </View>

        {recentEvents.map(event => (
          <EventCard
            key={event.id}
            event={event}
            onPress={() =>
              router.push({
                pathname: '/(modals)/event-detail',
                params: { eventId: event.id },
              })
            }
          />
        ))}

        {recentEvents.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons name="library-outline" size={40} color={colors.textMuted} />
            <Text style={styles.emptyText}>No events yet. Upload your first source!</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCard({ icon, value, label, color }: { icon: string; value: number; label: string; color: string }) {
  return (
    <View style={[styles.statCard, { borderTopColor: color }]}>
      <Ionicons name={icon as never} size={18} color={color} />
      <Text style={[styles.statValue, { color }]}>{value.toLocaleString()}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function QuickAction({ icon, label, color, onPress }: { icon: string; label: string; color: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.quickAction} onPress={onPress}>
      <View style={[styles.quickActionIcon, { backgroundColor: color + '20' }]}>
        <Ionicons name={icon as never} size={22} color={color} />
      </View>
      <Text style={styles.quickActionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.md, paddingBottom: 32 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.lg,
  },
  greeting: { fontSize: typography.sm, color: colors.textMuted },
  username: { fontSize: typography.xl, fontWeight: typography.bold, color: colors.textPrimary },
  roleBadge: {
    backgroundColor: colors.blueDim,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(96,165,250,0.3)',
  },
  roleBadgeOwner: { backgroundColor: colors.purpleLight, borderColor: colors.purple + '50' },
  roleText: { fontSize: 10, fontWeight: typography.bold, color: colors.blue, letterSpacing: 0.5 },
  activeSessionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.greenLight,
    borderWidth: 1,
    borderColor: colors.green + '40',
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  activeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.green,
  },
  activeSessionInfo: { flex: 1 },
  activeSessionLabel: { fontSize: 11, color: colors.green, fontWeight: typography.medium },
  activeSessionName: { fontSize: typography.sm, fontWeight: typography.semibold, color: colors.textPrimary },
  activeSessionStats: { alignItems: 'center' },
  activeStatNum: { fontSize: typography.base, fontWeight: typography.bold, color: colors.textPrimary },
  activeStatLabel: { fontSize: 10, color: colors.textMuted },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
    borderTopWidth: 2,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  statValue: { fontSize: typography.xl, fontWeight: typography.bold },
  statLabel: { fontSize: 10, color: colors.textMuted, textAlign: 'center' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  sectionTitle: { fontSize: typography.md, fontWeight: typography.bold, color: colors.textPrimary, marginBottom: spacing.sm },
  seeAll: { fontSize: typography.sm, color: colors.blue },
  quickActions: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  quickAction: { flex: 1, alignItems: 'center', gap: spacing.xs },
  quickActionIcon: { width: 52, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  quickActionLabel: { fontSize: 11, color: colors.textSecondary, textAlign: 'center' },
  emptyState: { alignItems: 'center', padding: spacing.xxl, gap: spacing.sm },
  emptyText: { fontSize: typography.sm, color: colors.textMuted, textAlign: 'center' },
});
