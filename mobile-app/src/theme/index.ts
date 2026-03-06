// HistoDB Design System — matches the dark navy aesthetic of the web app

export const colors = {
  // Backgrounds
  background: '#0F1223',
  surface: '#141827',
  surfaceElevated: '#1a2035',
  surfaceHighlight: 'rgba(255,255,255,0.04)',

  // Borders
  border: 'rgba(255,255,255,0.07)',
  borderStrong: 'rgba(255,255,255,0.12)',

  // Accents
  blue: '#60a5fa',
  blueLight: 'rgba(96,165,250,0.15)',
  blueDim: 'rgba(96,165,250,0.08)',
  purple: '#a78bfa',
  purpleLight: 'rgba(167,139,250,0.15)',
  green: '#34d399',
  greenLight: 'rgba(52,211,153,0.15)',
  orange: '#fb923c',
  orangeLight: 'rgba(251,146,60,0.15)',
  red: '#f87171',
  redLight: 'rgba(248,113,113,0.15)',
  yellow: '#fbbf24',
  yellowLight: 'rgba(251,191,36,0.15)',

  // Text
  textPrimary: '#e2e8f0',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
  textInverse: '#0F1223',

  // Status colors
  verified: '#34d399',
  unverified: '#64748b',
  flagged: '#fb923c',
  historical: '#60a5fa',

  // Tab bar
  tabActive: '#60a5fa',
  tabInactive: '#64748b',
  tabBackground: '#0d1020',

  // Source brand colors
  youtube: '#FF0000',
  tiktok: '#fe2c55',
  instagram: '#E1306C',
  twitter: '#1DA1F2',
  reddit: '#FF4500',
  rumble: '#85c742',
  substack: '#FF6719',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 999,
};

export const typography = {
  // Sizes
  xs: 11,
  sm: 13,
  base: 15,
  md: 17,
  lg: 19,
  xl: 22,
  xxl: 28,
  xxxl: 34,

  // Weights (as string for React Native)
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};

// Research level configuration
export const researchLevelConfig = [
  { level: 1, label: 'Surface', color: colors.blue },
  { level: 2, label: 'Reported', color: colors.green },
  { level: 3, label: 'Documented', color: colors.yellow },
  { level: 4, label: 'Suppressed', color: colors.orange },
  { level: 5, label: 'Classified', color: colors.red },
];

// Event status configuration
export const eventStatusConfig = {
  verified: { label: 'Verified', color: colors.verified, bg: colors.greenLight },
  unverified: { label: 'Unverified', color: colors.unverified, bg: 'rgba(100,116,139,0.15)' },
  flagged: { label: 'Flagged', color: colors.flagged, bg: colors.orangeLight },
  historical_record: { label: 'Historical', color: colors.historical, bg: colors.blueDim },
};

// Source detection from URL
export function detectSourceFromUrl(url: string): { name: string; color: string } {
  const lower = url.toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be'))
    return { name: 'YouTube', color: colors.youtube };
  if (lower.includes('tiktok.com'))
    return { name: 'TikTok', color: colors.tiktok };
  if (lower.includes('instagram.com'))
    return { name: 'Instagram', color: colors.instagram };
  if (lower.includes('twitter.com') || lower.includes('x.com'))
    return { name: 'X (Twitter)', color: colors.twitter };
  if (lower.includes('reddit.com'))
    return { name: 'Reddit', color: colors.reddit };
  if (lower.includes('rumble.com'))
    return { name: 'Rumble', color: colors.rumble };
  if (lower.includes('substack.com'))
    return { name: 'Substack', color: colors.substack };
  if (lower.includes('bitchute.com'))
    return { name: 'BitChute', color: colors.orange };
  if (lower.includes('telegram.org') || lower.includes('t.me'))
    return { name: 'Telegram', color: colors.blue };
  return { name: 'Web', color: colors.blue };
}
