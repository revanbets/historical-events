import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ResearchSession } from '../types';
import { colors, spacing, radius, typography } from '../theme';

interface ResearchSessionCardProps {
  session: ResearchSession;
  onPress: () => void;
  onResume?: () => void;
}

const statusConfig = {
  active: { label: 'Active', color: colors.green, icon: 'radio-button-on' as const },
  paused: { label: 'Paused', color: colors.yellow, icon: 'pause-circle' as const },
  ended: { label: 'Ended', color: colors.textMuted, icon: 'stop-circle' as const },
  analyzed: { label: 'Analyzed', color: colors.blue, icon: 'checkmark-circle' as const },
};

export function ResearchSessionCard({ session, onPress, onResume }: ResearchSessionCardProps) {
  const status = statusConfig[session.status] ?? statusConfig.ended;

  const startDate = new Date(session.started_at).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const duration = session.ended_at
    ? getDuration(session.started_at, session.ended_at)
    : session.status === 'active' || session.status === 'paused'
    ? 'In progress'
    : '';

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.topRow}>
        <View style={styles.nameRow}>
          <Ionicons name={status.icon} size={14} color={status.color} />
          <Text style={styles.name} numberOfLines={1}>{session.session_name}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: status.color + '20' }]}>
          <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
        </View>
      </View>

      <View style={styles.statsRow}>
        <StatPill icon="footsteps" value={session.trail.length} label="pages" />
        <StatPill icon="bookmark" value={session.captured_items.length} label="captures" />
        <Text style={styles.dateText}>{startDate}</Text>
      </View>

      {duration ? <Text style={styles.duration}>{duration}</Text> : null}

      {onResume && (session.status === 'paused' || session.status === 'active') && (
        <TouchableOpacity
          style={styles.resumeBtn}
          onPress={onResume}
        >
          <Ionicons name="play" size={12} color={colors.green} />
          <Text style={styles.resumeBtnText}>
            {session.status === 'paused' ? 'Resume' : 'View Active Session'}
          </Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

function StatPill({ icon, value, label }: { icon: string; value: number; label: string }) {
  return (
    <View style={styles.statPill}>
      <Ionicons name={icon as never} size={11} color={colors.textMuted} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function getDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainMins = minutes % 60;
  return remainMins > 0 ? `${hours}h ${remainMins}m` : `${hours}h`;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flex: 1,
    marginRight: spacing.sm,
  },
  name: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
    color: colors.textPrimary,
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  statusText: { fontSize: 11, fontWeight: typography.semibold },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  statPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.surfaceHighlight,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.full,
  },
  statValue: { fontSize: 12, fontWeight: typography.bold, color: colors.textSecondary },
  statLabel: { fontSize: 11, color: colors.textMuted },
  dateText: { fontSize: 11, color: colors.textMuted, marginLeft: 'auto' },
  duration: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  resumeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  resumeBtnText: { fontSize: typography.sm, color: colors.green, fontWeight: typography.medium },
});
