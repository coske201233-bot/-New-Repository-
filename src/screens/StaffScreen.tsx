import React, { useState, useMemo, useEffect } from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity, Modal, ActivityIndicator, Alert, TextInput, SafeAreaView, Platform, Text, Button } from 'react-native';
import { ThemeText } from '../components/ThemeText';
import { ThemeCard } from '../components/ThemeCard';
import { COLORS, SPACING, BORDER_RADIUS } from '../theme/theme';
import { 
  ChevronLeft, ChevronRight, Calendar, User, 
  Check, X, Clock, MapPin, Briefcase, Settings, Shield, Printer, Plus, Pencil, LogOut
} from 'lucide-react-native';
import { getMonthInfo, getDayType, isHoliday, getDateStr } from '../utils/dateUtils';
import { normalizeName } from '../utils/staffUtils';
import { cloudStorage } from '../utils/cloudStorage';
import { supabase } from '../utils/supabase';
import * as Print from 'expo-print';

interface StaffScreenProps {
  staffList: any[];
  setStaffList: (staff: any[] | ((prev: any[]) => any[])) => void;
  requests: any[];
  setRequests: (requests: any[] | ((prev: any[]) => any[])) => void;
  profile: any;
  isAdminAuthenticated: boolean;
  isPrivileged?: boolean;
  onDeleteRequest?: (id: string) => void;
  initialWard?: string;
  currentDate: Date;
  setCurrentDate: (d: Date | ((prev: Date) => Date)) => void;
  onForceCloudSync?: () => Promise<boolean>;
  onLogout?: () => void;
}

interface MonthDay {
  day: number;
  dateStr: string;
  isH?: boolean;
  empty: boolean;
}

export const StaffScreen: React.FC<StaffScreenProps> = (props) => {
  const { 
    staffList, setStaffList, 
    requests, setRequests, onDeleteRequest, isPrivileged, profile, 
    currentDate, setCurrentDate,
    shifts, fetchShifts, isLoadingShifts // [V54.0]
  } = props;

  // --- [CRITICAL: FALLBACK UI FOR WSOD PREVENTION] ---
  if (!staffList || !requests) {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: 20 }]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <ThemeText style={{ marginTop: 24, marginBottom: 8 }} variant="h2">データを読み込み中...</ThemeText>
        <TouchableOpacity 
          style={{ marginTop: 40, backgroundColor: 'rgba(239, 68, 68, 0.1)', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#ef4444' }}
          onPress={() => props.onLogout ? props.onLogout() : supabase.auth.signOut()}
        >
          <ThemeText color="#ef4444" bold>ログアウトして戻る</ThemeText>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const isAdminAuthenticated = props.isAdminAuthenticated || isPrivileged;
  const userRole = isAdminAuthenticated ? 'admin' : 'staff';

  const [selectedStaff, setSelectedStaff] = useState<any>(null);
  const [isCalendarModalVisible, setIsCalendarModalVisible] = useState(false);
  const activeDate = currentDate || new Date();
  const setActiveDate = setCurrentDate;
  
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState('出勤');
  const [selectedHours, setSelectedHours] = useState(1.0);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (fetchShifts) fetchShifts();
  }, [fetchShifts, activeDate]);

  // --- [CRITICAL: FORCE RE-FETCH ON FOCUS & DEBUG] ---
  // タブが切り替わってこのコンポーネントがマウントされるたびにクラウドから最新データを取得します
  useEffect(() => {
    console.log('--- [STAFF_SCREEN] Tab focused, triggering cloud sync & debug fetch... ---');
    const runDebugFetch = async () => {
      try {
        const { data, error } = await supabase.from('staff').select('*');

        if (error) {
          console.error("FETCH ERROR:", error);
          setDebugError(error.message);
        } else {
          console.log("FETCHED DATA:", data);
          setDebugStaffList(data || []);
        }
      } catch (e: any) {
        console.error("DEBUG FETCH EXCEPTION:", e);
        setDebugError(e.message);
      }
    };

    runDebugFetch();
  }, []);

  // [NEW] 自動的に自分のカレンダーを開くロジック (一般スタッフ用)
  useEffect(() => {
    if (profile && !isAdminAuthenticated && !selectedStaff && staffList.length > 0) {
      const me = staffList.find(s => s && (s.id === profile.id || normalize(s.name) === normalize(profile.name)));
      if (me) {
        setSelectedStaff(me);
        setIsCalendarModalVisible(true);
      }
    }
  }, [profile, staffList, isAdminAuthenticated]);

  // Registration Form States
  const [isRegistrationModalVisible, setIsRegistrationModalVisible] = useState(false);
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regAppRole, setRegAppRole] = useState('一般スタッフ');
  const [regTitle, setRegTitle] = useState('主事');
  const [regJobType, setRegJobType] = useState('PT');
  const [regPlacement, setRegPlacement] = useState('4F');
  const [regStatus, setRegStatus] = useState('常勤');
  const [editingStaff, setEditingStaff] = useState<any>(null);
  const [regHolidaySetting, setRegHolidaySetting] = useState(false);
  const [showHolidayPicker, setShowHolidayPicker] = useState(false);

  // --- [ON-SCREEN DEBUGGING & FAIL-SAFE RENDER] ---
  const [statusMsg, setStatusMsg] = useState("");
  const [debugError, setDebugError] = useState<string | null>(null);
  const [debugStaffList, setDebugStaffList] = useState<any[]>([]);
  const staff = debugStaffList; // Alias for user requirement snippet

  // Multi-choice options (Custom Hospital Structure)
  const APP_ROLES = ['管理者', '一般スタッフ'];
  const JOB_TYPES = ['PT', 'OT', 'ST', '助手'];
  const TITLES = ['科長', '科長補佐', '係長', '主査', '主任', '主事', '会計年度'];
  const PLACEMENTS = ['２F', '包括', '4F', '外来', 'フォロー', '兼務', '管理', '事務', '排尿管理', '訪問リハ'];
  const STATUSES = ['常勤', '時短勤務', '長期休暇', 'その他'];

  const handleOpenRegistration = (staffToEdit: any) => {
    if (!staffToEdit) return;

    setEditingStaff(staffToEdit);
    setRegName(staffToEdit.name || '');
    setRegEmail(staffToEdit.email || '');
    setRegAppRole(staffToEdit.permissions?.includes('管理者') ? '管理者' : '一般スタッフ');
    setRegTitle(staffToEdit.role || '主事');
    setRegJobType(staffToEdit.jobType || 'PT');
    setRegPlacement(staffToEdit.placement || '4F');
    setRegStatus(staffToEdit.status || '常勤');
    setRegHolidaySetting(!!staffToEdit.noHoliday);
    
    setIsRegistrationModalVisible(true);
  };

  const fetchStaff = async () => {
    if (props.onForceCloudSync) {
      await props.onForceCloudSync();
    }
  };

  const handleRegisterStaff = async () => {
    console.log("SUBMIT CLICKED", { regName, regEmail });

    if (!regName.trim() || !regEmail.trim()) {
      setStatusMsg('❌ 氏名とメールアドレスを入力してください');
      return;
    }
    setStatusMsg("処理中...");

    const finalEmail = regEmail.trim().toLowerCase();
    const isMasterAdmin = finalEmail === 'admin@reha.local';

    setIsSaving(true);
    try {
      const payload = {
        name: regName.trim(),
        email: finalEmail,
        position: regTitle, // 役職 (Title)
        role: (isMasterAdmin || regAppRole === '管理者') ? '管理者,スタッフ' : 'スタッフ', // アプリ権限 (permissions)
        profession: regJobType, // 職種 (jobType)
        placement: regPlacement,
        status: regStatus,
        no_holiday: regHolidaySetting,
        is_approved: isMasterAdmin || regStatus === '承認済み',
      };

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('サーバーからの応答が一定時間を超えました。')), 5000)
      );

      if (editingStaff) {
        // UPDATE
        const { error } = await Promise.race([
          supabase.from('staff').update(payload).eq('id', editingStaff.id),
          timeoutPromise
        ]) as any;

        if (error) {
          console.error("UPDATE ERROR:", error);
          setStatusMsg("❌ 保存に失敗しました: " + (error.message || "不明なエラー"));
          setIsSaving(false);
          return;
        }

        setStatusMsg('🎉 変更を保存しました！');
        if (props.onForceCloudSync) {
          props.onForceCloudSync();
        }
        setTimeout(() => {
          setStatusMsg('');
        }, 3000);
      }
    } catch (error: any) {
      console.error("INSERT ERROR:", error);
      setStatusMsg("❌ エラー: " + (error.message || "不明なエラー"));
    } finally {
      setIsSaving(false);
    }
  };

  // Constants
  const SHIFT_TYPES = ['出勤', '公休', '夏季休暇', '時間休', '振替＋時間休', '1日振替', '半日振替', '特休', '年休', '空欄'];
  const HOUR_SELECTOR_TYPES = ['時間休', '振替＋時間休', '特休', '時間給', '看護休暇', '午前休', '午後休'];

  const monthInfo = useMemo(() => (getMonthInfo(activeDate.getFullYear(), activeDate.getMonth()) || []) as MonthDay[], [activeDate]);
  
  const filteredStaff = useMemo(() => {
    if (!Array.isArray(staffList)) return [];
    return [...staffList.filter(s => s)].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [staffList]);

  const normalize = (n: string) => (n || '').replace(/[\s\u3000\t\n\r()（）/／・.\-_]/g, '').replace(/公費/g, '').toUpperCase();

  const getReqHours = (r: any): number => {
    if (!r) return 0;
    const h = r.hours ?? r.details?.duration ?? r.duration;
    if (h !== undefined && h !== null && h !== '') return parseFloat(String(h));
    
    // Default values by type
    if (r.type === '1日振替') return 7.75;
    if (r.type === '半日振替') return 3.75;
    if (['年休', '有給休暇', '夏季休暇', '特休', '全休', '休暇', '欠勤'].includes(r.type)) return 7.75;
    if (r.type === '午前休') return 4.0;
    if (r.type === '午後休') return 3.75;
    
    // Fallback: calculate from details if available
    if (r.details?.startTime && r.details?.endTime) {
      try {
        const [sh, sm] = String(r.details.startTime).split(':').map(Number);
        const [eh, em] = String(r.details.endTime).split(':').map(Number);
        if (!isNaN(sh) && !isNaN(eh)) return (eh + em / 60) - (sh + sm / 60);
      } catch (e) {}
    }
    return 0;
  };

  const requestMap = useMemo(() => {
    const map = new Map<string, Map<string, any>>();
    
    const normalizeLocal = (n: string) => (n || '').replace(/[\s\u3000\t\n\r()（）/／・.\-_]/g, '').replace(/公費/g, '').toUpperCase();
    const extractUuid = (idStr: string): string | null => {
      if (!idStr) return null;
      const parts = idStr.split('-');
      return parts.length >= 6 ? parts.slice(1, 6).join('-') : null;
    };
    const allData = [...(Array.isArray(requests) ? requests : []), ...(Array.isArray(shifts) ? shifts : [])];
    
    allData.forEach(r => {
      if (!r || !r.date || r.status === 'deleted') return;
      
      const dateKey = String(r.date).substring(0, 10);
      if (!map.has(dateKey)) map.set(dateKey, new Map<string, any>());
      const dayMap = map.get(dateKey)!;
      
      // [V57.6] 照合キーを ID 優先にするが、IDの揺れ（staff_id vs user_id）に備え名前でも保持
      const extractedId = extractUuid(r.id);
      const sId = String(r.staff_id || r.staffId || r.user_id || extractedId || '').trim();
      const sName = normalizeLocal(r.staffName || r.staff_name || '');
      
      const keys = [sId, sName].filter(Boolean);
      keys.forEach(key => {
        const existing = dayMap.get(key);
        
        const isManualEntry = (rec: any) => 
          !!(rec?.is_manual || rec?.isManual) || 
          String(rec?.id || '').startsWith('m-') || 
          String(rec?.id || '').startsWith('req-');

        let isBetter = false;
        if (!existing) {
          isBetter = true;
        } else {
          const isManNew = isManualEntry(r);
          const wasManOld = isManualEntry(existing);

          if (isManNew && !wasManOld) {
            isBetter = true; // 手動は常に自動を上書き
          } else if (!isManNew && wasManOld) {
            isBetter = false; // 自動は手動を上書きできない
          } else if (isManNew && wasManOld) {
            // 共に手動の場合は時間が新しい方を優先
            const getTime = (i: any) => {
              const t = i?.updatedAt || i?.updated_at || i?.createdAt || i?.created_at || 0;
              return typeof t === 'string' ? new Date(t).getTime() : (typeof t === 'number' ? t : 0);
            };
            isBetter = getTime(r) > getTime(existing);
          } else {
            // 共に自動（または手動フラグが無い）場合は、休みを優先
            isBetter = (!['出勤', '日勤'].includes(r?.type) && ['出勤', '日勤'].includes(existing?.type));
          }
        }
          
        if (isBetter) {
          dayMap.set(key, r);
        }
      });
    });
    return map;
  }, [requests, shifts, normalize]);

  const handleDayPress = (d: MonthDay) => {
    if (!d || d.empty) return;
    setSelectedDay(d.dateStr);
    const sId = String(selectedStaff?.id || '').trim();
    const sName = normalize(selectedStaff?.name || '');
    const dayMap = requestMap.get(d.dateStr);
    const existing = (sId && dayMap?.get(sId)) || (sName && dayMap?.get(sName));
    if (existing) {
      setSelectedType((existing.type === '日勤' || existing.type === '出勤') ? '出勤' : existing.type);
      setSelectedHours(getReqHours(existing) || 1.0);
    } else {
      setSelectedType('出勤');
      setSelectedHours(1.0);
    }
  };

  const handleConfirmShift = async () => {
    if (!selectedDay || !selectedStaff || isSaving) return;

    if (selectedType === '空欄') {
      await handleDeleteCurrentDay(false);
      return;
    }

    setIsSaving(true);
    try {
      const type = selectedType;
      const now = new Date().toISOString();
      const newReq = {
        id: `m-${selectedStaff.id}-${selectedDay}`,
        staffId: selectedStaff.id,
        staffName: selectedStaff.name,
        date: selectedDay,
        type: type,
        hours: HOUR_SELECTOR_TYPES.includes(type) ? selectedHours : undefined,
        status: 'approved',
        createdAt: now,
        updatedAt: now, // 常に最新の時刻をセットして重複排除で勝つようにする
        isShift: true,
        isManual: true // 手動フラグを確実に立てる
      };
      
      const sT = normalize(selectedStaff.name);
      setRequests((prev: any[]) => {
        const without = prev.filter((r: any) => r && !( (String(r.staffId) === selectedStaff.id || normalize(r.staffName) === sT) && r.date === selectedDay ));
        return [newReq, ...without];
      });
      
      await cloudStorage.upsertRequests([newReq]);
      
      // [V53.2] shiftsテーブルも同期（全体カレンダーとの不整合を解消）
      const shiftPayload = {
        id: newReq.id,
        staff_id: selectedStaff.id,
        staff_name: selectedStaff.name,
        date: selectedDay,
        type: type,
        status: 'approved',
        is_manual: true, // 【V53.6】手動フラグを付与
        details: newReq.details
      };
      await supabase.from('shifts').upsert(shiftPayload);
      
      await fetchShifts(); // 再取得して表示を更新
      Alert.alert('完了', '保存しました');
    } catch (e) {
      console.error('Confirm Shift Error:', e);
      Alert.alert('エラー', '保存に失敗しました。');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteCurrentDay = async (showConfirm = true) => {
    if (!selectedDay || !selectedStaff || isSaving) return;
    const sT = normalize(selectedStaff.name);
    const existing = requests.filter((r: any) => r && ( (String(r.staffId) === selectedStaff.id || normalize(r.staffName) === sT) && r.date === selectedDay ) && r.status !== 'deleted');
    
    if (existing.length === 0) {
      if (showConfirm) Alert.alert('情報', '削除する予定がありません。');
      return;
    }

    const performDelete = async () => {
      setIsSaving(true);
      try {
        for (const r of existing) {
          if (r.id) {
            if (onDeleteRequest) {
              onDeleteRequest(r.id);
            } else {
              setRequests((prev: any[]) => prev.filter((req: any) => req.id !== r.id));
              await cloudStorage.upsertRequests([{ ...r, status: 'deleted', updatedAt: new Date().toISOString() }]);
            }
          }
        }
        
        // [V53.3] shiftsテーブルからも削除
        await supabase.from('shifts').delete()
          .eq('staff_id', selectedStaff.id)
          .eq('date', selectedDay);
        
        await fetchShifts();
        
        // Instead of setting selectedDay to null and closing everything, just update the state
        setSelectedType('出勤');
        setSelectedHours(1.0);
        if (showConfirm) Alert.alert('完了', '予定を削除しました。');
      } catch (e) {
        Alert.alert('エラー', '削除に失敗しました。');
      } finally {
        setIsSaving(false);
      }
    };

    if (showConfirm) {
      Alert.alert('予定の削除', `${selectedDay} の予定を完全に削除しますか？`, [
        { text: 'キャンセル', style: 'cancel' },
        { text: '削除する', style: 'destructive', onPress: performDelete }
      ]);
    } else {
      await performDelete();
    }
  };

  const handlePrint = () => {
    if (Platform.OS !== 'web' || !selectedStaff) return;
    
    try {
      const sId = String(selectedStaff.id || '').trim();
      const sName = normalize(selectedStaff.name);
      const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
      const currentMonthKey = `${year}-${String(month).padStart(2, '0')}`;
      
      let rowsHtml = '';
      monthInfo.forEach((d: MonthDay) => {
        if (d.empty) return;
        const dayMap = requestMap.get(d.dateStr);
        const r = (sId && dayMap?.get(sId)) || (sName && dayMap?.get(sName));
        
        let type = '';
        if (r) {
          type = r.type;
        } else {
          const dDate = new Date(d.dateStr);
          const dtype = getDayType(dDate);
          const isNoHoliday = (dtype !== 'weekday') && (selectedStaff.monthlyNoHoliday?.[currentMonthKey] ?? selectedStaff.noHoliday);
          type = (dtype === 'weekday') ? '出勤' : '公休';
        }

        const h = r ? getReqHours(r) : 0;
        const shiftDisplay = (HOUR_SELECTOR_TYPES.includes(type)) ? `${type}(${h}h)` : ((type === '日勤' || type === '出勤') ? '出勤' : type);
        
        const dDate = new Date(d.dateStr);
        const dayIdx = dDate.getDay();
        const style = (d.isH || dayIdx === 0) ? 'color: #ef4444; background-color: #fef2f2;' : (dayIdx === 6 ? 'color: #3b82f6; background-color: #eff6ff;' : '');
        
        rowsHtml += `
          <tr style="${style}">
            <td style="text-align: center;">${d.day}</td>
            <td style="text-align: center;">${dayNames[dayIdx]}</td>
            <td style="font-weight: bold; text-align: center;">${shiftDisplay}</td>
            <td>${r?.details?.note || ''}</td>
          </tr>
        `;
      });

      const html = `<html><head><title>個人別勤務実績表</title><style>@page { size: A4 portrait; margin: 10mm; } body { font-family: sans-serif; padding: 20px; color: #1e293b; } .header { border-bottom: 2px solid #38bdf8; padding-bottom: 15px; margin-bottom: 25px; display: flex; justify-content: space-between; align-items: center; } h1 { margin: 0; font-size: 20px; } .meta { font-size: 14px; text-align: right; } table { width: 100%; border-collapse: collapse; margin-top: 10px; } th, td { border: 1px solid #cbd5e1; padding: 10px; text-align: center; } th { background-color: #f8fafc; font-size: 13px; font-weight: bold; }</style></head><body><div class="header"><div><h1>個人別勤務実績表 (${month}月)</h1><div style="margin-top: 5px;">氏名: <strong style="font-size: 18px;">${selectedStaff.name}</strong></div></div><div class="meta">${year}年${month}月分<br/>職種: ${selectedStaff.jobType || selectedStaff.profession || ''}</div></div><table><thead><tr><th style="width: 50px;">日</th><th style="width: 50px;">曜</th><th>勤務実績 / 申請</th><th>特記事項</th></tr></thead><tbody>${rowsHtml}</tbody></table><script>window.onload=function(){window.print();};<\\/script></body></html>`;

      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
      } else {
        Alert.alert('ポップアップ制限', '実績表のプレビューが開けませんでした。ブラウザ設定でポップアップを許可してください。');
      }
    } catch (e) {
      console.error('Print Error:', e);
      Alert.alert('エラー', 'データの生成中に問題が発生しました。');
    }
  };

  const renderCalendar = () => {
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    
    // 1週間（7日）ごとの行に分割する
    const rows: MonthDay[][] = [];
    let currentRow: MonthDay[] = [];
    
    monthInfo.forEach((d, i) => {
      currentRow.push(d);
      if (currentRow.length === 7 || i === monthInfo.length - 1) {
        // 7日分たまったか、最後の日なら行を追加
        while (currentRow.length < 7) {
          currentRow.push({ day: 0, dateStr: `empty-${i}-${currentRow.length}`, empty: true, isH: false });
        }
        rows.push(currentRow);
        currentRow = [];
      }
    });

    return (
      <View style={styles.calendarContainer}>
        {/* 曜日ヘッダー */}
        <View style={styles.calendarRow}>
          {days.map(d => (
            <View key={d} style={styles.calendarHeaderCell}>
              <ThemeText variant="caption" color={COLORS.textSecondary} style={{ fontSize: 12 }}>{d}</ThemeText>
            </View>
          ))}
        </View>

        {/* 日付グリッド */}
        {rows.map((row, rowIndex) => (
          <View key={`row-${rowIndex}`} style={styles.calendarRow}>
            {row.map((d, colIndex) => {
              if (!d || d.empty) {
                return <View key={`empty-${rowIndex}-${colIndex}`} style={styles.calendarDayCell} />;
              }

              const isSelected = selectedDay === d.dateStr;
              const sId = String(selectedStaff?.id || '').trim();
              const sName = normalize(selectedStaff?.name || '');
              const dayMap = requestMap.get(d.dateStr);
              const req = (sId && dayMap?.get(sId)) || (sName && dayMap?.get(sName));
              
              let displayLabel = '';
              let labelColor = 'white';
              if (req) {
                const h = getReqHours(req);
                if (['出勤', '日勤'].includes(req.type)) {
                  displayLabel = '出勤'; labelColor = '#38bdf8';
                } else if (req.type === '公休') {
                  displayLabel = '公休'; labelColor = '#ef4444';
                } else if (req.type === '夏季休暇') {
                  displayLabel = '夏季'; labelColor = '#ef4444';
                } else if (req.type === '年休' || req.type === '有給休暇') {
                  displayLabel = '年休'; labelColor = '#ef4444';
                } else if (req.type === '1日振替') {
                  displayLabel = '振(全)'; labelColor = '#ef4444';
                } else if (req.type === '半日振替') {
                  displayLabel = '振(半)'; labelColor = '#ef4444';
                } else if (['時間休', '時間給', '特休', '午前休', '午後休', '振替＋時間休', '看護休暇'].includes(req.type)) {
                  displayLabel = `${req.type.charAt(0)}(${h}h)`; labelColor = '#ef4444';
                } else {
                  displayLabel = req.type.slice(0, 2);
                  if (['公休', '欠勤', '休暇', '全休'].includes(req.type)) labelColor = '#ef4444';
                }
              } else {
                const dDate = new Date(d.dateStr);
                const dtype = getDayType(dDate);
                if (dtype === 'weekday') {
                  displayLabel = '出勤'; labelColor = '#38bdf8';
                } else {
                  displayLabel = '公休'; labelColor = '#ef4444';
                }
              }

              return (
                <TouchableOpacity 
                  key={d.dateStr} 
                  style={[styles.calendarDayCell, isSelected && styles.calendarDaySelected]} 
                  onPress={() => handleDayPress(d)}
                >
                  <ThemeText bold={isSelected} color={d.isH ? '#ef4444' : 'white'} style={{ fontSize: 13, marginBottom: 2 }}>{d.day}</ThemeText>
                  <View style={styles.statusLabelContainer}>
                    {displayLabel ? (
                      <ThemeText 
                        numberOfLines={1} 
                        style={[styles.statusLabel, { color: labelColor }]}
                      >
                        {displayLabel}
                      </ThemeText>
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>
    );
  };

  const calculateStats = (staff: any) => {
    if (!staff) return { workDays: 0, holidayWorkDays: 0, leaveHours: '0.00' };
    const sName = normalize(staff.name);
    const year = activeDate.getFullYear();
    const month = activeDate.getMonth();
    const targetMonth = year + '-' + String(month + 1).padStart(2, '0');
    
    // 月の日数を取得
    const daysInMonthCount = new Date(year, month + 1, 0).getDate();
    
    let workDays = 0, holidayWorkDays = 0, leaveHours = 0;
    
    for (let day = 1; day <= daysInMonthCount; day++) {
      const date = new Date(year, month, day);
      const dateStr = getDateStr(date);
      const sT = normalize(staff.name);
      
      // requestMapを直接引くか、requestsをフィルタリングする（ここでは正確な算出のためrequestsを使用）
      const req = requests.find(r => r && normalize(r.staffName) === sT && r.date === dateStr && r.status !== 'deleted');
      
      if (req) {
        if (['出勤', '日勤'].includes(req.type)) {
          if (getDayType(date) === 'weekday' && !isHoliday(date)) workDays++; else holidayWorkDays++;
        } else {
          // 振替は統計から除外、時間休などは加算
          if (['振替', '1日振替', '半日振替', '振替休日'].includes(req.type)) continue;

          const h = getReqHours(req);
          if (h > 0) {
            leaveHours += h;
          } else if (['公休', '年休', '有給休暇', '夏季休暇', '特休', '休暇', '欠勤', '看護休暇', '研修'].includes(req.type)) {
            leaveHours += 7.75;
          }
        }
      } else {
        // デフォルトロジック：平日は出勤、休日は公休（カウントなし）
        const dtype = getDayType(date);
        if (dtype === 'weekday') {
          workDays++;
        }
      }
    }
    return { workDays, holidayWorkDays, leaveHours: leaveHours.toFixed(2) };
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View>
            <ThemeText variant="h1">[BUILD: VERSION 68.0 - COMPLETE MOBILE FULL-WIDTH RECOVERY]</ThemeText>
            <ThemeText variant="caption">職員の出勤状況・管理</ThemeText>
          </View>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <TouchableOpacity 
              style={{ padding: 8 }} 
              onPress={() => props.onLogout ? props.onLogout() : supabase.auth.signOut()}
            >
              <LogOut size={24} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* --- [CLEANUP] DEBUG RENDER AREA REMOVED --- */}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SPACING.md, paddingBottom: 100 }}>
        <View style={styles.staffGrid}>
          {(filteredStaff || []).map(staff => {
            if (!staff) return null;
            const stats = calculateStats(staff);
            return (
              <ThemeCard key={staff.id} style={[styles.staffCard, staff?.status === '長期休暇' && { opacity: 0.6 }]}>
                <View style={styles.cardHeader}>
                  <TouchableOpacity style={{ flex: 1 }} onPress={() => { setSelectedStaff(staff); setSelectedDay(null); setIsCalendarModalVisible(true); }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}><ThemeText bold variant="h2" style={{ marginRight: 8 }}>{staff?.name || '無名'}</ThemeText>{(staff?.role || staff?.position) ? ( <View style={styles.badge}><ThemeText style={styles.badgeText}>{staff?.role || staff?.position}</ThemeText></View> ) : null}</View>
                    <View style={{ flexDirection: 'row', marginTop: 4, gap: 12 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}><Briefcase size={12} color={COLORS.textSecondary} /><ThemeText variant="caption" color={COLORS.textSecondary} style={{ marginLeft: 4 }}>{staff?.jobType || staff?.profession || ''}</ThemeText></View>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}><MapPin size={12} color={COLORS.textSecondary} /><ThemeText variant="caption" color={COLORS.textSecondary} style={{ marginLeft: 4 }}>{staff?.placement || staff?.department || ''}</ThemeText></View>
                    </View>
                  </TouchableOpacity>
                  {userRole === 'admin' && (
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity style={[styles.miniBtn, { backgroundColor: 'rgba(56, 189, 248, 0.05)' }]} onPress={() => handleOpenRegistration(staff)}>
                        <Pencil size={18} color="#38bdf8" />
                      </TouchableOpacity>
                    </View>
                  )}
                  <TouchableOpacity style={styles.miniBtn} onPress={() => { setSelectedStaff(staff); setSelectedDay(null); setIsCalendarModalVisible(true); }}>
                    <Calendar size={18} color="#38bdf8" />
                  </TouchableOpacity>
                </View>
                <View style={styles.statsGrid}>
                  <View style={styles.statBox}><ThemeText variant="caption" color={COLORS.textSecondary}>平日</ThemeText><ThemeText bold>{stats?.workDays || 0}日</ThemeText></View>
                  <View style={styles.statBox}><ThemeText variant="caption" color={COLORS.textSecondary}>休出</ThemeText><ThemeText bold color="#f87171">{stats?.holidayWorkDays || 0}日</ThemeText></View>
                  <View style={styles.statBox}><ThemeText variant="caption" color={COLORS.textSecondary}>休暇(h)</ThemeText><ThemeText bold>{stats?.leaveHours || '0.00'}</ThemeText></View>
                </View>
              </ThemeCard>
            );
          })}
        </View>
      </ScrollView>
      <Modal visible={isCalendarModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.calendarModal}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}><ThemeText variant="h2">{selectedStaff?.name || ''}</ThemeText><ThemeText variant="caption" color={COLORS.textSecondary}>{activeDate.getFullYear()}年 {activeDate.getMonth() + 1}月</ThemeText></View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                {Platform.OS === 'web' && ( <TouchableOpacity onPress={handlePrint} style={styles.iconBtn}><Printer size={22} color="#38bdf8" /></TouchableOpacity> )}
                <TouchableOpacity onPress={() => setIsCalendarModalVisible(false)}><X size={24} color={COLORS.textSecondary} /></TouchableOpacity>
              </View>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
              <View style={styles.calendarNav}>
                <TouchableOpacity onPress={() => { setActiveDate(new Date(activeDate.getFullYear(), activeDate.getMonth() - 1, 1)); setSelectedDay(null); }}><ChevronLeft color="white" /></TouchableOpacity>
                <ThemeText bold>{activeDate.getMonth() + 1}月</ThemeText>
                <TouchableOpacity onPress={() => { setActiveDate(new Date(activeDate.getFullYear(), activeDate.getMonth() + 1, 1)); setSelectedDay(null); }}><ChevronRight color="white" /></TouchableOpacity>
              </View>
              {renderCalendar()}
              {selectedDay ? (
                <View style={styles.editorSection}>
                  <ThemeText bold style={{ marginBottom: 12 }}>{selectedDay} の確定</ThemeText>
                  <View style={styles.typeGrid}>{SHIFT_TYPES.map(type => ( <TouchableOpacity key={type} style={[styles.typeBtn, selectedType === type && styles.typeBtnActive]} onPress={() => setSelectedType(type)}><ThemeText bold={selectedType === type} color={selectedType === type ? 'white' : COLORS.textSecondary}>{type}</ThemeText></TouchableOpacity> ))}</View>
                  {HOUR_SELECTOR_TYPES.includes(selectedType) && (
                    <View style={{ marginTop: 12 }}>
                      <ThemeText variant="label" style={{ marginBottom: 12 }}>時間設定 (0.25h単位)</ThemeText>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                        <TouchableOpacity onPress={() => setSelectedHours(Math.max(0.25, selectedHours - 0.25))} style={styles.adjustBtn}>
                          <ThemeText bold>-</ThemeText>
                        </TouchableOpacity>
                        <ThemeText variant="h2" color={COLORS.primary}>{selectedHours.toFixed(2)}h</ThemeText>
                        <TouchableOpacity onPress={() => setSelectedHours(Math.min(8.0, selectedHours + 0.25))} style={styles.adjustBtn}>
                          <ThemeText bold>+</ThemeText>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                  {(isPrivileged || isAdminAuthenticated) && (
                    <View style={{ marginTop: 20 }}>
                      <TouchableOpacity style={styles.confirmBtn} onPress={handleConfirmShift} disabled={isSaving}>
                        {isSaving ? <ActivityIndicator color="white" /> : <ThemeText bold color="white">確定</ThemeText>}
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              ) : <View style={styles.placeholderSection}><ThemeText color={COLORS.textSecondary}>日付をタップ</ThemeText></View>}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Staff Registration Modal (Replaced with Custom Absolute View) */}
      {isRegistrationModalVisible && (
        <View style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 99999,
          backgroundColor: 'rgba(0,0,0,0.8)',
          justifyContent: 'center',
          alignItems: 'center',
          pointerEvents: 'box-none'
        }}>
          <View style={{
            width: '95%', backgroundColor: '#0f172a',
            padding: 20, borderRadius: 10,
            pointerEvents: 'auto',
            elevation: 10,
            maxHeight: '90%',
            overflow: 'hidden'
          }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <View style={{ flex: 1 }}>
              <ThemeText variant="h2">職員情報の編集</ThemeText>
              <ThemeText variant="caption" color={COLORS.textSecondary}>
                {`${editingStaff?.name || ''} さんの情報を更新します`}
              </ThemeText>
            </View>
            <Button title="閉じる" onPress={() => setIsRegistrationModalVisible(false)} color="#ef4444" />
          </View>
          
          <View style={Platform.OS === 'web' ? { flex: 1, overflowY: 'auto' } as any : { flex: 1 }} pointerEvents="auto">
            <View style={styles.editorSection}>
              {statusMsg ? <Text style={{ color: '#f87171', fontSize: 16, fontWeight: 'bold', marginVertical: 10, textAlign: 'center' }}>{statusMsg}</Text> : null}
              <ThemeText variant="label" style={{ marginBottom: 8 }}>氏名</ThemeText>
              <TextInput
                style={styles.input}
                placeholder="例: 山田 太郎"
                placeholderTextColor="rgba(255,255,255,0.3)"
                value={regName}
                onChangeText={setRegName}
              />

              <ThemeText variant="label" style={{ marginBottom: 8, marginTop: 16 }}>メールアドレス</ThemeText>
              <TextInput
                style={styles.input}
                placeholder="例: yamada@example.com"
                placeholderTextColor="rgba(255,255,255,0.3)"
                value={regEmail}
                onChangeText={setRegEmail}
                autoCapitalize="none"
                keyboardType="email-address"
              />

              <ThemeText variant="label" style={{ marginBottom: 12, marginTop: 16 }}>アプリ権限</ThemeText>
              <View style={styles.typeGrid}>
                {APP_ROLES.map(r => (
                  <TouchableOpacity 
                    key={r} 
                    style={[styles.typeBtn, regAppRole === r && styles.typeBtnActive]} 
                    onPress={() => setRegAppRole(r)}
                  >
                    <ThemeText color={regAppRole === r ? 'white' : COLORS.textSecondary}>{r}</ThemeText>
                  </TouchableOpacity>
                ))}
              </View>

              <ThemeText variant="label" style={{ marginBottom: 12, marginTop: 16 }}>職種</ThemeText>
              <View style={styles.typeGrid}>
                {JOB_TYPES.map(jt => (
                  <TouchableOpacity 
                    key={jt} 
                    style={[styles.typeBtn, regJobType === jt && styles.typeBtnActive]} 
                    onPress={() => setRegJobType(jt)}
                  >
                    <ThemeText color={regJobType === jt ? 'white' : COLORS.textSecondary}>{jt}</ThemeText>
                  </TouchableOpacity>
                ))}
              </View>

              <ThemeText variant="label" style={{ marginBottom: 12, marginTop: 16 }}>役職</ThemeText>
              <View style={styles.typeGrid}>
                {TITLES.map(t => (
                  <TouchableOpacity 
                    key={t} 
                    style={[styles.typeBtn, regTitle === t && styles.typeBtnActive]} 
                    onPress={() => setRegTitle(t)}
                  >
                    <ThemeText color={regTitle === t ? 'white' : COLORS.textSecondary}>{t}</ThemeText>
                  </TouchableOpacity>
                ))}
              </View>

              <ThemeText variant="label" style={{ marginBottom: 12, marginTop: 16 }}>配置</ThemeText>
              <View style={styles.typeGrid}>
                {PLACEMENTS.map(p => (
                  <TouchableOpacity 
                    key={p} 
                    style={[styles.typeBtn, regPlacement === p && styles.typeBtnActive]} 
                    onPress={() => setRegPlacement(p)}
                  >
                    <ThemeText color={regPlacement === p ? 'white' : COLORS.textSecondary}>{p}</ThemeText>
                  </TouchableOpacity>
                ))}
              </View>

              <ThemeText variant="label" style={{ marginBottom: 12, marginTop: 16 }}>ステータス</ThemeText>
              <View style={styles.typeGrid}>
                {STATUSES.map(s => (
                  <TouchableOpacity 
                    key={s} 
                    style={[styles.typeBtn, regStatus === s && styles.typeBtnActive]} 
                    onPress={() => setRegStatus(s)}
                  >
                    <ThemeText color={regStatus === s ? 'white' : COLORS.textSecondary}>{s}</ThemeText>
                  </TouchableOpacity>
                ))}
              </View>

              <ThemeText variant="label" style={{ marginBottom: 12, marginTop: 16 }}>休日設定 (自動割当条件)</ThemeText>
              <TouchableOpacity 
                style={{ 
                  flexDirection: 'row', 
                  alignItems: 'center', 
                  justifyContent: 'space-between', 
                  backgroundColor: 'rgba(255,255,255,0.05)', 
                  borderRadius: 12, 
                  height: 52, 
                  paddingHorizontal: 16,
                  marginBottom: 16
                }} 
                onPress={() => setShowHolidayPicker(true)}
              >
                <ThemeText color="white">{regHolidaySetting ? '土日祝休み' : '設定なし'}</ThemeText>
                <ChevronRight size={20} color={COLORS.textSecondary} />
              </TouchableOpacity>

              <View style={{ marginTop: 30, marginBottom: 20 }}>
                <TouchableOpacity 
                  style={[
                    { 
                      height: 52, 
                      borderRadius: 12, 
                      backgroundColor: COLORS.primary, 
                      justifyContent: 'center', 
                      alignItems: 'center',
                      flexDirection: 'row'
                    },
                    isSaving && { opacity: 0.7 }
                  ]} 
                  onPress={handleRegisterStaff}
                  disabled={isSaving}
                >
                  {isSaving ? (
                    <ActivityIndicator color="white" style={{ marginRight: 8 }} />
                  ) : (
                    <Check size={20} color="white" style={{ marginRight: 8 }} />
                  )}
                  <ThemeText bold color="white">
                    {isSaving ? '保存中...' : '変更を保存する'}
                  </ThemeText>
                </TouchableOpacity>
              </View>
            </View>
          </View>
          </View>
        </View>
      )}

      {/* Holiday Setting Selection Modal */}
      <Modal visible={showHolidayPicker} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ width: '85%', backgroundColor: '#0f172a', borderRadius: 24, padding: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
            <ThemeText variant="h2" style={{ marginBottom: 20 }}>休日設定 (自動割当条件)</ThemeText>
            
            <TouchableOpacity 
              style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }} 
              onPress={() => { setRegHolidaySetting(false); setShowHolidayPicker(false); }}
            >
              <ThemeText color={!regHolidaySetting ? '#38bdf8' : 'white'} style={{ fontSize: 18 }}>設定なし</ThemeText>
              {!regHolidaySetting && <Check size={20} color="#38bdf8" />}
            </TouchableOpacity>

            <TouchableOpacity 
              style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16 }} 
              onPress={() => { setRegHolidaySetting(true); setShowHolidayPicker(false); }}
            >
              <ThemeText color={regHolidaySetting ? '#38bdf8' : 'white'} style={{ fontSize: 18 }}>土日祝休み</ThemeText>
              {regHolidaySetting && <Check size={20} color="#38bdf8" />}
            </TouchableOpacity>

            <TouchableOpacity 
              style={{ marginTop: 24, height: 52, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center' }} 
              onPress={() => setShowHolidayPicker(false)}
            >
              <ThemeText bold>キャンセル</ThemeText>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background, width: '100%', alignItems: 'stretch' },
  header: { padding: SPACING.md, paddingTop: 10, width: '100%', alignItems: 'stretch' },
  input: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    padding: 14,
    color: 'white',
    fontSize: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    width: '100%'
  },
  wardScroll: { paddingVertical: 10, width: '100%' },
  wardTab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.05)', marginRight: 8 },
  wardTabActive: { backgroundColor: '#38bdf8' },
  staffGrid: { gap: 12, width: '100%', alignItems: 'stretch' },
  staffCard: { padding: 16, borderRadius: 24, backgroundColor: 'rgba(30, 41, 59, 0.4)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.03)', width: '100%', alignItems: 'stretch' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16, width: '100%', alignItems: 'center' },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(56, 189, 248, 0.15)', marginRight: 6, marginTop: 4 },
  badgeText: { fontSize: 10, color: '#38bdf8', fontWeight: 'bold' },
  miniBtn: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(56, 189, 248, 0.1)', justifyContent: 'center', alignItems: 'center' },
  iconBtn: { padding: 8, backgroundColor: 'rgba(56, 189, 248, 0.1)', borderRadius: 10 },
  statsGrid: { flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 16, padding: 12, width: '100%' },
  statBox: { flex: 1, alignItems: 'center' },
  modalOverlay: { 
    flex: 1, 
    backgroundColor: 'rgba(0,0,0,0.85)', 
    justifyContent: 'flex-end', 
    alignItems: 'stretch',
    width: '100%'
  },
  calendarModal: { 
    backgroundColor: '#0f172a', 
    borderTopLeftRadius: 28, 
    borderTopRightRadius: 28, 
    padding: 12, 
    paddingTop: 20,
    maxHeight: '92%',
    width: '100%',
    alignSelf: 'stretch'
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, width: '100%' },
  calendarNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, width: '100%' },
  calendarContainer: { width: '100%', marginBottom: 10 },
  calendarRow: { flexDirection: 'row', width: '100%', justifyContent: 'space-between' },
  calendarHeaderCell: { flex: 1, height: 30, justifyContent: 'center', alignItems: 'center' },
  calendarDayCell: { 
    flex: 1, 
    height: 68, 
    justifyContent: 'center', 
    alignItems: 'center', 
    borderRadius: 12, 
    margin: 1,
    borderWidth: 1,
    borderColor: 'transparent',
    minWidth: 0
  },
  calendarDaySelected: { backgroundColor: 'rgba(56, 189, 248, 0.2)', borderColor: '#38bdf8' },
  statusLabelContainer: { height: 18, justifyContent: 'center', alignItems: 'center' },
  statusLabel: { fontSize: 9, fontWeight: 'bold', textAlign: 'center' },
  editorSection: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)', paddingTop: 20 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  typeBtn: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', minWidth: 80, alignItems: 'center' },
  typeBtnActive: { backgroundColor: '#38bdf8' },
  hBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center' },
  hBtnActive: { backgroundColor: '#38bdf8' },
  confirmBtn: { backgroundColor: '#38bdf8', padding: 16, borderRadius: 16, alignItems: 'center' },
  placeholderSection: { height: 100, justifyContent: 'center', alignItems: 'center' },
  adjustBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(56, 189, 248, 0.1)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  deleteBtn: { borderWidth: 1, borderColor: '#ef4444', padding: 16, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
