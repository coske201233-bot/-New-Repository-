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
    patchStaff,
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
      staffList, setStaffList, updateStaffList, patchStaff,
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
          <ThemeText style={styles.buildBannerText}>[BUILD: VERSION 49.0 - STABLE RELEASE]</ThemeText>
        </View>

        {/* --- [STRICT BINARY ROUTING] --- */}
        {(!logic.isInitialized) ? (
          <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
            <ActivityIndicator size="large" color={COLORS.primary || '#0ea5e9'} />
            <ThemeText style={{ marginTop: 16 }}>初期化中...</ThemeText>
          </SafeAreaView>
        ) : (!logic.user) ? (
          /* --- [AUTH FLOW] --- */
          showSetup ? (
            <SetupScreen onComplete={setProfile} onBack={() => setShowSetup(false)} />
          ) : (
            <LoginScreen onLogin={logic.handleLogin} />
          )
        ) : (
          /* --- [MAIN APP FLOW] --- */
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

