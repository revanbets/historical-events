import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  SafeAreaView,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FilterState, DEFAULT_FILTERS } from '../types';
import { colors, spacing, radius, typography, researchLevelConfig } from '../theme';

interface FilterSheetProps {
  visible: boolean;
  filters: FilterState;
  availableTopics: string[];
  availablePeople: string[];
  availableOrgs: string[];
  onApply: (filters: FilterState) => void;
  onClose: () => void;
}

export function FilterSheet({
  visible,
  filters,
  availableTopics,
  availablePeople,
  availableOrgs,
  onApply,
  onClose,
}: FilterSheetProps) {
  const [localFilters, setLocalFilters] = useState<FilterState>(filters);

  const toggleItem = (field: 'topics' | 'people' | 'organizations', value: string) => {
    setLocalFilters(prev => {
      const current = prev[field];
      const updated = current.includes(value)
        ? current.filter(v => v !== value)
        : [...current, value];
      return { ...prev, [field]: updated };
    });
  };

  const toggleLevel = (level: number) => {
    setLocalFilters(prev => {
      const current = prev.researchLevels;
      const updated = current.includes(level)
        ? current.filter(l => l !== level)
        : [...current, level];
      return { ...prev, researchLevels: updated };
    });
  };

  const activeFilterCount =
    localFilters.topics.length +
    localFilters.people.length +
    localFilters.organizations.length +
    localFilters.researchLevels.length +
    (localFilters.showMajorOnly ? 1 : 0);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => { setLocalFilters(DEFAULT_FILTERS); }} style={styles.clearBtn}>
            <Text style={styles.clearBtnText}>Clear all</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Filters</Text>
          <TouchableOpacity onPress={() => { onApply(localFilters); onClose(); }} style={styles.applyBtn}>
            <Text style={styles.applyBtnText}>
              Apply{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.scroll}>
          {/* Major events only */}
          <View style={styles.section}>
            <View style={styles.switchRow}>
              <Text style={styles.sectionTitle}>Major Events Only</Text>
              <Switch
                value={localFilters.showMajorOnly}
                onValueChange={v => setLocalFilters(prev => ({ ...prev, showMajorOnly: v }))}
                trackColor={{ false: colors.border, true: colors.blue }}
                thumbColor="#fff"
              />
            </View>
          </View>

          {/* Research Level */}
          <FilterSection title="Research Level">
            <View style={styles.levelRow}>
              {researchLevelConfig.map(({ level, label, color }) => (
                <TouchableOpacity
                  key={level}
                  style={[
                    styles.levelChip,
                    localFilters.researchLevels.includes(level) && {
                      backgroundColor: color + '30',
                      borderColor: color,
                    },
                  ]}
                  onPress={() => toggleLevel(level)}
                >
                  <View style={[styles.levelDot, { backgroundColor: color }]} />
                  <Text style={[
                    styles.levelLabel,
                    localFilters.researchLevels.includes(level) && { color },
                  ]}>
                    {level} · {label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </FilterSection>

          {/* Topics */}
          {availableTopics.length > 0 && (
            <FilterSection title="Topics" count={localFilters.topics.length}>
              <CheckboxList
                items={availableTopics.slice(0, 30)}
                selected={localFilters.topics}
                onToggle={v => toggleItem('topics', v)}
                color={colors.blue}
              />
            </FilterSection>
          )}

          {/* People */}
          {availablePeople.length > 0 && (
            <FilterSection title="People" count={localFilters.people.length}>
              <CheckboxList
                items={availablePeople.slice(0, 20)}
                selected={localFilters.people}
                onToggle={v => toggleItem('people', v)}
                color={colors.purple}
              />
            </FilterSection>
          )}

          {/* Organizations */}
          {availableOrgs.length > 0 && (
            <FilterSection title="Organizations" count={localFilters.organizations.length}>
              <CheckboxList
                items={availableOrgs.slice(0, 20)}
                selected={localFilters.organizations}
                onToggle={v => toggleItem('organizations', v)}
                color={colors.green}
              />
            </FilterSection>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function FilterSection({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {count != null && count > 0 && (
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{count}</Text>
          </View>
        )}
      </View>
      {children}
    </View>
  );
}

function CheckboxList({
  items,
  selected,
  onToggle,
  color,
}: {
  items: string[];
  selected: string[];
  onToggle: (v: string) => void;
  color: string;
}) {
  return (
    <View>
      {items.map(item => {
        const isSelected = selected.includes(item);
        return (
          <TouchableOpacity
            key={item}
            style={styles.checkRow}
            onPress={() => onToggle(item)}
            activeOpacity={0.7}
          >
            <View style={[styles.checkbox, isSelected && { backgroundColor: color, borderColor: color }]}>
              {isSelected && <Ionicons name="checkmark" size={12} color="#fff" />}
            </View>
            <Text style={[styles.checkLabel, isSelected && { color }]} numberOfLines={1}>
              {item}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontSize: typography.md,
    fontWeight: typography.bold,
    color: colors.textPrimary,
  },
  clearBtn: { padding: spacing.xs },
  clearBtnText: { fontSize: typography.sm, color: colors.textMuted },
  applyBtn: {
    backgroundColor: colors.blue,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
  },
  applyBtnText: { fontSize: typography.sm, fontWeight: typography.bold, color: '#000' },
  scroll: { padding: spacing.md, paddingBottom: 40 },
  section: {
    marginBottom: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.md,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  sectionTitle: { fontSize: typography.base, fontWeight: typography.semibold, color: colors.textPrimary },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  countBadge: {
    backgroundColor: colors.blue,
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.xs,
    paddingHorizontal: 5,
  },
  countBadgeText: { fontSize: 10, color: '#000', fontWeight: typography.bold },
  levelRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  levelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  levelDot: { width: 8, height: 8, borderRadius: 4 },
  levelLabel: { fontSize: typography.sm, color: colors.textSecondary },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: spacing.sm,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkLabel: { flex: 1, fontSize: typography.sm, color: colors.textSecondary },
});
