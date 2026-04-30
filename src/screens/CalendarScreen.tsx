import React, { useState } from 'react';
import { StyleSheet, View, SafeAreaView, ScrollView, TouchableOpacity, Modal, Alert, ActivityIndicator } from 'react-native';
import { ThemeText } from '../components/ThemeText';
import { ThemeCard } from '../components/ThemeCard';
import { COLORS, SPACING, BORDER_RADIUS } from '../theme/theme';
import { ChevronLeft, ChevronRight, Users, Shield, UserMinus, XCircle, Plus, Check, LogOut } from 'lucide-react-native';
import { getDayType, formatDate, getDateStr, normalizeName } from '../utils/dateUtils';
import { cloudStorage } from '../utils/cloudStorage';
import { supabase } from '../utils/supabase';

const getSeasonalTheme = (month: number) => {
  const themes: Record<number, { icon: string, color: string }> = {
    0: { icon: '🎍', color: '#be123c' }, // Jan
    1: { icon: '❄️', color: '#0ea5e9' }, // Feb
    2: { icon: '🌸', color: '#f472b6' }, // Mar
    3: { icon: '🌱', color: '#10b981' }, // Apr
    4: { icon: '🎏', color: '#3b82f6' }, // May
    5: { icon: '☔', color: '#6366f1' }, // Jun
    6: { icon: '🎋', color: '#fbbf24' }, // Jul
    7: { icon: '🌻', color: '#f59e0b' }, // Aug
    8: { icon: '🎑', color: '#8b5cf6' }, // Sep
    9: { icon: '🎃', color: '#f97316' }, // Oct
    10: { icon: '🍁', color: '#ea580c' }, // Nov
    11: { icon: '🎄', color: '#ef4444' }, // Dec
  };
  return themes[month] || { icon: '📅', color: COLORS.primary };
};

interface CalendarScreenProps {
  requests: any[];
  setRequests: (requests: any[] | ((prev: any[]) => any[])) => void;
  weekdayLimit: number;
  holidayLimit: number;
  saturdayLimit: number;
  sundayLimit: number;
  publicHolidayLimit: number;
  profile: any;
  staffList: any[];
  isAdminAuthenticated: boolean;
  monthlyLimits: Record<string, { weekday: number, sat: number, sun: number, pub: number }>;
  staffViewMode?: boolean;
  currentDate: Date;
  setCurrentDate: (d: Date | ((prev: Date) => Date)) => void;
  onDeleteRequest: (id: string) => void;
  onDeleteRequests?: (ids: string[]) => void;
  approveRequest?: (id: string, status: string) => void;
  onLogout?: () => void;
}

// ─────────────────────────────────────────────
// [BUILD: VERSION 55.0 - UNIFIED SYNC LOGIC]
// ─────────────────────────────────────────────

export const CalendarScreen: React.FC<any> = ({ 
  requests, setRequests,
  profile, staffList, isAdminAuthenticated, monthlyLimits, staffViewMode = false,
  currentDate, setCurrentDate, onDeleteRequest, onDeleteRequests, approveRequest,
  onLogout,
  shifts, fetchShifts, isLoadingShifts, // [V53.9] Props から受け取る
  weekdayLimit, saturdayLimit, sundayLimit, publicHolidayLimit
}) => {
  const [selectedDate, setSelectedDate] = useState(currentDate);
  const [isAddStaffModalVisible, setIsAddStaffModalVisible] = useState(false);
  const [selectedStaffToAdd, setSelectedStaffToAdd] = useState<string[]>([]);
  const [selectedType, setSelectedType] = useState('出勤');
  const [hourlyDuration, setHourlyDuration] = useState(1.0);
  const [isTypeModalVisible, setIsTypeModalVisible] = useState(false);

  React.useEffect(() => {
    // タブ切り替えや月変更時に最新データを取得
    if (fetchShifts) fetchShifts();
  }, [fetchShifts, currentDate]);

  React.useEffect(() => {
    // If current selected date is not in the active month, reset it to the 1st of that month
    if (selectedDate.getMonth() !== currentDate.getMonth() || selectedDate.getFullYear() !== currentDate.getFullYear()) {
      setSelectedDate(new Date(currentDate.getFullYear(), currentDate.getMonth(), 1));
    }
  }, [currentDate]);

  const normalize = (n: string) => (n || '').replace(/[\s\u3000\t\n\r()（）/／・.\-_]/g, '').replace(/公費/g, '').toUpperCase();

  // [V55.0] PERFECT DATA SYNC: 全てのスタッフで共通の重複排除・優先順位ロジック
  const requestMap = React.useMemo(() => {
    const map = new Map<string, Map<string, any>>();
    const allData = [...requests, ...shifts].filter(r => {
      return true;
    });
    
    const normalizeLocal = (n: string) => (n || '').replace(/[\s\u3000\t\n\r()（）/／・.\-_]/g, '').replace(/公費/g, '').toUpperCase();
    
    const extractUuid = (idStr: string): string | null => {
      if (!idStr) return null;
      const parts = idStr.split('-');
      return parts.length >= 6 ? parts.slice(1, 6).join('-') : null;
    };

    allData.forEach((r: any) => {
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
          !!(rec.is_manual || rec.isManual) || 
          String(rec.id || '').startsWith('m-') || 
          String(rec.id || '').startsWith('manual-') || 
          String(rec.id || '').startsWith('req-');

        const isOff = (t: string) => ['公休', '年休', '有給休暇', '夏季休暇', '特休', '休暇', '欠勤', '看護休暇', '研修'].includes(t);

        const getTime = (i: any) => {
          const t = i.updatedAt || i.updated_at || i.createdAt || i.created_at || 0;
          return typeof t === 'string' ? new Date(t).getTime() : (typeof t === 'number' ? t : 0);
        };

        let isBetter = false;
        if (!existing) {
          isBetter = true;
        } else {
          const isManNew = isManualEntry(r);
          const wasManOld = isManualEntry(existing);
          const isOffNew = isOff(r.type);
          const isOffOld = isOff(existing.type);

          if (isManNew && !wasManOld) {
            isBetter = true; // 手動は常に自動を上書き
          } else if (!isManNew && wasManOld) {
            isBetter = false; // 自動は手動を上書きできない
          } else if (isManNew && wasManOld) {
            isBetter = getTime(r) > getTime(existing); // 共に手動なら新しい方を優先
          } else {
            // 共に自動の場合、安全のため公休（休み）を優先
            isBetter = isOffNew && !isOffOld;
          }
        }

        if (isBetter) {
          dayMap.set(key, r);
        }
      });
    });

    return map;
  }, [requests, shifts]);

  const isPrivileged = ((profile?.role?.includes('シフト管理者') || profile?.role?.includes('開発者')) && !staffViewMode) || (isAdminAuthenticated && !staffViewMode);

    const getDetailedDayInfo = (date: Date) => {
      const dateStr = getDateStr(date); // YYYY-MM-DD
      const dayType = getDayType(date);

      const working: any[] = [];
      const off: any[] = [];

      (staffList || []).forEach(staff => {
        if (!staff || !staff.name) return;
        
        const status = staff.status?.trim() || '通常';
        const isInactive = status === '長期休暇' || status === '入職前';
        if (isInactive) return;

        const jobType = staff.jobType || staff.profession || '';
        const placement = staff.placement || '';
        const role = staff.role || staff.position || '';

        const isHomeVisit = placement === '訪問' || placement === '訪問リハ' || role === '訪問リハ';
        const isAssistant = jobType === '助手' || role === '助手';

        const dayMap = requestMap.get(dateStr);
        const sId = String(staff.id || '').trim();
        const sName = normalize(staff.name || '');
        
        // [V57.3] ID優先でルックアップ
        const singleReq = (sId && dayMap?.get(sId)) || (sName && dayMap?.get(sName));
        const userRequests = singleReq ? [singleReq] : [];
        
        // 稼働としてカウントする種別の定義
        const isWorkType = (t: string) => {
          if (!t) return false;
          if (t === '出勤' || t === '日勤') return true; 
          if (t.includes('時')) return true; 
          if (t.includes('振')) return true; 
          if (t.includes('午前休') || t.includes('午後休')) return true;
          return false;
        };

        // 休暇系種別の定義
        const isOffType = (t: string) => {
          if (!t) return false;
          // [V54.6] 研修も「出勤人数（分母）」に含めない休みとして扱う
          if (['公休', '年休', '有給休暇', '夏季休暇', '特休', '休暇', '欠勤', '看護休暇', '研修'].includes(t)) return true;
          return false;
        };

        const approvedReqs = userRequests.filter(r => r.status === 'approved');
        const pendingReq = userRequests.find(r => r.status === 'pending');

        if (approvedReqs.length > 0) {
          const offReq = approvedReqs.find(r => isOffType(r.type));
          const workReq = approvedReqs.find(r => isWorkType(r.type));

          if (offReq) {
            off.push({ staff, type: offReq.type, requestId: offReq.id, isManual: !!(offReq.is_manual || offReq.isManual), isHomeVisit, isAssistant, status: 'approved', details: offReq.details });
          } else if (workReq) {
            working.push({ staff, type: workReq.type, requestId: workReq.id, isManual: !!(workReq.is_manual || workReq.isManual), isHomeVisit, isAssistant, status: 'approved', details: workReq.details });
          } else {
            off.push({ staff, type: '公休', requestId: `auto-${staff.id}`, isManual: false, isHomeVisit, isAssistant, status: 'approved' });
          }
        } else if (pendingReq) {
          if (isWorkType(pendingReq.type)) {
            working.push({ staff, type: pendingReq.type, requestId: pendingReq.id, isManual: true, isHomeVisit, isAssistant, status: 'pending', details: pendingReq.details });
          } else {
            off.push({ staff, type: pendingReq.type, requestId: pendingReq.id, isManual: true, isHomeVisit, isAssistant, status: 'pending', details: pendingReq.details });
          }
        } else {
          // [V54.9] デフォルトロジック：平日は出勤、休日は公休
          const isScheduledToWork = dayType === 'weekday';
          
          if (isScheduledToWork) {
            working.push({ staff, type: '出勤', requestId: `auto-${staff.id}`, isManual: false, isHomeVisit, isAssistant, status: 'approved' });
          } else {
            off.push({ staff, type: '公休', requestId: `auto-${staff.id}`, isManual: false, isHomeVisit, isAssistant, status: 'approved' });
          }
        }
      });

      return { working, off };
    };

  const { working: workingStaff, off: offStaff } = getDetailedDayInfo(selectedDate);
  const currentDayType = getDayType(selectedDate);
  const monthStr = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}`;
  const currentMonthly = monthlyLimits[monthStr] || { weekday: weekdayLimit, sat: saturdayLimit, sun: sundayLimit, pub: publicHolidayLimit };
  const rawLimit = currentDayType === 'weekday' ? currentMonthly.weekday : 
                   currentDayType === 'sat' ? currentMonthly.sat :
                   currentDayType === 'sun' ? currentMonthly.sun :
                   currentMonthly.pub;
  const currentLimit = Number(rawLimit) || (currentDayType === 'weekday' ? 12 : 1);

  const handleDeleteShift = async (staffName: string, requestId: string, isManual: boolean, wasWorking: boolean) => {
    Alert.alert(
      'シフトの解除・調整',
      `${staffName} さんの当日の予定を削除または変更しますか？`,
      [
        { text: 'キャンセル', style: 'cancel' },
        { 
          text: '実行する', 
          style: 'destructive', 
          onPress: async () => {
            const dateStr = getDateStr(selectedDate);
            const dayType = getDayType(selectedDate);
            
            // 1. 対象スタッフ・対象日の「手動リクエスト」をすべて特定
            const manualRequestIds = requests
              .filter(r => r.staffName?.trim() === staffName.trim() && r.date === dateStr && !String(r.id).startsWith('auto-'))
              .map(r => r.id);

            // 2. クラウド/グローバルステートから一括削除
            if (manualRequestIds.length > 0) {
              if (onDeleteRequests) {
                await onDeleteRequests(manualRequestIds);
              } else {
                for (const id of manualRequestIds) {
                  await onDeleteRequest(id);
                }
              }
            }

            // 3. shiftsテーブルからも削除
            const staff = staffList.find(s => normalizeName(s.name) === normalizeName(staffName));
            if (staff) {
              await supabase.from('shifts').delete()
                .eq('staff_id', staff.id)
                .eq('date', dateStr)
                .eq('is_manual', true);
            }

            // 4. ローカルステートの更新
            setRequests((prev: any[]) => prev.filter(r => !(r.staffName?.trim() === staffName.trim() && r.date === dateStr)));

            Alert.alert('完了', 'シフトの解除・調整が完了しました。');
            fetchShifts();
          }
        }
      ]
    );
  };

  const handleAddStaff = async (staffNames: string[]) => {
    const dateStr = getDateStr(selectedDate);

    if (selectedType === '空欄') {
      const idsToDelete = requests
        .filter(r => r.date === dateStr && staffNames.includes(r.staffName?.trim()) && !String(r.id).startsWith('auto-'))
        .map(r => r.id);
      
      if (idsToDelete.length > 0) {
        if (onDeleteRequests) {
          await onDeleteRequests(idsToDelete);
        } else {
          for (const id of idsToDelete) {
            await onDeleteRequest(id);
          }
        }
        
        setRequests((prev: any[]) => prev.filter(r => !idsToDelete.includes(r.id)));
        Alert.alert('完了', 'シフトをクリアしました。');
      }

      // [V60.9] shiftsテーブルからも該当スタッフのその日の手動シフトを確実に削除する
      const staffs = staffNames.map(name => staffList.find(s => normalizeName(s.name) === normalizeName(name)));
      const staffIds = staffs.filter(Boolean).map(s => s.id);
      if (staffIds.length > 0) {
        await supabase.from('shifts').delete()
          .in('staff_id', staffIds)
          .eq('date', dateStr)
          .eq('is_manual', true);
      }

      setIsAddStaffModalVisible(false);
      setIsTypeModalVisible(false);
      setSelectedStaffToAdd([]);
      fetchShifts(); // [V60.9] 削除後も再取得を呼ぶ
      return;
    }

    const newReqs = staffNames.map(nameOrId => {
      const staff = staffList.find(s => s.id === nameOrId || normalizeName(s.name) === normalizeName(nameOrId));
      const finalName = staff ? staff.name : nameOrId;
      const sId = staff ? staff.id : `manual-${Date.now()}`;
      // [V60.9] 確定的ID（m-ID-DATE）を使用することで、UPSERT時に以前の手動シフト（公休など）を上書きする
      return {
        id: `m-${sId}-${dateStr}`,
        staffName: finalName,
        date: dateStr,
        type: selectedType,
        status: 'approved',
        reason: '管理者による調整',
        isManual: true, // リクエストテーブル用
        details: { 
          note: '手動割当',
          duration: (selectedType === '時間休' || selectedType === '時間給' || selectedType === '特休' || selectedType === '看護休暇') ? hourlyDuration : undefined
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(), // [V61.0] 優先度判定のためにupdatedAtを付与
      };
    });

    // [V61.4] requests と shifts 両方のテーブルを更新して状態の不整合を防ぐ
    for (const req of newReqs) {
      // 確実なマッチングのために、UUIDのチェックも追加
      const extractedId = extractUuid(req.id);
      const staff = staffList.find(s => s.id === extractedId || normalizeName(s.name) === normalizeName(req.staffName));
      if (staff) {
        // 1. shiftsテーブルの更新（updated_atカラムは存在しないため除外）
        await supabase.from('shifts').upsert({
          id: req.id,
          staff_id: staff.id,
          staff_name: staff.name,
          date: req.date,
          type: req.type,
          status: 'approved',
          is_manual: true,
          details: req.details
        });

        // 2. requestsテーブルの更新（同期割れ防止）
        await supabase.from('requests').upsert({
          id: req.id,
          staff_name: req.staffName,
          date: req.date,
          type: req.type,
          status: 'approved',
          reason: req.reason,
          details: { ...req.details, isManual: true, updatedAt: req.updatedAt },
          is_manual: true
        });
      }
    }

    setRequests((prev: any[]) => [...prev, ...newReqs]);
    setIsAddStaffModalVisible(false);
    setIsTypeModalVisible(false);
    setSelectedStaffToAdd([]);
    setSelectedType('出勤');
    fetchShifts(); // 最新の状態を再取得
  };

  const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();

  const daysInMonth = getDaysInMonth(currentDate.getFullYear(), currentDate.getMonth());
  const firstDayOfMonth = getFirstDayOfMonth(currentDate.getFullYear(), currentDate.getMonth());

  const days: (number | null)[] = [];
  for (let i = 0; i < firstDayOfMonth; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);

  const renderCalendar = () => {
    const rows: any[] = [];
    let cells: any[] = [];

    days.forEach((day, i) => {
      if (i > 0 && i % 7 === 0) {
        rows.push(<View key={`row-${i}`} style={styles.calendarRow}>{cells}</View>);
        cells = [];
      }

      const isSelected = day === selectedDate.getDate() && currentDate.getMonth() === selectedDate.getMonth() && currentDate.getFullYear() === selectedDate.getFullYear();
      const isToday = day === new Date().getDate() && 
                      currentDate.getMonth() === new Date().getMonth() && 
                      currentDate.getFullYear() === new Date().getFullYear();
      
      const d = day ? new Date(currentDate.getFullYear(), currentDate.getMonth(), day) : null;
      const dayType = d ? getDayType(d) : 'weekday';
      // currentDate ベースの monthStr を使用（表示月と一致させるため）
      const cellMonthStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
      const monthly = monthlyLimits[cellMonthStr] || {};
      const rawLimit = dayType === 'weekday' ? (monthly.weekday ?? weekdayLimit) : 
                    dayType === 'sat' ? (monthly.sat ?? saturdayLimit) :
                    dayType === 'sun' ? (monthly.sun ?? sundayLimit) :
                    (monthly.pub ?? publicHolidayLimit);
      const limit = Number(rawLimit) || (dayType === 'weekday' ? 12 : 1);

      let dateColor = COLORS.text;
      if (dayType === 'sun' || dayType === 'holiday') dateColor = '#ef4444';
      if (dayType === 'sat') dateColor = '#3b82f6';

      let workingCount = 0;
      let holidayWorkers: any[] = [];
      let offWorkers: any[] = [];
      if (day) {
        const info = getDetailedDayInfo(d!);
        workingCount = info.working.filter(w => !w.isHomeVisit && !w.isAssistant).length;

        // 名前＋種別のラベルを生成するヘルパー
        const getDisplayLabel = (item: any) => {
          const name = item.staff.name;
          const type = item.type || '';
          if (type === '時間休' || type === '時間給') return `${name}(${item.details?.duration || '?'}h)`;
          if (type === '午前休') return `${name}(前)`;
          if (type === '午後休') return `${name}(後)`;
          if (type.includes('振替') || type.includes('振休')) return `${name}(振)`;
          if (type === '年休' || type === '有給休暇') return `${name}(年)`;
          if (type === '特休') return `${name}(特)`;
          if (type === '公休') return name;
          return `${name}(${type.substring(0, 1)})`;
        };

        if (dayType !== 'weekday') {
          holidayWorkers = info.working.filter(w => !w.isHomeVisit && !w.isAssistant).map(w => getDisplayLabel(w));
        } else {
          // [V67.0] 2026年6月以降は平日でも「公休」を含めてすべて表示する
          const isAfterJune2026 = (d!.getFullYear() > 2026) || (d!.getFullYear() === 2026 && d!.getMonth() >= 5);
          offWorkers = info.off
            .filter(o => isAfterJune2026 || o.type !== '公休')
            .map(o => getDisplayLabel(o));
        }
      }

      const isUnderLimit = workingCount < limit;

      cells.push(
        <TouchableOpacity 
          key={`day-${i}`} 
          style={[
            styles.dayCell, 
            isSelected && styles.selectedDay, 
            isToday && !isSelected && styles.todayCell,
            (!isSelected && !!day && isUnderLimit) ? { backgroundColor: 'rgba(59, 130, 246, 0.05)', borderRadius: BORDER_RADIUS.sm } : null
          ]}
          onPress={() => day && setSelectedDate(new Date(currentDate.getFullYear(), currentDate.getMonth(), day))}
          disabled={!day}
        >
          {day && (
            <>
              <ThemeText 
                variant="caption" 
                style={{ color: isSelected ? COLORS.background : dateColor, fontWeight: isSelected || isToday ? 'bold' : 'normal', fontSize: 10 }}
              >
                {day}
              </ThemeText>

              <ThemeText 
                variant="caption" 
                style={[
                  styles.dayCount, 
                  { color: isSelected ? COLORS.background : (workingCount > limit ? '#ef4444' : isUnderLimit ? '#3b82f6' : COLORS.textSecondary) }
                ]}
              >
                {dayType === 'weekday' ? workingCount : `${workingCount}/${limit}`}
              </ThemeText>

              {(holidayWorkers.length > 0 || offWorkers.length > 0) && (
                <View style={styles.holidayWorkersBox}>
                  {(dayType === 'weekday' ? offWorkers : holidayWorkers).slice(0, 3).map((name, idx) => (
                    <ThemeText 
                      key={idx} 
                      style={[
                        styles.holidayWorkerName, 
                        isSelected && { color: 'white' },
                        dayType === 'weekday' && { color: '#ef4444' } // 休暇者は赤字で表示
                      ]} 
                      numberOfLines={1}
                      adjustsFontSizeToFit
                    >
                      {name}
                    </ThemeText>
                  ))}
                  {(dayType === 'weekday' ? offWorkers : holidayWorkers).length > 3 && (
                    <ThemeText style={[styles.holidayWorkerName, { opacity: 0.6, fontSize: 8 }, isSelected && { color: 'white' }]}>
                      他{(dayType === 'weekday' ? offWorkers : holidayWorkers).length - 3}名
                    </ThemeText>
                  )}
                </View>
              )}
            </>
          )}
        </TouchableOpacity>
      );
    });

    if (cells.length > 0) {
      while (cells.length < 7) cells.push(<View key={`empty-${cells.length}`} style={styles.dayCell} />);
      rows.push(<View key="last-row" style={styles.calendarRow}>{cells}</View>);
    }
    return rows;
  };

  if (!profile) {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: 20 }]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <ThemeText style={{ marginTop: 24, marginBottom: 8 }} variant="h2">プロフィールを取得中...</ThemeText>
        <ThemeText style={{ marginBottom: 40, color: COLORS.textSecondary, textAlign: 'center' }}>
          名簿情報との照合を行っています。{"\n"}しばらくお待ちください。
        </ThemeText>
        <TouchableOpacity 
          style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#ef4444' }}
          onPress={() => onLogout ? onLogout() : supabase.auth.signOut()}
        >
          <ThemeText color="#ef4444" bold>ログアウトして戻る</ThemeText>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 160 }} showsVerticalScrollIndicator={true}>
        <View style={styles.header}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View>
              <ThemeText variant="h1">カレンダー [V70.0]</ThemeText>
              <ThemeText variant="caption">[BUILD: VERSION 70.0 - LOGGING FORCED]</ThemeText>
            </View>
            <TouchableOpacity 
              style={{ padding: 8 }} 
              onPress={() => onLogout ? onLogout() : supabase.auth.signOut()}
            >
              <LogOut size={24} color={COLORS.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

      <ThemeCard style={styles.calendarContainer}>
        <View style={styles.monthHeader}>
          <TouchableOpacity onPress={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1))}>
            <ChevronLeft color={COLORS.text} size={24} />
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <ThemeText style={{ fontSize: 24 }}>{getSeasonalTheme(currentDate.getMonth()).icon}</ThemeText>
            <ThemeText variant="h2">{currentDate.getFullYear()}年 {currentDate.getMonth() + 1}月</ThemeText>
          </View>
          <TouchableOpacity onPress={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1))}>
            <ChevronRight color={COLORS.text} size={24} />
          </TouchableOpacity>
        </View>

        <View style={styles.weekDays}>
          {['日', '月', '火', '水', '木', '金', '土'].map((d, i) => (
            <ThemeText key={d} variant="caption" style={[styles.weekDayText, i === 0 && { color: '#ef4444' }, i === 6 && { color: '#3b82f6' }]}>{d}</ThemeText>
          ))}
        </View>

        <View style={styles.calendarGrid}>
          {renderCalendar()}
        </View>
      </ThemeCard>

      <View style={styles.detailScroll}>
        <ThemeCard style={styles.detailCard}>
          <View style={styles.detailHeader}>
            <ThemeText variant="h2">{selectedDate.getMonth() + 1}月{selectedDate.getDate()}日の詳細</ThemeText>
          </View>
          <View style={styles.detailRow}>
            <View style={styles.detailItem}>
              <View style={styles.detailTitleRow}><Users size={16} color={COLORS.primary} /><ThemeText variant="label" style={{ marginLeft: 8 }}>現在の出勤数 (全員)</ThemeText></View>
              <ThemeText variant="h1">
                {workingStaff.length}
                <ThemeText variant="caption"> 名</ThemeText>
              </ThemeText>
            </View>
          </View>

          {/* 休日のみ詳細リストを表示する */}
          {/* 詳細は常に表示 */}
          {true && (
            <>
              {/* Working Staff Section */}
              <View style={styles.leavesSection}>
                <View style={styles.sectionDivider} />
                <View style={styles.leavesTitleRow}><Users size={16} color={COLORS.primary} /><ThemeText variant="label" style={{ color: COLORS.primary, marginLeft: 8 }}>出勤者一覧</ThemeText></View>
                {workingStaff.length > 0 ? workingStaff.map((item, idx) => (
                  <View key={idx} style={styles.leafItem}>
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                      <ThemeText variant="caption" bold>
                        {item.staff.name} {item.isHomeVisit ? '[訪問リハ]' : (item.isAssistant ? '[助手]' : `[${item.staff.jobType || item.staff.profession}]`)}
                      </ThemeText>
                      <ThemeText variant="caption" style={{ color: COLORS.textSecondary, marginLeft: 8 }} numberOfLines={1}>
                        ({item.type}{item.isHomeVisit ? ' / 訪問' : (item.isAssistant ? ' / 助手' : '')})
                        {item.details?.startTime && <ThemeText variant="caption" style={{ color: COLORS.accent, fontWeight: 'bold' }}> {item.details.startTime}-{item.details.endTime}</ThemeText>}
                        {(!item.details?.startTime && item.details?.duration) && <ThemeText variant="caption" style={{ color: COLORS.accent, fontWeight: 'bold' }}> {item.details.duration}h</ThemeText>}
                        {item.status === 'pending' && <ThemeText variant="caption" style={{ color: '#f59e0b', fontWeight: 'bold' }}> [申請中]</ThemeText>}
                      </ThemeText>
                    </View>
                    {(isPrivileged || (profile && item.staff && normalizeName(profile.name) === normalizeName(item.staff.name))) && (
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        {item.status === 'pending' && (
                          <TouchableOpacity 
                            style={[styles.smallActionBtn, { borderColor: COLORS.primary, backgroundColor: 'rgba(56, 189, 248, 0.05)' }]}
                            onPress={() => item.requestId && approveRequest && approveRequest(item.requestId, 'approved')}
                          >
                            <Check size={14} color={COLORS.primary} />
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                  </View>
                )) : (
                  <ThemeText variant="caption" style={{ color: COLORS.textSecondary, marginTop: 4, marginLeft: 8 }}>出勤予定なし</ThemeText>
                )}
              </View>
            {/* Off Staff Section */}
          <View style={styles.leavesSection}>
            <View style={styles.sectionDivider} />
            <View style={styles.leavesTitleRow}><UserMinus size={16} color="#ef4444" /><ThemeText variant="label" style={{ color: '#ef4444', marginLeft: 8 }}>休暇・休日</ThemeText></View>
            {offStaff.length > 0 ? offStaff.map((item, idx) => (
                <View key={idx} style={styles.leafItem}>
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                    <ThemeText 
                      variant="caption" 
                      bold={item.type !== '公休' && item.type !== '年休'} 
                      style={{ color: (item.type !== '公休' && item.type !== '年休') ? COLORS.primary : COLORS.textSecondary }}
                    >
                      {item.staff.name} {item.isHomeVisit ? '[訪問リハ]' : (item.isAssistant ? '[助手]' : `[${item.staff.jobType || item.staff.profession}]`)}
                    </ThemeText>
                    <ThemeText 
                      variant="caption" 
                      bold={item.type !== '公休' && item.type !== '年休'}
                      style={{ marginLeft: 8, color: (item.type !== '公休' && item.type !== '年休') ? COLORS.primary : COLORS.textSecondary }} 
                      numberOfLines={1}
                    >
                      ({item.type})
                      {item.details?.startTime && <ThemeText variant="caption" style={{ color: COLORS.accent }}> {item.details.startTime}-{item.details.endTime}</ThemeText>}
                      {(!item.details?.startTime && item.details?.duration) && <ThemeText variant="caption" style={{ color: COLORS.accent }}> {item.details.duration}h</ThemeText>}
                      {item.status === 'pending' && <ThemeText variant="caption" style={{ color: '#f59e0b', fontWeight: 'bold' }}> [申請中]</ThemeText>}
                    </ThemeText>
                  </View>
                  {(isPrivileged || (profile && item.staff && normalizeName(profile.name) === normalizeName(item.staff.name))) && (
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {item.status === 'pending' && (
                        <TouchableOpacity 
                          style={[styles.smallActionBtn, { borderColor: COLORS.primary, backgroundColor: 'rgba(56, 189, 248, 0.05)' }]}
                          onPress={() => item.requestId && approveRequest && approveRequest(item.requestId, 'approved')}
                        >
                          <Check size={14} color={COLORS.primary} />
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>
            )) : (
              <ThemeText variant="caption" style={{ color: COLORS.textSecondary, marginTop: 4, marginLeft: 8 }}>休暇者なし</ThemeText>
            )}
          </View>
            </>
          )}
        </ThemeCard>
      </View>
      </ScrollView>

      {/* Staff Assignment Modal */}
      <Modal visible={isAddStaffModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View>
                <ThemeText variant="h2">スタッフを出勤に割り当て</ThemeText>
                <ThemeText variant="caption">{formatDate(selectedDate)}</ThemeText>
              </View>
              <TouchableOpacity onPress={() => setIsAddStaffModalVisible(false)}>
                <XCircle color={COLORS.textSecondary} size={24} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 400 }}>
              {staffList
                .filter(s => {
                  const mStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
                  const isLongTerm = s.status === '長期休暇' || s.status === '入職前';
                  const isNoHoliday = (getDayType(selectedDate) !== 'weekday') && (s.monthlyNoHoliday?.[mStr] ?? s.noHoliday);
                  // [V61.3] 既に手動データが存在していても、何度でも上書き修正できるように除外フィルターを撤廃
                  
                  return !isLongTerm && !isNoHoliday;
                })
                .map((staff, idx) => {
                  const isSelected = selectedStaffToAdd.includes(staff.name);
                  return (
                    <TouchableOpacity 
                      key={staff.id || idx} 
                      style={[styles.staffSelectOption, isSelected && styles.staffSelectOptionActive]}
                      onPress={() => {
                        if (isSelected) {
                          setSelectedStaffToAdd(selectedStaffToAdd.filter(n => n !== staff.name));
                        } else {
                          setSelectedStaffToAdd([...selectedStaffToAdd, staff.name]);
                        }
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <ThemeText variant="body" bold={!isSelected} color={isSelected ? 'white' : COLORS.text}>{staff.name}</ThemeText>
                        <ThemeText variant="caption" color={isSelected ? 'white' : COLORS.textSecondary}>{staff.placement} / {staff.jobType || staff.profession}</ThemeText>
                      </View>
                      {isSelected && <Check color="white" size={20} />}
                    </TouchableOpacity>
                  );
                })}
            </ScrollView>

            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={[styles.modalButton, styles.modalCancelButton]} 
                onPress={() => setIsAddStaffModalVisible(false)}
              >
                <ThemeText bold>キャンセル</ThemeText>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.modalButton, styles.modalSubmitButton]} 
                onPress={() => setIsTypeModalVisible(true)}
                disabled={selectedStaffToAdd.length === 0}
              >
                <ThemeText bold color="white">次へ ({selectedStaffToAdd.length}名)</ThemeText>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Type Selection Modal */}
      <Modal visible={isTypeModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { padding: 24 }]}>
            <View style={{ marginBottom: 20 }}>
              <ThemeText variant="h2">種別を選択</ThemeText>
              <ThemeText variant="caption">{selectedStaffToAdd.join(', ')}</ThemeText>
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
              {['出勤', '午前休', '午後休', '時間休', '午前振替', '午後振替', '公休', '特休', '年休', '看護休暇', '空欄'].map(t => (
                <TouchableOpacity 
                  key={t}
                  style={[
                    { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, backgroundColor: 'rgba(255,255,255,0.05)' },
                    selectedType === t && { backgroundColor: COLORS.primary, borderColor: COLORS.primary }
                  ]}
                  onPress={() => setSelectedType(t)}
                >
                  <ThemeText color={selectedType === t ? 'white' : COLORS.text} bold={selectedType === t}>{t}</ThemeText>
                </TouchableOpacity>
              ))}
            </View>

            {(selectedType === '時間休' || selectedType === '時間給' || selectedType === '特休' || selectedType === '看護休暇') && (
              <View style={{ marginBottom: 20 }}>
                <ThemeText variant="label" style={{ marginBottom: 8 }}>時間設定 (15分単位)</ThemeText>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                  <TouchableOpacity onPress={() => setHourlyDuration(Math.max(0.25, hourlyDuration - 0.25))} style={styles.addStaffBtn}>
                    <ThemeText bold>-</ThemeText>
                  </TouchableOpacity>
                  <ThemeText variant="h2" color={COLORS.primary}>{hourlyDuration.toFixed(2)}h</ThemeText>
                  <TouchableOpacity onPress={() => setHourlyDuration(Math.min(8.0, hourlyDuration + 0.25))} style={styles.addStaffBtn}>
                    <ThemeText bold>+</ThemeText>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <View style={styles.modalButtons}>
              <TouchableOpacity style={[styles.modalButton, styles.modalCancelButton]} onPress={() => setIsTypeModalVisible(false)}>
                <ThemeText>戻る</ThemeText>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalButton, styles.modalSubmitButton]} onPress={() => handleAddStaff(selectedStaffToAdd)}>
                <ThemeText bold color="white">確定する</ThemeText>
              </TouchableOpacity>
            </View>
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
  calendarContainer: { 
    marginVertical: SPACING.md, 
    padding: SPACING.md, 
    width: '100%',
    alignItems: 'stretch'
  },
  monthHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.lg, width: '100%' },
  weekDays: { flexDirection: 'row', marginBottom: SPACING.sm, width: '100%' },
  weekDayText: { flex: 1, textAlign: 'center', color: COLORS.textSecondary },
  calendarGrid: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)', width: '100%' },
  calendarRow: { flexDirection: 'row', height: 110, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)', width: '100%' },
  dayCell: { flex: 1, padding: 2, alignItems: 'center', justifyContent: 'flex-start' },
  selectedDay: { backgroundColor: COLORS.primary, borderRadius: BORDER_RADIUS.md },
  todayCell: { backgroundColor: 'rgba(56, 189, 248, 0.1)', borderRadius: BORDER_RADIUS.md, borderWidth: 1, borderColor: COLORS.primary },
  dayCount: { fontSize: 9.5, marginTop: 1, fontWeight: 'bold' },
  holidayWorkersBox: { width: '100%', marginTop: 3, paddingHorizontal: 2, alignItems: 'center', gap: 2 },
  holidayWorkerName: { fontSize: 10, color: COLORS.text, fontWeight: 'bold', width: '100%', textAlign: 'center' },
  requestBadge: { backgroundColor: '#ef4444', borderRadius: 4, paddingHorizontal: 2, paddingVertical: 1, marginTop: 1, alignItems: 'center', justifyContent: 'center', width: '90%' },
  requestText: { color: 'white', fontSize: 7, fontWeight: 'bold', textAlign: 'center' },
  detailScroll: { paddingHorizontal: SPACING.md, width: '100%' },
  detailCard: { padding: SPACING.md, marginBottom: 100, width: '100%' },
  detailHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SPACING.md, width: '100%' },
  detailRow: { flexDirection: 'row', gap: SPACING.lg, marginTop: 8, width: '100%' },
  detailTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  detailItem: { flex: 1 },
  leavesSection: { marginTop: SPACING.md, width: '100%' },
  sectionDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.05)', marginBottom: SPACING.md, width: '100%' },
  leavesTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.sm },
  leafItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 4, paddingLeft: 8, width: '100%' },
  addStaffBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(56, 189, 248, 0.1)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: BORDER_RADIUS.sm },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 20, width: '100%' },
  modalContent: { backgroundColor: COLORS.card, borderRadius: 24, padding: 24, width: '100%', borderWidth: 1, borderColor: COLORS.border },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, width: '100%' },
  staffSelectOption: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)', width: '100%' },
  staffSelectOptionActive: { backgroundColor: COLORS.primary, borderRadius: 8 },
  modalButtons: { flexDirection: 'row', gap: SPACING.md, marginTop: 24, width: '100%' },
  modalButton: { flex: 1, height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  modalCancelButton: { backgroundColor: 'transparent', borderWidth: 1, borderColor: COLORS.border },
  modalSubmitButton: { backgroundColor: COLORS.primary },
  smallActionBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, borderWidth: 1, backgroundColor: 'rgba(239, 68, 68, 0.05)', zIndex: 10 },
  finishBtn: { backgroundColor: COLORS.primary, height: 54, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 4, zIndex: 20, width: '100%' },
});
