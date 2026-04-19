import React, { useState } from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity, TextInput, Alert, Platform } from 'react-native';
import { ThemeText } from '../components/ThemeText';
import { ThemeCard } from '../components/ThemeCard';
import { COLORS, SPACING, BORDER_RADIUS } from '../theme/theme';
import { Calendar, Clock, Edit3, Send, CheckCircle2 } from 'lucide-react-native';

export const LeaveRequestScreen = ({ user, onSubmitRequest }: any) => {
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [type, setType] = useState('年休');
  const [hours, setHours] = useState(1.0);
  const [comment, setComment] = useState('');

  const types = ['年休', '時間休', '1日振替', '半日振替', '振替＋時間休', '夏季休暇', '特休'];
  const needsHours = ['時間休', '振替＋時間休', '特休'].includes(type);

  const adjustHours = (delta: number) => {
    setHours(prev => Math.max(0.25, Math.min(24, prev + delta)));
  };

  const handleSubmit = () => {
    if (!startDate) return Alert.alert('エラー', '開始日を入力してください');
    
    const request = {
      staffName: user?.name,
      date: startDate,
      endDate: endDate,
      type: type,
      hours: needsHours ? hours : null,
      comment: comment,
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    onSubmitRequest(request);
    Alert.alert('申請完了', '休日申請を送信しました。');
    setComment('');
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 100 }}>
      {/* ... header omission ... */}

      <ThemeCard style={styles.formCard}>
        <View style={styles.inputGroup}>
          <ThemeText bold style={styles.label}>1. 休暇の種類</ThemeText>
          <View style={styles.typeGrid}>
            {types.map((t) => (
              <TouchableOpacity 
                key={t}
                style={[styles.typeBtn, type === t && styles.typeBtnActive]}
                onPress={() => setType(t)}
              >
                <ThemeText color={type === t ? 'white' : COLORS.textPrimary} size={11} bold={type === t}>{t}</ThemeText>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {needsHours && (
          <View style={styles.inputGroup}>
            <ThemeText bold style={styles.label}>2. 申請時間 (0.25h単位)</ThemeText>
            <View style={styles.hourControl}>
              <TouchableOpacity style={styles.stepBtn} onPress={() => adjustHours(-0.25)}>
                <ThemeText color="white" bold size={20}>-</ThemeText>
              </TouchableOpacity>
              <View style={styles.hourDisplay}>
                <ThemeText bold size={18}>{hours.toFixed(2)} h</ThemeText>
              </View>
              <TouchableOpacity style={styles.stepBtn} onPress={() => adjustHours(0.25)}>
                <ThemeText color="white" bold size={20}>+</ThemeText>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.inputGroup}>
          <ThemeText bold style={styles.label}>{needsHours ? '3' : '2'}. 期間の選択</ThemeText>
          {/* ... date inputs ... */}
          <View style={styles.dateRow}>
            <View style={{ flex: 1 }}>
              <ThemeText variant="caption">開始日</ThemeText>
              <TextInput 
                style={styles.dateInput} 
                value={startDate} 
                onChangeText={setStartDate} 
                placeholder="YYYY-MM-DD"
              />
            </View>
            <View style={{ width: 20, alignItems: 'center', justifyContent: 'center', paddingTop: 20 }}>
              <ThemeText>~</ThemeText>
            </View>
            <View style={{ flex: 1 }}>
              <ThemeText variant="caption">終了日</ThemeText>
              <TextInput 
                style={styles.dateInput} 
                value={endDate} 
                onChangeText={setEndDate}
                placeholder="YYYY-MM-DD"
              />
            </View>
          </View>
        </View>

        <View style={styles.inputGroup}>
          <ThemeText bold style={styles.label}>3. 備考（任意）</ThemeText>
          <TextInput 
            style={styles.textArea}
            multiline
            numberOfLines={4}
            value={comment}
            onChangeText={setComment}
            placeholder="理由や詳細を入力してください"
            textAlignVertical="top"
          />
        </View>

        <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit}>
          <Send size={20} color="white" />
          <ThemeText color="white" bold style={{ marginLeft: 8 }}>申請を送信する</ThemeText>
        </TouchableOpacity>
      </ThemeCard>

      <ThemeCard style={styles.infoCard}>
        <ThemeText variant="caption" color={COLORS.primary}>
          ※ 申請後、管理者が承認するまで「HOME」画面の申請リストに表示されます。
        </ThemeText>
      </ThemeCard>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bgSoft },
  header: { padding: SPACING.lg, paddingTop: 20 },
  formCard: { margin: SPACING.md, padding: SPACING.lg },
  label: { marginBottom: 12, fontSize: 16 },
  inputGroup: { marginBottom: 24 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeBtn: { 
    paddingHorizontal: 16, paddingVertical: 10, 
    borderRadius: BORDER_RADIUS.full, backgroundColor: COLORS.bgSubtle,
    borderWidth: 1, borderColor: COLORS.border
  },
  typeBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  dateRow: { flexDirection: 'row', gap: 8 },
  dateInput: { 
    height: 48, borderRadius: BORDER_RADIUS.md, backgroundColor: COLORS.bgSubtle,
    borderWidth: 1, borderColor: COLORS.border, paddingHorizontal: 12, marginTop: 4,
    color: COLORS.textPrimary
  },
  textArea: {
    minHeight: 100, borderRadius: BORDER_RADIUS.md, backgroundColor: COLORS.bgSubtle,
    borderWidth: 1, borderColor: COLORS.border, padding: 12, color: COLORS.textPrimary
  },
  submitBtn: {
    height: 56, backgroundColor: COLORS.primary, borderRadius: BORDER_RADIUS.lg,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 10,
    ...Platform.select({ ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8 }, android: { elevation: 4 } })
  },
  hourControl: { 
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.bgSubtle, 
    borderRadius: BORDER_RADIUS.md, borderWidth: 1, borderColor: COLORS.border, overflow: 'hidden' 
  },
  stepBtn: { 
    width: 60, height: 50, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center' 
  },
  hourDisplay: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  infoCard: { marginHorizontal: SPACING.md, padding: SPACING.md, backgroundColor: '#f0f9ff', borderColor: '#bae6fd' }
});
