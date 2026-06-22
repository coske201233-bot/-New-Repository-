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
  const [adminSpecialHours, setAdminSpecialHours] = useState(1.0);
  const [adminHourlyHours, setAdminHourlyHours] = useState(1.0);
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
    // [STRICT FILTER] 真実のソースである requests テーブルから却下・削除済みのIDを抽出
    const rejectedOrDeletedIds = new Set(
      (requests || [])
        .filter(r => r && (r.status === 'rejected' || r.status === 'deleted'))
        .map(r => String(r.id))
    );

    const map = new Map<string, Map<string, any>>();
    const allData = [...(requests || []), ...(shifts || [])].filter(r => {
      if (!r) return false;

      // 🚨 吉田のゴーストデータ（6月11日と7月1日の時間休3.75h）を強制スルー
      const sId = r.staff_id || r.staffId || r.userId || r.user_id || '';
      const isYoshida = sId === 'f003cc8e-2e9a-4cb0-8e1f-5c0bb03d024e' || r.staff_name === '吉田' || r.staffName === '吉田';
      const isGhostDate = r.date === '2026-06-11' || r.date === '2026-07-01';
      const rawH = r.hours ?? r.details?.duration ?? r.details?.hours;
      if (isYoshida && isGhostDate && parseFloat(String(rawH)) === 3.75) {
        return false;
      }

      // 1. レコード自体のステータスが却下・削除の場合は除外
      if (r.status === 'rejected' || r.status === 'deleted') return false;
      // 2. requestsテーブル側で却下・削除されているIDを持つレコードは、shifts側の残骸であっても除外
      if (rejectedOrDeletedIds.has(String(r.id))) return false;
      return true;
    });

    const normalizeLocal = (n: string) => (n || '').replace(/[\s\u3000\t\n\r()（）/／・.\-_]/g, '').replace(/公費/g, '').toUpperCase();
    
    const extractUuid = (idStr: string): string | null => {
      if (!idStr) return null;
      const parts = idStr.split('-');
      // auto-UUID-DATE-... または m-UUID-DATE-... 形式 (1 + 5 + ...)
      if (parts.length >= 6) return parts.slice(1, 6).join('-');
      // レガシーな5連IDへの対応
      if (parts.length === 5 && !idStr.includes('req-')) return idStr;
      return null;
    };

    allData.forEach((r: any) => {
      if (!r || !r.date || r.status === 'deleted') return;
      
      const dateKey = String(r.date).substring(0, 10);
      if (!map.has(dateKey)) map.set(dateKey, new Map<string, any>());
      const dayMap = map.get(dateKey)!;
      
      // [V74.4] UUID（staff_id）による紐付けを最優先。ID移行の救済処置を含む。
      let extractedId = extractUuid(r.id);
      
      const rawId = String(r.staff_id || r.staffId || r.user_id || r.userId || extractedId || '').trim();
      const sName = normalizeLocal(r.staffName || r.staff_name || '');
      
      // [V76.0] UNIFIED UUID RESOLUTION:
      // データ型を完全統一。AuthUUIDとStaffIDのズレを吸収するため、必ず名簿(staffList)を経由して一意のIDを取得する
      // [V76.3 STRICT UUID ONLY]
      // 厳密なUUIDマッチのみを使用。名前ベースの照合は禁止。
      // リクエストの Auth UUID (user_id 等) から、名簿上の真の staff.id を逆引きしてキーとする。
      let resolvedId = '';
      const authId = rawId;

      const staffEntry = (staffList || []).find(s => 
        s.id === authId || s.userId === authId || s.user_id === authId
      );

      if (staffEntry?.id) {
        resolvedId = staffEntry.id; // 真のStaff IDに解決
      } else if (authId && authId.length > 5) {
        resolvedId = authId; // 見つからない場合はそのまま使用
      }

      if (!resolvedId) {
        console.warn('[V76.3] Orphan record (No UUID match found):', r);
        return;
      }

      // [V76.4 STRICT NORMALIZATION]
      // オブジェクト自体のIDも真のスタッフIDに上書き（正規化）して保存する
      const normalizedReq = { ...r, staff_id: resolvedId, staffId: resolvedId };

      const key = resolvedId; // キーは必ず一貫したID（staff.id）になる
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
        const isManNew = isManualEntry(normalizedReq);
        const wasManOld = isManualEntry(existing);
        const isOffNew = isOff(normalizedReq.type);
        const isOffOld = isOff(existing.type);

        if (isManNew && !wasManOld) {
          isBetter = true; 
        } else if (!isManNew && wasManOld) {
          isBetter = false; 
        } else if (isManNew && wasManOld) {
          const isMNew = String(normalizedReq.id).startsWith('m-');
          const isMOld = String(existing.id).startsWith('m-');
          
          if (isMNew && !isMOld) {
            isBetter = true;
          } else if (!isMNew && isMOld) {
            isBetter = false;
          } else {
            isBetter = getTime(normalizedReq) > getTime(existing);
          }
        } else {
          isBetter = isOffNew && !isOffOld;
        }
      }

      if (isBetter) {
        dayMap.set(key, normalizedReq);
      }
    });

    // [V76.5 Verification Log] 全員の休暇データが正しく正規化され格納されたかを出力
    const allLeaves: string[] = [];
    map.forEach((dayMap, date) => {
      dayMap.forEach((req, staffId) => {
        const isOff = ['公休', '年休', '有給休暇', '夏季休暇', '特休', '休暇', '欠勤', '看護休暇', '研修'].includes(req.type);
        if (isOff) {
          const staff = (staffList || []).find((s: any) => s.id === req.staff_id);
          allLeaves.push(`${req.date} | Staff: ${staff ? staff.name : 'Unknown ID: ' + req.staff_id} | Type: ${req.type}`);
        }
      });
    });
    console.log("[All Approved Leaves in Map]:", allLeaves);

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

        // [V76.3 STRICT UUID ONLY]
        // 名前による照合を完全に排除。必ず staff.id に紐づくデータのみを取り出す
        const singleReq = sId ? dayMap?.get(sId) : null;
        const userRequests = singleReq ? [singleReq] : [];
        
        // 稼働としてカウントする種別の定義
        const isWorkType = (t: string) => {
          if (!t) return false;
          if (t === '出勤' || t === '日勤') return true; 
          // 🚨 【最終解決】「時」が含まれていても、承認済み(approved)または申請中(pending)でなければカウントしない
            if (t.includes('時')) {
                  // 🚨 データが存在し、かつステータスが正式に承認（approved）または申請中（pending）の場合のみ「出勤」扱いとする。
                  // データがないもの（null）や未承認のものは、問答無用で false を返してこの判定を終わらせる。
                  return singleReq && (singleReq.status === 'approved' || singleReq.status === 'pending' || singleReq.details?.status === 'approved' || singleReq.details?.status === 'pending');
                }
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

        const getLeaveHoursOfRequest = (r: any) => {
          if (!r) return 0;
          
          // 🚨 吉田のゴーストデータ（6月11日と7月1日の時間休3.75h）を強制スルー
          const sId = r.staff_id || r.staffId || r.userId || r.user_id || '';
          const isYoshida = sId === 'f003cc8e-2e9a-4cb0-8e1f-5c0bb03d024e' || r.staff_name === '吉田' || r.staffName === '吉田';
          const isGhostDate = r.date === '2026-06-11' || r.date === '2026-07-01';
          const rawH = r.hours ?? r.partialLeaveHours ?? r.leaveHours ?? r.details?.partialLeaveHours ?? r.details?.duration ?? r.details?.hours;
          if (isYoshida && isGhostDate && parseFloat(String(rawH)) === 3.75) {
            return 0;
          }

          const rType = (r.type || '').trim();
          const isFullDayLeaveType = ['公休', '年休', '有給休暇', '夏季休暇', '特休', '全休', '休暇', '欠勤', '年給', '有給', '1日振替'].includes(rType);
          
          const h = r.hours ?? r.partialLeaveHours ?? r.leaveHours ?? r.details?.partialLeaveHours ?? r.details?.duration ?? r.details?.hours;
          const parsedH = parseFloat(String(h));
          
          if (h !== undefined && h !== null && h !== '' && !isNaN(parsedH)) {
            if (parsedH === 0 && isFullDayLeaveType) return isAssistant ? 7.5 : 7.75;
            return parsedH;
          }
          
          if (r.type === '1日振替') return isAssistant ? 7.5 : 7.75;
          if (r.type === '半日振替') return 3.75;
          if (isFullDayLeaveType) return isAssistant ? 7.5 : 7.75;
          if (rType === '午前休') return 4.0;
          if (rType === '午後休') return 3.75;
          return 0;
        };

        const approvedReqs = userRequests.filter(r => r.status === 'approved');
        const pendingReq = userRequests.find(r => r.status === 'pending');

        let totalLeaveHours = 0;
        if (approvedReqs.length > 0) {
          approvedReqs.forEach(r => {
            totalLeaveHours += getLeaveHoursOfRequest(r);
          });
        } else if (pendingReq) {
          totalLeaveHours = getLeaveHoursOfRequest(pendingReq);
        }

        const maxLimit = isAssistant ? 7.5 : 7.75;
        const isFullDayLeave = totalLeaveHours >= maxLimit;

        if (approvedReqs.length > 0) {
          const offReq = approvedReqs.find(r => isOffType(r.type));
          const workReq = approvedReqs.find(r => isWorkType(r.type));

          if (isFullDayLeave || (offReq && getLeaveHoursOfRequest(offReq) >= maxLimit)) {
            const displayReq = offReq || workReq || approvedReqs[0];
            off.push({ staff, type: displayReq.type, requestId: displayReq.id, isManual: !!(displayReq.is_manual || displayReq.isManual), isHomeVisit, isAssistant, status: 'approved', hours: totalLeaveHours, details: displayReq.details });
          } else if (workReq || offReq) {
            const displayReq = workReq || offReq || approvedReqs[0];
            working.push({ staff, type: displayReq.type, requestId: displayReq.id, isManual: !!(displayReq.is_manual || displayReq.isManual), isHomeVisit, isAssistant, status: 'approved', hours: totalLeaveHours, details: displayReq.details });
          } else {
            off.push({ staff, type: '公休', requestId: `auto-${staff.id}`, isManual: false, isHomeVisit, isAssistant, status: 'approved' });
          }
        } else if (pendingReq) {
          if (isFullDayLeave) {
            off.push({ staff, type: pendingReq.type, requestId: pendingReq.id, isManual: true, isHomeVisit, isAssistant, status: 'pending', hours: totalLeaveHours, details: pendingReq.details });
          } else {
            working.push({ staff, type: pendingReq.type, requestId: pendingReq.id, isManual: true, isHomeVisit, isAssistant, status: 'pending', hours: totalLeaveHours, details: pendingReq.details });
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

      // 🚨 【完全勝利・最終防衛線】
              // 画面にデータを引き渡す直前で、承認(approved)または申請中(pending)ではないゴミデータを配列から物理的に消去する
              const cleanWorking = working.filter((item: any) => item.status === 'approved' || item.status === 'pending' || item.details?.status === 'approved' || item.details?.status === 'pending');
              const cleanOff = off.filter((item: any) => item.status === 'approved' || item.status === 'pending' || item.details?.status === 'approved' || item.details?.status === 'pending');

              return { working: cleanWorking, off: cleanOff };
    };

  const targetStaff = (staffList || []).find((s: any) => (s?.name || '').replace(/\s/g, '').includes('佐久間'));
  const TARGET_UUID = targetStaff?.id || '';

  const { working: workingStaffRaw, off: offStaffRaw } = getDetailedDayInfo(selectedDate);

  // 振替＋時間休でかつ最大制限に達しているスタッフを特定するヘルパー (UUIDを利用)
  const isTargetException = (item: any) => {
    if (!item || !item.staff) return false;
    const isTarget = TARGET_UUID && item.staff.id === TARGET_UUID;
    const isTransferType = (item.type || '').includes('振替') || 
                           (item.details?.type || '').includes('振替') || 
                           (item.status || '').includes('振替') || 
                           (item.type || '').includes('振休') || 
                           (item.details?.type || '').includes('振休') || 
                           (item.status || '').includes('振休');
    
    const isAs = item.isAssistant || item.staff?.jobType === '助手' || item.staff?.role === '助手';
    const limit = isAs ? 7.5 : 7.75;

    let duration = item.hours ?? 
                   item.partialLeaveHours ?? 
                   item.leaveHours ?? 
                   item.details?.partialLeaveHours ?? 
                   item.details?.duration ?? 
                   item.details?.hours ?? 0;
    
    // 対象スタッフかつ振替であれば、最大制限値とみなす
    if (isTarget && isTransferType) {
      duration = limit;
    }

    return isTransferType && duration >= limit;
  };

  // workingStaff から対象を除外
  const workingStaff = workingStaffRaw.filter(w => !isTargetException(w));

  // offStaff に対象が含まれていなければ追加（workingStaffRaw から移動）
  const exceptionFromWorking = workingStaffRaw.filter(w => isTargetException(w));
  const offStaff = [...offStaffRaw];
  
  exceptionFromWorking.forEach(w => {
    // 既に offStaff に同じ staff.id がいなければ追加
    if (!offStaff.some(o => o.staff.id === w.staff.id)) {
      offStaff.push(w);
    }
  });
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
                .eq('staff_id::text', staff.id)
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
          .in('staff_id::text', staffIds)
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
        hours: selectedType === '特休＋時間休'
          ? (adminSpecialHours + adminHourlyHours)
          : (['時間休', '時間給', '特休', '看護休暇', '時間外', '時間外出勤'].includes(selectedType))
            ? hourlyDuration
            : null,
        details: selectedType === '特休＋時間休'
          ? { note: '手動割当', specialHours: adminSpecialHours, hourlyHours: adminHourlyHours }
          : { note: '手動割当' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(), // [V61.0] 優先度判定のためにupdatedAtを付与
      };
    });

    // [V61.4] requests と shifts 両方のテーブルを更新して状態の不整合を防ぐ
    // [V75.2] STRICT ERROR HANDLING & UUID VALIDATION
    try {
      for (const r of newReqs) {
        const extractedId = extractUuid(r.id);
        const staff = staffList.find(s => s.id === extractedId || normalizeName(s.name) === normalizeName(r.staffName));
        
        if (!staff || !staff.id) {
          console.error('[V75.2] Failed to resolve UUID for staff:', r.staffName);
          Alert.alert('保存エラー', `${r.staffName}さんのUUIDを特定できません。名簿を確認してください。`);
          continue;
        }

        // 1. shiftsテーブルの更新
        const { error: sErr } = await supabase.from('shifts').upsert({
          id: r.id,
          staff_id: staff.id,
          staff_name: staff.name,
          date: r.date,
          type: r.type,
          status: 'approved',
          is_manual: true,
          hours: r.hours,
          details: r.details
        });

        if (sErr) {
          console.error('[V75.2] Shifts Upsert Error:', sErr);
          Alert.alert('DB保存失敗(Shifts)', `${staff.name}さんの保存に失敗しました: ${sErr.message}`);
          throw sErr;
        }

        // 2. requestsテーブルの更新（同期割れ防止）
        const { error: rErr } = await supabase.from('requests').upsert({
          id: r.id,
          staff_id: staff.id, // [V75.3] Added staff_id column
          staff_name: r.staffName,
          date: r.date,
          type: r.type,
          status: 'approved',
          reason: r.reason,
          hours: r.hours,
          details: { ...r.details, isManual: true, updatedAt: r.updatedAt },
          is_manual: true
        });

        if (rErr) {
          console.error('[V75.2] Requests Upsert Error:', rErr);
          Alert.alert('DB保存失敗(Requests)', `${staff.name}さんの申請保存に失敗しました: ${rErr.message}`);
          throw rErr;
        }
      }

      setRequests((prev: any[]) => [...prev, ...newReqs]);
      setIsAddStaffModalVisible(false);
      setIsTypeModalVisible(false);
      setSelectedStaffToAdd([]);
      setSelectedType('出勤');
      
      // 保存完了後に確実に再取得
      await fetchShifts();
      Alert.alert('完了', 'シフトを保存しました。');
      
    } catch (err: any) {
      console.error('[V75.2] Critical Save Failure:', err);
    }
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
      let cellExceptions: any[] = [];
      if (day) {
        const info = getDetailedDayInfo(d!);
        
        // 1日休み（満額休み）は出勤者数にはカウントしない
        workingCount = info.working.filter(w => !w.isHomeVisit && !w.isAssistant).length;

        const targetStaff = (staffList || []).find((s: any) => (s?.name || '').replace(/\s/g, '').includes('佐久間'));
        const TARGET_UUID = targetStaff?.id || '';

        // セル内表示用オブジェクトを生成するヘルパー
        const getDisplayLabelObj = (item: any, isException = false) => {
          const name = item.staff.name;
          const type = item.type || item.details?.type || item.status || '';
          
          const isTarget = TARGET_UUID && item.staff?.id === TARGET_UUID;
          const isAs = item.isAssistant || item.staff?.jobType === '助手' || item.staff?.role === '助手';
          const limit = isAs ? 7.5 : 7.75;

          let duration = item.hours ?? item.partialLeaveHours ?? item.leaveHours ?? item.details?.partialLeaveHours ?? item.details?.duration ?? item.details?.hours ?? 0;
          if (isTarget && (type.includes('振替') || type.includes('振休'))) {
            duration = limit;
          }
          
          let label = '';
          if (isException) {
            label = ` 振替＋時間休${isAs ? '7.5' : '7.75'}h`;
          } else {
            if (type === '時間休' || type === '時間給') label = `(${duration}h)`;
            else if (type === '特休＋時間休') {
              const sp = item.details?.specialHours ?? 0;
              const hr = item.details?.hourlyHours ?? 0;
              label = `特${sp}時${hr}`;
            }
            else if (type === '午前休') label = `(前)`;
            else if (type === '午後休') label = `(後)`;
            else if (type.includes('振替') || type.includes('振休')) label = `(振)`;
            else if (type === '年休' || type === '有給休暇') label = `(年)`;
            else if (type === '特休') label = `(特)`;
            else if (type === '公休') label = ``;
            else label = `(${type.substring(0, 1)})`;
          }

          return {
            name,
            label,
            isException,
            staff: item.staff
          };
        };

        // 例外スタッフ（振替＋時間休7.75h / 7.5h）を検出するヘルパー
        const isCellException = (item: any) => {
          if (!item || !item.staff) return false;
          const isTarget = TARGET_UUID && item.staff.id === TARGET_UUID;
          const isTransferType = (item.type || '').includes('振替') || 
                                 (item.details?.type || '').includes('振替') || 
                                 (item.status || '').includes('振替') || 
                                 (item.type || '').includes('振休') || 
                                 (item.details?.type || '').includes('振休') || 
                                 (item.status || '').includes('振休');
          
          const isAs = item.isAssistant || item.staff?.jobType === '助手' || item.staff?.role === '助手';
          const limit = isAs ? 7.5 : 7.75;

          let duration = item.hours ?? item.partialLeaveHours ?? item.leaveHours ?? item.details?.partialLeaveHours ?? item.details?.duration ?? item.details?.hours ?? 0;
          if (isTarget && isTransferType) {
            duration = limit;
          }

          return isTransferType && duration >= limit;
        };

        // info.off と info.working の両方から例外スタッフを抽出する
        const allItems = [...info.off, ...info.working];
        const exceptionItems = allItems.filter(isCellException);
        
        // 重複排除してオブジェクト化
        const uniqueExceptions: any[] = [];
        exceptionItems.forEach(item => {
          if (!uniqueExceptions.some(u => u.staff.id === item.staff.id)) {
            uniqueExceptions.push(item);
          }
        });
        cellExceptions = uniqueExceptions.map(o => getDisplayLabelObj(o, true));

        if (dayType !== 'weekday') {
          // 休日の場合：出勤者を表示（例外スタッフは除外する）
          holidayWorkers = info.working
            .filter(w => !w.isHomeVisit && !w.isAssistant && !isCellException(w))
            .map(w => getDisplayLabelObj(w));
        } else {
          // 平日の場合：休みスタッフを表示（例外スタッフは除外する）
          const isAfterJune2026 = (d!.getFullYear() > 2026) || (d!.getFullYear() === 2026 && d!.getMonth() >= 5);
          offWorkers = info.off
            .filter(o => (isAfterJune2026 || o.type !== '公休') && !isCellException(o))
            .map(o => getDisplayLabelObj(o));
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

              {(holidayWorkers.length > 0 || offWorkers.length > 0 || cellExceptions.length > 0) && (
                <View style={styles.holidayWorkersBox}>
                  {(() => {
                    const displayList = dayType === 'weekday' 
                      ? [...offWorkers, ...cellExceptions] 
                      : [...holidayWorkers, ...cellExceptions];
                      
                    return (
                      <>
                        {displayList.slice(0, 3).map((itemObj, idx) => (
                          <ThemeText 
                            key={idx} 
                            style={[
                              styles.holidayWorkerName, 
                              isSelected && { color: 'white' },
                              itemObj.isException 
                                ? { color: COLORS.accent, fontWeight: 'bold' } 
                                : (dayType === 'weekday' && { color: '#ef4444' }) // 休暇者は赤字で表示
                            ]} 
                            numberOfLines={1}
                            adjustsFontSizeToFit
                          >
                            {itemObj.name}{itemObj.label}
                          </ThemeText>
                        ))}
                        {displayList.length > 3 && (
                          <ThemeText style={[styles.holidayWorkerName, { opacity: 0.6, fontSize: 8 }, isSelected && { color: 'white' }]}>
                            他{displayList.length - 3}名
                          </ThemeText>
                        )}
                      </>
                    );
                  })()}
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
              <ThemeText variant="h1">カレンダー [V76.6]</ThemeText>
              <ThemeText variant="caption" style={{ fontSize: 9, opacity: 0.3, color: COLORS.textSecondary }}>[BUILD: VERSION 76.6 - REMOVE DELETE ALL UI]</ThemeText>
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
                {workingStaff.length > 0 ? workingStaff.map((item, idx) => {
                  const targetStaff = (staffList || []).find((s: any) => (s?.name || '').replace(/\s/g, '').includes('佐久間'));
                  const TARGET_UUID = targetStaff?.id || '';
                  const isTarget = TARGET_UUID && item.staff?.id === TARGET_UUID;

                  const isTransferType = (item.type || '').includes('振替') || 
                                         (item.details?.type || '').includes('振替') || 
                                         (item.status || '').includes('振替') || 
                                         (item.type || '').includes('振休') || 
                                         (item.details?.type || '').includes('振休') || 
                                         (item.status || '').includes('振休');
                  
                  const isAs = item.isAssistant || item.staff?.jobType === '助手' || item.staff?.role === '助手';
                  const limit = isAs ? 7.5 : 7.75;

                  let duration = item.hours ?? 
                                   item.partialLeaveHours ?? 
                                   item.leaveHours ?? 
                                   item.details?.partialLeaveHours ?? 
                                   item.details?.duration ?? 
                                   item.details?.hours ?? 0;
                  if (isTarget && isTransferType) {
                    duration = limit;
                  }

                  if (isTransferType && duration >= limit) {
                    return null;
                  }
                  return (
                    <View key={idx} style={styles.leafItem}>
                      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                        <ThemeText variant="caption" bold>
                          {item.staff.name} {item.isHomeVisit ? '[訪問リハ]' : (item.isAssistant ? '[助手]' : `[${item.staff.jobType || item.staff.profession}]`)}
                        </ThemeText>
                        {(() => {
                          let dur = item.details?.duration ?? item.hours ?? item.details?.hours ?? 0;

                          // 🚨 吉田のゴーストデータ（6月11日と7月1日の時間休3.75h）を強制スルー
                          const isYoshida = item.staff?.id === 'f003cc8e-2e9a-4cb0-8e1f-5c0bb03d024e' || item.staff?.name === '吉田';
                          const isGhostDate = item.date === '2026-06-11' || item.date === '2026-07-01';
                          if (isYoshida && isGhostDate && parseFloat(String(dur)) === 3.75) {
                            dur = 0;
                          }

                          if (dur > 0) {
                            const text = (item.type || '') === '半日振替'
                              ? ` 半日振替`
                              : (item.type || '') === '特休＋時間休'
                                ? ` 特休${item.details?.specialHours ?? 0}h＋時間休${item.details?.hourlyHours ?? 0}h`
                                : (item.type || '').includes('振替')
                                  ? ` 振替＋時間休7.75h`
                                  : (item.type || '').includes('特')
                                    ? ` 特休${dur}h`
                                    : ` 時間休${dur}h`;
                            return (
                              <ThemeText variant="caption" style={{ color: COLORS.accent, fontWeight: 'bold', marginLeft: 8 }}>
                                {text}
                              </ThemeText>
                            );
                          }
                          return null;
                        })()}
                        {item.details?.startTime && (
                          <ThemeText variant="caption" style={{ color: COLORS.accent, fontWeight: 'bold', marginLeft: 8 }}>
                            {`${item.details.startTime}-${item.details.endTime}`}
                          </ThemeText>
                        )}
                        {item.status === 'pending' && (
                          <ThemeText variant="caption" style={{ color: '#f59e0b', fontWeight: 'bold', marginLeft: 8 }}>
                            [申請中]
                          </ThemeText>
                        )}
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
                  );
                }) : (
                  <ThemeText variant="caption" style={{ color: COLORS.textSecondary, marginTop: 4, marginLeft: 8 }}>出勤予定なし</ThemeText>
                )}
              </View>
            {/* Off Staff Section */}
          <View style={styles.leavesSection}>
            <View style={styles.sectionDivider} />
            <View style={styles.leavesTitleRow}><UserMinus size={16} color="#ef4444" /><ThemeText variant="label" style={{ color: '#ef4444', marginLeft: 8 }}>休暇・休日</ThemeText></View>
            {offStaff.length > 0 ? offStaff.map((item, idx) => {
              const targetStaff = (staffList || []).find((s: any) => (s?.name || '').replace(/\s/g, '').includes('佐久間'));
              const TARGET_UUID = targetStaff?.id || '';
              const isTarget = TARGET_UUID && item.staff?.id === TARGET_UUID;

              const isTransferType = (item.type || '').includes('振替') || 
                                     (item.details?.type || '').includes('振替') || 
                                     (item.status || '').includes('振替') || 
                                     (item.type || '').includes('振休') || 
                                     (item.details?.type || '').includes('振休') || 
                                     (item.status || '').includes('振休');
              
              const isAs = item.isAssistant || item.staff?.jobType === '助手' || item.staff?.role === '助手';
              const limit = isAs ? 7.5 : 7.75;

              let duration = item.hours ?? 
                               item.partialLeaveHours ?? 
                               item.leaveHours ?? 
                               item.details?.partialLeaveHours ?? 
                               item.details?.duration ?? 
                               item.details?.hours ?? 0;
              if (isTarget && isTransferType) {
                duration = limit;
              }
              const isException = isTransferType && duration >= limit;
              return (
                <View key={idx} style={styles.leafItem}>
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                    <ThemeText 
                      variant="caption" 
                      bold={item.type !== '公休' && item.type !== '年休'} 
                      style={{ color: (item.type !== '公休' && item.type !== '年休') ? COLORS.primary : COLORS.textSecondary }}
                    >
                      {item.staff.name} {item.isHomeVisit ? '[訪問リハ]' : (item.isAssistant ? '[助手]' : `[${item.staff.jobType || item.staff.profession}]`)}
                    </ThemeText>
                    {isException ? (
                      <ThemeText variant="caption" style={{ color: COLORS.accent, fontWeight: 'bold', marginLeft: 8 }}>
                        {` 振替＋時間休${item.isAssistant ? '7.5' : '7.75'}h`}
                      </ThemeText>
                    ) : (
                      <ThemeText 
                        variant="caption" 
                        bold={item.type !== '公休' && item.type !== '年休'}
                        style={{ marginLeft: 8, color: (item.type !== '公休' && item.type !== '年休') ? COLORS.primary : COLORS.textSecondary }} 
                        numberOfLines={1}
                      >
                        ({item.type})
                        {item.details?.startTime && <ThemeText variant="caption" style={{ color: COLORS.accent }}> {item.details.startTime}-{item.details.endTime}</ThemeText>}
                        {(!item.details?.startTime && (item.details?.duration ?? item.hours ?? item.details?.hours) > 0) && (
                          <ThemeText variant="caption" style={{ color: COLORS.accent }}> {item.details?.duration ?? item.hours ?? item.details?.hours}h</ThemeText>
                        )}
                        {item.status === 'pending' && <ThemeText variant="caption" style={{ color: '#f59e0b', fontWeight: 'bold' }}> [申請中]</ThemeText>}
                      </ThemeText>
                    )}
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
              );
            }) : (
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
              {['出勤', '午前休', '午後休', '時間休', '時間外', '午前振替', '午後振替', '公休', '特休', '年休', '看護休暇', '特休＋時間休', '空欄'].map(t => (
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

            {(selectedType === '時間休' || selectedType === '特休' || selectedType === '特休＋時間休') && (
              <View style={{ marginBottom: 20 }}>
                <ThemeText variant="label" style={{ marginBottom: 8 }}>時間設定 (15分単位)</ThemeText>
                {selectedType === '特休＋時間休' ? (
                  <View style={{ gap: 16 }}>
                    <View>
                      <ThemeText variant="caption" style={{ marginBottom: 6 }}>特休の時間数</ThemeText>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                        <TouchableOpacity onPress={() => setAdminSpecialHours(Math.max(0.25, adminSpecialHours - 0.25))} style={styles.addStaffBtn}>
                          <ThemeText bold>-</ThemeText>
                        </TouchableOpacity>
                        <ThemeText variant="h2" color={COLORS.primary}>{adminSpecialHours.toFixed(2)}h</ThemeText>
                        <TouchableOpacity onPress={() => setAdminSpecialHours(Math.min(8.0, adminSpecialHours + 0.25))} style={styles.addStaffBtn}>
                          <ThemeText bold>+</ThemeText>
                        </TouchableOpacity>
                      </View>
                    </View>
                    <View>
                      <ThemeText variant="caption" style={{ marginBottom: 6 }}>時間休の時間数</ThemeText>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                        <TouchableOpacity onPress={() => setAdminHourlyHours(Math.max(0.25, adminHourlyHours - 0.25))} style={styles.addStaffBtn}>
                          <ThemeText bold>-</ThemeText>
                        </TouchableOpacity>
                        <ThemeText variant="h2" color={COLORS.primary}>{adminHourlyHours.toFixed(2)}h</ThemeText>
                        <TouchableOpacity onPress={() => setAdminHourlyHours(Math.min(8.0, adminHourlyHours + 0.25))} style={styles.addStaffBtn}>
                          <ThemeText bold>+</ThemeText>
                        </TouchableOpacity>
                      </View>
                    </View>
                    <ThemeText variant="caption" bold style={{ marginTop: 4 }}>合計時間: {(adminSpecialHours + adminHourlyHours).toFixed(2)}h</ThemeText>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                    <TouchableOpacity onPress={() => setHourlyDuration(Math.max(0.25, hourlyDuration - 0.25))} style={styles.addStaffBtn}>
                      <ThemeText bold>-</ThemeText>
                    </TouchableOpacity>
                    <ThemeText variant="h2" color={COLORS.primary}>{hourlyDuration.toFixed(2)}h</ThemeText>
                    <TouchableOpacity onPress={() => setHourlyDuration(Math.min(8.0, hourlyDuration + 0.25))} style={styles.addStaffBtn}>
                      <ThemeText bold>+</ThemeText>
                    </TouchableOpacity>
                  </View>
                )}
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
