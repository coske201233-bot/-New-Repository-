import { useState, useEffect, useRef } from 'react';
import { supabase } from '../utils/supabase';
import { STORAGE_KEYS, saveData, loadData } from '../utils/storage';
import { cloudStorage } from '../utils/cloudStorage';
import { checkIsAdmin, cleanupStaffSelectionStorage } from '../utils/authUtils';

export const useAuthSession = () => {
  const [profile, setProfile] = useState<any>(null);
  const profileRef = useRef<any>(null);
  profileRef.current = profile;

  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [sessionDuration, setSessionDuration] = useState(24);
  const [isInitialized, setIsInitialized] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isCheckingProfile, setIsCheckingProfile] = useState(true);
  const [user, setUser] = useState<any>(null);
  const loadingProfileEmailRef = useRef<string | null>(null);

  // CRITICAL ARCHITECT COMMAND: Global Admin Override
  // 共通判定ヘルパーで user / profile の両面から確実に管理者フラグを算出
  const isGlobalAdmin = checkIsAdmin(user, profile);
  
  // Replace standalone isAdminAuthenticated with forced evaluate to prevent race conditions
  const currentAdminState = !!(isGlobalAdmin || isAdminAuthenticated);

  const checkAdmin = (_p: any, u?: any) => {
    const adminStatus = checkIsAdmin(u || user, _p || profile);
    console.log(`[ACL] UserEmail:${(u?.email || user?.email || '')} AdminStatus:${adminStatus} (FORCED_MASTER_KEY)`);
    setIsAdminAuthenticated(adminStatus);
    return adminStatus;
  };

  const loadProfile = async (session: any, nameHint?: string) => {
    const userEmail = session?.user?.email;
    if (!userEmail) {
      setIsCheckingProfile(false);
      setIsInitialized(true);
      return null;
    }

    // Skip if profile is already loaded or currently loading for this user to break loops
    const currentProf = profileRef.current || profile;
    if ((currentProf?.email === userEmail || loadingProfileEmailRef.current === userEmail) && !nameHint) {
      setIsCheckingProfile(false);
      setIsInitialized(true);
      return currentProf;
    }

    loadingProfileEmailRef.current = userEmail;
    setIsCheckingProfile(true);
    setLoadError(null);
    
    try {
      setUser(session.user);
      console.log('--- [AUTH_GATE] Checking profile for:', userEmail);
      
      // 🚨 7-second Timeout Guard for Profile Fetching (prevents premature timeout)
      const fetchWithTimeout = async () => {
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 7000));
        const fetch = supabase.from('staff').select('*').eq('email', userEmail).maybeSingle();
        return Promise.race([fetch, timeout]);
      };

      // 🚨 [EMERGENCY YOSHIDA BYPASS]
      if (userEmail === 'yoshida@reha.local') {
        const yoshidaProfile = { 
          id: session.user.id,
          name: '吉田誠', 
          email: 'yoshida@reha.local', 
          role: 'admin', 
          position: 'Section Chief',
          isApproved: true,
          is_admin: true
        };
        console.log('--- [EMERGENCY] Yoshida Bypass Activated ---');
        setProfile(yoshidaProfile);
        setIsAdminAuthenticated(true);
        await cleanupStaffSelectionStorage();
        return yoshidaProfile;
      }

      // 🚨 [EMERGENCY MAKOTO BYPASS]
      if (userEmail.toLowerCase().includes('makoto')) {
        const makotoProfile = { 
          id: session.user.id,
          name: 'MAKOTO', 
          email: userEmail, 
          role: 'admin', 
          isApproved: true,
          is_admin: true
        };
        console.log('--- [EMERGENCY] Makoto Bypass Activated ---');
        setProfile(makotoProfile);
        setIsAdminAuthenticated(true);
        await cleanupStaffSelectionStorage();
        return makotoProfile;
      }

      let profileData = null;
      try {
        const result: any = await fetchWithTimeout();
        profileData = result.data;
      } catch (timeoutErr) {
        console.warn('--- [AUTH_TIMEOUT] Profile fetch took too long, using fallback ---');
      }

      if (profileData) {
        console.log('Profile found via email:', profileData.name);
        setProfile(profileData);
        const isAdmin = checkAdmin(profileData, session.user);
        if (isAdmin) {
          await cleanupStaffSelectionStorage();
        }
        
        if (!profileData.user_id) {
          await supabase.from('staff').update({ user_id: session.user.id }).eq('id', profileData.id);
        }
        return profileData;
      }

      // Fallback Profile: checkIsAdmin を通すことで、管理者ユーザーが一般スタッフに降格されるのを防止
      const isAdminCandidate = checkIsAdmin(session.user, null);
      const fallbackProfile = { 
        id: session.user.id, 
        name: session.user.user_metadata?.full_name || userEmail.split('@')[0] || (isAdminCandidate ? '管理者' : '利用者'), 
        role: isAdminCandidate ? 'admin' : '一般スタッフ', 
        profession: isAdminCandidate ? '管理者' : '職員',
        email: userEmail,
        isApproved: true,
        is_admin: isAdminCandidate,
      };

      setProfile(fallbackProfile);
      setIsAdminAuthenticated(isAdminCandidate);
      if (isAdminCandidate) {
        await cleanupStaffSelectionStorage();
      }
      return fallbackProfile;
    } catch (e: any) {
      console.error('Critical Profile Error:', e);
      return null;
    } finally {
      loadingProfileEmailRef.current = null;
      setIsCheckingProfile(false);
      setIsInitialized(true);
    }
  };

  useEffect(() => {
    let mounted = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      console.log('Auth event:', _event);
      
      if (session) {
        // タブ切り替え等に伴うTOKEN_REFRESHED時、既にプロファイルが取得済みであれば再フェッチを行わない
        if (_event === 'TOKEN_REFRESHED' && profileRef.current && session.user?.email === profileRef.current?.email) {
          setUser(session.user);
          return;
        }

        setUser(session.user);
        await loadProfile(session);
      } else {
        setUser((prev: any) => {
          if (prev === null) {
            setIsCheckingProfile(false);
            setIsInitialized(true);
            return null;
          }
          setProfile(null);
          setIsAdminAuthenticated(false);
          setIsCheckingProfile(false);
          setIsInitialized(true);
          return null;
        });
      }
    });

    // 8秒後に強制的に初期化フラグを立てるフェイルセーフ（早期ロック解除を防止）
    const failsafeTimer = setTimeout(() => {
      if (mounted && !isInitialized) {
        console.warn('--- [FAILSAFE] Forced initialization unlock after 8s ---');
        setIsInitialized(true);
        setIsCheckingProfile(false);
      }
    }, 8000);

    // Initial session grab
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        setUser(session.user);
        await loadProfile(session);
      } else {
        setIsCheckingProfile(false);
        setIsInitialized(true);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
      clearTimeout(failsafeTimer);
    };
  }, []);

  const login = async (email: string, pass: string) => {
    setLoadError(null);
    setIsCheckingProfile(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });
    
    if (error) {
      setIsCheckingProfile(false);
      await supabase.auth.signOut().catch(() => {});
      throw error;
    }

    try {
      setUser(data.session.user);
      // 権限判定およびプロファイルのロードが完了するまで確実に await
      const loaded = await loadProfile(data.session);
      const isAdm = checkIsAdmin(data.session.user, loaded);
      setIsAdminAuthenticated(isAdm);
      if (isAdm) {
        await cleanupStaffSelectionStorage();
      }
    } finally {
      setIsCheckingProfile(false);
      setIsInitialized(true);
    }
    
    return data.session;
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setUser(null);
    setIsAdminAuthenticated(false);
    await saveData(STORAGE_KEYS.PROFILE, null);
    await cleanupStaffSelectionStorage();
    if (typeof window !== 'undefined') {
      localStorage.clear();
    }
  };

  const isAuthReady = isInitialized && !isCheckingProfile;

  return { 
    user,
    profile, 
    setProfile, 
    isAdminAuthenticated: currentAdminState, 
    setIsAdminAuthenticated, 
    sessionDuration, 
    isInitialized, 
    isCheckingProfile,
    isAuthReady,
    loadError,
    loadProfile,
    login,
    logout 
  };
};
