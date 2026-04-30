import React, { useState } from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity, TextInput, Alert, Modal, ActivityIndicator, SafeAreaView, Platform } from 'react-native';
import { ThemeText } from '../components/ThemeText';
import { ThemeCard } from '../components/ThemeCard';
import { COLORS, SPACING } from '../theme/theme';
import { 
  ChevronRight, Database, FileOutput, 
  QrCode, X, Check, Shield, User, Key, Save, LogOut, Edit3, Printer, FileText, UserPlus, Clock
} from 'lucide-react-native';
import { getMonthInfo, normalizeName, formatDate, getDayType } from '../utils/dateUtils';
import { cloudStorage } from '../utils/cloudStorage';
import { supabase } from '../utils/supabase';
import * as Print from 'expo-print';
import { generateMonthlyShifts } from '../utils/shiftEngine';


interface AdminScreenProps {
  profile: any;
  setProfile: (p: any) => void;
  staffList: any[];
  setStaffList: (staff: any[] | ((prev: any[]) => any[])) => void;
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
  updateStaffList: (update: any[] | ((prev: any[]) => any[])) => Promise<any>;
  patchStaff: (id: string, updates: any) => Promise<any>;
  fetchShifts?: () => Promise<void>;
}

export const AdminScreen: React.FC<AdminScreenProps> = ({
  profile, setProfile, staffList = [], setStaffList,
  updateLimits, updatePassword, monthlyLimits = {}, adminPassword, onShareApp,
  currentDate = new Date(), onAutoAssign, onUndoAutoAssign, canUndoAutoAssign, isAdminAuthenticated, setIsAdminAuthenticated, onLogout, requests = [], setRequests,
  updateStaffList, patchStaff, fetchShifts
}) => {

  
  const [showPersonalPassModal, setShowPersonalPassModal] = useState(false);
  const [personalPassInput, setPersonalPassInput] = useState('');
  


  const [editStaff, setEditStaff] = useState<any>(null);
  const [showStaffEditModal, setShowStaffEditModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editJobType, setEditJobType] = useState('');
  const [editPlacement, setEditPlacement] = useState('');
  const [editRole, setEditRole] = useState('');
  const [editStatus, setEditStatus] = useState('常勤');
  const [editNoHoliday, setEditNoHoliday] = useState(false);
  const [editPermissions, setEditPermissions] = useState(['スタッフ']);
  
  const [isAssigning, setIsAssigning] = useState(false);
 
  // [CRITICAL VERSION 49.0] 自動管理者認証バイパス
  React.useEffect(() => {
    const isPowerUser = profile?.role === 'admin' || profile?.role === '管理者' || profile?.role === '開発者' || profile?.is_admin === true;
    if (isPowerUser && !isAdminAuthenticated) {
      console.log('--- [AUTO_ADMIN] Role-based bypass activated for:', profile.name);
      setIsAdminAuthenticated(true);
    }
  }, [profile, isAdminAuthenticated]);

  // Safeguard: Ensure currentDate exists
  const safeDate = currentDate || new Date();
  const currentYear = safeDate.getFullYear();
  const currentMonth = safeDate.getMonth();
  const currentMonthStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
  const limits = (monthlyLimits && monthlyLimits[currentMonthStr]) || { weekday: 12, sat: 1, sun: 0, pub: 1 };

  // --- Approvals Filtering with safeguards and logical fixes ---
  const pendingRequests = Array.isArray(requests) ? requests.filter(r => r && (r.status === 'pending' || !r.status)) : [];

  // --- Constant Options (Custom Hospital Structure) ---
  const PROFESSION_OPTS = ['PT', 'OT', 'ST', '助手'];
  const PLACEMENT_OPTS = ['２F', '包括', '4F', '外来', 'フォロー', '兼務', '管理', '事務', '排尿管理', '訪問リハ'];
  const POSITION_OPTS = ['科長', '科長補佐', '係長', '主査', '主任', '主事', '会計年度'];
  const STATUS_OPTS = ['常勤', '時短勤務', '長期休暇', 'その他'];
  const HOLIDAY_SETTING_OPTS = [{ label: '設定なし', value: false }, { label: '土日祝休み', value: true }];
  const ROLE_OPTS = [{ label: '一般スタッフ', value: ['スタッフ'] }, { label: 'シフト管理者', value: ['管理者', 'スタッフ'] }];

  // --- Handlers ---


  const handleApproveRequest = async (req: any) => {
    try {
      const updatedReq = { ...req, status: 'approved' };
      setRequests(prev => prev.map(r => r.id === req.id ? updatedReq : r));
      await cloudStorage.upsertRequests([updatedReq]);
      Alert.alert('完了', '申請を承認しました。');
    } catch (error: any) {
      console.error("UPDATE ERROR:", error);
      Alert.alert("保存に失敗しました", (error.message || "不明なエラー") + "\n" + (error.details || ""));
    }
  };

  const handleRejectRequest = async (id: string) => {
    try {
      // 物理削除を実行
      await cloudStorage.deleteRequest(id);
      setRequests(prev => prev.filter(r => r.id !== id));
      Alert.alert('完了', '申請を却下し、削除しました。');
    } catch (e) {
      console.error('Reject error:', e);
      Alert.alert('エラー', '却下処理中にエラーが発生しました。');
    }
  };

  const handlePrintAttendanceReport = () => {
    if (Platform.OS !== 'web') return;
    
    try {
      // データの準備
      const year = currentYear;
      const month = currentMonth + 1;
      const monthInfoArr = getMonthInfo(year, currentMonth) || [];
      const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
      const currentMonthKey = `${year}-${String(month).padStart(2, '0')}`;
      
      // ヘッダー
      let headerHtml = '<th style="width: 80px;">氏名</th><th style="width: 40px;">職種</th>';
      monthInfoArr.forEach((d: any) => {
        if (!d.empty) {
          const dDate = new Date(d.dateStr);
          const dayIdx = isNaN(dDate.getTime()) ? 0 : dDate.getDay();
          const style = (d.isH || dayIdx === 0) ? 'color: #ef4444; background-color: #fef2f2;' : (dayIdx === 6 ? 'color: #3b82f6; background-color: #eff6ff;' : '');
          headerHtml += `<th style="${style}">${d.day}<br/><small>${dayNames[dayIdx]}</small></th>`;
        }
      });

      // 行データ
      let rowsHtml = '';
      const listToPrint = staffList.filter(s => s && s.isApproved);
      listToPrint.forEach(s => {
        let row = `<tr><td style="text-align: left; padding-left: 5px; font-weight: bold;">${s.name}</td><td>${s.jobType || ''}</td>`;
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
              type = (dtype === 'weekday') ? '出勤' : (isNoHoliday ? '日勤' : '公休');
            }

            const isOff = ['公休', '年休', '特休', '休暇', '欠勤'].includes(type);
            const style = isOff ? 'background-color: #fef2f2; color: #ef4444;' : '';
            const label = type === '公休' ? '公' : (type === '日勤' || type === '出勤' ? '日' : (type === '夜勤' ? '夜' : (type === '早番' ? '早' : (type === '遅番' ? '遅' : (type ? type.charAt(0) : '')))));
            row += `<td style="${style}">${label}</td>`;
          }
        });
        row += '</tr>';
        rowsHtml += row;
      });

      const html = `
        <html>
          <head>
            <title>勤務実績表</title>
            <style>
              @page { size: A4 landscape; margin: 5mm; }
              body { font-family: sans-serif; padding: 10px; color: #1e293b; }
              .header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 10px; border-bottom: 2px solid #38bdf8; padding-bottom: 5px; }
              table { width: 100%; border-collapse: collapse; table-layout: fixed; border: 2px solid #334155; }
              th, td { border: 1px solid #94a3b8; padding: 2px 1px; text-align: center; font-size: 9px; }
              th { background-color: #f1f5f9; font-weight: bold; }
              td { height: 22px; }
            </style>
          </head>
          <body>
            <div class="header">
              <h1 style="margin:0; font-size:18px;">勤務実績表（${year}年${month}月）</h1>
              <div style="font-size: 11px;">印刷日: ${new Date().toLocaleDateString('ja-JP')}</div>
            </div>
            <table><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>
            <script>window.onload=function(){window.print();};<\\/script>
          </body>
        </html>
      `;

      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
      } else {
        Alert.alert('ポップアップ制限', 'ブラウザのポップアップ設定を許可してください。');
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






  const handlePersonalPassUpdate = async () => {
    if (!personalPassInput) {
      Alert.alert('入力エラー', '新しいパスワードを入力してください。');
      return;
    }
    const updatedProfile = { ...profile, password: personalPassInput };
    setProfile(updatedProfile);
    
    // 同時にスタッフリストも更新して永続化（localStorage sync）をトリガー
    await updateStaffList((prev: any[]) => prev.map(s => s && s.id === profile.id ? updatedProfile : s));
    
    setShowPersonalPassModal(false);
    setPersonalPassInput('');
    Alert.alert('完了', '個人パスワードを更新しました。');
  };



  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}><ThemeText variant="h1">設定</ThemeText><ThemeText variant="caption" color={COLORS.textSecondary}>個人設定と管理機能</ThemeText></View>
      <ScrollView style={{ flex: 1 }}>
        <View style={{ padding: SPACING.md }}>



          {isAdminAuthenticated ? (
            <View style={{ marginTop: 24 }}>

              <ThemeText bold style={{ color: '#ef4444', marginBottom: 12, marginTop: 12 }}>🔔 承認が必要な申請</ThemeText>
              


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

              {pendingRequests.length === 0 ? (
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
                    console.log('[AdminScreen] 「自動生成」ボタンが押されました。');
                    setIsAssigning(true);
                    try {
                      console.log('[AdminScreen] シフト生成開始: ' + currentYear + '年' + (currentMonth + 1) + '月');
                      
                      const result = await generateMonthlyShifts(currentYear, currentMonth + 1, {
                        weekdayCap: limits.weekday,
                        satCap: limits.sat,
                        sunCap: limits.sun,
                        holidayCap: limits.pub
                      });
                      
                      console.log('[AdminScreen] シフト生成完了。レコード数: ' + (result?.length || 0));
                      Alert.alert('完了', 'シフトの自動割り当てが完了しました。');

                      // グローバルなシフトステートを最新化
                      if (fetchShifts) {
                        console.log('[AdminScreen] 全体ステートをリフレッシュ中...');
                        await fetchShifts();
                      }
                      
                      // ターゲット月の旧自動生成リクエスト（UI用）をパージ
                      const monthPrefix = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
                      setRequests((prev: any[]) => prev.filter(
                        r => !(String(r.id || '').startsWith('auto-') && r.date && r.date.startsWith(monthPrefix))
                      ));

                    } catch (e: any) {
                      console.error('[AdminScreen] 自動割り当てエラー:', e);
                      Alert.alert(
                        'エラーが発生しました',
                        'シフト生成中に問題が発生しました。\n\n' + (e.message || '不明なエラー')
                      );
                    } finally {
                      setIsAssigning(false);
                      console.log('[AdminScreen] 処理終了 (Loading state cleared)');
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
                <View style={styles.iconCircle}><Key size={20} color="#a855f7" /></View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <ThemeText bold>個人パスワード変更</ThemeText>
                  <ThemeText variant="caption" color={COLORS.textSecondary}>現在のログインユーザーのパスワードを変更します</ThemeText>
                </View>
                <TouchableOpacity style={[styles.inlineBtn, { backgroundColor: 'rgba(168, 85, 247, 0.1)' }]} onPress={() => setShowPersonalPassModal(true)}>
                  <ThemeText bold color="#a855f7">変更</ThemeText>
                </TouchableOpacity>
              </ThemeCard>





              <View style={{ marginTop: 24, paddingBottom: 40 }}>
                <ThemeText bold variant="h2" style={{ marginBottom: 16 }}>📈 {currentMonth + 1}月の必要人数設定</ThemeText>
                <View style={styles.limitGrid}>
                  {/* [V60.4] 平日の上限設定を廃止 */}
                  <View style={{ flex: 1 }} />
                  <DropdownSelector label="土曜" value={limits.sat} options={Array.from({length:21}, (_,i)=>i)} onSelect={(v:number)=>updateLimits('sat', v, currentMonthStr)} style={{flex:1}} />
                </View>
                <View style={styles.limitGrid}>
                  <DropdownSelector label="日曜" value={limits.sun} options={Array.from({length:21}, (_,i)=>i)} onSelect={(v:number)=>updateLimits('sun', v, currentMonthStr)} style={{flex:1}} />
                  <DropdownSelector label="祝日" value={limits.pub} options={Array.from({length:21}, (_,i)=>i)} onSelect={(v:number)=>updateLimits('pub', v, currentMonthStr)} style={{flex:1}} />
                </View>
              </View>
            </View>
          ) : null}
          <TouchableOpacity style={styles.logoutBtn} onPress={onLogout}><LogOut size={20} color="#ef4444" /><ThemeText bold color="#ef4444" style={{ marginLeft: 10 }}>アプリからログアウト</ThemeText></TouchableOpacity>
        </View>
      </ScrollView>

      {/* --- モーダル群 --- */}

      <Modal visible={showPersonalPassModal} transparent animationType="fade"><View style={styles.modalOverlay}><View style={styles.detailModal}><ThemeText variant="h2" style={{marginBottom:16}}>個人パスワードの変更</ThemeText><TextInput style={styles.modalInput} placeholder="新しいパスワード" secureTextEntry value={personalPassInput} onChangeText={setPersonalPassInput} placeholderTextColor={COLORS.textSecondary} /><View style={{flexDirection:'row', gap:12, marginTop:24}}><TouchableOpacity style={styles.cancelBtn} onPress={()=>setShowPersonalPassModal(false)}><ThemeText bold>キャンセル</ThemeText></TouchableOpacity><TouchableOpacity style={[styles.confirmBtn,{backgroundColor:'#a855f7'}]} onPress={handlePersonalPassUpdate}><ThemeText bold color="white">更新する</ThemeText></TouchableOpacity></View></View></View></Modal>


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
    paddingTop: 10, 
    width: '100%',
    alignItems: 'stretch',
    alignSelf: 'stretch'
  },
  itemRow: { flexDirection: 'row', alignItems: 'center', padding: 16, marginBottom: 12, backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 16, width: '100%' },
  approvalItem: { flexDirection: 'row', alignItems: 'center', padding: 12, marginBottom: 8, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 12, borderLeftWidth: 3, borderLeftColor: '#ef4444', width: '100%' },
  miniApproveBtn: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  iconCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center' },
  inlineBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(56, 189, 248, 0.1)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },

  staffAdminList: { marginBottom: 20, width: '100%' },
  staffAdminItem: { flexDirection: 'row', alignItems: 'center', padding: 12, marginBottom: 8, backgroundColor: 'rgba(255,255,255,0.015)', borderRadius: 12, width: '100%' },
  staffMiniEdit: { flexDirection: 'row', alignItems: 'center', padding: 8, backgroundColor: 'rgba(56, 189, 248, 0.1)', borderRadius: 8 },
  actionRow: { flexDirection: 'row', gap: 12, marginBottom: 20, width: '100%' },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 60, borderRadius: 16, marginTop: 20, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)', width: '100%' },
  dropdownBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, height: 52, paddingHorizontal: 16, width: '100%' },
  limitGrid: { flexDirection: 'row', gap: 12, width: '100%' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', width: '100%' },
  detailModal: { width: '90%', backgroundColor: '#0f172a', borderRadius: 24, padding: 24, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  modalInput: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, height: 52, paddingHorizontal: 16, color: 'white', fontSize: 16, marginBottom: 8, width: '100%' },
  cancelBtn: { flex: 1, height: 52, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center' },
  confirmBtn: { flex: 1, height: 52, borderRadius: 12, backgroundColor: '#38bdf8', justifyContent: 'center', alignItems: 'center' },
  pickerContainer: { width: '90%', maxHeight: '70%', backgroundColor: '#0f172a', borderRadius: 24, padding: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  pickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)', width: '100%' },
  pickerItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.02)', width: '100%' },
  pickerItemActive: { backgroundColor: 'rgba(56, 189, 248, 0.05)' }
});
