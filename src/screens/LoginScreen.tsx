import React, { useState } from 'react';
import { StyleSheet, View, SafeAreaView, TouchableOpacity, TextInput, Alert, ScrollView, Platform, KeyboardAvoidingView, ActivityIndicator } from 'react-native';
import { ThemeText } from '../components/ThemeText';
import { ThemeCard } from '../components/ThemeCard';
import { COLORS, SPACING, BORDER_RADIUS } from '../theme/theme';
import { Mail, Lock, LogIn, ShieldAlert } from 'lucide-react-native';

interface LoginScreenProps {
  onLogin: (email: string, pass: string) => Promise<boolean>;
  onGoToSetup?: () => void; // Keep but maybe hide or use for something else
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin, onGoToSetup }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleLoginSubmit = async () => {
    if (!email || !password) {
      Alert.alert('入力エラー', 'メールアドレスとパスワードを入力してください。');
      return;
    }
    
    setIsLoading(true);
    try {
      const success = await onLogin(email, password);
      if (success) {
        console.log('--- [AUTH_FORCE_NAV] Login successful, forcing hard redirect ---');
        if (Platform.OS === 'web') {
          window.location.href = '/'; 
        }
      }
    } catch (e: any) {
      console.error('Login error:', e);
      Alert.alert('ログインエラー', '接続に失敗しました。');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.glassBackground} />
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
        style={{ flex: 1 }}
      >
        <ScrollView 
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <View style={styles.logoContainer}>
              <ShieldIcon size={64} color={COLORS.primary} />
            </View>
            <ThemeText variant="h1" style={styles.title}>Shift Manager</ThemeText>
            <ThemeText variant="caption" style={styles.subtitle}>SECURE AUTHENTICATION</ThemeText>
          </View>

          <ThemeCard style={styles.card}>
            <ThemeText variant="h2" style={{ marginBottom: 8, textAlign: 'center' }}>ログイン</ThemeText>
            <ThemeText variant="caption" color={COLORS.textSecondary} style={{ marginBottom: 32, textAlign: 'center' }}>
              登録済みのメールアドレスとパスワードを入力してください。
            </ThemeText>
            
            <View style={styles.inputGroup}>
              <ThemeText variant="label" style={{ marginBottom: 8 }}>メールアドレス / ID</ThemeText>
              <View style={styles.inputContainer}>
                <View style={styles.inputIconWrapper}>
                  <Mail size={20} color={COLORS.textSecondary} />
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="name@example.com"
                  placeholderTextColor={COLORS.textSecondary}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <ThemeText variant="label" style={{ marginBottom: 8 }}>パスワード</ThemeText>
              <View style={styles.inputContainer}>
                <View style={styles.inputIconWrapper}>
                  <Lock size={20} color={COLORS.textSecondary} />
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="••••••••"
                  placeholderTextColor={COLORS.textSecondary}
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                />
              </View>
            </View>

            <TouchableOpacity 
              style={[
                styles.loginBtn, 
                (!email || !password || isLoading) && { opacity: 0.6 }
              ]} 
              onPress={handleLoginSubmit}
              disabled={!email || !password || isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="white" />
              ) : (
                <>
                  <ThemeText color="white" bold style={{ fontSize: 16 }}>ログイン</ThemeText>
                  <LogIn size={20} color="white" style={{ marginLeft: 8 }} />
                </>
              )}
            </TouchableOpacity>

            <View style={styles.securityNotice}>
              <ShieldAlert size={14} color={COLORS.textSecondary} />
              <ThemeText variant="caption" color={COLORS.textSecondary} style={{ marginLeft: 6 }}>
                個人情報の保護のため、RLSセキュリティが有効です。
              </ThemeText>
            </View>
          </ThemeCard>

          <View style={styles.footer}>
            <ThemeText variant="caption" color={COLORS.textSecondary}>
              アカウントをお持ちでない場合は、管理者に登録を依頼してください。
            </ThemeText>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const ShieldIcon = ({ size, color }: any) => (
  <View style={{ 
    width: size, 
    height: size, 
    backgroundColor: color + '15', 
    borderRadius: size/3, 
    justifyContent: 'center', 
    alignItems: 'center',
    borderWidth: 2,
    borderColor: color + '30'
  }}>
     <LogIn size={size * 0.5} color={color} />
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  glassBackground: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(56, 189, 248, 0.03)' },
  scrollContent: { flexGrow: 1, padding: SPACING.lg, justifyContent: 'center', paddingVertical: SPACING.xl },
  header: { alignItems: 'center', marginBottom: SPACING.xl },
  logoContainer: { marginBottom: 16 },
  title: { fontSize: 32, fontWeight: 'bold' },
  subtitle: { marginTop: 4, letterSpacing: 3, opacity: 0.6, fontSize: 10, fontWeight: 'bold' },
  card: { padding: SPACING.xl, borderRadius: 32, elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 20 },
  inputGroup: { marginBottom: 20 },
  inputContainer: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: 'rgba(255,255,255,0.05)', 
    borderRadius: 16, 
    height: 56, 
    borderWidth: 1, 
    borderColor: 'rgba(255,255,255,0.1)' 
  },
  inputIconWrapper: { marginLeft: 16, marginRight: 12 },
  input: { flex: 1, color: COLORS.text, fontSize: 16, height: '100%' },
  loginBtn: { 
    backgroundColor: COLORS.primary, 
    flexDirection: 'row', 
    height: 56, 
    borderRadius: 18, 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginTop: 12,
    shadowColor: COLORS.primary, 
    shadowOffset: { width: 0, height: 6 }, 
    shadowOpacity: 0.4, 
    shadowRadius: 10, 
    elevation: 6 
  },
  securityNotice: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 24, opacity: 0.7 },
  footer: { marginTop: 32, alignItems: 'center' }
});
