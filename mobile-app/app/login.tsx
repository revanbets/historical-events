import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '../src/contexts/AuthContext';
import { colors, spacing, radius, typography } from '../src/theme';

export default function LoginScreen() {
  const { login, loginWithBiometrics, biometricsAvailable, biometricsEnabled, session } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (session) router.replace('/(tabs)/');
  }, [session, router]);

  const handleLogin = async () => {
    if (!username.trim() || !password) {
      setError('Please enter your username and password.');
      return;
    }
    setError('');
    setIsLoading(true);
    const result = await login(username, password);
    setIsLoading(false);
    if (result.error) setError(result.error);
  };

  const handleBiometricLogin = async () => {
    setError('');
    setIsLoading(true);
    const result = await loginWithBiometrics();
    setIsLoading(false);
    if (result.error) setError(result.error);
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kav}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Logo / Brand */}
          <View style={styles.brand}>
            <View style={styles.logoCircle}>
              <Text style={styles.logoText}>HDB</Text>
            </View>
            <Text style={styles.appName}>HistoDB</Text>
            <Text style={styles.tagline}>Historical Events Research Database</Text>
          </View>

          {/* Login Form */}
          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Username</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="person-outline" size={16} color={colors.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="Enter your username"
                  placeholderTextColor={colors.textMuted}
                  returnKeyType="next"
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Password</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="lock-closed-outline" size={16} color={colors.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  placeholder="Enter your password"
                  placeholderTextColor={colors.textMuted}
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={18}
                    color={colors.textMuted}
                  />
                </TouchableOpacity>
              </View>
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={14} color={colors.red} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.loginBtn, isLoading && styles.loginBtnDisabled]}
              onPress={handleLogin}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#000" size="small" />
              ) : (
                <Text style={styles.loginBtnText}>Log In</Text>
              )}
            </TouchableOpacity>

            {biometricsAvailable && biometricsEnabled && (
              <TouchableOpacity style={styles.biometricBtn} onPress={handleBiometricLogin}>
                <Ionicons name="finger-print" size={20} color={colors.blue} />
                <Text style={styles.biometricBtnText}>Login with Face ID / Touch ID</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Info */}
          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={14} color={colors.textMuted} />
            <Text style={styles.infoText}>
              Use the same username and password as the HistoDB web app. Your account and data sync instantly.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  kav: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: spacing.lg },
  brand: { alignItems: 'center', marginBottom: spacing.xxl },
  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: colors.blueLight,
    borderWidth: 1,
    borderColor: 'rgba(96,165,250,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  logoText: { fontSize: 24, fontWeight: typography.bold, color: colors.blue },
  appName: { fontSize: typography.xxxl, fontWeight: typography.bold, color: colors.textPrimary, letterSpacing: -0.5 },
  tagline: { fontSize: typography.sm, color: colors.textMuted, marginTop: 4, textAlign: 'center' },
  form: { gap: spacing.md, marginBottom: spacing.lg },
  inputGroup: { gap: spacing.xs },
  inputLabel: { fontSize: typography.sm, fontWeight: typography.medium, color: colors.textSecondary },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 48,
  },
  inputIcon: { marginRight: spacing.sm },
  input: { flex: 1, fontSize: typography.base, color: colors.textPrimary },
  eyeBtn: { padding: 4 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.redLight,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  errorText: { flex: 1, fontSize: typography.sm, color: colors.red },
  loginBtn: {
    backgroundColor: colors.blue,
    borderRadius: radius.md,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  loginBtnDisabled: { opacity: 0.6 },
  loginBtnText: { fontSize: typography.md, fontWeight: typography.bold, color: '#000' },
  biometricBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
  },
  biometricBtnText: { fontSize: typography.base, color: colors.blue, fontWeight: typography.medium },
  infoBox: {
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoText: { flex: 1, fontSize: 12, color: colors.textMuted, lineHeight: 18 },
});
