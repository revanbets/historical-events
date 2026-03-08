import { useState, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../services/supabase';
import { Event, FilterState } from '../types';

const BLOCKED_USERS_KEY = 'hdb_blocked_users';

const PAGE_SIZE = 30;

export function useEvents() {
  const [events, setEvents] = useState<Event[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const pageRef = useRef(0);

  const buildQuery = (filters: FilterState, offset: number) => {
    let query = supabase
      .from('events')
      .select('*')
      .or('is_public.eq.true')
      .order('date_uploaded', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (filters.search) {
      query = query.ilike('title', `%${filters.search}%`);
    }
    if (filters.showMajorOnly) {
      query = query.eq('is_major_event', true);
    }
    if (filters.dateFrom) {
      query = query.gte('date', filters.dateFrom);
    }
    if (filters.dateTo) {
      query = query.lte('date', filters.dateTo);
    }
    if (filters.researchLevels.length > 0) {
      query = query.in('research_level', filters.researchLevels);
    }

    return query;
  };

  const getBlockedUsers = async (): Promise<string[]> => {
    try {
      const raw = await AsyncStorage.getItem(BLOCKED_USERS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  };

  const loadEvents = useCallback(async (filters: FilterState) => {
    setIsLoading(true);
    pageRef.current = 0;
    try {
      const [{ data, error }, blocked] = await Promise.all([
        buildQuery(filters, 0),
        getBlockedUsers(),
      ]);
      if (error) throw error;
      const loaded = (data ?? []) as Event[];

      // Client-side filter for topics/people/orgs (arrays need contains check)
      let filtered = applyArrayFilters(loaded, filters);
      if (blocked.length > 0) {
        filtered = filtered.filter(e => !e.uploaded_by || !blocked.includes(e.uploaded_by));
      }
      setEvents(filtered);
      setHasMore(loaded.length === PAGE_SIZE);
    } catch (err) {
      console.error('Failed to load events:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadMore = useCallback(async (filters: FilterState) => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    const nextPage = pageRef.current + 1;
    pageRef.current = nextPage;
    try {
      const [{ data }, blocked] = await Promise.all([
        buildQuery(filters, nextPage * PAGE_SIZE),
        getBlockedUsers(),
      ]);
      const loaded = (data ?? []) as Event[];
      let filtered = applyArrayFilters(loaded, filters);
      if (blocked.length > 0) {
        filtered = filtered.filter(e => !e.uploaded_by || !blocked.includes(e.uploaded_by));
      }
      setEvents(prev => [...prev, ...filtered]);
      setHasMore(loaded.length === PAGE_SIZE);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMore]);

  return { events, isLoading, isLoadingMore, hasMore, loadEvents, loadMore };
}

function applyArrayFilters(events: Event[], filters: FilterState): Event[] {
  return events.filter(e => {
    if (filters.topics.length > 0) {
      const eventTopics = e.topics ?? [];
      if (!filters.topics.some(t => eventTopics.includes(t))) return false;
    }
    if (filters.people.length > 0) {
      const eventPeople = e.people ?? [];
      if (!filters.people.some(p => eventPeople.includes(p))) return false;
    }
    if (filters.organizations.length > 0) {
      const eventOrgs = e.organizations ?? [];
      if (!filters.organizations.some(o => eventOrgs.includes(o))) return false;
    }
    return true;
  });
}
