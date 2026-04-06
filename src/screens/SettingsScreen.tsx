import React, { useState } from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity, SafeAreaView, TextInput, Alert, Modal } from 'react-native';
import { ThemeText } from '../components/ThemeText';
import { ThemeCard } from '../components/ThemeCard';
import { COLORS, SPACING, BORDER_RADIUS } from '../theme/theme';
import { 
  ChevronLeft, ChevronRight, Lock, LogOut, 
  Shield, CheckCircle2, AlertCircle
} from 'lucide-react-native';

interface SettingsScreenProps {
  onLogout: () => void;
  currentDate: Date;
  setCurrentDate: (d: Date) => void;
  monthlyLimits: any;
  updateLimits: (type: string, val: number, monthStr?: string) => void;
  adminPassword?: string;
  updatePassword: (pass: string) => void;
  isAdminAuthenticated: boolean;
  setIsAdminAuthenticated: (auth: boolean) => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  onLogout,
  currentDate,
  setCurrentDate,
  monthlyLimits,
  updateLimits,
  adminPassword,
  updatePassword,
  isAdminAuthenticated,
  setIsAdminAuthenticated
}) => {
  const [passInput, setPassInput] = useState('');
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();
  const currentMonthStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
  
  const limits = monthlyLimits[currentMonthStr] || { weekday: 12, sat: 1, sun: 0, pub: 1 };

  const handleAuth = () => {
    if (!adminPassword) {
      Alert.alert('未設定', '管理パネルからパスワードを設定してください。');
      return;
    }
    if (passInput === adminPassword) {
      setIsAdminAuthenticated(true);
      setPassInput('');
      Alert.alert('認証完了', '管理者用編集機能が有効になりました。');
    } else {
      Alert.alert('認証失敗', 'パスワードが正しくありません。');
    }
  };

  const LimitAdjustmentRow = ({ label, type, val }: { label: string, type: string, val: number }) => (
    <View style={styles.limitRow}>
      <ThemeText style={{ flex: 1, fontSize: 16 }}>{label}</ThemeText>
      <View style={styles.counterContainer}>
        <TouchableOpacity style={styles.counterBtn} onPress={() => updateLimits(type, Math.max(0, val - 1), currentMonthStr)}><ThemeText bold color="white">−</ThemeText></TouchableOpacity>
        <ThemeText bold variant="h2" style={styles.counterVal}>{val}</ThemeText>
        <TouchableOpacity style={styles.counterBtn} onPress={() => updateLimits(type, val + 1, currentMonthStr)}><ThemeText bold color="white">+</ThemeText></TouchableOpacity>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <ThemeText variant="h1">設定</ThemeText>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: SPACING.md, paddingBottom: 100 }}>
        <ThemeCard style={styles.sectionCard}>
          <ThemeText variant="label" color={COLORS.textSecondary} style={{ marginBottom: 16 }}>管理者認証</ThemeText>
          {isAdminAuthenticated ? (
            <View style={styles.authInfo}>
              <CheckCircle2 color="#10b981" size={24} />
              <View style={{ marginLeft: 12 }}>
                <ThemeText bold color="#10b981">認証済み</ThemeText>
                <ThemeText variant="caption" color={COLORS.textSecondary}>管理者用編集機能が有効です</ThemeText>
              </View>
              <TouchableOpacity style={styles.authLogoutBtn} onPress={() => setIsAdminAuthenticated(false)}><ThemeText color="#ef4444">解除</ThemeText></TouchableOpacity>
            </View>
          ) : (
            <View>
              <View style={styles.passwordInputArea}>
                <Lock color={COLORS.textSecondary} size={20} />
                <TextInput 
                  style={styles.passInput} 
                  placeholder="管理者パスワードを入力" 
                  secureTextEntry 
                  value={passInput}
                  onChangeText={setPassInput}
                  placeholderTextColor={COLORS.textSecondary} 
                />
              </View>
              <TouchableOpacity style={styles.authBtn} onPress={handleAuth}>
                <ThemeText bold color="white">管理者モードを有効化</ThemeText>
              </TouchableOpacity>
            </View>
          )}
        </ThemeCard>

        <ThemeText variant="label" color={COLORS.textSecondary} style={{ marginBottom: 12, marginTop: 12 }}>制限設定</ThemeText>
        <ThemeCard style={styles.sectionCard}>
          <View style={styles.monthPicker}>
            <ThemeText bold style={{ fontSize: 16 }}>対象月</ThemeText>
            <View style={styles.pickerControls}>
              <TouchableOpacity onPress={() => setCurrentDate(new Date(currentYear, currentMonth - 1, 1))}><ChevronLeft size={24} color="#38bdf8" /></TouchableOpacity>
              <ThemeText bold color="#38bdf8" style={{ marginHorizontal: 12 }}>{currentYear}年{currentMonth + 1}月</ThemeText>
              <TouchableOpacity onPress={() => setCurrentDate(new Date(currentYear, currentMonth + 1, 1))}><ChevronRight size={24} color="#38bdf8" /></TouchableOpacity>
            </View>
          </View>
          <View style={{ marginTop: 24 }}>
            <LimitAdjustmentRow label="平日勤務制限" type="weekday" val={limits.weekday} />
            <LimitAdjustmentRow label="土曜勤務制限" type="sat" val={limits.sat} />
            <LimitAdjustmentRow label="祝日勤務制限" type="pub" val={limits.pub} />
            <LimitAdjustmentRow label="日曜勤務制限" type="sun" val={limits.sun} />
          </View>
        </ThemeCard>

        <ThemeCard style={styles.sectionCard}>
          <ThemeText variant="label" color={COLORS.textSecondary} style={{ marginBottom: 16 }}>その他</ThemeText>
          <TouchableOpacity style={styles.listItem} onPress={onLogout}>
            <View style={[styles.iconBox, { backgroundColor: 'rgba(239, 68, 68, 0.1)' }]}><LogOut size={20} color="#ef4444" /></View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <ThemeText bold color="#ef4444">ログアウト</ThemeText>
              <ThemeText variant="caption" color={COLORS.textSecondary}>現在のアカウントからログアウトします</ThemeText>
            </View>
          </TouchableOpacity>
        </ThemeCard>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { padding: SPACING.md, paddingTop: 20 },
  sectionCard: { padding: 16, marginBottom: 20, backgroundColor: 'rgba(30, 41, 59, 0.5)', borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  passwordInputArea: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 12, paddingHorizontal: 16, height: 52, marginBottom: 12 },
  passInput: { flex: 1, marginLeft: 12, color: 'white', fontSize: 16 },
  authBtn: { backgroundColor: '#38bdf8', height: 52, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  authInfo: { flexDirection: 'row', alignItems: 'center' },
  authLogoutBtn: { marginLeft: 'auto', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: 'rgba(239,68,68,0.1)' },
  monthPicker: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)', paddingBottom: 16 },
  pickerControls: { flexDirection: 'row', alignItems: 'center' },
  limitRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  counterContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 12, padding: 4 },
  counterBtn: { width: 44, height: 44, borderRadius: 10, backgroundColor: '#38bdf8', justifyContent: 'center', alignItems: 'center' },
  counterVal: { width: 40, textAlign: 'center', fontSize: 18 },
  listItem: { flexDirection: 'row', alignItems: 'center' },
  iconBox: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center' }
});
