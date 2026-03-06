// TypeScript types mirroring the Supabase schema used by the web app

export interface User {
  username: string;
  role: 'owner' | 'admin' | 'user';
  karma: number;
  created_at: string;
}

export type EventStatus = 'unverified' | 'flagged' | 'verified' | 'historical_record';

export interface Event {
  id: string;
  title: string;
  description: string;
  date: string;
  date_uploaded: string;
  topics: string[];
  people: string[];
  organizations: string[];
  links: string[];
  research_level: number; // 1–5
  source_type: string;
  source: string;
  primary_source: string;
  source_sheet?: string;
  main_link: string;
  connections?: string[];
  ai_summary?: string;
  is_major_event: boolean;
  uploaded_by: string;
  is_public: boolean;
  event_status: EventStatus;
  backend_id?: string;
  ai_analyzed: boolean;
  analysis_mode?: string;
  has_frames?: boolean;
  visual_content?: string;
  frames_data?: string[];
  transcript_file?: string;
  attachments?: Attachment[];
  backend_file_name?: string;
  is_video?: boolean;
  transcription?: string;
}

export interface Attachment {
  filename: string;
  type: string;
}

export interface EntityProfile {
  id: string;
  entity_name: string;
  entity_type: 'person' | 'org' | 'topic';
  description: string;
  date_start?: string;
  date_end?: string;
  related_topics: string[];
  related_people: string[];
  related_organizations: string[];
  ai_generated: boolean;
  user_id?: string;
  created_at: string;
  updated_at: string;
}

export interface TrailEntry {
  id: string;
  url: string;
  title?: string;
  favIconUrl?: string;
  timestamp: string;
  fromUrl?: string;
}

export type CaptureType = 'url' | 'text' | 'video' | 'image';

export interface CapturedItem {
  id: string;
  type: CaptureType;
  url?: string;
  pageTitle?: string;
  text?: string;
  timecode?: string;
  timecodeEnd?: string;
  frames?: string[];
  timestamp: string;
  source?: string; // 'clipboard', 'share', 'browser', 'manual'
}

export type SessionStatus = 'active' | 'paused' | 'ended' | 'analyzed';

export interface ResearchSession {
  id: string;
  uploaded_by: string;
  session_name: string;
  started_at: string;
  ended_at?: string;
  trail: TrailEntry[];
  captured_items: CapturedItem[];
  status: SessionStatus;
}

export interface Notification {
  id: string;
  type: 'upload' | 'ai_analysis' | 'ai_error' | 'edit' | 'mention';
  title: string;
  message: string;
  event_id?: string;
  created_by: string;
  created_by_role: string;
  created_at: string;
  read_by: string[];
  dismissed_by: string[];
  metadata?: Record<string, unknown>;
}

export interface Presentation {
  id: string;
  user_id: string;
  name: string;
  is_public: boolean;
  slides: PresentationSlide[];
  created_at: string;
  updated_at: string;
}

export interface PresentationSlide {
  id: string;
  type: 'title' | 'overview' | 'key_figures' | 'timeline' | 'custom';
  blocks: SlideBlock[];
}

export interface SlideBlock {
  id: string;
  type: 'heading' | 'text' | 'image' | 'event_ref';
  content: string;
}

export interface ChatChannel {
  id: string;
  name: string;
  description?: string;
  members: string[];
  created_by: string;
  created_at: string;
  last_message_at?: string;
}

export interface ChatMessage {
  id: string;
  channel_id: string;
  sender: string;
  content: string;
  reactions: Record<string, string[]>;
  reply_to?: string;
  edited: boolean;
  edited_at?: string;
  created_at: string;
}

// App-specific types

export interface AppSession {
  username: string;
  role: 'owner' | 'admin' | 'user';
  karma: number;
}

export type DetectedSource = {
  name: string;
  color: string;
  icon?: string;
};

export interface FilterState {
  search: string;
  topics: string[];
  people: string[];
  organizations: string[];
  researchLevels: number[];
  dateFrom: string;
  dateTo: string;
  showMajorOnly: boolean;
}

export const DEFAULT_FILTERS: FilterState = {
  search: '',
  topics: [],
  people: [],
  organizations: [],
  researchLevels: [],
  dateFrom: '',
  dateTo: '',
  showMajorOnly: false,
};
