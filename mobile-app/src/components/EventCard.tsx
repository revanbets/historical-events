import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { Event } from '../types';
import { colors, spacing, radius, typography, researchLevelConfig, eventStatusConfig } from '../theme';

interface EventCardProps {
  event: Event;
  onPress: () => void;
}

export function EventCard({ event, onPress }: EventCardProps) {
  const statusConfig = eventStatusConfig[event.event_status ?? 'unverified'];
  const levelConfig = researchLevelConfig.find(l => l.level === event.research_level);

  const displayTopics = (event.topics ?? []).slice(0, 3);
  const moreTopics = (event.topics ?? []).length - 3;

  const formattedDate = event.date
    ? new Date(event.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    : 'Unknown date';

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.75}
      onLongPress={() =>
        Alert.alert('Report Content', 'What would you like to do?', [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Report Content',
            onPress: () =>
              Alert.alert('Content Reported', 'Thank you. Our moderation team will review this within 24 hours.'),
          },
          ...(event.uploaded_by
            ? [{
                text: `Block ${event.uploaded_by}`,
                style: 'destructive' as const,
                onPress: () =>
                  Alert.alert('User Blocked', `"${event.uploaded_by}" has been blocked. You can manage blocked users in your account settings.`),
              }]
            : []),
        ])
      }
    >
      {/* Top row: date + status + research level */}
      <View style={styles.metaRow}>
        <Text style={styles.date}>{formattedDate}</Text>
        <View style={styles.badges}>
          {event.is_major_event && (
            <View style={styles.majorBadge}>
              <Text style={styles.majorBadgeText}>MAJOR</Text>
            </View>
          )}
          <View style={[styles.statusBadge, { backgroundColor: statusConfig.bg }]}>
            <Text style={[styles.statusText, { color: statusConfig.color }]}>
              {statusConfig.label}
            </Text>
          </View>
        </View>
      </View>

      {/* Title */}
      <Text style={styles.title} numberOfLines={2}>{event.title}</Text>

      {/* AI Summary or description */}
      {(event.ai_summary || event.description) ? (
        <Text style={styles.summary} numberOfLines={3}>
          {event.ai_summary || event.description}
        </Text>
      ) : null}

      {/* Bottom row: topics + research level */}
      <View style={styles.bottomRow}>
        <View style={styles.topicsRow}>
          {displayTopics.map(topic => (
            <View key={topic} style={styles.topicChip}>
              <Text style={styles.topicText} numberOfLines={1}>{topic}</Text>
            </View>
          ))}
          {moreTopics > 0 && (
            <View style={[styles.topicChip, styles.topicChipMore]}>
              <Text style={styles.topicText}>+{moreTopics}</Text>
            </View>
          )}
        </View>

        {levelConfig && (
          <View style={styles.levelRow}>
            {Array.from({ length: 5 }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.levelDot,
                  { backgroundColor: i < event.research_level ? levelConfig.color : colors.border },
                ]}
              />
            ))}
          </View>
        )}
      </View>

      {/* Source type indicator */}
      {event.source_type && (
        <Text style={styles.sourceType}>
          {event.source_type}{event.uploaded_by ? ` · ${event.uploaded_by}` : ''}
        </Text>
      )}
    </TouchableOpacity>
  );
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
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  date: {
    fontSize: typography.xs,
    color: colors.textMuted,
    fontWeight: typography.medium,
  },
  badges: {
    flexDirection: 'row',
    gap: spacing.xs,
    alignItems: 'center',
  },
  majorBadge: {
    backgroundColor: colors.yellowLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  majorBadgeText: {
    fontSize: 9,
    color: colors.yellow,
    fontWeight: typography.bold,
    letterSpacing: 0.5,
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  statusText: {
    fontSize: 10,
    fontWeight: typography.semibold,
  },
  title: {
    fontSize: typography.base,
    fontWeight: typography.bold,
    color: colors.textPrimary,
    lineHeight: 22,
    marginBottom: spacing.xs,
  },
  summary: {
    fontSize: typography.sm,
    color: colors.textSecondary,
    lineHeight: 19,
    marginBottom: spacing.sm,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  topicsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    flex: 1,
    marginRight: spacing.sm,
  },
  topicChip: {
    backgroundColor: colors.blueDim,
    borderWidth: 1,
    borderColor: 'rgba(96,165,250,0.2)',
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 2,
    maxWidth: 110,
  },
  topicChipMore: {
    backgroundColor: colors.surfaceHighlight,
    borderColor: colors.border,
  },
  topicText: {
    fontSize: 11,
    color: colors.blue,
    fontWeight: typography.medium,
  },
  levelRow: {
    flexDirection: 'row',
    gap: 3,
    alignItems: 'center',
  },
  levelDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  sourceType: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
});
