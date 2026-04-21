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
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [user, setUser] = useState<any>(null);
  const nameHintRef = useRef<string | null>(null);

  // CRITICAL ARCHITECT COMMAND: Global Admin Override
  const isMasterAdminAuth = user?.email?.includes('admin@reha.local') || false;
  const isGlobalAdmin = isMasterAdminAuth || profile?.role === 'admin' || profile?.role?.includes('開発者') || profile?.is_admin === true;
  
  // Replace standalone isAdminAuthenticated with forced evaluate to prevent race conditions
  const currentAdminState = isGlobalAdmin || isAdminAuthenticated;

  const loadProfile = async (session: any, nameHint?: string) => {
    if (isLoadingProfile) return null;
    setIsLoadingProfile(true);
    setLoadError(null);
    
    try {
      if (session?.user) {
        setUser(session.user);
        console.log('--- [AUTH_SYNC] Loading profile for:', session.user.email);
        
        const userId = session?.user?.id;
        if (!userId) {
          console.warn('--- [AUTH_SYNC] No UserID found in session. ---');
          return null;
        }

        // 1. user_id による直接検索 (最も安全)
        const { data: directProfile, error: directError } = await supabase
          .from('staff')
          .select('*')
          .eq('user_id', userId)
          .maybeSingle();

        if (directProfile) {
          console.log('Profile found via user_id:', directProfile.name);
          setProfile(directProfile);
          checkAdmin(directProfile, session.user);
          await saveData(STORAGE_KEYS.PROFILE, directProfile);
          return directProfile;
        }

        if (directError) {
          console.error('Profile fetch error:', directError);
        }

        // 2. 自己修復: user_id が見つからない場合、名前またはメールでの紐付けを試行
        const searchName = nameHint || session?.user?.user_metadata?.full_name || session?.user?.email?.split('@')[0];
        console.log('Attempting self-healing for identity:', searchName);

        // a. まずメールアドレスで検索 (一意性が高い)
        const { data: emailProfile } = await supabase
          .from('staff')
          .select('*')
          .eq('email', session.user.email)
          .is('user_id', null)
          .maybeSingle();

        // b. 見つからなければ名前で検索
        let targetProfile = emailProfile;
        if (!targetProfile && searchName) {
           const { data: nameProfile } = await supabase
            .from('staff')
            .select('*')
            .ilike('name', `%${searchName}%`)
            .is('user_id', null)
            .maybeSingle();
           targetProfile = nameProfile;
        }

        if (targetProfile) {
          console.log('Match found! Binding user_id to staff:', targetProfile.name);
          const { data: updated, error: updateError } = await supabase
            .from('staff')
            .update({ 
              user_id: session.user.id,
              email: targetProfile.email || session.user.email // メールも同期
            })
            .eq('id', targetProfile.id)
            .select()
            .single();
          
          if (!updateError && updated) {
            setProfile(updated);
            checkAdmin(updated, session.user);
            await saveData(STORAGE_KEYS.PROFILE, updated);
            return updated;
          }
           console.error('Binding failed:', updateError);
        }

        // 3. 特例：管理者 (adminメールの場合)
        const userEmail = session?.user?.email || '';
        if (userEmail === 'admin@reha.local' || userEmail === 'admin@example.com' || userEmail.startsWith('admin')) {
          console.log('--- [AUTH_BYPASS] VIP Admin detected, injecting mock profile ---');
          const adminProfile = { 
            id: 'admin-' + session.user.id, 
            name: userEmail === 'admin@reha.local' ? '最高管理者' : '管理者', 
            role: '開発者', 
            profession: '管理者', 
            isApproved: true,
            is_admin: true 
          };
          setProfile(adminProfile);
          setIsAdminAuthenticated(true);
          return adminProfile;
        }
        
        // 最終的に見つからない場合
        setLoadError('職員名簿にあなたの名前が見つかりません。管理者に名前の登録を依頼してください。');
      } else {
        // セッションがない場合はローカルから復元試行
        const savedProfile = await loadData(STORAGE_KEYS.PROFILE);
        if (savedProfile) {
          setProfile(savedProfile);
          checkAdmin(savedProfile);
          return savedProfile;
        }
      }
      return null;
    } catch (e: any) {
      console.error('Critical Profile Error:', e);
      setLoadError('プロファイルの読み込み中にエラーが発生しました。');
      return null;
    } finally {
      setIsLoadingProfile(false);
      setIsInitialized(true);
    }
  };

  useEffect(() => {
    // 1. Supabase Auth セッションの監視
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      console.log('Auth state change event:', _event);
      if (_event === 'SIGNED_IN' || _event === 'INITIAL_SESSION' || _event === 'TOKEN_REFRESHED') {
        await loadProfile(session);
      } else if (_event === 'SIGNED_OUT') {
        setProfile(null);
        setUser(null);
        setIsAdminAuthenticated(false);
        await saveData(STORAGE_KEYS.PROFILE, null);
      }
    });

    // Initial check
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) loadProfile(session);
      else setIsInitialized(true);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const checkAdmin = (_p: any, u?: any) => {
    const email = u?.email || user?.email || session?.user?.email || '';
    const isAdmin = email.toLowerCase().includes('admin');
    
    console.log(`[ACL] UserEmail:${email} AdminStatus:${isAdmin} (FORCED_MASTER_KEY)`);
    setIsAdminAuthenticated(isAdmin);
    return isAdmin;
  };

  const login = async (email: string, pass: string) => {
    setLoadError(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if (error) throw error;
    // ログイン成功直後にプロファイルをロード
    await loadProfile(data.session);
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
    loadError,
    loadProfile,
    login,
    logout 
  };
}
