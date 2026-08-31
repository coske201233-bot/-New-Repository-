import React, { useState } from 'react';
import { StyleSheet, View, SafeAreaView, ScrollView, TouchableOpacity, TextInput, Alert, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { ThemeText } from '../components/ThemeText';
import { ThemeCard } from '../components/ThemeCard';
import { COLORS, SPACING, BORDER_RADIUS } from '../theme/theme';
import { ClipboardList, Plus, Calendar as CalendarIcon, Clock, CheckCircle2, AlertCircle, X, ChevronRight, RefreshCw } from 'lucide-react-native';
import { formatDate, getDateStr } from '../utils/dateUtils';
import { normalizeName } from '../utils/staffUtils';
import { supabase } from '../utils/supabase';
import { deleteShiftRequest } from '../utils/requestApi';

interface RequestScreenProps {
  requests: any[];
  setRequests: (requests: any[] | ((prev: any[]) => any[])) => void;
  onDeleteRequest?: (id: string) => void;
  approveRequest: (id: string, status: string) => void;
  profile: any;
  isAdminAuthenticated: boolean;
  onForceCloudSync?: () => Promise<boolean>;
  onSubmitRequest?: (request: any) => Promise<boolean>;
}

export const RequestScreen: React.FC<RequestScreenProps> = ({ requests, setRequests, onDeleteRequest, approveRequest, profile, isAdminAuthenticated, onForceCloudSync, onSubmitRequest }) => {
  const isManager = (profile?.role?.includes('シフト管理者') || profile?.role?.includes('開発者') || profile?.role?.includes('管理者')) || isAdminAuthenticated;
  const [showForm, setShowForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDateModalVisible, setIsDateModalVisible] = useState(false);
  const [newRequest, setNewRequest] = useState({
    type: '年休',
    date: '',
    reason: '',
    startTime: '08:30',
    endTime: '17:15',
    hours: 1.0,
  });
  const [specialHours, setSpecialHours] = useState(1.0);
  const [hourlyHours, setHourlyHours] = useState(1.0);
  const [originalDate, setOriginalDate] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [workOriginalDate, setWorkOriginalDate] = useState('');
  const [workTargetDate, setWorkTargetDate] = useState('');
  const [offOriginalDate, setOffOriginalDate] = useState('');
  const [offTargetDate, setOffTargetDate] = useState('');
  const [activeDateField, setActiveDateField] = useState<'single' | 'original' | 'target' | 'workOriginal' | 'workTarget' | 'offOriginal' | 'offTarget'>('single');
  const [formError, setFormError] = useState('');

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

  // スタッフ本人が自分の申請を削除する関数
  const handleDeleteOwnRequest = async (id: string) => {
    if (!id) {
      const msg = '削除対象の申請IDが存在しません。';
      if (Platform.OS === 'web') window.alert(msg);
      else Alert.alert('エラー', msg);
      return;
    }

    const confirmed = Platform.OS === 'web'
      ? window.confirm('この申請記録を削除しますか？')
      : await new Promise<boolean>(resolve => {
          Alert.alert(
            '削除の確認',
            'この申請記録を削除しますか？',
            [
              { text: 'キャンセル', style: 'cancel', onPress: () => resolve(false) },
              { text: '削除', style: 'destructive', onPress: () => resolve(true) }
            ]
          );
        });

    if (!confirmed) return;

    try {
      const cleanId = String(id).replace(/['"]/g, '').trim();

      if (onDeleteRequest) {
        await onDeleteRequest(cleanId);
      } else {
        await deleteShiftRequest(cleanId);
      }

      // ローカルステートも即座に更新
      setRequests(prev => prev.filter(r => r.id !== id && String(r.id).replace(/['"]/g, '').trim() !== cleanId));

      if (Platform.OS === 'web') {
        window.alert('削除しました。');
      } else {
        Alert.alert('完了', '申請記録を削除しました。');
      }
    } catch (err: any) {
      console.error('Request Delete Error:', err);
      if (Platform.OS === 'web') {
        window.alert('削除エラー: ' + err.message);
      } else {
        Alert.alert('削除エラー', err.message);
      }
    }
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

    // '公休変更' と '休日出勤変更' のみペア日付（変更日＋変更希望日）を要求する
    const isSinglePairType = ['公休変更', '休日出勤変更'].includes(newRequest.type);
    const isDoublePairType = newRequest.type === '休日出勤＋公休変更';

    if (isDoublePairType) {
      if (!workOriginalDate || !workTargetDate || !offOriginalDate || !offTargetDate) {
        const msg = '休日出勤の「変更日」「変更希望日」および公休の「変更日」「変更希望日」の全てを選択してください';
        setFormError(msg);
        if (Platform.OS === 'web') window.alert(msg);
        return;
      }
    } else if (isSinglePairType) {
      if (!originalDate || !targetDate) {
        const msg = '「変更日」と「変更希望日」の両方を選択してください';
        setFormError(msg);
        if (Platform.OS === 'web') window.alert(msg);
        return;
      }
    } else if (!newRequest.date) {
      const msg = '日付を選択してください';
      setFormError(msg);
      if (Platform.OS === 'web') window.alert(msg);
      return;
    }
    
    if (!profile || !profile.id) {
      setFormError('ユーザー情報が取得できません。再ログインしてください。');
      if (Platform.OS === 'web') window.alert('エラー: ユーザーIDが取得できません');
      else Alert.alert('エラー', 'ユーザーIDが取得できません');
      return;
    }
    
    const isManager = (profile?.role?.includes('シフト管理者') || profile?.role?.includes('開発者')) || isAdminAuthenticated;
    const nameStr = profile?.name || '不明な職員';
    const isFiscalYear = (profile.position?.trim() === '会計年度');
    const MORNING_H = 4.0;
    const AFTERNOON_H = isFiscalYear ? 3.5 : 3.75;
    
    let duration = 0;
    let detailsPayload: any = null;
    if (newRequest.type === '午前休') {
      duration = MORNING_H;
    } else if (newRequest.type === '午後休' || newRequest.type === '半日振替') {
      duration = AFTERNOON_H;
    } else if (
      newRequest.type === '1日振替' || 
      newRequest.type === '年休' || 
      newRequest.type === '公休' || 
      newRequest.type === '公休変更' || 
      newRequest.type === '休日出勤変更' || 
      newRequest.type === '夏季休暇' || 
      newRequest.type === '振替' || 
      newRequest.type === '休日出勤＋公休変更'
    ) {
      duration = isFiscalYear ? 7.5 : 7.75;
    } else if (newRequest.type === '特休＋時間休') {
      duration = specialHours + hourlyHours;
      detailsPayload = { specialHours, hourlyHours };
    } else if (newRequest.type === '振替＋時間休') {
      duration = 4.0 + hourlyHours;
      detailsPayload = { furikaeHours: 4.0, hourlyHours };
    } else if (newRequest.type === '振替4') {
      duration = 4.0;
      detailsPayload = { furikaeHours: 4.0, note: '振替4時間' };
    } else if (newRequest.type === '時間休' || newRequest.type === '特休' || newRequest.type === '時間給' || newRequest.type === '出張') {
      duration = newRequest.hours;
    }

    if (isDoublePairType) {
      detailsPayload = {
        ...(detailsPayload || {}),
        workOriginalDate, workTargetDate,
        offOriginalDate, offTargetDate
      };
    } else if (isSinglePairType) {
      detailsPayload = { ...(detailsPayload || {}), originalDate, targetDate };
    }

    setIsSubmitting(true);
    
    try {
      const requestPayload = {
        type: newRequest.type,
        date: isDoublePairType ? workTargetDate : (isSinglePairType ? targetDate : newRequest.date),
        reason: newRequest.reason || (
          isDoublePairType
            ? `[休日出勤] ${formatDate(workOriginalDate)}→${formatDate(workTargetDate)} / [公休] ${formatDate(offOriginalDate)}→${formatDate(offTargetDate)}`
            : (isSinglePairType ? `${formatDate(originalDate)} → ${formatDate(targetDate)} 変更` : '')
        ),
        hours: duration,
        details: detailsPayload
      };

      if (onSubmitRequest) {
        const success = await onSubmitRequest(requestPayload);
        if (success) {
          setShowForm(false);
          setNewRequest({ type: '年休', date: '', reason: '', startTime: '08:30', endTime: '17:15', hours: 1.0 });
          setOriginalDate('');
          setTargetDate('');
        }
      } else {
        // フォールバック（通常は App.tsx から渡されるはず）
        throw new Error('送信関数が設定されていません');
      }
    } catch (err: any) {
      console.error('Submit Error:', err);
      setFormError('申請の送信中にエラーが発生しました。');
      if (Platform.OS === 'web') {
        window.alert('DB送信エラー: ' + err.message);
      } else {
        Alert.alert('DB送信エラー', err.message);
      }
    } finally {
      setIsSubmitting(false);
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
                const isWorkType = r.type === '出勤' || r.type === '公休';
                if (isWorkType || r.status === 'deleted') return false;
                
                // [NEW] 却下された申請は一般職員の履歴からは非表示にする（管理者は管理者画面で確認可能）
                if (!isManager && r.status === 'rejected') return false;
                
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
                  <View style={[styles.typeBadge, { backgroundColor: 'rgba(56, 189, 248, 0.1)' }]}>
                    <ThemeText variant="caption" bold color="#38bdf8">{item.type}</ThemeText>
                  </View>
                  <View style={[
                    styles.statusBadge, 
                    { backgroundColor: (item.status === 'approved' || item.status === '承認' || item.is_manual === true || item.isManual === true) ? 'rgba(34, 197, 94, 0.1)' : 'rgba(234, 179, 8, 0.1)' }
                  ]}>
                    {(item.status === 'approved' || item.status === '承認' || item.is_manual === true || item.isManual === true) ? (
                      <CheckCircle2 size={14} color="#22c55e" />
                    ) : (
                      <AlertCircle size={14} color="#eab308" />
                    )}
                    <ThemeText 
                      variant="caption" 
                      style={{ color: (item.status === 'approved' || item.status === '承認' || item.is_manual === true || item.isManual === true) ? '#22c55e' : '#eab308', marginLeft: 4 }}
                    >
                      {(item.status === 'approved' || item.status === '承認' || item.is_manual === true || item.isManual === true) ? '承認済み' : '承認待ち'}
                    </ThemeText>
                  </View>
                </View>

                <View style={styles.cardBody}>
                  {item.staffName && (
                    <ThemeText variant="caption" color={COLORS.primary} bold>申請者: {item.staffName}</ThemeText>
                  )}
                  <View style={styles.infoRow}>
                    <CalendarIcon size={14} color={COLORS.textSecondary} />
                    <ThemeText variant="body" style={styles.infoText}>対象日: {formatDate(item.date)}</ThemeText>
                    {item.details?.duration && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 12 }}>
                        <Clock size={14} color={COLORS.accent} />
                        <ThemeText variant="caption" style={{ marginLeft: 4, color: COLORS.accent }} bold>{item.details.duration}時間</ThemeText>
                      </View>
                    )}
                  </View>
                  {(item.createdAt || item.created_at || item.details?.createdAt) ? (
                    <ThemeText variant="caption" color={COLORS.textSecondary} style={{ marginTop: 2, fontSize: 11 }}>
                      申請日: {formatDate(item.createdAt || item.created_at || item.details?.createdAt)}
                    </ThemeText>
                  ) : null}
                  <ThemeText variant="caption" color={COLORS.textSecondary} style={styles.reasonText}>
                    詳細: {item.reason || 'なし'}
                  </ThemeText>
                </View>

                <View style={styles.cardActions}>
                  {(() => {
                    const isApproved = item.status === 'approved' || item.status === '承認' || item.is_manual === true || item.isManual === true;
                    const isPending = !isApproved && (item.status === 'pending' || item.status === '申請中' || !item.status);
                    return (
                      <>
                        {isManager && (
                          <>
                            {isPending ? (
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
                          </>
                        )}
                        {/* スタッフ本人用の削除ボタン：承認済または却下の申請を履歴から消せる */}
                        {!isManager && (
                          <TouchableOpacity 
                            style={[styles.actionBtn, styles.rejectBtn]}
                            onPress={() => handleDeleteOwnRequest(item.id)}
                          >
                            <X size={14} color={COLORS.danger} />
                            <ThemeText variant="caption" color={COLORS.danger} style={{ marginLeft: 4 }}>削除</ThemeText>
                          </TouchableOpacity>
                        )}
                      </>
                    );
                  })()}
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
                  {['年休', '時間休', '公休変更', '休日出勤変更', '休日出勤＋公休変更', '1日振替', '半日振替', '振替4', '振替＋時間休', '夏季休暇', '特休', '特休＋時間休', '出張'].map((t) => (
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
  
              {(newRequest.type === '時間休' || newRequest.type === '特休' || newRequest.type === '時間給' || newRequest.type === '特休＋時間休' || newRequest.type === '振替＋時間休' || newRequest.type === '出張') && (
                <View style={styles.timeSelectionArea}>
                  <ThemeText variant="label" style={{ marginBottom: 12 }}>時間設定 (0.25h単位)</ThemeText>
                  {newRequest.type === '特休＋時間休' ? (
                    <View style={{ gap: 16 }}>
                      <View>
                        <ThemeText variant="caption" style={{ marginBottom: 6 }}>特休の時間数</ThemeText>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                          <TouchableOpacity onPress={() => setSpecialHours(prev => Math.max(0.25, prev - 0.25))} style={styles.stepperBtn}>
                            <ThemeText bold color="white">-</ThemeText>
                          </TouchableOpacity>
                          <ThemeText variant="h2" color={COLORS.primary}>{specialHours.toFixed(2)}h</ThemeText>
                          <TouchableOpacity onPress={() => setSpecialHours(prev => Math.min(8.0, prev + 0.25))} style={styles.stepperBtn}>
                            <ThemeText bold color="white">+</ThemeText>
                          </TouchableOpacity>
                        </View>
                      </View>
                      <View>
                        <ThemeText variant="caption" style={{ marginBottom: 6 }}>時間休の時間数</ThemeText>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                          <TouchableOpacity onPress={() => setHourlyHours(prev => Math.max(0.25, prev - 0.25))} style={styles.stepperBtn}>
                            <ThemeText bold color="white">-</ThemeText>
                          </TouchableOpacity>
                          <ThemeText variant="h2" color={COLORS.primary}>{hourlyHours.toFixed(2)}h</ThemeText>
                          <TouchableOpacity onPress={() => setHourlyHours(prev => Math.min(8.0, prev + 0.25))} style={styles.stepperBtn}>
                            <ThemeText bold color="white">+</ThemeText>
                          </TouchableOpacity>
                        </View>
                      </View>
                      <ThemeText variant="caption" bold style={{ marginTop: 4 }}>合計時間: {(specialHours + hourlyHours).toFixed(2)}h</ThemeText>
                    </View>
                  ) : newRequest.type === '振替＋時間休' ? (
                    <View style={{ gap: 14 }}>
                      <View style={{ backgroundColor: 'rgba(56, 189, 248, 0.12)', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(56, 189, 248, 0.3)' }}>
                        <ThemeText variant="caption" color={COLORS.primary} bold>
                          ※ 振替4時間 ＋ 時間休 {hourlyHours.toFixed(2)}時間（合計休暇: {(4.0 + hourlyHours).toFixed(2)}h）
                        </ThemeText>
                        <ThemeText variant="caption" style={{ color: COLORS.textSecondary, fontSize: 11, marginTop: 2 }}>
                          ※ 時間休の {hourlyHours.toFixed(2)}時間 分が年休（有給）から消化されます
                        </ThemeText>
                      </View>

                      <View>
                        <ThemeText variant="caption" style={{ marginBottom: 8 }}>時間休の時間数を選択</ThemeText>
                        
                        {/* プリセットクイックボタン */}
                        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                          {[1.0, 2.0, 3.0, 3.5, 3.75].map((preset) => (
                            <TouchableOpacity
                              key={preset}
                              style={[
                                { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: COLORS.border, backgroundColor: 'rgba(255,255,255,0.05)' },
                                hourlyHours === preset && { backgroundColor: COLORS.primary, borderColor: COLORS.primary }
                              ]}
                              onPress={() => setHourlyHours(preset)}
                            >
                              <ThemeText variant="caption" bold={hourlyHours === preset} color={hourlyHours === preset ? 'white' : COLORS.text}>
                                {preset}h
                              </ThemeText>
                            </TouchableOpacity>
                          ))}
                        </View>

                        {/* ステッパー */}
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                          <TouchableOpacity onPress={() => setHourlyHours(prev => Math.max(0.25, prev - 0.25))} style={styles.stepperBtn}>
                            <ThemeText bold color="white">-</ThemeText>
                          </TouchableOpacity>
                          <ThemeText variant="h2" color={COLORS.primary}>{hourlyHours.toFixed(2)}h</ThemeText>
                          <TouchableOpacity onPress={() => setHourlyHours(prev => Math.min(8.0, prev + 0.25))} style={styles.stepperBtn}>
                            <ThemeText bold color="white">+</ThemeText>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                      <TouchableOpacity onPress={() => setNewRequest({ ...newRequest, hours: Math.max(0.25, newRequest.hours - 0.25) })} style={styles.stepperBtn}>
                        <ThemeText bold color="white">-</ThemeText>
                      </TouchableOpacity>
                      <ThemeText variant="h2" color={COLORS.primary}>{newRequest.hours.toFixed(2)}h</ThemeText>
                      <TouchableOpacity onPress={() => setNewRequest({ ...newRequest, hours: Math.min(8.0, newRequest.hours + 0.25) })} style={styles.stepperBtn}>
                        <ThemeText bold color="white">+</ThemeText>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )}
  
              {newRequest.type === '休日出勤＋公休変更' ? (
                <View style={{ gap: 16, marginBottom: 16 }}>
                  <ThemeText variant="label" bold color={COLORS.primary}>【1】 休日出勤の変更</ThemeText>
                  <View style={styles.inputGroup}>
                    <ThemeText variant="caption">① 休日出勤の変更日（元の出勤予定日）</ThemeText>
                    <TouchableOpacity style={styles.dateSelectorBtn} onPress={() => { setActiveDateField('workOriginal'); setIsDateModalVisible(true); }}>
                      <CalendarIcon size={18} color="#f87171" />
                      <ThemeText style={{ marginLeft: 12, color: workOriginalDate ? COLORS.text : COLORS.border }}>
                        {workOriginalDate ? formatDate(workOriginalDate) : 'タップして元の休日出勤日を選択'}
                      </ThemeText>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.inputGroup}>
                    <ThemeText variant="caption">② 休日出勤の変更希望日（新しい出勤希望日）</ThemeText>
                    <TouchableOpacity style={styles.dateSelectorBtn} onPress={() => { setActiveDateField('workTarget'); setIsDateModalVisible(true); }}>
                      <CalendarIcon size={18} color="#38bdf8" />
                      <ThemeText style={{ marginLeft: 12, color: workTargetDate ? COLORS.text : COLORS.border }}>
                        {workTargetDate ? formatDate(workTargetDate) : 'タップして新しい休日出勤日を選択'}
                      </ThemeText>
                    </TouchableOpacity>
                  </View>

                  <ThemeText variant="label" bold color={COLORS.primary} style={{ marginTop: 8 }}>【2】 公休の変更</ThemeText>
                  <View style={styles.inputGroup}>
                    <ThemeText variant="caption">③ 公休の変更日（元の公休予定日）</ThemeText>
                    <TouchableOpacity style={styles.dateSelectorBtn} onPress={() => { setActiveDateField('offOriginal'); setIsDateModalVisible(true); }}>
                      <CalendarIcon size={18} color="#f87171" />
                      <ThemeText style={{ marginLeft: 12, color: offOriginalDate ? COLORS.text : COLORS.border }}>
                        {offOriginalDate ? formatDate(offOriginalDate) : 'タップして元の公休日を選択'}
                      </ThemeText>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.inputGroup}>
                    <ThemeText variant="caption">④ 公休の変更希望日（新しい公休希望日）</ThemeText>
                    <TouchableOpacity style={styles.dateSelectorBtn} onPress={() => { setActiveDateField('offTarget'); setIsDateModalVisible(true); }}>
                      <CalendarIcon size={18} color="#38bdf8" />
                      <ThemeText style={{ marginLeft: 12, color: offTargetDate ? COLORS.text : COLORS.border }}>
                        {offTargetDate ? formatDate(offTargetDate) : 'タップして新しい公休日を選択'}
                      </ThemeText>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : ['公休変更', '休日出勤変更'].includes(newRequest.type) ? (
                <View style={{ gap: 16, marginBottom: 16 }}>
                  <View style={styles.inputGroup}>
                    <ThemeText variant="label">① 変更日（元の予定日）</ThemeText>
                    <TouchableOpacity 
                      style={styles.dateSelectorBtn} 
                      onPress={() => {
                        setActiveDateField('original');
                        setIsDateModalVisible(true);
                      }}
                    >
                      <CalendarIcon size={18} color="#f87171" />
                      <ThemeText style={{ marginLeft: 12, color: originalDate ? COLORS.text : COLORS.border }}>
                        {originalDate ? formatDate(originalDate) : 'タップして変更日を選択'}
                      </ThemeText>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.inputGroup}>
                    <ThemeText variant="label">② 変更希望日（新たな希望日）</ThemeText>
                    <TouchableOpacity 
                      style={styles.dateSelectorBtn} 
                      onPress={() => {
                        setActiveDateField('target');
                        setIsDateModalVisible(true);
                      }}
                    >
                      <CalendarIcon size={18} color="#38bdf8" />
                      <ThemeText style={{ marginLeft: 12, color: targetDate ? COLORS.text : COLORS.border }}>
                        {targetDate ? formatDate(targetDate) : 'タップして変更先の日を選択'}
                      </ThemeText>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.inputGroup}>
                  <ThemeText variant="label">日付</ThemeText>
                  <TouchableOpacity 
                    style={styles.dateSelectorBtn} 
                    onPress={() => {
                      setActiveDateField('single');
                      setIsDateModalVisible(true);
                    }}
                  >
                    <CalendarIcon size={18} color={COLORS.primary} />
                    <ThemeText style={{ marginLeft: 12 }}>
                      {newRequest.date ? formatDate(newRequest.date) : 'タップして日付を選択'}
                    </ThemeText>
                  </TouchableOpacity>
                </View>
              )}
  
              <View style={styles.inputGroup}>
                <ThemeText variant="label">詳細（特別な理由がある場合）</ThemeText>
                <TextInput style={[styles.input, styles.textArea]} placeholder="詳細を入力してください（任意）" placeholderTextColor={COLORS.border} multiline numberOfLines={3} value={newRequest.reason} onChangeText={(text) => setNewRequest({ ...newRequest, reason: text })} />
              </View>
  
              <View style={styles.formButtons}>
                <TouchableOpacity style={[styles.button, styles.cancelButton]} onPress={() => setShowForm(false)} disabled={isSubmitting}>
                  <ThemeText bold>キャンセル</ThemeText>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.button, styles.submitButton, isSubmitting && { opacity: 0.5 }]} onPress={handleSubmit} disabled={isSubmitting}>
                  <ThemeText bold color={COLORS.background}>{isSubmitting ? '送信中...' : '申請する'}</ThemeText>
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
              <ThemeText variant="h2">
                {activeDateField === 'workOriginal' ? '元の休日出勤日を選択' :
                 activeDateField === 'workTarget' ? '新しい休日出勤日を選択' :
                 activeDateField === 'offOriginal' ? '元の公休日を選択' :
                 activeDateField === 'offTarget' ? '新しい公休日を選択' :
                 activeDateField === 'original' ? '変更日を選択' :
                 activeDateField === 'target' ? '変更希望日を選択' : '日付を選択'}
              </ThemeText>
              <TouchableOpacity onPress={() => setIsDateModalVisible(false)}>
                <X color={COLORS.textSecondary} size={24} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 400 }} keyboardShouldPersistTaps="always">
              {Array.from({ length: 60 }).map((_, i) => {
                const d = new Date();
                d.setDate(d.getDate() + i);
                const dateStr = getDateStr(d);
                const isSelected = 
                  activeDateField === 'workOriginal' ? workOriginalDate === dateStr :
                  activeDateField === 'workTarget' ? workTargetDate === dateStr :
                  activeDateField === 'offOriginal' ? offOriginalDate === dateStr :
                  activeDateField === 'offTarget' ? offTargetDate === dateStr :
                  activeDateField === 'original' ? originalDate === dateStr :
                  activeDateField === 'target' ? targetDate === dateStr :
                  newRequest.date === dateStr;

                return (
                  <TouchableOpacity 
                    key={dateStr} 
                    style={[styles.dateOption, isSelected && styles.dateOptionActive]}
                    onPress={() => {
                      if (activeDateField === 'workOriginal') setWorkOriginalDate(dateStr);
                      else if (activeDateField === 'workTarget') setWorkTargetDate(dateStr);
                      else if (activeDateField === 'offOriginal') setOffOriginalDate(dateStr);
                      else if (activeDateField === 'offTarget') setOffTargetDate(dateStr);
                      else if (activeDateField === 'original') setOriginalDate(dateStr);
                      else if (activeDateField === 'target') setTargetDate(dateStr);
                      else setNewRequest({ ...newRequest, date: dateStr });
                      setIsDateModalVisible(false);
                    }}
                  >
                    <ThemeText color={isSelected ? COLORS.background : COLORS.text}>{formatDate(d)}</ThemeText>
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
  container: { 
    flex: 1, 
    backgroundColor: COLORS.background, 
    width: '100%',
    maxWidth: '100%',
    alignItems: 'stretch',
    alignSelf: 'stretch'
  },
  header: { 
    padding: SPACING.md, 
    marginTop: SPACING.md, 
    width: '100%',
    alignItems: 'stretch',
    alignSelf: 'stretch'
  },
  scrollContent: { 
    padding: SPACING.md, 
    paddingBottom: 100, 
    width: '100%',
    alignItems: 'stretch'
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginBottom: SPACING.md, width: '100%' },
  requestCard: { marginBottom: SPACING.md, padding: SPACING.md, width: '100%' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.sm, width: '100%' },
  typeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: BORDER_RADIUS.full },
  cardBody: { gap: 6, width: '100%' },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 6, width: '100%' },
  infoText: { fontSize: 14 },
  reasonText: { marginTop: 2 },
  cardActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)', gap: 8, width: '100%' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  approveBtn: { backgroundColor: '#22c55e' },
  rejectBtn: { backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: COLORS.border },
  undoBtn: { backgroundColor: 'rgba(255,255,255,0.05)' },
  fab: { position: 'absolute', bottom: 30, right: 30, width: 60, height: 60, borderRadius: 30, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center', elevation: 5 },
  formContainer: { padding: SPACING.md, width: '100%' },
  formCard: { padding: SPACING.lg, width: '100%' },
  formTitle: { marginBottom: SPACING.lg, width: '100%' },
  inputGroup: { marginBottom: SPACING.lg, width: '100%' },
  typeSelector: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8, width: '100%' },
  typeOption: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: COLORS.border },
  typeOptionActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  timeSelectionArea: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 12, padding: SPACING.md, marginBottom: SPACING.lg, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', width: '100%' },
  timeScroll: { marginTop: 8, width: '100%' },
  timeChip: { minWidth: 65, paddingVertical: 8, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.05)', marginRight: 8, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center' },
  timeChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  input: { marginTop: 8, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 12, color: COLORS.text, borderWidth: 1, borderColor: COLORS.border, width: '100%' },
  dateSelectorBtn: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    padding: 12, 
    backgroundColor: 'rgba(255,255,255,0.05)', 
    borderRadius: 8, 
    marginTop: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    width: '100%'
  },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 20, width: '100%' },
  modalContent: { backgroundColor: COLORS.card, borderRadius: 24, padding: 24, width: '100%', borderWidth: 1, borderColor: COLORS.border },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, width: '100%' },
  dateOption: { padding: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)', width: '100%' },
  dateOptionActive: { backgroundColor: COLORS.primary, borderRadius: 8 },
  closeBtn: { marginTop: 16, padding: 12, alignItems: 'center', width: '100%' },
  textArea: { height: 100, textAlignVertical: 'top', width: '100%' },
  formButtons: { flexDirection: 'row', gap: SPACING.md, marginTop: SPACING.md, width: '100%' },
  button: { flex: 1, height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  cancelButton: { backgroundColor: 'transparent', borderWidth: 1, borderColor: COLORS.border },
  submitButton: { backgroundColor: COLORS.primary },
  stepperBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(56, 189, 248, 0.4)', justifyContent: 'center', alignItems: 'center' },
});
