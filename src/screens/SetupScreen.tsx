import React, { useState } from 'react';
import { StyleSheet, View, SafeAreaView, TouchableOpacity, TextInput, ScrollView, Alert, Platform } from 'react-native';
import { ThemeText } from '../components/ThemeText';
import { COLORS, SPACING, BORDER_RADIUS } from '../theme/theme';
import { User, Lock, Mail, ChevronLeft, CheckCircle2 } from 'lucide-react-native';

interface SetupScreenProps {
  onComplete: (profile: any, email: string, pass: string) => void;
  onBack: () => void;
}

export const SetupScreen: React.FC<SetupScreenProps> = ({ onComplete, onBack }) => {
  const [staffName, setStaffName] = useState('');
  const [password, setPassword] = useState('');

  const handleFinish = () => {
    const rawName = staffName.trim();
    if (!rawName) {
      Alert.alert('入力エラー', '氏名を入力してください');
      return;
    }
    
    // 名前のバリデーション: メールアドレス形式を壊す文字を禁止
    const invalidChars = /[@\/\\.:;<>\[\]]/;
    if (invalidChars.test(rawName)) {
      Alert.alert('入力エラー', '氏名に記号（@ / . など）は使用できません');
      return;
    }

    if (password.length < 6) {
      Alert.alert('入力エラー', 'パスワードは6文字以上で設定してください');
      return;
    }
    
    // システム内部用のID生成: 空白を除去してダミーメールを作成
    const sanitizedName = rawName.replace(/\s+/g, '');
    const email = `${sanitizedName}@app.local`;
    
    const newStaff = {
      name: rawName,
      placement: '未設定',
      profession: '未設定',
      position: '未設定',
      status: '常勤',
      role: '一般職員',
      isApproved: false,
      updatedAt: new Date().toISOString()
    };
    
    onComplete(newStaff, email, password);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <ChevronLeft size={24} color={COLORS.textSecondary} />
            <ThemeText color={COLORS.textSecondary}>ログインへ</ThemeText>
          </TouchableOpacity>
          <ThemeText variant="h1" style={styles.title}>新規スタッフ登録</ThemeText>
          <View style={styles.sectionHeader}>
            <User size={18} color={COLORS.primary} />
            <ThemeText variant="body" bold style={{ marginLeft: 8 }}>氏名</ThemeText>
          </View>
          <TextInput 
            style={styles.input} 
            placeholder="山田 太郎" 
            placeholderTextColor={COLORS.textSecondary} 
            autoCapitalize="none"
            value={staffName} 
            onChangeText={setStaffName} 
          />
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Lock size={18} color={COLORS.primary} />
            <ThemeText variant="body" bold style={{ marginLeft: 8 }}>パスワード (6文字以上)</ThemeText>
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

        <TouchableOpacity style={styles.button} onPress={handleFinish}>
          <ThemeText bold color="white">アカウントを作成</ThemeText>
          <CheckCircle2 size={20} color="white" style={{ marginLeft: 8 }} />
        </TouchableOpacity>

        <View style={styles.footer}>
          <ThemeText variant="caption" color={COLORS.textSecondary} style={{ textAlign: 'center' }}>
            ※ 登録後、管理者による承認が必要な場合があります。
          </ThemeText>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  scroll: { padding: SPACING.xl, flexGrow: 1, justifyContent: 'center' },
  header: { marginBottom: 40, alignItems: 'center', position: 'relative', width: '100%' },
  backButton: { position: 'absolute', left: 0, top: 0, flexDirection: 'row', alignItems: 'center', padding: 10, zIndex: 10 },
  title: { fontSize: 32, marginBottom: 8, marginTop: 60, fontWeight: 'bold' },
  section: { marginBottom: 24 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  input: { backgroundColor: COLORS.card, borderRadius: BORDER_RADIUS.md, padding: 16, color: COLORS.text, fontSize: 16, borderWidth: 1, borderColor: COLORS.border },
  button: { backgroundColor: COLORS.primary, flexDirection: 'row', height: 60, borderRadius: BORDER_RADIUS.lg, alignItems: 'center', justifyContent: 'center', marginTop: 20, shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  footer: { marginTop: 30 }
});
