import React, { useState } from 'react';
import { StyleSheet, View, SafeAreaView, TouchableOpacity, TextInput, Alert, ScrollView, Platform, KeyboardAvoidingView } from 'react-native';
import { ThemeText } from '../components/ThemeText';
import { ThemeCard } from '../components/ThemeCard';
import { COLORS, SPACING, BORDER_RADIUS } from '../theme/theme';
import { User, Lock, ChevronRight, Search, PlusCircle, ArrowRight } from 'lucide-react-native';
import { sortStaffByName} from '../utils/staffUtils';

interface LoginScreenProps {
  staffList: any[];
  onLogin: (staff: any) => void;
  onGoToSetup: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ staffList, onLogin, onGoToSetup }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStaff, setSelectedStaff] = useState<any>(null);
  const [password, setPassword] = useState('');

  const filteredStaff = sortStaffByName(staffList.filter(s => 
    (s.name || '').toLowerCase().includes(searchQuery.toLowerCase())
  ));

  const handleLoginSubmit = () => {
    if (!selectedStaff) return;
    
    // Check password (default is '0000' if not set)
    const correctPassword = selectedStaff.password || '0000';
    
    if (password === correctPassword) {
      if (selectedStaff.isApproved === false) {
        Alert.alert(
          '承認待ち', 
          '現在、管理者の承認待ち状態です。承認されるまでログインできません。',
          [{ text: '了解' }]
        );
        return;
      }
      
      // 2段階認証(PIN)を完全にスキップ
      onLogin({ ...selectedStaff, lastLoginTimestamp: Date.now() });
    } else {
      Alert.alert('認証エラー', 'パスワードが違います。');
    }
  };

  const handleBack = () => {
    setSelectedStaff(null);
    setPassword('');
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
              <ShieldIcon size={48} color={COLORS.primary} />
            </View>
            <ThemeText variant="h1" style={styles.title}>Shift Manager</ThemeText>
            <ThemeText variant="caption" style={styles.subtitle}>ログイン</ThemeText>
          </View>

          {!selectedStaff ? (
            <ThemeCard style={styles.card}>
              <ThemeText variant="h2" style={{ marginBottom: 16 }}>職員を選択してログイン</ThemeText>
              
              <View style={styles.searchBar}>
                <Search size={18} color={COLORS.textSecondary} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="名前で検索..."
                  placeholderTextColor={COLORS.textSecondary}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
              </View>

              <View style={styles.staffList}>
                {filteredStaff.length > 0 ? (
                  filteredStaff.map(staff => (
                    <TouchableOpacity 
                      key={staff.id} 
                      style={styles.staffItem} 
                      onPress={() => setSelectedStaff(staff)}
                    >
                      <View style={styles.staffAvatar}>
                        <ThemeText bold color={COLORS.primary}>{(staff.name || '?')[0]}</ThemeText>
                      </View>
                      <View style={{ flex: 1 }}>
                        <ThemeText bold>{staff.name}</ThemeText>
                        <ThemeText variant="caption" color={COLORS.textSecondary}>{staff.placement} / {staff.position}</ThemeText>
                      </View>
                      <ChevronRight size={18} color={COLORS.textSecondary} />
                    </TouchableOpacity>
                  ))
                ) : (
                  <View style={styles.emptySearch}>
                    <ThemeText variant="caption">該当する職員が見つかりませんでした</ThemeText>
                  </View>
                )}
              </View>

              <View style={styles.divider} />
              
              <TouchableOpacity style={styles.setupBtn} onPress={onGoToSetup}>
                <PlusCircle size={20} color={COLORS.primary} />
                <ThemeText color={COLORS.primary} bold style={{ marginLeft: 8 }}>新規登録はこちら</ThemeText>
              </TouchableOpacity>
            </ThemeCard>
          ) : (
            <ThemeCard style={styles.card}>
              <TouchableOpacity style={styles.backLink} onPress={handleBack}>
                <ThemeText variant="caption" color={COLORS.primary}>← 職員一覧に戻る</ThemeText>
              </TouchableOpacity>

              <View style={styles.selectedUser}>
                <View style={[styles.staffAvatar, { width: 70, height: 70, borderRadius: 35 }]}>
                  <ThemeText variant="h1" color={COLORS.primary}>{(selectedStaff.name || '?')[0]}</ThemeText>
                </View>
                <ThemeText variant="h2" style={{ marginTop: 12 }}>{selectedStaff.name}</ThemeText>
                <ThemeText variant="caption" color={COLORS.textSecondary}>{selectedStaff.placement} / {selectedStaff.position}</ThemeText>
              </View>

              <View style={styles.passwordSection}>
                <ThemeText variant="label" style={{ marginBottom: 8 }}>パスワード (初期設定 0000)</ThemeText>
                <View style={styles.passwordInputContainer}>
                  <View style={styles.inputIconWrapper}>
                    <Lock size={18} color={COLORS.textSecondary} />
                  </View>
                  <TextInput
                    style={styles.passwordInput}
                    placeholder="****"
                    placeholderTextColor={COLORS.textSecondary}
                    secureTextEntry
                    keyboardType="numeric"
                    value={password}
                    onChangeText={setPassword}
                    autoFocus
                  />
                </View>
              </View>

              <TouchableOpacity 
                style={[
                  styles.loginBtn, 
                  (!password) && { opacity: 0.6 }
                ]} 
                onPress={handleLoginSubmit}
                disabled={!password}
              >
                <ThemeText color="white" bold style={{ fontSize: 16 }}>ログイン</ThemeText>
                <ArrowRight size={20} color="white" style={{ marginLeft: 8 }} />
              </TouchableOpacity>
            </ThemeCard>
          )}
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
    borderRadius: size/2, 
    justifyContent: 'center', 
    alignItems: 'center',
    borderWidth: 2,
    borderColor: color + '30'
  }}>
     <User size={size * 0.5} color={color} />
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  glassBackground: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(56, 189, 248, 0.03)' },
  scrollContent: { flexGrow: 1, padding: SPACING.lg, justifyContent: 'center', paddingVertical: SPACING.xl },
  header: { alignItems: 'center', marginBottom: SPACING.xl },
  logoContainer: { marginBottom: 12 },
  title: { fontSize: 32, fontWeight: 'bold' },
  subtitle: { marginTop: 4, letterSpacing: 2, opacity: 0.6 },
  card: { padding: SPACING.lg, borderRadius: 24, elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 20 },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, paddingHorizontal: 16, height: 52, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  searchInput: { flex: 1, marginLeft: 12, color: COLORS.text, fontSize: 16 },
  staffList: { minHeight: 100 },
  staffItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  staffAvatar: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(56, 189, 248, 0.1)', justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  emptySearch: { padding: 30, alignItems: 'center' },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.05)', marginVertical: 20 },
  setupBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: COLORS.primary + '60' },
  backLink: { marginBottom: 20 },
  selectedUser: { alignItems: 'center', marginBottom: 24 },
  passwordSection: { marginBottom: 30 },
  passwordInputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, height: 60, position: 'relative', justifyContent: 'center' },
  inputIconWrapper: { position: 'absolute', left: 16, zIndex: 10 },
  passwordInput: { flex: 1, color: COLORS.text, fontSize: 24, letterSpacing: 8, textAlign: 'center' },
  loginBtn: { backgroundColor: COLORS.primary, flexDirection: 'row', height: 60, borderRadius: 18, justifyContent: 'center', alignItems: 'center', shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 6 },
});
