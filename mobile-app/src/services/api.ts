import { API_BASE_URL } from '../config';
import { Event, ResearchSession, EntityProfile } from '../types';

// All calls go to the same Render backend as the web app.
// Note: The free tier sleeps after 15 min — first request may take ~30s.

async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── Health ──────────────────────────────────────────────────────────────────

export async function checkBackendHealth(): Promise<boolean> {
  try {
    await apiFetch('/api/health');
    return true;
  } catch {
    return false;
  }
}

// ── URL / Web Page Analysis ─────────────────────────────────────────────────

export interface AnalyzeUrlOptions {
  url: string;
  focus?: string;          // e.g. "Look for references to MKULTRA"
  extractFrames?: boolean;
  startTime?: string;      // "00:02:30"
  endTime?: string;
}

export interface AnalyzeUrlResult {
  record_id?: string;
  title?: string;
  description?: string;
  topics?: string[];
  people?: string[];
  organizations?: string[];
  ai_summary?: string;
  error?: string;
}

export async function analyzeUrl(opts: AnalyzeUrlOptions): Promise<AnalyzeUrlResult> {
  return apiFetch('/api/analyze-url', {
    method: 'POST',
    body: JSON.stringify({
      url: opts.url,
      focus: opts.focus,
      extract_frames: opts.extractFrames ?? false,
      start_time: opts.startTime,
      end_time: opts.endTime,
    }),
  });
}

// ── Event Analysis ──────────────────────────────────────────────────────────

export async function analyzeEvent(recordId: string): Promise<{ success: boolean }> {
  return apiFetch(`/api/analyze/${recordId}`, { method: 'POST' });
}

// ── Entity Profile Generation ────────────────────────────────────────────────

export async function analyzeEntity(
  name: string,
  type: 'person' | 'org' | 'topic'
): Promise<EntityProfile> {
  return apiFetch('/api/analyze-entity', {
    method: 'POST',
    body: JSON.stringify({ name, type }),
  });
}

// ── File Upload (PDF, Word, images) ─────────────────────────────────────────

export interface UploadFileResult {
  backend_id?: string;
  filename?: string;
  extracted_text?: string;
  error?: string;
}

export async function uploadFile(
  fileUri: string,
  filename: string,
  mimeType: string
): Promise<UploadFileResult> {
  const formData = new FormData();
  formData.append('file', {
    uri: fileUri,
    name: filename,
    type: mimeType,
  } as unknown as Blob);

  const res = await fetch(`${API_BASE_URL}/api/upload`, {
    method: 'POST',
    body: formData,
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return res.json();
}

// ── Presentation Generation ──────────────────────────────────────────────────

export async function generatePresentation(
  events: Event[],
  depth: 1 | 2 | 3
): Promise<{ slides: unknown[] }> {
  return apiFetch('/api/generate-presentation', {
    method: 'POST',
    body: JSON.stringify({ events, depth }),
  });
}

// ── Text Condensing ──────────────────────────────────────────────────────────

export async function condenseText(text: string): Promise<{ condensed: string }> {
  return apiFetch('/api/condense', {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

// ── Frames & Attachments ─────────────────────────────────────────────────────

export function getFrameUrl(filename: string): string {
  return `${API_BASE_URL}/api/frames/${filename}`;
}

export function getAttachmentUrl(filename: string): string {
  return `${API_BASE_URL}/api/attachments/${filename}`;
}

export function getTranscriptUrl(filename: string): string {
  return `${API_BASE_URL}/api/transcripts/${filename}`;
}
