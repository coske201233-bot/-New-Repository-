import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, TouchableOpacity, SafeAreaView, Alert, Platform, AppState, TextInput, ActivityIndicator, Text as RNText } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Home, Calendar, User, ClipboardList, Users, Shield, RefreshCw, AlertTriangle } from 'lucide-react-native';
import { ThemeCard } from './src/components/ThemeCard';
import { HomeScreen } from './src/screens/HomeScreen';
import { CalendarScreen } from './src/screens/CalendarScreen';
import { RequestScreen } from './src/screens/RequestScreen';
import { StaffScreen } from './src/screens/StaffScreen';
import { AdminScreen } from './src/screens/AdminScreen';
import { AdminRequestScreen } from './src/screens/AdminRequestScreen';
import { QrShareScreen } from './src/screens/QrShareScreen';
import { SetupScreen } from './src/screens/SetupScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { ThemeText } from './src/components/ThemeText';
import { COLORS, SPACING } from './src/theme/theme';
import { getDateStr } from './src/utils/dateUtils';
import { useAppLogic } from './src/hooks/useAppLogic';
import { supabase, isSupabaseAuthReady } from './src/utils/supabase';

/**
 * VERSION 44.2 [RESILIENCE]
 * クリティカル: ホワイトスクリーン (WSOD) 対策
 * 構文エラーや予期せぬ実行エラーを画面にトラップし、原因を可視化します。
 */
function ErrorFallback({ error }: { error: string }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#000', padding: 20, justifyContent: 'center', alignItems: 'center' }}>
      <AlertTriangle size={64} color="#fca5a5" style={{ marginBottom: 20 }} />
      <RNText style={{ color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 12 }}>アプリケーションエラー</RNText>
      <RNText style={{ color: '#fca5a5', fontSize: 14, marginBottom: 32, textAlign: 'center' }}>{error}</RNText>
      <TouchableOpacity 
        style={{ backgroundColor: '#fff', padding: 16, borderRadius: 8 }}
        onPress={() => Platform.OS === 'web' ? window.location.reload() : null}
      >
        <RNText style={{ color: '#000', fontWeight: 'bold' }}>再読み込み</RNText>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

export default function App() {
  const [fatalError, setFatalError] = useState<string | null>(null);

  useEffect(() => {
    // グローバルエラーキャッチ
    const errorHandler = (e: any) => {
      console.error('Fatal App Error:', e);
      setFatalError(e.message || String(e));
    };
    
    if (Platform.OS === 'web') {
      window.onerror = (msg) => { setFatalError(String(msg)); return false; };
      window.onunhandledrejection = (e) => { setFatalError(String(e.reason)); };
    }
  }, []);

  const logic = useAppLogic();
  
  const {
    currentTab, setCurrentTab,
    showSetup, setShowSetup,
    staffList, setStaffList,
    requests, setRequests,
    profile, setProfile,
    weekdayLimit, saturdayLimit, sundayLimit, publicHolidayLimit,
    monthlyLimits, updateLimits,
    adminPassword, updatePassword,
    isAdminAuthenticated, setIsAdminAuthenticated,
    staffViewMode, setStaffViewMode,
    sessionDuration, setSessionDuration,
    isInitialized, isSyncing,
    activeDate, setActiveDate,
    holidayLimit,
    handleLogout,
    handleForceCloudSync,
    onSubmitRequest,
    cancelRequest,
    approveRequest,
    onDeleteRequest,
    onDeleteStaff,
    onAutoAssign,
    onUndoAutoAssign,
    canUndoAutoAssign,
    updateStaffList,
    handleLogin,
  } = logic;

  useEffect(() => {
    // Connection health check
    if (isSupabaseAuthReady) {
      console.log('✅ Supabase Auth: READY');
    } else {
      console.warn('⚠️ Supabase Auth: NOT READY (Check .env.local)');
    }
  }, []);

  if (fatalError) return <ErrorFallback error={fatalError} />;

  const renderContent = () => {
    const commonProps = {
      staffList, setStaffList, updateStaffList,
      requests, setRequests,
      onDeleteRequest,
      onDeleteStaff,
      onDeleteRequests: async (ids: string[]) => {
        for (const id of ids) {
          await onDeleteRequest(id);
        }
      },
      approveRequest,
      profile, setProfile,
      weekdayLimit, holidayLimit, saturdayLimit, sundayLimit, publicHolidayLimit,
      monthlyLimits, updateLimits,
      adminPassword, updatePassword,
      isAdminAuthenticated, setIsAdminAuthenticated,
      onOpenRequests: () => setCurrentTab('adminRequests'),
      onShareApp: () => setCurrentTab('qrShare'),
      onLogout: handleLogout,
      staffViewMode,
      setStaffViewMode,
      sessionDuration,
      setSessionDuration,
      onForceCloudSync: handleForceCloudSync,
      currentDate: activeDate, setCurrentDate: setActiveDate,
      onAutoAssign,
      onUndoAutoAssign,
      canUndoAutoAssign,
      isInitialized,
    };

    switch (currentTab) {
      case 'home': return <HomeScreen onNavigateToStaff={() => setCurrentTab('staff')} {...commonProps} />;
      case 'calendar': return <CalendarScreen {...commonProps} />;
      case 'requests': return <RequestScreen {...commonProps} />;
      case 'staff': return <StaffScreen {...commonProps} isPrivileged={isAdminAuthenticated} />;
      case 'admin': return <AdminScreen {...commonProps} />;
      case 'adminRequests': return <AdminRequestScreen onBack={() => setCurrentTab('admin')} requests={requests} approveRequest={approveRequest} deleteRequest={onDeleteRequest} />;
      case 'qrShare': return <QrShareScreen onBack={() => setCurrentTab('admin')} />;
      default: return <HomeScreen onNavigateToStaff={() => setCurrentTab('staff')} {...commonProps} />;
    }
  };

  return (
    <SafeAreaProvider>
      <View style={styles.container}>
        <StatusBar style="light" />
        <View style={styles.buildBanner}>
          <ThemeText style={styles.buildBannerText}>[BUILD: VERSION 47.3 - ADMIN ENFORCED]</ThemeText>
        </View>
        {(!profile && !logic.user) ? (
          showSetup ? (
            <SetupScreen onComplete={setProfile} onBack={() => setShowSetup(false)} />
          ) : (
            <LoginScreen onLogin={handleLogin} />
          )
        ) : (!profile || (profile.isApproved === false && logic.user?.email !== 'admin@reha.local')) ? (
          // ロード中または承認待ち (VIP管理者 admin@reha.local はバイパス)
          <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: SPACING.xl }]}>
            <View style={{ width: '100%', alignItems: 'center' }}>
              <ThemeCard style={{ padding: 40, width: '100%', alignItems: 'center', borderRadius: 32 }}>
                <View style={{ backgroundColor: 'rgba(56, 189, 248, 0.1)', padding: 24, borderRadius: 100, marginBottom: 24 }}>
                  <Shield size={48} color={COLORS.primary} />
                </View>
                <ThemeText variant="h1" style={{ marginBottom: 12, textAlign: 'center' }}>登録承認待ち</ThemeText>
                <ThemeText variant="body" color={COLORS.textSecondary} style={{ textAlign: 'center', lineHeight: 24, marginBottom: 32 }}>
                  {profile?.name || 'スタッフ'} さんの登録申請を送信しました。{"\n"}
                  管理者が承認するまで、しばらくお待ちください。{"\n"}
                  （承認後にアプリが利用可能になります）
                </ThemeText>
                
                {logic.user?.email === 'admin@reha.local' && (
                  <TouchableOpacity 
                    style={{ marginBottom: 20, padding: 12, backgroundColor: '#fef3c7', borderRadius: 12, borderWidth: 1, borderColor: '#f59e0b', width: '100%' }}
                    onPress={() => {
                      console.log('--- [ARCHITECT_BYPASS] Manual force dashboard ---');
                      setProfile(prev => ({ ...prev, isApproved: true } as any));
                    }}
                  >
                    <ThemeText style={{ color: '#92400e', fontSize: 13, fontWeight: '700', textAlign: 'center' }}>
                      [ARCHITECT BYPASS: VIP ADMIN DETECTED]
                    </ThemeText>
                    <ThemeText style={{ color: '#b45309', fontSize: 11, textAlign: 'center', marginTop: 4 }}>
                      ここをタップして強制的にダッシュボードへ移動
                    </ThemeText>
                  </TouchableOpacity>
                )}
                
                <TouchableOpacity 
                  style={{ backgroundColor: COLORS.primary, paddingHorizontal: 32, paddingVertical: 16, borderRadius: 16, flexDirection: 'row', alignItems: 'center', opacity: isSyncing ? 0.7 : 1 }}
                  disabled={isSyncing}
                  onPress={async () => {
                    const success = await handleForceCloudSync();
                    if (success) {
                      Alert.alert('確認', '最新のステータスを確認しました。');
                    }
                  }}
                >
                  {isSyncing ? (
                    <ActivityIndicator size="small" color="white" style={{ marginRight: 8 }} />
                  ) : (
                    <RefreshCw size={20} color="white" style={{ marginRight: 8 }} />
                  )}
                  <ThemeText bold color="white">{isSyncing ? '確認中...' : '最新の状態に更新'}</ThemeText>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={{ marginTop: 40 }}
                  onPress={handleLogout}
                >
                  <ThemeText color="#ef4444">入力をやり直す (ログアウト)</ThemeText>
                </TouchableOpacity>
              </ThemeCard>
            </View>
          </SafeAreaView>
        ) : (
          <>
            <View style={styles.content}>{renderContent()}</View>
            <SafeAreaView style={styles.tabBarContainer}>
              <View style={styles.tabBar}>
                {[
                  { id: 'home', icon: Home, label: 'ホーム' },
                  { id: 'calendar', icon: Calendar, label: '出勤' },
                  { id: 'staff', icon: Users, label: '職員' },
                  { id: 'requests', icon: ClipboardList, label: '申請' },
                  ...(isAdminAuthenticated ? [{ id: 'admin', icon: Shield, label: '管理・設定' }] : [])
                ].map(tab => (
                  <TouchableOpacity key={tab.id} style={styles.tabItem} onPress={() => setCurrentTab(tab.id)} activeOpacity={0.7}>
                    <tab.icon size={24} color={currentTab === tab.id ? COLORS.primary : COLORS.textSecondary} />
                    <ThemeText variant="caption" style={{ marginTop: 4, fontSize: 9, color: currentTab === tab.id ? COLORS.primary : COLORS.textSecondary }}>{tab.label}</ThemeText>
                  </TouchableOpacity>
                ))}
              </View>
            </SafeAreaView>
          </>
        )}
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  buildBanner: { backgroundColor: '#1e293b', paddingVertical: 4, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#334155' },
  buildBannerText: { color: COLORS.primary, fontSize: 10, fontWeight: 'bold', letterSpacing: 1 },
  content: { flex: 1 },
  tabBarContainer: { backgroundColor: COLORS.card, borderTopWidth: 1, borderTopColor: COLORS.border },
  tabBar: { flexDirection: 'row', height: 60, alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, paddingBottom: 8 },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 8 },
});

