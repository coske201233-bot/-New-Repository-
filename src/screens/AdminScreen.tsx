import React, { useState } from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity, TextInput, Alert, Modal, ActivityIndicator, SafeAreaView, Platform } from 'react-native';
import { ThemeText } from '../components/ThemeText';
import { ThemeCard } from '../components/ThemeCard';
import { COLORS, SPACING } from '../theme/theme';
import { 
  ChevronRight, Database, FileOutput, 
  QrCode, X, Check, Shield, User, Key, Save, LogOut, Edit3, Trash2, Printer, FileText, UserPlus, Clock
} from 'lucide-react-native';
import { getMonthInfo, normalizeName, formatDate, getDayType } from '../utils/dateUtils';
import { cloudStorage } from '../utils/cloudStorage';
import * as Print from 'expo-print';

interface AdminScreenProps {
  profile: any;
  setProfile: (p: any) => void;
  staffList: any[];
  setStaffList: (staff: any[] | ((prev: any[]) => any[])) => void;
  updateStaffList: (staff: any[] | ((prev: any[]) => any[])) => Promise<void>;
  updateLimits: (type: string, val: number, monthStr?: string) => void;
  updatePassword: (pass: string) => void;
  adminPassword?: string;
  isAdminAuthenticated: boolean;
  setIsAdminAuthenticated: (auth: boolean) => void;
  monthlyLimits: any;
  onShareApp: () => void;
  onLogout: () => void;
  currentDate: Date;
  onAutoAssign: (year: number, month: number, limits: any) => Promise<void>;
  onUndoAutoAssign: () => Promise<void>;
  canUndoAutoAssign: boolean;
  requests: any[];
  setRequests: (requests: any[] | ((prev: any[]) => any[])) => void;
  updateRequests: (requests: any[] | ((prev: any[]) => any[])) => Promise<void>;
  onForceSave?: () => void;
  onForceFetch?: () => void;
  isSyncing?: boolean;
}
export const AdminScreen: React.FC<AdminScreenProps> = ({
  profile, setProfile, staffList = [], setStaffList, updateStaffList,
  updateLimits, updatePassword, monthlyLimits = {}, adminPassword, onShareApp,
  currentDate = new Date(), onAutoAssign, onUndoAutoAssign, canUndoAutoAssign,
  isAdminAuthenticated, setIsAdminAuthenticated, onLogout, requests = [], setRequests, updateRequests,
  onForceSave, onForceFetch, isSyncing = false
}) => {
  const [showAdminAuthModal, setShowAdminAuthModal] = useState(false);
  const [adminAuthInput, setAdminAuthInput] = useState('');
  
  const [showPersonalPassModal, setShowPersonalPassModal] = useState(false);
  const [personalPassInput, setPersonalPassInput] = useState('');
  
  const [showAdminPassChangeModal, setShowAdminPassChangeModal] = useState(false);
  const [newAdminPassInput, setNewAdminPassInput] = useState('');

  const [editStaff, setEditStaff] = useState<any>(null);
  const [showStaffEditModal, setShowStaffEditModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editProfession, setEditProfession] = useState('');
  const [editPlacement, setEditPlacement] = useState('');
  const [editPosition, setEditPosition] = useState('');
  const [editStatus, setEditStatus] = useState('常勤');
  const [editNoHoliday, setEditNoHoliday] = useState(false);
  const [editRole, setEditRole] = useState(['スタッフ']);
  
  const [showMaintenanceModal, setShowMaintenanceModal] = useState(false);
  const [orphanedRequests, setOrphanedRequests] = useState<any[]>([]);
  const [repairMap, setRepairMap] = useState<Record<string, string>>({});
  const [isRepairing, setIsRepairing] = useState(false);
  
  const [isAssigning, setIsAssigning] = useState(false);

  // Safeguard: Ensure currentDate exists
  const safeDate = currentDate || new Date();
  const currentYear = safeDate.getFullYear();
  const currentMonth = safeDate.getMonth();
  const currentMonthStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
  const limits = (monthlyLimits && monthlyLimits[currentMonthStr]) || { weekday: 12, sat: 1, sun: 0, pub: 1 };

  // --- Approvals Filtering with safeguards and logical fixes ---
  const pendingStaff = Array.isArray(staffList) ? staffList.filter(s => s && s.isApproved === false) : [];
  const pendingRequests = Array.isArray(requests) ? requests.filter(r => r && (r.status === 'pending' || !r.status)) : [];

  // --- Constant Options ---
  const PROFESSION_OPTS = ['PT', 'OT', 'ST', '助手'];
  const PLACEMENT_OPTS = ['外来', '２F', '包括', '４F', '排尿', '兼務', 'フォロー', '管理', '事務', '訪問リハ'];
  const POSITION_OPTS = ['科長', '係長', '主査', '主任', '主事', '会計年度'];
  const STATUS_OPTS = ['常勤', '時短出勤', '長期休暇'];
  const HOLIDAY_SETTING_OPTS = [{ label: '設定なし', value: false }, { label: '土日祝休み', value: true }];
  const ROLE_OPTS = [{ label: '一般スタッフ', value: ['スタッフ'] }, { label: 'シフト管理者', value: ['管理者', 'スタッフ'] }];

  // --- Handlers ---
  const handleApproveStaff = async (id: string) => {
    try {
      await updateStaffList(prev => prev.map(s => s && s.id === id ? { ...s, isApproved: true } : s));
      if (Platform.OS === 'web') window.alert('✅ 登録を承認しました');
      else Alert.alert('完了', '登録を承認しました。');
    } catch (e) {
      if (Platform.OS === 'web') window.alert('❌ 承認に失敗しました');
      else Alert.alert('エラー', '承認に失敗しました');
    }
  };

  const handleApproveRequest = async (req: any) => {
    const updatedReq = { ...req, status: 'approved' };
    await updateRequests(prev => prev.map(r => r.id === req.id ? updatedReq : r));
    Alert.alert('完了', '申請を承認しました。');
  };

  const handleRejectRequest = async (id: string) => {
    await updateRequests(prev => prev.filter(r => r.id !== id));
    await cloudStorage.deleteRequests([id]); // Ensure cloud deletion
    Alert.alert('却下', '申請を却下し、削除しました。');
  };

  const handlePrintAttendanceReport = async () => {
    try {
      // データの準備
      const year = currentYear;
      const month = currentMonth + 1;
      const monthInfoArr = getMonthInfo(year, currentMonth) || [];
      const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
      const currentMonthKey = `${year}-${String(month).padStart(2, '0')}`;
      
      // ヘッダーの初期化
      let headerHtml = '<th style="width: 80px;">氏名</th><th style="width: 40px;">職種</th>';
      
      // 日付ヘッダーの生成
      monthInfoArr.forEach((d: any) => {
        if (!d.empty) {
          const dDate = new Date(d.dateStr);
          const dayIdx = isNaN(dDate.getTime()) ? 0 : dDate.getDay();
          const style = (d.isH || dayIdx === 0) ? 'color: #ef4444; background-color: #fef2f2;' : (dayIdx === 6 ? 'color: #3b82f6; background-color: #eff6ff;' : '');
          headerHtml += `<th style="${style}">${d.day}<br/><small>${dayNames[dayIdx]}</small></th>`;
        }
      });

      // 行データの生成
      let rowsHtml = '';
      const listToPrint = staffList.filter(s => s && s.isApproved);
      listToPrint.forEach(s => {
        let row = `<tr><td style="text-align: left; padding-left: 5px; font-weight: bold;">${s.name}</td><td>${s.profession || ''}</td>`;
        monthInfoArr.forEach((d: any) => {
          if (!d.empty) {
            const sT = normalizeName(s.name);
            const req = requests.find(r => r && r.date === d.dateStr && (String(r.staffId) === s.id || normalizeName(r.staffName) === sT));
            
            let type = '';
            if (req) {
              type = req.type;
            } else {
              const dDate = new Date(d.dateStr);
              const dtype = getDayType(dDate);
              const isNoHoliday = (dtype !== 'weekday') && (s.monthlyNoHoliday?.[currentMonthKey] ?? s.noHoliday);
              type = (dtype === 'weekday') ? '出勤' : (isNoHoliday ? '公休' : '公休');
            }

            const offTypes = ['公休', '年休', '特休', '休暇', '欠勤'];
            const isOff = offTypes.some(ot => normalizeName(ot) === normalizeName(type));
            const style = isOff ? 'background-color: #fef2f2; color: #ef4444;' : '';
            const normalizedType = normalizeName(type);
            const label = normalizedType === normalizeName('公休') ? '公' : 
                          (normalizedType === normalizeName('出勤') ? '出' : 
                          (normalizedType === normalizeName('夜勤') ? '夜' : 
                          (normalizedType === normalizeName('早番') ? '早' : 
                          (normalizedType === normalizeName('遅番') ? '遅' : 
                          (type ? type.charAt(0) : '')))));
            row += `<td style="${style}">${label}</td>`;
          }
        });
        row += '</tr>';
        rowsHtml += row;
      });

      const html = `
        <html>
          <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no" />
            <title>勤務実績表</title>
            <style>
              @page { size: A4 landscape; margin: 5mm; }
              body { font-family: sans-serif; padding: 10px; color: #1e293b; }
              .header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 10px; border-bottom: 2px solid #38bdf8; padding-bottom: 5px; }
              table { width: 100%; border-collapse: collapse; table-layout: fixed; border: 2px solid #334155; }
              th, td { border: 1px solid #94a3b8; padding: 2px 1px; text-align: center; font-size: 8px; overflow: hidden; white-space: nowrap; }
              th { background-color: #f1f5f9; font-weight: bold; }
              td { height: 20px; }
            </style>
          </head>
          <body>
            <div class="header">
              <h1 style="margin:0; font-size:16px;">勤務実績表（${year}年${month}月）</h1>
              <div style="font-size: 10px;">印刷日: ${new Date().toLocaleDateString('ja-JP')}</div>
            </div>
            <table><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>
          </body>
        </html>
      `;

      if (Platform.OS === 'web') {
        const printWindow = window.open('', '_blank');
        if (printWindow) {
          printWindow.document.write(html);
          printWindow.document.close();
          // モバイルブラウザでの動作を考慮し、少し遅らせて実行するか、PrintOptionsを使用
        } else {
          Alert.alert('ポップアップ制限', 'ブラウザのポップアップ設定を許可してください。');
        }
      } else {
        // モバイル環境（iOS/Android）では expo-print を使用
        await Print.printAsync({ html });
      }
    } catch (err) {
      console.error('Print logic error:', err);
      Alert.alert('エラー', 'データの生成中に問題が発生しました。');
    }
  };

  const DropdownSelector = ({ label, value, options, onSelect, style }: any) => {
    const [isVisible, setIsVisible] = useState(false);
    const displayValue = typeof value === 'boolean' 
      ? (options.find((o:any) => o.value === value)?.label || 'なし')
      : (Array.isArray(value) ? (options.find((o:any) => JSON.stringify(o.value) === JSON.stringify(value))?.label || value[0]) : value);
    const isSimpleArray = options.length > 0 && typeof options[0] !== 'object';
    return (
      <View style={[{ marginBottom: 16 }, style]}>
        <ThemeText bold style={{ marginBottom: 8, fontSize: 13, color: COLORS.textSecondary }}>{label}</ThemeText>
        <TouchableOpacity style={styles.dropdownBtn} onPress={() => setIsVisible(true)}><ThemeText bold color="white">{typeof value === 'number' ? value : (displayValue || '未選択')}</ThemeText><ChevronRight size={18} color={COLORS.textSecondary} /></TouchableOpacity>
        <Modal visible={isVisible} transparent animationType="fade">
          <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setIsVisible(false)}>
            <View style={styles.pickerContainer}>
              <View style={styles.pickerHeader}><ThemeText bold variant="h2">{label}</ThemeText><TouchableOpacity onPress={() => setIsVisible(false)}><X size={24} color={COLORS.textSecondary} /></TouchableOpacity></View>
              <ScrollView>{options.map((opt: any) => {
                const optVal = isSimpleArray ? opt : (typeof opt === 'number' ? opt : opt.value);
                const optLabel = isSimpleArray ? (typeof opt === 'number' ? `${opt}人` : opt) : opt.label;
                const isActive = typeof optVal === 'object' ? JSON.stringify(optVal) === JSON.stringify(value) : (typeof value === 'number' ? optVal === value : optVal === value);
                return (
                  <TouchableOpacity key={String(optLabel)} style={[styles.pickerItem, isActive && styles.pickerItemActive]} onPress={() => { onSelect(optVal); setIsVisible(false); }}>
                    <ThemeText bold={isActive} color={isActive ? '#38bdf8' : 'white'} style={{ fontSize: 18 }}>{optLabel}</ThemeText>
                    {isActive && <Check size={20} color="#38bdf8" />}
                  </TouchableOpacity>
                );
              })}</ScrollView>
            </View>
          </TouchableOpacity>
        </Modal>
      </View>
    );
  };

  const handleAdminAuth = () => {
    if (adminAuthInput === adminPassword) { setIsAdminAuthenticated(true); setShowAdminAuthModal(false); setAdminAuthInput(''); }
    else { Alert.alert('エラー', '管理用パスワードが違います。'); }
  };

  const handleStaffUpdate = async () => {
    if (!editStaff) return;
    try {
      // Normalize all fields before saving to ensure strict matching
      const normalizedNameVal = normalizeName(editName);
      const normalizedProfession = editProfession?.trim() || '';
      const normalizedPlacement = editPlacement?.trim() || '';
      const normalizedPosition = editPosition?.trim() || '';
      const normalizedStatus = editStatus?.trim() || '常勤';

      // Update staff list
      await updateStaffList(prev => prev.map(s => s && s.id === editStaff.id ? { 
        ...s, 
        name: normalizedNameVal, 
        profession: normalizedProfession, 
        placement: normalizedPlacement, 
        position: normalizedPosition, 
        status: normalizedStatus, 
        noHoliday: editNoHoliday, 
        role: editRole 
      } : s));

      const oldName = editStaff.name;
      const isNameChanged = normalizeName(oldName) !== normalizedNameVal;

      // If name changed, we MUST update all existing requests for this staff member
      // to avoid mapping errors on the calendar and personal screens.
      if (isNameChanged) {
        await updateRequests(prev => {
          return prev.map(r => {
            if (normalizeName(r.staffName || r.staff_name) === normalizeName(oldName)) {
              return { ...r, staffName: normalizedNameVal };
            }
            return r;
          });
        });
      }

      setShowStaffEditModal(false);
      if (Platform.OS === 'web') window.alert('✅ 情報を更新しました');
      else Alert.alert('完了', `${editName}さんの情報を更新しました。`);
    } catch (e) {
      if (Platform.OS === 'web') window.alert('❌ 更新に失敗しました');
      else Alert.alert('エラー', '情報の更新に失敗しました');
    }
  };

  const handleDeleteStaff = (id: string, name: string) => {
    const performDelete = async () => {
      try {
        await cloudStorage.deleteStaff(id);
        if (updateStaffList) {
          await updateStaffList(prev => prev.filter(s => s && s.id !== id));
        } else {
          setStaffList(prev => prev.filter(s => s && s.id !== id));
        }
        setShowStaffEditModal(false);
        if (Platform.OS === 'web') window.alert('✅ 削除しました');
        else Alert.alert('完了', '削除しました');
      } catch (e) {
        if (Platform.OS === 'web') window.alert('❌ 削除に失敗しました');
        else Alert.alert('エラー', '削除に失敗しました');
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm(`${name}さんを削除しますか？`)) performDelete();
    } else {
      Alert.alert('職員削除', `${name}さんを削除しますか？`, [
        { text: 'キャンセル', style: 'cancel' },
        { text: '削除', style: 'destructive', onPress: performDelete }
      ]);
    }
  };

  const handleIdentifyOrphans = () => {
    const sNames = staffList.filter(s => s && s.name).map(s => normalizeName(s.name));
    const orphans = requests.filter(r => {
      if (!r) return false;
      const sName = r.staffName || r.staff_name;
      return sName && !sNames.includes(normalizeName(sName));
    });
    
    if (orphans.length === 0) {
      Alert.alert('クリーンです', '現在、スタッフリストに見当たらない氏名の申請データはありません。');
      return;
    }
    
    setOrphanedRequests(orphans);
    setShowMaintenanceModal(true);
  };

  const handleExecuteRepair = async () => {
    if (Object.keys(repairMap).length === 0) {
      Alert.alert('未選択', '統合先のスタッフを1つ以上選択してください。');
      return;
    }

    setIsRepairing(true);
    try {
      const updatedRequests = requests.map(r => {
        const sName = r.staffName || r.staff_name;
        if (!sName) return r;
        const targetStaffName = repairMap[sName];
        if (targetStaffName) {
          const targetStaff = staffList.find(s => s && s.name === targetStaffName);
          return {
            ...r,
            staffName: targetStaffName,
            staffId: targetStaff?.id,
            updatedAt: new Date().toISOString()
          };
        }
        return r;
      });

      const changedOnly = updatedRequests.filter((r, i) => r.staffName !== requests[i].staffName);
      
      // Update local and cloud state
      await updateRequests(updatedRequests);
      
      Alert.alert('完了', `${changedOnly.length}件の申請データを新しい名前に統合しました。`);
      setShowMaintenanceModal(false);
      setRepairMap({});
    } catch (e) {
      console.error('Repair error:', e);
      Alert.alert('エラー', 'データの修復中にエラーが発生しました。');
    } finally {
      setIsRepairing(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}><ThemeText variant="h1">設定</ThemeText><ThemeText variant="caption" color={COLORS.textSecondary}>個人設定と管理機能</ThemeText></View>
      <ScrollView style={{ flex: 1 }}>
        <View style={{ padding: SPACING.md }}>
          <ThemeText bold variant="h2" style={{ marginBottom: 12 }}>本人設定</ThemeText>
          <ThemeCard style={styles.itemRow}>
            <View style={styles.iconCircle}><User size={20} color="#38bdf8" /></View>
            <View style={{ flex: 1, marginLeft: 12 }}><ThemeText bold>{profile?.name}</ThemeText><ThemeText variant="caption" color={COLORS.textSecondary}>{profile?.profession} | {profile?.placement} {profile?.position ? `[${profile.position}]` : ''}</ThemeText></View>
          </ThemeCard>
          {!isAdminAuthenticated && (
            <TouchableOpacity style={styles.adminLoginEntry} onPress={() => setShowAdminAuthModal(true)}>
              <Shield size={20} color="white" /><ThemeText bold color="white" style={{ marginLeft: 10 }}>管理者モードへログイン</ThemeText>
            </TouchableOpacity>
          )}

          {isAdminAuthenticated ? (
            <View style={{ marginTop: 24 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <ThemeText bold variant="h2">🛡️ 管理者モード</ThemeText>
                <TouchableOpacity onPress={() => setIsAdminAuthenticated(false)}><ThemeText color="#ef4444" style={{ fontSize: 12 }}>解除</ThemeText></TouchableOpacity>
              </View>
              

              <ThemeText bold style={{ color: '#ef4444', marginBottom: 12, marginTop: 12 }}>🔔 承認が必要な申請</ThemeText>
              
              {pendingStaff.length > 0 ? (
                <View style={{ marginBottom: 16 }}>
                  <ThemeText variant="caption" bold color={COLORS.textSecondary} style={{marginBottom:8}}>👤 新規登録の承認待ち ({pendingStaff.length}名)</ThemeText>
                  {pendingStaff.map(s => (
                    <ThemeCard key={s.id} style={styles.approvalItem}>
                      <View style={{ flex: 1 }}><ThemeText bold>{s.name}</ThemeText><ThemeText variant="caption" color={COLORS.textSecondary}>{s.profession} | {s.placement}</ThemeText></View>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity style={[styles.miniApproveBtn, {backgroundColor: '#10b981'}]} onPress={() => handleApproveStaff(s.id)}><Check size={16} color="white" /></TouchableOpacity>
                        <TouchableOpacity style={[styles.miniApproveBtn, {backgroundColor: '#ef4444'}]} onPress={() => handleDeleteStaff(s.id, s.name)}><X size={16} color="white" /></TouchableOpacity>
                      </View>
                    </ThemeCard>
                  ))}
                </View>
              ) : null}

              {pendingRequests.length > 0 ? (
                <View style={{ marginBottom: 16 }}>
                  <ThemeText variant="caption" bold color={COLORS.textSecondary} style={{marginBottom:8}}>📅 休暇・休日申請の承認待ち ({pendingRequests.length}件)</ThemeText>
                  {pendingRequests.map(r => (
                    <ThemeCard key={r.id} style={styles.approvalItem}>
                      <View style={{ flex: 1 }}><ThemeText bold>{r.staffName}</ThemeText><ThemeText variant="caption" color={COLORS.textSecondary}>{formatDate(r.date)} | {r.type} {r.hours ? `(${r.hours}h)` : ''}</ThemeText></View>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity style={[styles.miniApproveBtn, {backgroundColor: '#38bdf8'}]} onPress={() => handleApproveRequest(r)}><Check size={16} color="white" /></TouchableOpacity>
                        <TouchableOpacity style={[styles.miniApproveBtn, {backgroundColor: 'rgba(255,255,255,0.05)'}]} onPress={() => handleRejectRequest(r.id)}><X size={16} color={COLORS.textSecondary} /></TouchableOpacity>
                      </View>
                    </ThemeCard>
                  ))}
                </View>
              ) : null}

              {pendingStaff.length === 0 && pendingRequests.length === 0 ? (
                <ThemeCard style={{ padding: 20, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.02)', marginBottom: 20 }}>
                  <ThemeText color={COLORS.textSecondary}>現在、承認待ちの申請はありません</ThemeText>
                </ThemeCard>
              ) : null}

              <ThemeText bold style={{ color: COLORS.textSecondary, marginBottom: 12, marginTop: 12 }}>📋 レポーティング & ツール</ThemeText>
              
              <ThemeCard style={styles.itemRow}>
                <View style={styles.iconCircle}><FileText size={20} color="#10b981" /></View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <ThemeText bold>全職員の勤務実績表</ThemeText>
                  <ThemeText variant="caption" color={COLORS.textSecondary}>{currentMonth + 1}月分の全スタッフ一覧表（A4横印刷用）</ThemeText>
                </View>
                <TouchableOpacity style={styles.inlineBtn} onPress={handlePrintAttendanceReport}>
                  <Printer size={18} color="#38bdf8" /><ThemeText bold color="#38bdf8" style={{marginLeft:6}}>生成</ThemeText>
                </TouchableOpacity>
              </ThemeCard>

              <ThemeCard style={styles.itemRow}>
                <View style={styles.iconCircle}><Clock size={20} color="#38bdf8" /></View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <ThemeText bold>シフト自動割り当て</ThemeText>
                  <ThemeText variant="caption" color={COLORS.textSecondary}>{currentMonth + 1}月の残り枠を自動的に埋めます</ThemeText>
                </View>
                <TouchableOpacity 
                  style={[styles.inlineBtn, { backgroundColor: 'rgba(56, 189, 248, 0.1)' }, isAssigning && { opacity: 0.5 }]} 
                  onPress={async () => {
                    if (isAssigning) return;
                    setIsAssigning(true);
                    try {
                      console.log('Starting Auto Assign for:', currentYear, currentMonth + 1);
                      await onAutoAssign(currentYear, currentMonth + 1, limits);
                      Alert.alert('完了', 'シフトの自動割り当てが完了しました。');
                    } catch (e: any) {
                      console.error('Auto assign error UI:', e);
                      Alert.alert('エラー', '自動割り当て中にエラーが発生しました。\n' + (e.message || String(e)));
                    } finally {
                      setIsAssigning(false);
                    }
                  }}
                  disabled={isAssigning}
                >
                  {isAssigning ? (
                    <ActivityIndicator size="small" color="#38bdf8" />
                  ) : (
                    <>
                      <Database size={18} color="#38bdf8" />
                      <ThemeText bold color="#38bdf8" style={{marginLeft:6}}>実行</ThemeText>
                    </>
                  )}
                </TouchableOpacity>

                {canUndoAutoAssign && !isAssigning && (
                  <TouchableOpacity 
                    style={[styles.inlineBtn, { backgroundColor: 'rgba(239, 68, 68, 0.1)', marginLeft: 8 }]} 
                    onPress={onUndoAutoAssign}
                  >
                    <ThemeText bold color="#ef4444">1つ戻す</ThemeText>
                  </TouchableOpacity>
                )}
              </ThemeCard>


              <ThemeCard style={styles.itemRow}>
                <View style={styles.iconCircle}><QrCode size={20} color="#f59e0b" /></View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <ThemeText bold>アプリ配布用QRコード</ThemeText>
                  <ThemeText variant="caption" color={COLORS.textSecondary}>スタッフにアプリを配布するためのQRコードを表示します</ThemeText>
                </View>
                <TouchableOpacity style={[styles.inlineBtn, { backgroundColor: 'rgba(245, 158, 11, 0.1)' }]} onPress={onShareApp}>
                  <ThemeText bold color="#f59e0b">表示</ThemeText>
                </TouchableOpacity>
              </ThemeCard>

              <ThemeCard style={styles.itemRow}>
                <View style={styles.iconCircle}><Database size={20} color="#a855f7" /></View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <ThemeText bold>氏名データの不整合を修復</ThemeText>
                  <ThemeText variant="caption" color={COLORS.textSecondary}>旧名で残っているデータを新しい名前に統合します</ThemeText>
                </View>
                <TouchableOpacity style={[styles.inlineBtn, { backgroundColor: 'rgba(168, 85, 247, 0.1)' }]} onPress={handleIdentifyOrphans}>
                  <ThemeText bold color="#a855f7">チェック</ThemeText>
                </TouchableOpacity>
              </ThemeCard>

              <ThemeText bold style={{ color: COLORS.textSecondary, marginBottom: 12, marginTop: 12 }}>👥 職員の属性・役割管理</ThemeText>
              <View style={styles.staffAdminList}>
                {staffList.filter(s => s && s.isApproved).map(s => (
                  <ThemeCard key={s.id} style={styles.staffAdminItem}>
                    <View style={{ flex: 1 }}><ThemeText bold>{s.name}</ThemeText><ThemeText variant="caption" color={COLORS.textSecondary}>{s.placement} | {s.profession} ({s.status}) {s.position ? `[${s.position}]` : ''}</ThemeText></View>
                    <TouchableOpacity style={styles.staffMiniEdit} onPress={() => { setEditStaff(s); setEditName(s.name); setEditProfession(s.profession); setEditPlacement(s.placement); setEditPosition(s.position || ''); setEditStatus(s.status || '常勤'); setEditNoHoliday(!!s.noHoliday); setEditRole(s.role || ['スタッフ']); setShowStaffEditModal(true); }}><Edit3 size={16} color="#38bdf8" /><ThemeText bold color="#38bdf8" style={{marginLeft:4}}>編集</ThemeText></TouchableOpacity>
                  </ThemeCard>
                ))}
              </View>

              <View style={{ marginTop: 24, paddingBottom: 40 }}>
                <ThemeText bold variant="h2" style={{ marginBottom: 16 }}>📈 {currentMonth + 1}月の必要人数設定</ThemeText>
                <View style={styles.limitGrid}>
                  <DropdownSelector label="平日" value={limits.weekday} options={Array.from({length:21}, (_,i)=>i)} onSelect={(v:number)=>updateLimits('weekday', v, currentMonthStr)} style={{flex:1}} />
                  <DropdownSelector label="土曜" value={limits.sat} options={Array.from({length:21}, (_,i)=>i)} onSelect={(v:number)=>updateLimits('saturday', v, currentMonthStr)} style={{flex:1}} />
                </View>
                <View style={styles.limitGrid}>
                  <DropdownSelector label="日曜" value={limits.sun} options={Array.from({length:21}, (_,i)=>i)} onSelect={(v:number)=>updateLimits('sunday', v, currentMonthStr)} style={{flex:1}} />
                  <DropdownSelector label="祝日" value={limits.pub} options={Array.from({length:21}, (_,i)=>i)} onSelect={(v:number)=>updateLimits('publicHoliday', v, currentMonthStr)} style={{flex:1}} />
                </View>
              </View>
            </View>
          ) : null}
          {isAdminAuthenticated && (
            <View style={{ marginTop: 24, paddingBottom: 20 }}>
              <ThemeText bold style={{ color: COLORS.primary, marginBottom: 12 }}>🔄 【管理者用】クラウド完全同期</ThemeText>
              <ThemeCard style={{ padding: 16 }}>
                <ThemeText variant="caption" color={COLORS.textSecondary} style={{ marginBottom: 16 }}>
                  PCで修正したスケジュールを確実にスマホへ反映させるための機能です。
                </ThemeText>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <TouchableOpacity 
                    style={[styles.syncFullBtn, { backgroundColor: COLORS.primary }, isSyncing && { opacity: 0.5 }]}
                    disabled={isSyncing}
                    onPress={() => {
                      if (!onForceSave) return;
                      if (Platform.OS === 'web') {
                        if (window.confirm('現在のこの端末の状態をクラウドに強制保存します。スマホなど他の端末の内容はこの内容で上書きされますが、よろしいですか？')) onForceSave();
                      } else {
                        Alert.alert(
                          'クラウドに保存',
                          '現在のこの端末の状態をクラウドに強制保存します。スマホなど他の端末の内容はこの内容で上書きされますが、よろしいですか？',
                          [{ text: 'キャンセル', style: 'cancel' }, { text: '保存する', onPress: onForceSave }]
                        );
                      }
                    }}
                  >
                    <Save size={18} color="white" />
                    <ThemeText bold color="white" style={{ marginLeft: 8 }}>{isSyncing ? '保存中...' : 'クラウドに保存'}</ThemeText>
                  </TouchableOpacity>
                  
                  <TouchableOpacity 
                    style={[styles.syncFullBtn, { backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: COLORS.border }, isSyncing && { opacity: 0.5 }]}
                    disabled={isSyncing}
                    onPress={() => {
                      if (!onForceFetch) return;
                      if (Platform.OS === 'web') {
                        if (window.confirm('クラウドから最新のデータを取得します。現在のローカルの変更は破棄されますが、よろしいですか？')) onForceFetch();
                      } else {
                        Alert.alert(
                          'クラウドから更新',
                          'クラウドから最新のデータを取得します。現在のローカルの変更は破棄されますが、よろしいですか？',
                          [{ text: 'キャンセル', style: 'cancel' }, { text: '更新する', onPress: onForceFetch }]
                        );
                      }
                    }}
                  >
                    <Clock size={18} color={COLORS.text} />
                    <ThemeText bold color={COLORS.text} style={{ marginLeft: 8 }}>{isSyncing ? '更新中...' : 'クラウドから更新'}</ThemeText>
                  </TouchableOpacity>
                </View>
              </ThemeCard>
            </View>
          )}

          <TouchableOpacity style={styles.logoutBtn} onPress={onLogout}><LogOut size={20} color="#ef4444" /><ThemeText bold color="#ef4444" style={{ marginLeft: 10 }}>アプリからログアウト</ThemeText></TouchableOpacity>
        </View>
      </ScrollView>

      {/* --- モーダル群 --- */}
      <Modal visible={showStaffEditModal} transparent animationType="slide">
        <View style={styles.modalOverlay}><View style={[styles.detailModal, {maxHeight: '90%'}]}><View style={{flexDirection:'row', justifyContent:'space-between', marginBottom:20}}><ThemeText variant="h2">職員情報の編集</ThemeText><TouchableOpacity onPress={() => setShowStaffEditModal(false)}><X size={24} color={COLORS.textSecondary} /></TouchableOpacity></View><ScrollView showsVerticalScrollIndicator={false}><ThemeText bold style={{marginBottom:8, fontSize:13, color:COLORS.textSecondary}}>氏名</ThemeText><TextInput style={styles.modalInput} value={editName} onChangeText={setEditName} placeholder="氏名を入力" placeholderTextColor={COLORS.textSecondary} /><DropdownSelector label="職種" value={editProfession} options={PROFESSION_OPTS} onSelect={setEditProfession} /><DropdownSelector label="役割(ポジション)" value={editPosition} options={POSITION_OPTS} onSelect={setEditPosition} /><DropdownSelector label="配置" value={editPlacement} options={PLACEMENT_OPTS} onSelect={setEditPlacement} /><DropdownSelector label="ステータス" value={editStatus} options={STATUS_OPTS} onSelect={setEditStatus} /><DropdownSelector label="休日設定 (自動割当条件)" value={editNoHoliday} options={HOLIDAY_SETTING_OPTS} onSelect={setEditNoHoliday} /><DropdownSelector label="アプリ権限" value={editRole} options={ROLE_OPTS} onSelect={setEditRole} /><View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}><TouchableOpacity style={styles.cancelBtn} onPress={() => setShowStaffEditModal(false)}><ThemeText bold>キャンセル</ThemeText></TouchableOpacity><TouchableOpacity style={styles.confirmBtn} onPress={handleStaffUpdate}><ThemeText bold color="white">保存する</ThemeText></TouchableOpacity></View><TouchableOpacity style={{ marginTop: 24, padding: 12, alignItems: 'center' }} onPress={() => editStaff && handleDeleteStaff(editStaff.id, editStaff.name)}><ThemeText color="#ef4444">職員を削除する</ThemeText></TouchableOpacity></ScrollView></View></View></Modal>
      <Modal visible={showAdminPassChangeModal} transparent animationType="fade"><View style={styles.modalOverlay}><View style={styles.detailModal}><ThemeText variant="h2" style={{marginBottom:16}}>管理者パスワード変更</ThemeText><TextInput style={styles.modalInput} placeholder="新しいパスワード" secureTextEntry value={newAdminPassInput} onChangeText={setNewAdminPassInput} placeholderTextColor={COLORS.textSecondary} /><View style={{flexDirection:'row', gap:12, marginTop:24}}><TouchableOpacity style={styles.cancelBtn} onPress={()=>setShowAdminPassChangeModal(false)}><ThemeText bold>キャンセル</ThemeText></TouchableOpacity><TouchableOpacity style={[styles.confirmBtn,{backgroundColor:'#38bdf8'}]} onPress={() => { updatePassword(newAdminPassInput); setShowAdminPassChangeModal(false); setNewAdminPassInput(''); Alert.alert('完了', 'パスワードを変更しました。'); }}><ThemeText bold color="white">変更する</ThemeText></TouchableOpacity></View></View></View></Modal>

      {/* --- Maintenance Modal --- */}
      <Modal visible={showMaintenanceModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.detailModal, { maxHeight: '85%' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 }}>
              <ThemeText variant="h2">データ不整合の修復</ThemeText>
              <TouchableOpacity onPress={() => setShowMaintenanceModal(false)}><X size={24} color={COLORS.textSecondary} /></TouchableOpacity>
            </View>
            
            <ThemeText variant="caption" color={COLORS.textSecondary} style={{ marginBottom: 16 }}>
              スタッフリストに存在しない旧名の申請データが見つかりました（計{orphanedRequests.length}件）。
              これらを現在のアルファベット氏名に紐付け直します。
            </ThemeText>

            <ScrollView showsVerticalScrollIndicator={false}>
              {Array.from(new Set(orphanedRequests.map(r => r.staffName))).map(oldName => {
                const count = orphanedRequests.filter(r => r.staffName === oldName).length;
                return (
                  <View key={oldName} style={{ marginBottom: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' }}>
                    <ThemeText bold color={COLORS.primary}>{oldName} ({count}件)</ThemeText>
                    <ThemeText variant="caption" style={{ marginTop: 4 }}>統合先を選択：</ThemeText>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                      {staffList.filter(s => s && s.isApproved).map(s => (
                        <TouchableOpacity 
                          key={s.id} 
                          style={[
                            styles.miniTag, 
                            repairMap[oldName] === s.name && { backgroundColor: COLORS.primary, borderColor: COLORS.primary }
                          ]}
                          onPress={() => setRepairMap(prev => ({ ...prev, [oldName]: s.name }))}
                        >
                          <ThemeText variant="caption" color={repairMap[oldName] === s.name ? 'white' : COLORS.text}>{s.name}</ThemeText>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                );
              })}
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowMaintenanceModal(false)} disabled={isRepairing}>
                <ThemeText bold>閉じる</ThemeText>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.confirmBtn, { backgroundColor: '#a855f7' }]} 
                onPress={handleExecuteRepair} 
                disabled={isRepairing || Object.keys(repairMap).length === 0}
              >
                {isRepairing ? <ActivityIndicator size="small" color="white" /> : <ThemeText bold color="white">実行する</ThemeText>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* --- Styles for tags --- */}
      <View style={{display: 'none'}}>
        <style>
          {`
            .miniTag {
              padding: 4px 10px;
              border-radius: 6px;
              border: 1px solid rgba(255,255,255,0.2);
              margin-right: 6px;
            }
          `}
        </style>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { padding: SPACING.md, paddingTop: 10 },
  itemRow: { flexDirection: 'row', alignItems: 'center', padding: 16, marginBottom: 12, backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 16 },
  approvalItem: { flexDirection: 'row', alignItems: 'center', padding: 12, marginBottom: 8, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 12, borderLeftWidth: 3, borderLeftColor: '#ef4444' },
  miniApproveBtn: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  iconCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center' },
  inlineBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(56, 189, 248, 0.1)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  adminLoginEntry: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(56, 189, 248, 0.15)', height: 60, borderRadius: 16, marginTop: 20, borderWidth: 1, borderColor: 'rgba(56, 189, 248, 0.3)' },
  staffAdminList: { marginBottom: 20 },
  staffAdminItem: { flexDirection: 'row', alignItems: 'center', padding: 12, marginBottom: 8, backgroundColor: 'rgba(255,255,255,0.015)', borderRadius: 12 },
  staffMiniEdit: { flexDirection: 'row', alignItems: 'center', padding: 8, backgroundColor: 'rgba(56, 189, 248, 0.1)', borderRadius: 8 },
  actionRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 60, borderRadius: 16, marginTop: 20, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' },
  dropdownBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, height: 52, paddingHorizontal: 16 },
  limitGrid: { flexDirection: 'row', gap: 12 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center' },
  detailModal: { width: '85%', backgroundColor: '#0f172a', borderRadius: 24, padding: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  modalInput: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, height: 52, paddingHorizontal: 16, color: 'white', fontSize: 16, marginBottom: 8 },
  cancelBtn: { flex: 1, height: 52, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center' },
  confirmBtn: { flex: 1, height: 52, borderRadius: 12, backgroundColor: '#38bdf8', justifyContent: 'center', alignItems: 'center' },
  pickerContainer: { width: '85%', maxHeight: '70%', backgroundColor: '#0f172a', borderRadius: 24, padding: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  syncFullBtn: { flex: 1, height: 52, borderRadius: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  pickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  pickerItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.02)' },
  pickerItemActive: { backgroundColor: 'rgba(56, 189, 248, 0.05)' },
  miniTag: { padding: 4, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', marginRight: 6 }
});
