import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Switch,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { analyzeUrl, uploadFile } from '../../src/services/api';
import { supabase } from '../../src/services/supabase';
import { useAuth } from '../../src/contexts/AuthContext';
import { colors, spacing, radius, typography } from '../../src/theme';

export default function UploadScreen() {
  const { session } = useAuth();
  const router = useRouter();

  const [urlInput, setUrlInput] = useState('');
  const [focusInput, setFocusInput] = useState('');
  const [autoAnalyze, setAutoAnalyze] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'analyzing' | 'done' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [elapsed, setElapsed] = useState(0);

  // Track elapsed seconds during analysis to show wake-up message
  React.useEffect(() => {
    if (uploadStatus !== 'analyzing') {
      setElapsed(0);
      return;
    }
    const interval = setInterval(() => {
      setElapsed(prev => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [uploadStatus]);

  // ── URL Submit ────────────────────────────────────────────────────────────

  const handleUrlSubmit = async () => {
    const url = urlInput.trim();
    if (!url) return;

    setIsAnalyzing(true);
    setUploadStatus('analyzing');
    setStatusMessage('Waking up analysis server…');

    try {
      const result = await analyzeUrl({ url, focus: focusInput.trim() || undefined });
      if (result.record_id) {
        await supabase.from('events').insert([{
          id: result.record_id,
          title: result.title ?? 'Untitled',
          description: '',
          ai_summary: result.ai_summary,
          topics: result.topics ?? [],
          people: result.people ?? [],
          organizations: result.organizations ?? [],
          links: [url],
          main_link: url,
          source_type: 'URL',
          source: url,
          uploaded_by: session?.username,
          is_public: false,
          event_status: 'unverified',
          ai_analyzed: true,
          date_uploaded: new Date().toISOString(),
        }]);
        setUploadStatus('done');
        setStatusMessage(`Saved: "${result.title ?? 'Event'}"`);
        setUrlInput('');
        setFocusInput('');
      } else {
        throw new Error(result.error ?? 'Unknown error');
      }
    } catch (err) {
      setUploadStatus('error');
      setStatusMessage(String(err instanceof Error ? err.message : err));
    } finally {
      setIsAnalyzing(false);
    }
  };

  // ── Camera / Photo ────────────────────────────────────────────────────────

  const handleCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission Required', 'Camera access is needed to photograph documents.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (!result.canceled && result.assets[0]) {
      await processFile(result.assets[0].uri, result.assets[0].fileName ?? 'photo.jpg', 'image/jpeg');
    }
  };

  const handlePhotoPicker = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission Required', 'Photo library access is needed to select documents.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (!result.canceled && result.assets[0]) {
      await processFile(result.assets[0].uri, result.assets[0].fileName ?? 'image.jpg', 'image/jpeg');
    }
  };

  const handleDocumentPicker = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      copyToCacheDirectory: true,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      await processFile(asset.uri, asset.name, asset.mimeType ?? 'application/pdf');
    }
  };

  const processFile = async (uri: string, name: string, mimeType: string) => {
    setUploadStatus('uploading');
    setStatusMessage(`Uploading ${name}…`);
    setIsAnalyzing(true);
    try {
      const uploadResult = await uploadFile(uri, name, mimeType);
      if (!uploadResult.backend_id) throw new Error(uploadResult.error ?? 'Upload failed');

      setUploadStatus('analyzing');
      setStatusMessage('Extracting text and analyzing…\nServer may need to wake up first.');

      const analyzeResult = await analyzeUrl({
        url: `${uploadResult.filename}`,
        focus: focusInput.trim() || undefined,
      });

      setUploadStatus('done');
      setStatusMessage(`File processed: "${uploadResult.filename}"`);
    } catch (err) {
      setUploadStatus('error');
      setStatusMessage(String(err instanceof Error ? err.message : err));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const statusColors = {
    idle: colors.textMuted,
    uploading: colors.blue,
    analyzing: colors.purple,
    done: colors.green,
    error: colors.red,
  };

  const statusIcons: Record<string, string> = {
    idle: 'cloud-upload-outline',
    uploading: 'cloud-upload',
    analyzing: 'sparkles',
    done: 'checkmark-circle',
    error: 'alert-circle',
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.headerTitle}>Add Source</Text>
        <Text style={styles.headerSub}>
          Upload a URL, document, or photo. The AI will extract events, topics, people, and organizations.
        </Text>

        {/* Status Banner */}
        {uploadStatus !== 'idle' && (
          <View style={[styles.statusBanner, { borderColor: statusColors[uploadStatus] + '40', backgroundColor: statusColors[uploadStatus] + '15' }]}>
            {uploadStatus === 'analyzing' ? (
              <ActivityIndicator size="small" color={statusColors[uploadStatus]} />
            ) : (
              <Ionicons name={statusIcons[uploadStatus] as never} size={16} color={statusColors[uploadStatus]} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={[styles.statusText, { color: statusColors[uploadStatus] }]}>{statusMessage}</Text>
              {uploadStatus === 'analyzing' && elapsed >= 3 && (
                <Text style={[styles.statusSubText, { color: statusColors[uploadStatus] }]}>
                  Waking up analysis server… this may take up to 30 seconds ({elapsed}s)
                </Text>
              )}
            </View>
            {(uploadStatus === 'done' || uploadStatus === 'error') && (
              <TouchableOpacity onPress={() => setUploadStatus('idle')}>
                <Ionicons name="close" size={16} color={statusColors[uploadStatus]} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* URL Input */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>URL or Video Link</Text>
          <Text style={styles.sectionSub}>Web pages, YouTube, Rumble, TikTok, and more</Text>
          <View style={styles.urlInputWrapper}>
            <Ionicons name="link" size={16} color={colors.textMuted} style={{ marginRight: spacing.sm }} />
            <TextInput
              style={styles.urlInput}
              value={urlInput}
              onChangeText={setUrlInput}
              placeholder="https://..."
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="done"
              multiline={false}
            />
            {urlInput.length > 0 && (
              <TouchableOpacity onPress={() => setUrlInput('')}>
                <Ionicons name="close-circle" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
          <TextInput
            style={styles.focusInput}
            value={focusInput}
            onChangeText={setFocusInput}
            placeholder="Analysis focus (optional) — e.g. 'Look for references to MKULTRA'"
            placeholderTextColor={colors.textMuted}
            multiline
            numberOfLines={2}
          />
          <TouchableOpacity
            style={[styles.submitBtn, (!urlInput.trim() || isAnalyzing) && styles.submitBtnDisabled]}
            onPress={handleUrlSubmit}
            disabled={!urlInput.trim() || isAnalyzing}
          >
            {isAnalyzing ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <>
                <Ionicons name="sparkles" size={18} color="#000" />
                <Text style={styles.submitBtnText}>Analyze & Save</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* File Sources */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Files & Documents</Text>
          <Text style={styles.sectionSub}>Photos, PDFs, Word docs — text will be extracted and analyzed</Text>
          <View style={styles.fileButtons}>
            <FileButton
              icon="camera"
              label="Camera"
              sublabel="Scan a document"
              onPress={handleCamera}
              color={colors.blue}
            />
            <FileButton
              icon="images"
              label="Photos"
              sublabel="From photo library"
              onPress={handlePhotoPicker}
              color={colors.purple}
            />
            <FileButton
              icon="document-text"
              label="PDF / Doc"
              sublabel="From files app"
              onPress={handleDocumentPicker}
              color={colors.green}
            />
          </View>
        </View>

        {/* Auto-analyze Toggle */}
        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Ionicons name="sparkles" size={16} color={colors.blue} />
            <View>
              <Text style={styles.toggleTitle}>Auto AI Analysis</Text>
              <Text style={styles.toggleSub}>
                {autoAnalyze ? 'AI runs automatically on every upload' : 'AI analysis is manual'}
              </Text>
            </View>
          </View>
          <Switch
            value={autoAnalyze}
            onValueChange={setAutoAnalyze}
            trackColor={{ false: colors.border, true: colors.blue }}
            thumbColor="#fff"
          />
        </View>

        {/* Backend notice */}
        <View style={styles.noticeBox}>
          <Ionicons name="time-outline" size={14} color={colors.textMuted} />
          <Text style={styles.noticeText}>
            The analysis server may take up to 30 seconds to wake up if it hasn't been used recently.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function FileButton({
  icon,
  label,
  sublabel,
  onPress,
  color,
}: {
  icon: string;
  label: string;
  sublabel: string;
  onPress: () => void;
  color: string;
}) {
  return (
    <TouchableOpacity style={styles.fileBtn} onPress={onPress}>
      <View style={[styles.fileBtnIcon, { backgroundColor: color + '20' }]}>
        <Ionicons name={icon as never} size={24} color={color} />
      </View>
      <Text style={styles.fileBtnLabel}>{label}</Text>
      <Text style={styles.fileBtnSub}>{sublabel}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.md, paddingBottom: 40 },
  headerTitle: { fontSize: typography.xxl, fontWeight: typography.bold, color: colors.textPrimary, marginBottom: 4 },
  headerSub: { fontSize: typography.sm, color: colors.textMuted, marginBottom: spacing.lg, lineHeight: 20 },
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  statusText: { fontSize: typography.sm, fontWeight: typography.medium },
  statusSubText: { fontSize: 11, marginTop: 4, opacity: 0.85 },
  section: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  sectionTitle: { fontSize: typography.base, fontWeight: typography.bold, color: colors.textPrimary },
  sectionSub: { fontSize: 12, color: colors.textMuted, marginTop: -4 },
  urlInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceHighlight,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 46,
  },
  urlInput: { flex: 1, fontSize: typography.sm, color: colors.textPrimary, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  focusInput: {
    backgroundColor: colors.surfaceHighlight,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.sm,
    color: colors.textPrimary,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.blue,
    borderRadius: radius.md,
    height: 48,
  },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: { fontSize: typography.base, fontWeight: typography.bold, color: '#000' },
  fileButtons: { flexDirection: 'row', gap: spacing.sm },
  fileBtn: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surfaceHighlight,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fileBtnIcon: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  fileBtnLabel: { fontSize: typography.sm, fontWeight: typography.semibold, color: colors.textPrimary },
  fileBtnSub: { fontSize: 10, color: colors.textMuted, textAlign: 'center' },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  toggleInfo: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, flex: 1 },
  toggleTitle: { fontSize: typography.sm, fontWeight: typography.semibold, color: colors.textPrimary },
  toggleSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  noticeBox: {
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radius.md,
  },
  noticeText: { flex: 1, fontSize: 11, color: colors.textMuted, lineHeight: 16 },
});
