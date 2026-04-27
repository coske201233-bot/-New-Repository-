import { useState, useEffect, useRef } from 'react';
import { supabase } from '../utils/supabase';
import { STORAGE_KEYS, saveData, loadData } from '../utils/storage';
import { cloudStorage } from '../utils/cloudStorage';

export const useAuthSession = () => {
  const [profile, setProfile] = useState<any>(null);
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [sessionDuration, setSessionDuration] = useState(24);
  const [isInitialized, setIsInitialized] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isCheckingProfile, setIsCheckingProfile] = useState(true);
  const [user, setUser] = useState<any>(null);

  // CRITICAL ARCHITECT COMMAND: Global Admin Override
  const isMasterAdminAuth = user?.email ? user.email.includes('admin@reha.local') : false;
  const isGlobalAdmin = isMasterAdminAuth || (profile?.role === 'admin' || profile?.role?.includes('管理者') || profile?.role?.includes('開発者') || profile?.is_admin === true);
  
  // Replace standalone isAdminAuthenticated with forced evaluate to prevent race conditions
  const currentAdminState = !!(isGlobalAdmin || isAdminAuthenticated);


  const loadProfile = async (session: any, nameHint?: string) => {
    const userEmail = session?.user?.email;
    if (!userEmail) {
      setIsCheckingProfile(false);
      setIsInitialized(true);
      return null;
    }

    // Skip if profile is already loaded for this user to break loops
    if (profile?.email === userEmail && !nameHint) {
      setIsCheckingProfile(false);
      setIsInitialized(true);
      return profile;
    }

    setIsCheckingProfile(true);
    setLoadError(null);
    
    try {
      setUser(session.user);
      console.log('--- [AUTH_GATE] Checking profile for:', userEmail);
      
      // 🚨 CRITICAL: 1.5-second Timeout Guard for Profile Fetching
      const fetchWithTimeout = async () => {
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 1500));
        const fetch = supabase.from('staff').select('*').eq('email', userEmail).maybeSingle();
        return Promise.race([fetch, timeout]);
      };

      // 🚨 [VERSION 48.61 EMERGENCY YOSHIDA BYPASS]
      if (userEmail === 'yoshida@reha.local') {
        const yoshidaProfile = { 
          id: 'yoshida-manual',
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
        return yoshidaProfile;
      }

      // 🚨 [VERSION 49.1 EMERGENCY MAKOTO BYPASS]
      if (userEmail.toLowerCase().includes('makoto')) {
        const makotoProfile = { 
          id: 'makoto-manual',
          name: 'MAKOTO', 
          email: userEmail, 
          role: 'admin', 
          isApproved: true,
          is_admin: true
        };
        console.log('--- [EMERGENCY] Makoto Bypass Activated ---');
        setProfile(makotoProfile);
        setIsAdminAuthenticated(true);
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
        checkAdmin(profileData, session.user);
        
        if (!profileData.user_id) {
          await supabase.from('staff').update({ user_id: session.user.id }).eq('id', profileData.id);
        }
        return profileData;
      }

      // Fallback Profile to unblock the UI
      const fallbackProfile = { 
        id: 'fallback-' + session.user.id, 
        name: session.user.user_metadata?.full_name || userEmail.split('@')[0] || '利用者', 
        role: '一般スタッフ', 
        profession: '職員',
        email: userEmail,
        isApproved: true 
      };

      // 2. VIP Bypass (if still not found)
      const isA = userEmail === 'admin@reha.local' || userEmail === 'admin@example.com' || userEmail.toLowerCase().includes('admin');
      if (isA) {
        const adminProfile = { ...fallbackProfile, role: '開発者', profession: '管理者', is_admin: true };
        setProfile(adminProfile);
        setIsAdminAuthenticated(true);
        return adminProfile;
      }

      setProfile(fallbackProfile);
      return fallbackProfile;
    } catch (e: any) {
      console.error('Critical Profile Error:', e);
      return null;
    } finally {
      setIsCheckingProfile(false);
      setIsInitialized(true);
    }
  };

  useEffect(() => {
    const mounted = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      console.log('Auth event:', _event);
      
      if (session) {
        // Direct email lookup, no loops, no setup screens
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

    // [CRITICAL VERSION 48.61] 1.5秒後に強制的に初期化フラグを立てるフェイルセーフ
    const failsafeTimer = setTimeout(() => {
      if (mounted && !isInitialized) {
        console.warn('--- [FAILSAFE] Forced initialization unlock after 1.5s ---');
        setIsInitialized(true);
      }
    }, 1500);

    // Initial session grab
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        loadProfile(session);
      } else {
        setIsCheckingProfile(false);
        setIsInitialized(true);
      }
    });

    return () => {
      subscription.unsubscribe();
      clearTimeout(failsafeTimer);
    };
  }, []);

  const checkAdmin = (_p: any, u?: any) => {
    const email = (u?.email || user?.email || '').toLowerCase();
    // [VERSION 49.1] Added 'makoto' to admin master list
    const isAdmin = email.includes('admin') || email.includes('makoto') || _p?.role === 'admin' || _p?.role?.includes('管理者') || _p?.is_admin === true;
    
    console.log(`[ACL] UserEmail:${email} AdminStatus:${isAdmin} (FORCED_MASTER_KEY)`);
    setIsAdminAuthenticated(isAdmin);
    return isAdmin;
  };

  const login = async (email: string, pass: string) => {
    setLoadError(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });
    
    if (error) {
      await supabase.auth.signOut().catch(() => {});
      throw error;
    }
    
    // [VERSION 48.62 ABSOLUTE BYPASS]
    // DO NOT await profile loading before unlocking the UI
    console.log('--- [ABSOLUTE_BYPASS] Force unlocking UI gates... ---');
    setIsCheckingProfile(false);
    setIsInitialized(true);
    
    if (email === 'yoshida@reha.local' && !profile) {
      const yoshidaFallback = { 
        id: 'yoshida-force', 
        name: '吉田', 
        email: 'yoshida@reha.local', 
        role: 'admin',
        isApproved: true,
        is_admin: true 
      };
      setProfile(yoshidaFallback);
      setIsAdminAuthenticated(true);
    }
    
    // Start profile load in background, do not block
    loadProfile(data.session).catch(e => console.warn('Background profile load failed:', e));
    
    return data.session;
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setUser(null);
    setIsAdminAuthenticated(false);
    await saveData(STORAGE_KEYS.PROFILE, null);
    if (typeof window !== 'undefined') {
      localStorage.clear();
      window.location.href = '/';
    }
  };

  return { 
    user,
    profile, 
    setProfile, 
    isAdminAuthenticated: currentAdminState, 
    setIsAdminAuthenticated, 
    sessionDuration, 
    isInitialized, 
    isCheckingProfile,
    loadError,
    loadProfile,
    login,
    logout 
  };
}
