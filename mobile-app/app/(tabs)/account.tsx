import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Switch,
  RefreshControl,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../../src/contexts/AuthContext';
import { supabase } from '../../src/services/supabase';
import { EventCard } from '../../src/components/EventCard';
import { Event, Notification } from '../../src/types';
import { colors, spacing, radius, typography } from '../../src/theme';

type AccountTab = 'uploads' | 'notifications' | 'settings';

export default function AccountScreen() {
  const router = useRouter();
  const { session, logout, biometricsAvailable, biometricsEnabled, setBiometricsEnabled } = useAuth();
  const [activeTab, setActiveTab] = useState<AccountTab>('uploads');
  const [myUploads, setMyUploads] = useState<Event[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { loadData(); }, [session]);

  const loadData = async () => {
    if (!session) return;
    setIsLoading(true);
    try {
      const [uploadsRes, notifRes] = await Promise.all([
        supabase
          .from('events')
          .select('*')
          .eq('uploaded_by', session.username)
          .order('date_uploaded', { ascending: false })
          .limit(50),
        supabase
          .from('notifications')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(30),
      ]);
      if (uploadsRes.data) setMyUploads(uploadsRes.data as Event[]);
      if (notifRes.data) {
        const notifs = notifRes.data as Notification[];
        setNotifications(notifs);
        setUnreadCount(notifs.filter(n =>
          !n.read_by?.includes(session.username) && !n.dismissed_by?.includes(session.username)
        ).length);
      }
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  const markAllRead = async () => {
    if (!session) return;
    const unread = notifications.filter(n => !n.read_by?.includes(session.username));
    await Promise.all(unread.map(n =>
      supabase.from('notifications').update({ read_by: [...(n.read_by ?? []), session.username] }).eq('id', n.id)
    ));
    setNotifications(prev => prev.map(n => ({ ...n, read_by: [...(n.read_by ?? []), session.username] })));
    setUnreadCount(0);
  };

  const handleLogout = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: logout },
      ]
    );
  };

  const onRefresh = () => { setRefreshing(true); loadData(); };

  if (!session) return null;

  const roleColor = session.role === 'owner' ? colors.purple : session.role === 'admin' ? colors.orange : colors.blue;

  return (
    <SafeAreaView style={styles.container}>
      {/* User header */}
      <View style={styles.userHeader}>
        <View style={[styles.avatar, { backgroundColor: roleColor + '30', borderColor: roleColor + '60' }]}>
          <Text style={[styles.avatarText, { color: roleColor }]}>
            {session.username[0].toUpperCase()}
          </Text>
        </View>
        <View style={styles.userInfo}>
          <Text style={styles.username}>{session.username}</Text>
          <View style={[styles.roleBadge, { backgroundColor: roleColor + '20', borderColor: roleColor + '40' }]}>
            <Text style={[styles.roleText, { color: roleColor }]}>{session.role.toUpperCase()}</Text>
          </View>
        </View>
        <TouchableOpacity onPress={handleLogout} style={styles.signOutBtn}>
          <Ionicons name="log-out-outline" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TabButton label="My Uploads" count={myUploads.length} active={activeTab === 'uploads'} onPress={() => setActiveTab('uploads')} />
        <TabButton label="Notifications" count={unreadCount} active={activeTab === 'notifications'} onPress={() => setActiveTab('notifications')} badge />
        <TabButton label="Settings" active={activeTab === 'settings'} onPress={() => setActiveTab('settings')} />
      </View>

      {/* Content */}
      {activeTab === 'uploads' && (
        <FlatList
          data={myUploads}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <EventCard
              event={item}
              onPress={() =>
                router.push({ pathname: '/(modals)/event-detail', params: { eventId: item.id } })
              }
            />
          )}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.blue} />}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="cloud-upload-outline" size={40} color={colors.textMuted} />
              <Text style={styles.emptyText}>No uploads yet.</Text>
              <Text style={styles.emptySubText}>Head to the Add tab to upload your first source.</Text>
            </View>
          }
        />
      )}

      {activeTab === 'notifications' && (
        <ScrollView
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.blue} />}
        >
          {unreadCount > 0 && (
            <TouchableOpacity style={styles.markAllBtn} onPress={markAllRead}>
              <Text style={styles.markAllText}>Mark all as read ({unreadCount})</Text>
            </TouchableOpacity>
          )}
          {notifications.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="notifications-outline" size={40} color={colors.textMuted} />
              <Text style={styles.emptyText}>No notifications.</Text>
            </View>
          ) : (
            notifications.map(notif => (
              <NotificationRow
                key={notif.id}
                notification={notif}
                isRead={notif.read_by?.includes(session.username) ?? false}
                onPress={() => notif.event_id && router.push({ pathname: '/(modals)/event-detail', params: { eventId: notif.event_id } })}
              />
            ))
          )}
        </ScrollView>
      )}

      {activeTab === 'settings' && (
        <ScrollView contentContainerStyle={styles.listContent}>
          {/* Biometrics */}
          {biometricsAvailable && (
            <View style={styles.settingRow}>
              <Ionicons name="finger-print" size={20} color={colors.blue} />
              <View style={styles.settingInfo}>
                <Text style={styles.settingTitle}>Face ID / Touch ID</Text>
                <Text style={styles.settingDesc}>Quick biometric login</Text>
              </View>
              <Switch
                value={biometricsEnabled}
                onValueChange={setBiometricsEnabled}
                trackColor={{ false: colors.border, true: colors.blue }}
                thumbColor="#fff"
              />
            </View>
          )}

          {/* Account info */}
          <View style={styles.infoSection}>
            <Text style={styles.infoSectionTitle}>Account Info</Text>
            <InfoRow label="Username" value={session.username} />
            <InfoRow label="Role" value={session.role} />
            <InfoRow label="Karma" value={String(session.karma)} />
          </View>

          {/* Web app link */}
          <View style={styles.infoSection}>
            <Text style={styles.infoSectionTitle}>Desktop Version</Text>
            <Text style={styles.webAppNote}>
              Features like the Network Graph, Presentations Editor, and full Admin Panel are available on the desktop version at:
            </Text>
            <Text style={styles.webAppUrl}>historical-events-databse.netlify.app</Text>
          </View>

          {/* Sign out */}
          <TouchableOpacity style={styles.signOutFullBtn} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={18} color={colors.red} />
            <Text style={styles.signOutFullText}>Sign Out</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function TabButton({ label, count, active, onPress, badge }: {
  label: string; count?: number; active: boolean; onPress: () => void; badge?: boolean;
}) {
  return (
    <TouchableOpacity style={[styles.tab, active && styles.tabActive]} onPress={onPress}>
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
      {count != null && count > 0 && (
        <View style={[styles.tabBadge, badge && { backgroundColor: colors.red }]}>
          <Text style={styles.tabBadgeText}>{count}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

function NotificationRow({ notification, isRead, onPress }: { notification: Notification; isRead: boolean; onPress: () => void }) {
  const icons: Record<string, string> = {
    upload: 'cloud-upload',
    ai_analysis: 'sparkles',
    ai_error: 'alert-circle',
    edit: 'create',
    mention: 'at',
  };
  return (
    <TouchableOpacity style={[styles.notifRow, !isRead && styles.notifRowUnread]} onPress={onPress}>
      <View style={[styles.notifIcon, !isRead && { backgroundColor: colors.blueDim }]}>
        <Ionicons name={icons[notification.type] as never ?? 'notifications'} size={16} color={!isRead ? colors.blue : colors.textMuted} />
      </View>
      <View style={styles.notifContent}>
        <Text style={[styles.notifTitle, !isRead && { color: colors.textPrimary }]}>{notification.title}</Text>
        <Text style={styles.notifMessage} numberOfLines={2}>{notification.message}</Text>
        <Text style={styles.notifTime}>{new Date(notification.created_at).toLocaleDateString()}</Text>
      </View>
      {!isRead && <View style={styles.unreadDot} />}
    </TouchableOpacity>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  userHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 22, fontWeight: typography.bold },
  userInfo: { flex: 1, gap: 4 },
  username: { fontSize: typography.lg, fontWeight: typography.bold, color: colors.textPrimary },
  roleBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.sm, borderWidth: 1 },
  roleText: { fontSize: 10, fontWeight: typography.bold, letterSpacing: 0.5 },
  signOutBtn: { padding: spacing.sm },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: colors.blue },
  tabLabel: { fontSize: typography.sm, color: colors.textMuted, fontWeight: typography.medium },
  tabLabelActive: { color: colors.blue, fontWeight: typography.bold },
  tabBadge: {
    backgroundColor: colors.blue,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  tabBadgeText: { fontSize: 9, color: '#000', fontWeight: typography.bold },
  listContent: { padding: spacing.md, paddingBottom: 32 },
  emptyState: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.xs },
  emptyText: { fontSize: typography.base, fontWeight: typography.medium, color: colors.textSecondary },
  emptySubText: { fontSize: typography.sm, color: colors.textMuted, textAlign: 'center' },
  markAllBtn: {
    alignSelf: 'flex-end',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
  },
  markAllText: { fontSize: typography.sm, color: colors.blue },
  notifRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  notifRowUnread: { borderColor: 'rgba(96,165,250,0.3)', backgroundColor: colors.surfaceElevated },
  notifIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceHighlight,
  },
  notifContent: { flex: 1 },
  notifTitle: { fontSize: typography.sm, fontWeight: typography.semibold, color: colors.textSecondary, marginBottom: 2 },
  notifMessage: { fontSize: 12, color: colors.textMuted, lineHeight: 16 },
  notifTime: { fontSize: 10, color: colors.textMuted, marginTop: 4 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.blue, marginTop: 4 },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  settingInfo: { flex: 1 },
  settingTitle: { fontSize: typography.base, fontWeight: typography.semibold, color: colors.textPrimary },
  settingDesc: { fontSize: typography.sm, color: colors.textMuted },
  infoSection: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  infoSectionTitle: { fontSize: typography.sm, fontWeight: typography.bold, color: colors.textMuted, letterSpacing: 0.5 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  infoLabel: { fontSize: typography.sm, color: colors.textSecondary },
  infoValue: { fontSize: typography.sm, fontWeight: typography.medium, color: colors.textPrimary },
  webAppNote: { fontSize: typography.sm, color: colors.textMuted, lineHeight: 18 },
  webAppUrl: { fontSize: typography.sm, color: colors.blue, fontFamily: 'monospace' },
  signOutFullBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.redLight,
    borderWidth: 1,
    borderColor: colors.red + '30',
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  signOutFullText: { fontSize: typography.base, fontWeight: typography.bold, color: colors.red },
});
