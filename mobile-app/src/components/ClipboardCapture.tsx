import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '../theme';
import { detectSourceFromUrl } from '../theme';

interface ClipboardCaptureProps {
  url: string;
  onAddToSession: (url: string) => void;
  onQuickAnalyze: (url: string) => void;
  onDismiss: () => void;
  hasActiveSession: boolean;
}

/**
 * Animated banner that appears when a URL is detected in the clipboard.
 * This is the core "research session" capture mechanism on mobile —
 * user copies a link from TikTok/Instagram/YouTube/X, switches to this app,
 * and this banner slides in automatically.
 */
export function ClipboardCapture({
  url,
  onAddToSession,
  onQuickAnalyze,
  onDismiss,
  hasActiveSession,
}: ClipboardCaptureProps) {
  const slideAnim = useRef(new Animated.Value(-120)).current;
  const source = detectSourceFromUrl(url);

  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: 0,
      tension: 60,
      friction: 10,
      useNativeDriver: true,
    }).start();
  }, [slideAnim]);

  const dismiss = () => {
    Animated.timing(slideAnim, {
      toValue: -120,
      duration: 200,
      useNativeDriver: true,
    }).start(onDismiss);
  };

  const shortUrl = url.length > 55 ? url.substring(0, 52) + '…' : url;

  return (
    <Animated.View style={[styles.banner, { transform: [{ translateY: slideAnim }] }]}>
      {/* Source badge */}
      <View style={styles.header}>
        <View style={[styles.sourceBadge, { borderColor: source.color + '60', backgroundColor: source.color + '20' }]}>
          <Text style={[styles.sourceName, { color: source.color }]}>
            {source.name}
          </Text>
        </View>
        <Text style={styles.detectedLabel}>Link detected in clipboard</Text>
        <TouchableOpacity onPress={dismiss} style={styles.closeBtn} hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}>
          <Ionicons name="close" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {/* URL preview */}
      <Text style={styles.urlText} numberOfLines={1}>{shortUrl}</Text>

      {/* Action buttons */}
      <View style={styles.actions}>
        {hasActiveSession && (
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnPrimary]}
            onPress={() => { onAddToSession(url); dismiss(); }}
          >
            <Ionicons name="add-circle" size={14} color={colors.textInverse} />
            <Text style={styles.actionBtnPrimaryText}>Add to Session</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.actionBtn, styles.actionBtnSecondary]}
          onPress={() => { onQuickAnalyze(url); dismiss(); }}
        >
          <Ionicons name="sparkles" size={14} color={colors.blue} />
          <Text style={styles.actionBtnSecondaryText}>
            {hasActiveSession ? 'Quick Analyze' : 'Analyze & Save'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionBtn, styles.actionBtnGhost]}
          onPress={() => { Linking.openURL(url); dismiss(); }}
        >
          <Ionicons name="open-outline" size={14} color={colors.textMuted} />
          <Text style={styles.actionBtnGhostText}>Open</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  sourceBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  sourceName: {
    fontSize: 11,
    fontWeight: typography.bold,
  },
  detectedLabel: {
    flex: 1,
    fontSize: 12,
    color: colors.textSecondary,
  },
  closeBtn: {
    padding: 2,
  },
  urlText: {
    fontSize: typography.sm,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    fontFamily: 'monospace',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    borderRadius: radius.md,
  },
  actionBtnPrimary: {
    backgroundColor: colors.blue,
  },
  actionBtnPrimaryText: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
    color: colors.textInverse,
  },
  actionBtnSecondary: {
    backgroundColor: colors.blueDim,
    borderWidth: 1,
    borderColor: 'rgba(96,165,250,0.3)',
  },
  actionBtnSecondaryText: {
    fontSize: typography.sm,
    fontWeight: typography.medium,
    color: colors.blue,
  },
  actionBtnGhost: {
    backgroundColor: colors.surfaceHighlight,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionBtnGhostText: {
    fontSize: typography.sm,
    color: colors.textMuted,
  },
});
