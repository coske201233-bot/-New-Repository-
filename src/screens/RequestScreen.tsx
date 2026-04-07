import React, { useState } from 'react';
import { StyleSheet, View, SafeAreaView, ScrollView, TouchableOpacity, TextInput, Alert, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { ThemeText } from '../components/ThemeText';
import { ThemeCard } from '../components/ThemeCard';
import { COLORS, SPACING, BORDER_RADIUS } from '../theme/theme';
import { ClipboardList, Plus, Calendar as CalendarIcon, Clock, CheckCircle2, AlertCircle, X, ChevronRight, RefreshCw } from 'lucide-react-native';
import { formatDate, getDateStr } from '../utils/dateUtils';
import { normalizeName } from '../utils/staffUtils';

interface RequestScreenProps {
  requests: any[];
  setRequests: (requests: any[] | ((prev: any[]) => any[])) => void;
  onDeleteRequest?: (id: string) => void;
  approveRequest: (id: string, status: string) => void;
  profile: any;
  isAdminAuthenticated: boolean;
  onForceCloudSync?: () => Promise<boolean>;
}

export const RequestScreen: React.FC<RequestScreenProps> = ({ requests, setRequests, onDeleteRequest, approveRequest, profile, isAdminAuthenticated, onForceCloudSync }) => {
  const [showForm, setShowForm] = useState(false);
  const [isDateModalVisible, setIsDateModalVisible] = useState(false);
  const [newRequest, setNewRequest] = useState({
    type: '年休',
    date: '',
    reason: '',
    startTime: '08:30',
    endTime: '17:15',
    hours: 1.0,
  });
  const [formError, setFormError] = useState('');
  const [syncMsg, setSyncMsg] = useState('');

  React.useEffect(() => {
    if (profile?.position?.trim() === '会計年度') {
      setNewRequest(prev => ({ ...prev, endTime: '17:00' }));
    }
  }, [profile]);

  const updateRequestStatus = (id: string, status: string) => {
    approveRequest(id, status);
  };

  const deleteRequest = (id: string) => {
    onDeleteRequest?.(id);
  };

  const timeSlots: string[] = [];
  let currentHour = 8;
  let currentMin = 30;
  while (currentHour < 17 || (currentHour === 17 && currentMin <= 15)) {
    const time = `${currentHour.toString().padStart(2, '0')}:${currentMin.toString().padStart(2, '0')}`;
    timeSlots.push(time);
    currentMin += 15;
    if (currentMin === 60) {
      currentHour += 1;
      currentMin = 0;
    }
  }

  const handleSubmit = async () => {
    setFormError('');
    if (!newRequest.date) {
      setFormError('日付を入力してください');
      return;
    }
    
    const isManager = (profile?.role?.includes('シフト管理者') || profile?.role?.includes('開発者')) || isAdminAuthenticated;
    const nameStr = profile?.name || '不明な職員';
    const isFiscalYear = (profile.position?.trim() === '会計年度');
    const MORNING_H = 4.0;
    const AFTERNOON_H = isFiscalYear ? 3.5 : 3.75;
    
    let duration = 0;
    if (newRequest.type === '午前休') {
      duration = MORNING_H;
    } else if (newRequest.type === '午後休' || newRequest.type === '半日振替') {
      duration = AFTERNOON_H;
    } else if (newRequest.type === '1日振替' || newRequest.type === '年休' || newRequest.type === '夏季休暇') {
      duration = 7.75;
    } else if (newRequest.type === '時間休' || newRequest.type === '振替＋時間休' || newRequest.type === '特休') {
      duration = newRequest.hours;
    }

    try {
      const now = new Date().toISOString();
      const request = {
        id: `m-${Date.now()}`,
        staffId: profile.id,
        type: newRequest.type,
        date: newRequest.date,
        reason: newRequest.reason,
        status: isManager ? 'approved' : 'pending',
        staffName: nameStr,
        createdAt: now,
        updatedAt: now,
        hours: duration,
        details: (newRequest.type === '時間休' || newRequest.type === '振替＋時間休' || newRequest.type === '特休') ? {
          duration: duration
        } : (newRequest.type === '午前休' || newRequest.type === '午後休' || newRequest.type === '半日振替' || newRequest.type === '1日振替') ? {
          duration: duration
        } : null
      };

      setRequests(prev => [request, ...prev]);
      setShowForm(false);
      setNewRequest({ type: '年休', date: '', reason: '', startTime: '08:30', endTime: '17:15', hours: 1.0 });
      
      if (!isManager) {
        Alert.alert('送信完了', '申請を送信しました。管理者の承認をお待ちください。');
      }
    } catch (err: any) {
      console.error('Submit Error:', err);
      setFormError('申請の送信中にエラーが発生しました。');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <ThemeText variant="h1">申請一覧</ThemeText>
            <ThemeText variant="caption">休暇・シフトの申請</ThemeText>
          </View>
          {onForceCloudSync && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {syncMsg ? <ThemeText variant="caption" style={{ color: COLORS.primary }}>{syncMsg}</ThemeText> : null}
              <TouchableOpacity onPress={async () => {
                setSyncMsg('更新中...');
                const success = await onForceCloudSync();
                setSyncMsg(success ? '更新しました' : 'エラー');
                setTimeout(() => setSyncMsg(''), 3000);
              }} style={{ padding: 8, backgroundColor: 'rgba(56, 189, 248, 0.1)', borderRadius: 12 }}>
                <RefreshCw size={20} color={COLORS.primary} />
              </TouchableOpacity>
            </View>
          )}
        </View>
        <ThemeText variant="caption" style={{ marginTop: 6, fontSize: 11, color: COLORS.textSecondary, lineHeight: 16 }}>
          ※基本的に休暇は承認しますが、その時の状況により休暇時期の相談をさせてもらう場合があります
        </ThemeText>
      </View>

      {!showForm ? (
        <View style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <View style={styles.sectionTitleRow}>
              <ClipboardList color={COLORS.primary} size={20} />
              <ThemeText variant="h2">申請履歴</ThemeText>
            </View>

            {requests
              .filter(r => {
                const isWorkType = r.type === '出勤' || r.type === 'シフト休';
                if (isWorkType || r.status === 'deleted') return false;
                
                const isManager = (profile?.role?.includes('シフト管理者') || profile?.role?.includes('開発者')) || isAdminAuthenticated;
                if (!isManager && normalizeName(r.staffName) !== normalizeName(profile?.name)) return false;
                
                return true;
              })
              .sort((a, b) => {
                const dateDiff = new Date(b.date.replace(/-/g, '/')).getTime() - new Date(a.date.replace(/-/g, '/')).getTime();
                if (dateDiff !== 0) return dateDiff;
                const timeA = new Date(a.updatedAt || a.createdAt || a.created_at || 0).getTime();
                const timeB = new Date(b.updatedAt || b.createdAt || b.created_at || 0).getTime();
                return timeB - timeA;
              })
              .map((item) => (
              <ThemeCard key={item.id} style={styles.requestCard}>
                <View style={styles.cardHeader}>
                  <View style={[styles.typeBadge, { backgroundColor: item.type === '時間外出勤' ? 'rgba(249, 115, 22, 0.1)' : 'rgba(56, 189, 248, 0.1)' }]}>
                    <ThemeText variant="caption" bold color={item.type === '時間外出勤' ? '#f97316' : '#38bdf8'}>{item.type}</ThemeText>
                  </View>
                  <View style={[
                    styles.statusBadge, 
                    { backgroundColor: item.status === 'approved' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(234, 179, 8, 0.1)' }
                  ]}>
                    {item.status === 'approved' ? (
                      <CheckCircle2 size={14} color="#22c55e" />
                    ) : (
                      <AlertCircle size={14} color="#eab308" />
                    )}
                    <ThemeText 
                      variant="caption" 
                      style={{ color: item.status === 'approved' ? '#22c55e' : '#eab308', marginLeft: 4 }}
                    >
                      {item.status === 'approved' ? '承認済み' : '承認待ち'}
                    </ThemeText>
                  </View>
                </View>

                <View style={styles.cardBody}>
                  {item.staffName && (
                    <ThemeText variant="caption" color={COLORS.primary} bold>申請者: {item.staffName}</ThemeText>
                  )}
                  <View style={styles.infoRow}>
                    <CalendarIcon size={14} color={COLORS.textSecondary} />
                    <ThemeText variant="body" style={styles.infoText}>{formatDate(item.date)}</ThemeText>
                    {item.details?.duration && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 12 }}>
                        <Clock size={14} color={COLORS.accent} />
                        <ThemeText variant="caption" style={{ marginLeft: 4, color: COLORS.accent }} bold>{item.details.duration}時間</ThemeText>
                      </View>
                    )}
                  </View>
                  <ThemeText variant="caption" color={COLORS.textSecondary} style={styles.reasonText}>
                    詳細: {item.reason || 'なし'}
                  </ThemeText>
                </View>

                <View style={styles.cardActions}>
                  {item.status === 'pending' ? (
                    <>
                      <TouchableOpacity 
                        style={[styles.actionBtn, styles.approveBtn]} 
                        onPress={() => updateRequestStatus(item.id, 'approved')}
                      >
                        <CheckCircle2 size={16} color="white" />
                        <ThemeText variant="caption" color="white" bold style={{ marginLeft: 4 }}>承認する</ThemeText>
                      </TouchableOpacity>
                      <TouchableOpacity 
                        style={[styles.actionBtn, styles.rejectBtn]} 
                        onPress={() => deleteRequest(item.id)}
                      >
                        <ThemeText variant="caption" color={COLORS.textSecondary}>削除</ThemeText>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <TouchableOpacity 
                      style={[styles.actionBtn, styles.undoBtn]} 
                      onPress={() => updateRequestStatus(item.id, 'pending')}
                    >
                      <ThemeText variant="caption" color={COLORS.textSecondary}>承認を取り消す</ThemeText>
                    </TouchableOpacity>
                  )}
                </View>
              </ThemeCard>
            ))}
          </ScrollView>

          <TouchableOpacity style={styles.fab} onPress={() => setShowForm(true)} activeOpacity={0.8}>
            <Plus color={COLORS.background} size={30} />
          </TouchableOpacity>
        </View>
      ) : (
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
          style={{ flex: 1 }}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        >
          <ScrollView contentContainerStyle={styles.formContainer} keyboardShouldPersistTaps="handled">
            <ThemeCard style={styles.formCard}>
              <ThemeText variant="h2" style={styles.formTitle}>新規申請</ThemeText>
              
              {formError ? (
                <View style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: 12, borderRadius: 8, marginBottom: 16 }}>
                  <ThemeText style={{ color: '#ef4444' }}>{formError}</ThemeText>
                </View>
              ) : null}
              
              <View style={styles.inputGroup}>
                <ThemeText variant="label">種類</ThemeText>
                <View style={styles.typeSelector}>
                  {['年休', '時間休', '振替', '1日振替', '半日振替', '振替＋時間休', '夏季休暇', '午前休', '午後休', '特休'].map((t) => (
                    <TouchableOpacity 
                      key={t}
                      style={[styles.typeOption, newRequest.type === t && styles.typeOptionActive]}
                      onPress={() => setNewRequest({ ...newRequest, type: t })}
                    >
                      <ThemeText variant="caption" color={newRequest.type === t ? COLORS.background : COLORS.text}>{t}</ThemeText>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
  
              {(newRequest.type === '時間休' || newRequest.type === '振替＋時間休' || newRequest.type === '特休' || newRequest.type === '時間給' || newRequest.type === '看護休暇') && (
                <View style={styles.timeSelectionArea}>
                  <ThemeText variant="label" style={{ marginBottom: 12 }}>時間設定 (0.25h単位)</ThemeText>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                    <TouchableOpacity onPress={() => setNewRequest({ ...newRequest, hours: Math.max(0.25, newRequest.hours - 0.25) })} style={styles.stepperBtn}>
                      <ThemeText bold color="white">-</ThemeText>
                    </TouchableOpacity>
                    <ThemeText variant="h2" color={COLORS.primary}>{newRequest.hours.toFixed(2)}h</ThemeText>
                    <TouchableOpacity onPress={() => setNewRequest({ ...newRequest, hours: Math.min(8.0, newRequest.hours + 0.25) })} style={styles.stepperBtn}>
                      <ThemeText bold color="white">+</ThemeText>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
  
              <View style={styles.inputGroup}>
                <ThemeText variant="label">日付</ThemeText>
                <TouchableOpacity 
                  style={styles.dateSelectorBtn} 
                  onPress={() => setIsDateModalVisible(true)}
                >
                  <CalendarIcon size={18} color={COLORS.primary} />
                  <ThemeText style={{ marginLeft: 12 }}>
                    {newRequest.date ? formatDate(newRequest.date) : 'タップして日付を選択'}
                  </ThemeText>
                </TouchableOpacity>
              </View>
  
              <View style={styles.inputGroup}>
                <ThemeText variant="label">詳細（特別な理由がある場合）</ThemeText>
                <TextInput style={[styles.input, styles.textArea]} placeholder="詳細を入力してください（任意）" placeholderTextColor={COLORS.border} multiline numberOfLines={3} value={newRequest.reason} onChangeText={(text) => setNewRequest({ ...newRequest, reason: text })} />
              </View>
  
              <View style={styles.formButtons}>
                <TouchableOpacity style={[styles.button, styles.cancelButton]} onPress={() => setShowForm(false)}>
                  <ThemeText bold>キャンセル</ThemeText>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.button, styles.submitButton]} onPress={handleSubmit}>
                  <ThemeText bold color={COLORS.background}>申請する</ThemeText>
                </TouchableOpacity>
              </View>
            </ThemeCard>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* Date Picker Modal */}
      <Modal visible={isDateModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <ThemeText variant="h2">日付を選択</ThemeText>
              <TouchableOpacity onPress={() => setIsDateModalVisible(false)}>
                <X color={COLORS.textSecondary} size={24} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 400 }} keyboardShouldPersistTaps="always">
              {Array.from({ length: 60 }).map((_, i) => {
                const d = new Date();
                d.setDate(d.getDate() + i);
                const dateStr = getDateStr(d);
                return (
                  <TouchableOpacity 
                    key={dateStr} 
                    style={[styles.dateOption, newRequest.date === dateStr && styles.dateOptionActive]}
                    onPress={() => {
                      setNewRequest({ ...newRequest, date: dateStr });
                      setIsDateModalVisible(false);
                    }}
                  >
                    <ThemeText color={newRequest.date === dateStr ? COLORS.background : COLORS.text}>{formatDate(d)}</ThemeText>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity style={styles.closeBtn} onPress={() => setIsDateModalVisible(false)}>
              <ThemeText color={COLORS.primary} bold>閉じる</ThemeText>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { padding: SPACING.md, marginTop: SPACING.md },
  scrollContent: { padding: SPACING.md, paddingBottom: 100 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.md },
  requestCard: { marginBottom: SPACING.md, padding: SPACING.md },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm },
  typeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: BORDER_RADIUS.full },
  cardBody: { gap: 6 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  infoText: { fontSize: 14 },
  reasonText: { marginTop: 2 },
  cardActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)', gap: 8 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  approveBtn: { backgroundColor: '#22c55e' },
  rejectBtn: { backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: COLORS.border },
  undoBtn: { backgroundColor: 'rgba(255,255,255,0.05)' },
  fab: { position: 'absolute', bottom: 30, right: 30, width: 60, height: 60, borderRadius: 30, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center', elevation: 5 },
  formContainer: { padding: SPACING.md },
  formCard: { padding: SPACING.lg },
  formTitle: { marginBottom: SPACING.lg },
  inputGroup: { marginBottom: SPACING.lg },
  typeSelector: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  typeOption: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: COLORS.border },
  typeOptionActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  timeSelectionArea: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: SPACING.md, marginBottom: SPACING.lg, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)' },
  timeScroll: { marginTop: 8 },
  timeChip: { minWidth: 65, paddingVertical: 8, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.05)', marginRight: 8, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center' },
  timeChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  input: { marginTop: 8, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 12, color: COLORS.text, borderWidth: 1, borderColor: COLORS.border },
  dateSelectorBtn: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    padding: 12, 
    backgroundColor: 'rgba(255,255,255,0.05)', 
    borderRadius: 8, 
    marginTop: 8,
    borderWidth: 1,
    borderColor: COLORS.border
  },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalContent: { backgroundColor: COLORS.card, borderRadius: 24, padding: 24, width: '100%', borderWidth: 1, borderColor: COLORS.border },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  dateOption: { padding: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  dateOptionActive: { backgroundColor: COLORS.primary, borderRadius: 8 },
  closeBtn: { marginTop: 16, padding: 12, alignItems: 'center' },
  textArea: { height: 100, textAlignVertical: 'top' },
  formButtons: { flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.md },
  button: { flex: 1, height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  cancelButton: { backgroundColor: 'transparent', borderWidth: 1, borderColor: COLORS.border },
  submitButton: { backgroundColor: COLORS.primary },
  stepperBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(56, 189, 248, 0.4)', justifyContent: 'center', alignItems: 'center' },
});
