import React, { useState, useMemo } from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity, TextInput, Alert, Modal, ActivityIndicator, Switch, SafeAreaView } from 'react-native';
import { ThemeText } from '../components/ThemeText';
import { ThemeCard } from '../components/ThemeCard';
import { COLORS, SPACING, BORDER_RADIUS } from '../theme/theme';
import { 
  ChevronLeft, ChevronRight, BarChart3, Calendar, 
  Settings, Database, FileOutput, HelpCircle, 
  RefreshCw, QrCode, Lock, Users, LogOut 
} from 'lucide-react-native';

interface AdminScreenProps {
  staffList: any[];
  setStaffList: (staff: any[] | ((prev: any[]) => any[])) => void;
  requests: any[];
  setRequests: (requests: any[] | ((prev: any[]) => any[])) => void;
  updateLimits: (type: string, val: number, monthStr?: string) => void;
  updatePassword: (pass: string) => void;
  monthlyLimits: any;
  onShareApp: () => void;
  onLogout: () => void;
  currentDate: Date;
  setCurrentDate: (d: Date) => void;
}

export const AdminScreen: React.FC<AdminScreenProps> = ({
  staffList, setStaffList, requests, setRequests,
  updateLimits, updatePassword, monthlyLimits, onShareApp, onLogout,
  currentDate, setCurrentDate
}) => {
  const [activeTab, setActiveTab] = useState<'analysis' | 'holidays'>('analysis');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();
  const currentMonthStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;

  const limits = monthlyLimits[currentMonthStr] || { weekday: 12, sat: 1, sun: 0, pub: 1 };

  const renderAnalysis = () => (
    <View style={{ flex: 1, padding: SPACING.md }}>
      <View style={styles.actionRow}>
        <TouchableOpacity style={[styles.mainBtn, { backgroundColor: '#38bdf8' }]}>
          <Database size={24} color="white" />
          <ThemeText bold color="white" style={{ marginLeft: 8 }}>自動割当（上書き）</ThemeText>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.mainBtn, { backgroundColor: '#10b981' }]}>
          <FileOutput size={24} color="white" />
          <ThemeText bold color="white" style={{ marginLeft: 8 }}>CSV出力</ThemeText>
        </TouchableOpacity>
      </View>

      <ThemeCard style={styles.promoCard}>
        <View style={{ flex: 1 }}>
          <ThemeText bold color="#eab308">休日のみ自動補填</ThemeText>
          <ThemeText variant="caption" color={COLORS.textSecondary} style={{ marginTop: 4 }}>
            現在のシフトを維持しつつ休日不足分を埋めます
          </ThemeText>
        </View>
        <ChevronRight color={COLORS.textSecondary} />
      </ThemeCard>

      <ThemeCard style={styles.itemRow}>
        <View style={{ flex: 1 }}>
          <ThemeText bold>アプリ配布用QRコード</ThemeText>
          <ThemeText variant="caption" color={COLORS.textSecondary} style={{ marginTop: 4 }}>
            スタッフにアプリを共有します
          </ThemeText>
        </View>
        <TouchableOpacity style={styles.inlineBtn} onPress={onShareApp}>
          <QrCode size={18} color="#38bdf8" />
          <ThemeText bold color="#38bdf8" style={{ marginLeft: 6 }}>表示</ThemeText>
        </TouchableOpacity>
      </ThemeCard>

      <ThemeCard style={styles.itemRow}>
        <View style={{ flex: 1 }}>
          <ThemeText bold>管理用パスワード</ThemeText>
          <ThemeText variant="caption" color={COLORS.textSecondary} style={{ marginTop: 4 }}>
            認証状態: {monthlyLimits.adminPassword ? '設定済み' : '未設定'}
          </ThemeText>
        </View>
        <TouchableOpacity style={styles.inlineBtn} onPress={() => setShowPasswordModal(true)}>
          <ThemeText bold color="#38bdf8">設定</ThemeText>
        </TouchableOpacity>
      </ThemeCard>

      <View style={styles.limitSection}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
          <ThemeText bold variant="h2">📈 {currentMonth + 1}月の出勤枠リミット設定</ThemeText>
        </View>
        <View style={styles.limitGrid}>
          <View style={styles.limitBox}>
            <ThemeText variant="caption" color={COLORS.textSecondary}>平日</ThemeText>
            <TextInput style={styles.limitInput} keyboardType="numeric" defaultValue={String(limits.weekday)} onChangeText={(v) => updateLimits('weekday', parseInt(v), currentMonthStr)} />
          </View>
          <View style={styles.limitBox}>
            <ThemeText variant="caption" color={COLORS.textSecondary}>土曜</ThemeText>
            <TextInput style={styles.limitInput} keyboardType="numeric" defaultValue={String(limits.sat)} onChangeText={(v) => updateLimits('saturday', parseInt(v), currentMonthStr)} />
          </View>
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View>
            <ThemeText variant="h1">管理パネル</ThemeText>
            <ThemeText variant="caption" color={COLORS.textSecondary}>{currentMonth + 1}月の分析と設定</ThemeText>
          </View>
        </View>
      </View>

      <View style={styles.tabBar}>
        <TouchableOpacity style={[styles.tabItem, activeTab === 'analysis' && styles.tabItemActive]} onPress={() => setActiveTab('analysis')}>
          <BarChart3 size={20} color={activeTab === 'analysis' ? '#38bdf8' : COLORS.textSecondary} />
          <ThemeText bold={activeTab === 'analysis'} color={activeTab === 'analysis' ? '#38bdf8' : COLORS.textSecondary} style={{ marginLeft: 8 }}>分析</ThemeText>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabItem, activeTab === 'holidays' && styles.tabItemActive]} onPress={() => setActiveTab('holidays')}>
          <Users size={20} color={activeTab === 'holidays' ? '#38bdf8' : COLORS.textSecondary} />
          <ThemeText bold={activeTab === 'holidays'} color={activeTab === 'holidays' ? '#38bdf8' : COLORS.textSecondary} style={{ marginLeft: 8 }}>スタッフ</ThemeText>
        </TouchableOpacity>
      </View>

      <ScrollView style={{ flex: 1 }}>
        {activeTab === 'analysis' ? renderAnalysis() : <View style={{ padding: 20 }}><ThemeText>スタッフ一覧（開発中）</ThemeText></View>}
      </ScrollView>

      <Modal visible={showPasswordModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.passwordModal}>
            <ThemeText variant="h2" style={{ marginBottom: 16 }}>管理用パスワード設定</ThemeText>
            <TextInput style={styles.modalInput} placeholder="新しいパスワード" secureTextEntry value={newPassword} onChangeText={setNewPassword} placeholderTextColor={COLORS.textSecondary} />
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 24 }}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowPasswordModal(false)}><ThemeText bold>キャンセル</ThemeText></TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={() => { if(newPassword) { updatePassword(newPassword); setShowPasswordModal(false); Alert.alert('保存完了'); } }}>
                <ThemeText bold color="white">保存</ThemeText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { padding: SPACING.md, paddingTop: 20 },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)', backgroundColor: 'rgba(30, 41, 59, 0.5)' },
  tabItem: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16 },
  tabItemActive: { borderBottomWidth: 3, borderBottomColor: '#38bdf8' },
  actionRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  mainBtn: { flex: 1, height: 60, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  promoCard: { flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: 'rgba(234, 179, 8, 0.05)', borderColor: 'rgba(234, 179, 8, 0.2)', marginBottom: 16 },
  itemRow: { flexDirection: 'row', alignItems: 'center', padding: 16, marginBottom: 12, backgroundColor: 'rgba(255,255,255,0.02)' },
  inlineBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(56, 189, 248, 0.1)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  limitSection: { marginTop: 20 },
  limitGrid: { flexDirection: 'row', gap: 12 },
  limitBox: { flex: 1, backgroundColor: 'rgba(255,255,255,0.02)', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  limitInput: { backgroundColor: 'rgba(15, 23, 42, 0.5)', borderRadius: 8, height: 48, marginTop: 8, textAlign: 'center', color: 'white', fontWeight: 'bold', fontSize: 18 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  passwordModal: { width: '80%', backgroundColor: '#1e293b', borderRadius: 24, padding: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  modalInput: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, height: 52, paddingHorizontal: 16, color: 'white', fontSize: 16 },
  cancelBtn: { flex: 1, height: 52, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center' },
  confirmBtn: { flex: 1, height: 52, borderRadius: 12, backgroundColor: '#38bdf8', justifyContent: 'center', alignItems: 'center' }
});
