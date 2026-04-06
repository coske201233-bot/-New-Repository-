import React, { useState } from 'react';
import { StyleSheet, View, SafeAreaView, TouchableOpacity, TextInput, ScrollView, Alert, Modal, Platform } from 'react-native';
import { ThemeText } from '../components/ThemeText';
import { ThemeCard } from '../components/ThemeCard';
import { COLORS, SPACING, BORDER_RADIUS } from '../theme/theme';
import { User, MapPin, Shield, CheckCircle2, Briefcase, ChevronLeft } from 'lucide-react-native';

interface SetupScreenProps {
  onComplete: (profile: any) => void;
  onBack: () => void;
}

export const SetupScreen: React.FC<SetupScreenProps> = ({ onComplete, onBack }) => {
  const [name, setName] = useState('');
  const [placement, setPlacement] = useState('外来');
  const [profession, setProfession] = useState('PT');
  const [position, setPosition] = useState('主事');
  const [selectedRoles, setSelectedRoles] = useState<string[]>(['一般職員']);
  const [isPasswordModalVisible, setIsPasswordModalVisible] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [pendingRole, setPendingRole] = useState<string | null>(null);

  const placements = ['外来', '２F', '包括', '４F', '排尿', '兼務', 'フォロー', '管理', '事務', '訪問リハ'];
  const professions = ['PT', 'OT', 'ST', '助手'];
  const p_roles = ['科長', '係長', '主査', '主任', '主事', '会計年度'];
  const roles = ['一般職員', 'シフト管理者'];
  const ADMIN_PASSWORD = '1114';

  const handleRoleToggle = (role: string) => {
    if (role === '一般職員') {
      setSelectedRoles(['一般職員']);
      return;
    }
    if (selectedRoles.includes(role)) {
      setSelectedRoles(prev => {
        const next = prev.filter(r => r !== role);
        return next.length === 0 ? ['一般職員'] : next;
      });
    } else {
      setPendingRole(role);
      setIsPasswordModalVisible(true);
      setPasswordInput('');
    }
  };

  const verifyPassword = () => {
    if (passwordInput === ADMIN_PASSWORD) {
      if (pendingRole) {
        setSelectedRoles(prev => [...prev.filter(r => r !== '一般職員'), pendingRole]);
      }
      setIsPasswordModalVisible(false);
      setPendingRole(null);
    } else {
      Alert.alert('認証エラー', 'パスワードが違います');
    }
  };

  const handleFinish = () => {
    if (!name.trim()) {
      Alert.alert('入力エラー', '名前を入力してください');
      return;
    }
    const isYoshidaAdmin = name.trim() === '吉田' && (selectedRoles.includes('シフト管理者') || selectedRoles.includes('開発者'));
    const newStaff = {
      id: Date.now().toString(),
      name: name.trim(),
      placement,
      profession,
      position,
      status: '常勤',
      role: selectedRoles.join(','),
      isApproved: isYoshidaAdmin,
      updatedAt: new Date().toISOString()
    };
    onComplete(newStaff);
  };

  const SelectionGroup = ({ label, icon: Icon, options, value, onChange, isMulti = false }: any) => (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Icon size={18} color={COLORS.primary} />
        <ThemeText variant="body" bold style={{ marginLeft: 8 }}>{label}</ThemeText>
      </View>
      <View style={styles.optionsGrid}>
        {options.map((opt: string) => {
          const isActive = isMulti ? value.includes(opt) : value === opt;
          return (
            <TouchableOpacity key={opt} style={[styles.option, isActive && styles.optionActive]} onPress={() => onChange(opt)}>
              <ThemeText variant="caption" style={{ color: isActive ? 'white' : COLORS.text }}>{opt}</ThemeText>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <ChevronLeft size={24} color={COLORS.textSecondary} />
            <ThemeText color={COLORS.textSecondary}>戻る</ThemeText>
          </TouchableOpacity>
          <ThemeText variant="h1" style={styles.title}>セットアップ</ThemeText>
          <ThemeText variant="body" color={COLORS.textSecondary}>情報を入力してください</ThemeText>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}><User size={18} color={COLORS.primary} /><ThemeText variant="body" bold style={{ marginLeft: 8 }}>お名前</ThemeText></View>
          <TextInput style={styles.input} placeholder="例: 山田 太郎" placeholderTextColor={COLORS.textSecondary} value={name} onChangeText={setName} />
        </View>

        <SelectionGroup label="職種" icon={Briefcase} options={professions} value={profession} onChange={setProfession} />
        <SelectionGroup label="役割" icon={Briefcase} options={p_roles} value={position} onChange={setPosition} />
        <SelectionGroup label="配置" icon={MapPin} options={placements} value={placement} onChange={setPlacement} />
        <SelectionGroup label="アプリ権限" icon={Shield} options={roles} value={selectedRoles} onChange={handleRoleToggle} isMulti />

        <TouchableOpacity style={styles.button} onPress={handleFinish}>
          <ThemeText bold color="white">はじめる</ThemeText>
          <CheckCircle2 size={20} color="white" style={{ marginLeft: 8 }} />
        </TouchableOpacity>
      </ScrollView>

      {/* Password Modal */}
      <Modal visible={isPasswordModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <ThemeCard style={styles.passwordCard}>
            <ThemeText variant="h2" style={{ marginBottom: 12, textAlign: 'center' }}>権限の認証</ThemeText>
            <ThemeText variant="body" color={COLORS.textSecondary} style={{ marginBottom: 20, textAlign: 'center' }}>パスワードを入力してください</ThemeText>
            <TextInput style={styles.input} placeholder="パスワードを入力" placeholderTextColor={COLORS.textSecondary} secureTextEntry value={passwordInput} onChangeText={setPasswordInput} autoFocus />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setIsPasswordModalVisible(false)}><ThemeText color={COLORS.textSecondary}>キャンセル</ThemeText></TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={verifyPassword}><ThemeText color="white" bold>認証</ThemeText></TouchableOpacity>
            </View>
          </ThemeCard>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { padding: SPACING.xl },
  header: { marginBottom: 30, alignItems: 'center', position: 'relative', width: '100%' },
  backButton: { position: 'absolute', left: 0, top: 0, flexDirection: 'row', alignItems: 'center', padding: 10, zIndex: 10 },
  title: { fontSize: 32, marginBottom: 8, marginTop: 40 },
  section: { marginBottom: 20 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  input: { backgroundColor: COLORS.card, borderRadius: BORDER_RADIUS.md, padding: 16, color: COLORS.text, fontSize: 16 },
  optionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  option: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.card },
  optionActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  button: { backgroundColor: COLORS.primary, flexDirection: 'row', height: 56, borderRadius: BORDER_RADIUS.lg, alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  passwordCard: { width: '100%', padding: 24, borderRadius: 24 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 24, gap: 12 },
  cancelBtn: { paddingVertical: 10, paddingHorizontal: 16 },
  confirmBtn: { backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 20 }
});
