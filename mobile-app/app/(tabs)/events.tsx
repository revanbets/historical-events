import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { EventCard } from '../../src/components/EventCard';
import { FilterSheet } from '../../src/components/FilterSheet';
import { useEvents } from '../../src/hooks/useEvents';
import { supabase } from '../../src/services/supabase';
import { FilterState, DEFAULT_FILTERS } from '../../src/types';
import { colors, spacing, radius, typography } from '../../src/theme';

export default function EventsScreen() {
  const router = useRouter();
  const { events, isLoading, isLoadingMore, hasMore, loadEvents, loadMore } = useEvents();

  const [searchText, setSearchText] = useState('');
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Metadata for filter sheet
  const [availableTopics, setAvailableTopics] = useState<string[]>([]);
  const [availablePeople, setAvailablePeople] = useState<string[]>([]);
  const [availableOrgs, setAvailableOrgs] = useState<string[]>([]);

  useEffect(() => {
    loadEvents(filters);
    loadFilterOptions();
  }, []);

  const loadFilterOptions = async () => {
    const { data } = await supabase.from('events').select('topics, people, organizations').limit(500);
    if (!data) return;
    const topics = new Set<string>();
    const people = new Set<string>();
    const orgs = new Set<string>();
    data.forEach((row: { topics?: string[]; people?: string[]; organizations?: string[] }) => {
      row.topics?.forEach((t: string) => topics.add(t));
      row.people?.forEach((p: string) => people.add(p));
      row.organizations?.forEach((o: string) => orgs.add(o));
    });
    setAvailableTopics(Array.from(topics).sort());
    setAvailablePeople(Array.from(people).sort());
    setAvailableOrgs(Array.from(orgs).sort());
  };

  const handleSearch = useCallback(() => {
    const updated = { ...filters, search: searchText.trim() };
    setFilters(updated);
    loadEvents(updated);
  }, [searchText, filters, loadEvents]);

  const handleApplyFilters = (newFilters: FilterState) => {
    const updated = { ...newFilters, search: searchText.trim() };
    setFilters(updated);
    loadEvents(updated);
  };

  const handleClearSearch = () => {
    setSearchText('');
    const updated = { ...filters, search: '' };
    setFilters(updated);
    loadEvents(updated);
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadEvents(filters).finally(() => setRefreshing(false));
  }, [filters, loadEvents]);

  const activeFilterCount =
    filters.topics.length +
    filters.people.length +
    filters.organizations.length +
    filters.researchLevels.length +
    (filters.showMajorOnly ? 1 : 0);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Events</Text>
        <Text style={styles.eventCount}>{events.length.toLocaleString()}</Text>
      </View>

      {/* Search bar */}
      <View style={styles.searchRow}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={searchText}
            onChangeText={setSearchText}
            placeholder="Search events..."
            placeholderTextColor={colors.textMuted}
            returnKeyType="search"
            onSubmitEditing={handleSearch}
          />
          {searchText.length > 0 && (
            <TouchableOpacity onPress={handleClearSearch}>
              <Ionicons name="close-circle" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={[styles.filterBtn, activeFilterCount > 0 && styles.filterBtnActive]}
          onPress={() => setShowFilters(true)}
        >
          <Ionicons
            name="options"
            size={18}
            color={activeFilterCount > 0 ? colors.blue : colors.textMuted}
          />
          {activeFilterCount > 0 && (
            <View style={styles.filterBadge}>
              <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Active filter pills */}
      {activeFilterCount > 0 && (
        <View style={styles.activePills}>
          {filters.showMajorOnly && (
            <ActivePill label="Major only" onRemove={() => handleApplyFilters({ ...filters, showMajorOnly: false })} />
          )}
          {filters.topics.map(t => (
            <ActivePill key={t} label={t} onRemove={() => handleApplyFilters({ ...filters, topics: filters.topics.filter(x => x !== t) })} />
          ))}
          {filters.people.map(p => (
            <ActivePill key={p} label={p} onRemove={() => handleApplyFilters({ ...filters, people: filters.people.filter(x => x !== p) })} />
          ))}
          {filters.organizations.map(o => (
            <ActivePill key={o} label={o} onRemove={() => handleApplyFilters({ ...filters, organizations: filters.organizations.filter(x => x !== o) })} />
          ))}
        </View>
      )}

      {/* Events list */}
      {isLoading ? (
        <ActivityIndicator color={colors.blue} size="large" style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={events}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <EventCard
              event={item}
              onPress={() =>
                router.push({
                  pathname: '/(modals)/event-detail',
                  params: { eventId: item.id },
                })
              }
            />
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.blue} />
          }
          onEndReached={() => loadMore(filters)}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            isLoadingMore ? (
              <ActivityIndicator color={colors.blue} style={{ marginVertical: spacing.md }} />
            ) : !hasMore && events.length > 0 ? (
              <Text style={styles.endText}>All events loaded</Text>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="search-outline" size={48} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>No events found</Text>
              <Text style={styles.emptySubtitle}>
                {activeFilterCount > 0 ? 'Try adjusting your filters.' : 'Upload your first source to get started.'}
              </Text>
            </View>
          }
        />
      )}

      <FilterSheet
        visible={showFilters}
        filters={filters}
        availableTopics={availableTopics}
        availablePeople={availablePeople}
        availableOrgs={availableOrgs}
        onApply={handleApplyFilters}
        onClose={() => setShowFilters(false)}
      />
    </SafeAreaView>
  );
}

function ActivePill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillText} numberOfLines={1}>{label}</Text>
      <TouchableOpacity onPress={onRemove} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
        <Ionicons name="close" size={12} color={colors.blue} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  headerTitle: { fontSize: typography.xxl, fontWeight: typography.bold, color: colors.textPrimary },
  eventCount: { fontSize: typography.sm, color: colors.textMuted },
  searchRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 42,
  },
  searchInput: { flex: 1, fontSize: typography.base, color: colors.textPrimary },
  filterBtn: {
    width: 42,
    height: 42,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBtnActive: { borderColor: colors.blue, backgroundColor: colors.blueDim },
  filterBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: colors.blue,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  filterBadgeText: { fontSize: 9, color: '#000', fontWeight: typography.bold },
  activePills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.blueDim,
    borderWidth: 1,
    borderColor: 'rgba(96,165,250,0.3)',
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
    maxWidth: 140,
  },
  pillText: { fontSize: 11, color: colors.blue, fontWeight: typography.medium },
  list: { padding: spacing.md, paddingTop: spacing.sm },
  emptyState: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.sm, paddingHorizontal: spacing.xl },
  emptyTitle: { fontSize: typography.md, fontWeight: typography.semibold, color: colors.textSecondary },
  emptySubtitle: { fontSize: typography.sm, color: colors.textMuted, textAlign: 'center' },
  endText: { textAlign: 'center', color: colors.textMuted, fontSize: typography.sm, padding: spacing.md },
});
