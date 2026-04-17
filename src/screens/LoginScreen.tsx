import React, { useState, useRef } from 'react';
import { StyleSheet, View, SafeAreaView, TouchableOpacity, TextInput, Alert, ScrollView, Platform, KeyboardAvoidingView, ActivityIndicator } from 'react-native';
import { ThemeText } from '../components/ThemeText';
import { ThemeCard } from '../components/ThemeCard';
import { COLORS, SPACING, BORDER_RADIUS } from '../theme/theme';
import { User, Lock, Mail, ChevronRight, PlusCircle, LogIn, ShieldAlert, RefreshCw } from 'lucide-react-native';

interface LoginScreenProps {
  onLogin: (staff: any, pass: string) => void;
  onAdminLogin: () => Promise<void>;
  onGoToSetup: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ 
  onLogin, 
  onAdminLogin,
  onGoToSetup 
}) => {
  const [isLoading, setIsLoading] = useState(false);
  const [staffName, setStaffName] = useState('');
  const [password, setPassword] = useState('');
  const [uiError, setUiError] = useState<string | null>(null);
  const [showEmergencyReset, setShowEmergencyReset] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const emergencyRef = useRef<NodeJS.Timeout | null>(null);

  const handleAdminRecovery = () => {
    if (Platform.OS === 'web') {
      const pass = window.prompt('管理者パスワードを入力してください');
      if (pass) onAdminLogin(pass);
    } else {
      Alert.prompt(
        '管理者認証',
        'マスターパスワードを入力してください',
        [
          { text: 'キャンセル', style: 'cancel' },
          { text: 'ログイン', onPress: (pass) => onAdminLogin(pass) }
        ],
        'secure-text'
      );
    }
  };

  const clearTimers = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (emergencyRef.current) clearTimeout(emergencyRef.current);
  };

  const handlePersonalLogin = async (e?: any) => {
    // 1. Form Default Behavior (for Web)
    if (e && e.preventDefault) {
      e.preventDefault();
    }

    setUiError(null);
    setShowEmergencyReset(false);
    clearTimers();

    const normalizedName = staffName || '';
    
    // 2. Null Safety & Input Validation
    if (!normalizedName.trim()) {
      setUiError('氏名を入力してください');
      return;
    }
    if (!password) {
      setUiError('パスワードを入力してください');
      return;
    }

    setIsLoading(true);

    // RULE 2: FORCED TIMEOUT (10s)
    timeoutRef.current = setTimeout(() => {
      if (isLoading) {
        setIsLoading(false);
        setUiError('接続タイムアウト - 通信環境を確認して再試行してください');
      }
    }, 10000);

    // RULE 5: EMERGENCY RESET (15s)
    emergencyRef.current = setTimeout(() => {
      setShowEmergencyReset(true);
    }, 15000);

    try {
      // 3. Absolute State Reset via try...catch...finally
      const success = await onLogin({ name: normalizedName.trim() }, password);
      
      if (!success) {
        setUiError('ログインに失敗しました。氏名またはパスワードを確認してください。');
      }
    } catch (err: any) {
      // 4. Visible UI Errors
      setUiError(`エラー: ${err.message || '予期せぬエラーが発生しました'}`);
      console.error('Login error in UI:', err);
    } finally {
      // RULE 1: NO HANGING PROMISES
      clearTimers();
      setIsLoading(false);
    }
  };

  const handleForceReload = () => {
    if (Platform.OS === 'web') {
      window.location.reload();
    } else {
      // Native reset would involve clearing app state or similar
      Alert.alert('リセット', 'アプリを再起動してください');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.glassBackground} />
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.header}>
            <ThemeText variant="h1" style={styles.title}>シフトマネジャー</ThemeText>
            <ThemeText variant="caption" style={styles.subtitle}>ログインして始めましょう</ThemeText>
          </View>

          <ThemeCard style={styles.card}>
            {/* Using a standard View as form container, onSubmit handling for Web */}
            <View 
              style={styles.formSection}
              // @ts-ignore - native doesn't have accessibilityRole form but web does via props
              accessibilityRole={Platform.OS === 'web' ? 'form' : undefined}
            >
              {uiError && (
                <View style={styles.errorBanner}>
                  <ShieldAlert size={16} color={COLORS.error} />
                  <ThemeText variant="caption" color={COLORS.error} style={{ marginLeft: 8, fontWeight: 'bold' }}>
                    {uiError}
                  </ThemeText>
                </View>
              )}

              <View style={styles.inputGroup}>
                <View style={styles.inputHeader}>
                  <User size={16} color={COLORS.primary} />
                  <ThemeText variant="label" style={{ marginLeft: 8 }}>氏名</ThemeText>
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="氏名を入力 (例: 山田)"
                  placeholderTextColor={COLORS.textSecondary}
                  autoCapitalize="none"
                  value={staffName}
                  onChangeText={setStaffName}
                />
              </View>

              <View style={styles.inputGroup}>
                <View style={styles.inputHeader}>
                  <Lock size={16} color={COLORS.primary} />
                  <ThemeText variant="label" style={{ marginLeft: 8 }}>パスワード</ThemeText>
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="パスワードを入力"
                  placeholderTextColor={COLORS.textSecondary}
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                />
              </View>

              <TouchableOpacity 
                style={[styles.loginBtn, (isLoading || !staffName || !password) && { opacity: 0.5 }]} 
                onPress={() => handlePersonalLogin()}
                disabled={isLoading || !staffName || !password}
              >
                <ThemeText color="white" bold>
                  {isLoading ? 'ログイン中...' : 'ログイン'}
                </ThemeText>
                <LogIn size={20} color="white" style={{ marginLeft: 10 }} />
              </TouchableOpacity>

              {showEmergencyReset && (
                <TouchableOpacity 
                  style={styles.emergencyResetBtn} 
                  onPress={handleForceReload}
                >
                  <RefreshCw size={16} color="#ef4444" />
                  <ThemeText style={{ marginLeft: 8, color: '#ef4444', fontWeight: 'bold' }}>
                    問題が発生していますか？強制リセット
                  </ThemeText>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.divider} />

            <TouchableOpacity style={styles.setupBtn} onPress={onGoToSetup}>
              <PlusCircle size={20} color={COLORS.primary} />
              <ThemeText color={COLORS.primary} bold style={{ marginLeft: 8 }}>新しい職員として登録</ThemeText>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.adminRecoveryLink} 
              onPress={handleAdminRecovery}
            >
              <ThemeText variant="caption" color={COLORS.textSecondary} style={{ textDecorationLine: 'underline' }}>
                管理者用データ復旧
              </ThemeText>
            </TouchableOpacity>
          </ThemeCard>

          {/* EMERGENCY DEV BYPASS - Visible in dev or via sigma URL */}
          {(__DEV__ || (typeof window !== 'undefined' && window.location.hostname.includes('sigma'))) && (
            <TouchableOpacity 
              style={styles.devBypassBtn} 
              onPress={() => onLogin({ name: 'admin' }, 'admin123')}
            >
              <ShieldAlert size={14} color={COLORS.textSecondary} />
              <ThemeText variant="caption" color={COLORS.textSecondary} style={{ marginLeft: 6 }}>
                [DEV] 緊急管理者ログイン (Bypass Auth)
              </ThemeText>
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  glassBackground: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(56, 189, 248, 0.03)' },
  scrollContent: { flexGrow: 1, padding: SPACING.lg, justifyContent: 'center' },
  header: { alignItems: 'center', marginBottom: 40 },
  title: { fontSize: 32, fontWeight: 'bold' },
  subtitle: { marginTop: 4, letterSpacing: 2, opacity: 0.6 },
  card: { padding: SPACING.xl, borderRadius: 24, elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 20 },
  formSection: { gap: 20 },
  inputGroup: { gap: 10 },
  inputHeader: { flexDirection: 'row', alignItems: 'center' },
  input: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, paddingHorizontal: 16, height: 56, borderWidth: 1, borderColor: COLORS.border, color: COLORS.text, fontSize: 16 },
  loginBtn: { backgroundColor: COLORS.primary, flexDirection: 'row', height: 60, borderRadius: 18, justifyContent: 'center', alignItems: 'center', shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 6, marginTop: 10 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.05)', marginVertical: 30 },
  setupBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: COLORS.primary + '60' },
  adminRecoveryLink: { marginTop: 24, alignItems: 'center', padding: 10 },
  errorBanner: {
    backgroundColor: COLORS.error + '15',
    padding: 12,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.error + '30',
  },
  devBypassBtn: {
    marginTop: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    opacity: 0.4,
  },
  emergencyResetBtn: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  }
});
