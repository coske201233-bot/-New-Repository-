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
  const nameHintRef = useRef<string | null>(null);

  const loadProfile = async (session: any, nameHint?: string) => {
    if (isLoadingProfile) return null;
    setIsLoadingProfile(true);
    
    try {
      if (session?.user) {
        console.log('Loading profile for user:', session.user.id, 'nameHint:', nameHint);
        
        // 1. まずは user_id での直接検索
        const { data: directProfile, error: directError } = await supabase
          .from('staff')
          .select('*')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (directError) {
          console.error('Supabase profile fetch error:', directError);
          if (directError.status === 406 || String(directError.message).includes('406')) {
            setLoadError('データベース構成エラー (カラム user_id は存在するはずですがアクセスに失敗しました。RLSの設定を確認してください)');
          }
        }

        if (directProfile) {
          setProfile(directProfile);
          checkAdmin(directProfile);
          await saveData(STORAGE_KEYS.PROFILE, directProfile);
          return directProfile;
        }

        // 2. [自己修復ロジック] user_id で見つからない場合、名前での紐付けを試行
        const searchName = nameHint || session?.user?.user_metadata?.name || session?.user?.email?.split('@')[0];
        if (searchName && searchName !== 'admin') {
          console.log('Attempting self-healing for name:', searchName);
          const { data: nameProfile } = await supabase
            .from('staff')
            .select('*')
            .ilike('name', `%${searchName}%`)
            .is('user_id', null)
            .maybeSingle();

          if (nameProfile) {
            console.log('Healed! Binding user_id to staff record:', nameProfile.name);
            const { data: updated } = await supabase
              .from('staff')
              .update({ user_id: session.user.id })
              .eq('id', nameProfile.id)
              .select()
              .single();
            
            if (updated) {
              setProfile(updated);
              checkAdmin(updated);
              await saveData(STORAGE_KEYS.PROFILE, updated);
              return updated;
            }
          }
        }

        // 3. 特例：管理者
        if (session?.user?.email === 'admin@example.com' || session?.user?.email?.startsWith('admin')) {
          const adminProfile = { id: 'admin', name: '管理者', role: '開発者', profession: '管理者', placement: '本部' };
          setProfile(adminProfile);
          setIsAdminAuthenticated(true);
          return adminProfile;
        }
        
        // 最終的に見つからない場合
        setLoadError('職員名簿にあなたの名前が見つかりません。管理者に名前の登録を確認してください。');
      } else {
        const savedProfile = await loadData(STORAGE_KEYS.PROFILE);
        if (savedProfile) {
          setProfile(savedProfile);
          checkAdmin(savedProfile);
          return savedProfile;
        }
      }
      return null;
    } catch (e: any) {
      console.error('Profile loading error:', e);
      setLoadError(e.message || '接続エラー');
      return null;
    } finally {
      setIsLoadingProfile(false);
      setIsInitialized(true);
    }
  };

  useEffect(() => {
    // 起動時の初期化セーフティ
    const initSafetyTimeout = setTimeout(() => {
      if (!isInitialized) {
        console.warn('Initialization safety timeout reached');
        setIsInitialized(true);
      }
    }, 15000);

    // 1. Supabase Auth セッションの監視と取得
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      console.log('Auth state changed:', _event);
      await loadProfile(session);
    });

    // Initial session check
    supabase.auth.getSession().then(({ data: { session } }) => {
      loadProfile(session, nameHintRef.current || undefined);
    });

    // 2. セーフティタイムアウト (20秒)
    const initTimeoutId = setTimeout(() => {
      if (!isInitialized) {
        console.warn('Initialization timed out after 20 seconds');
        if (!loadError) {
          setLoadError('接続に時間がかかっています。ネットワーク環境を確認してください。');
        }
        setIsInitialized(true);
      }
    }, 20000);

    const init = async () => {
      const dur = await loadData(STORAGE_KEYS.SESSION_DURATION);
      if (dur) setSessionDuration(Number(dur));
    };
    init();

    return () => {
      subscription.unsubscribe();
      clearTimeout(initSafetyTimeout);
      clearTimeout(initTimeoutId);
    };
  }, []);

  const checkAdmin = (p: any) => {
    if (p && (p.role?.includes('管理者') || p.role?.includes('開発者') || p.role?.includes('シフト管理者'))) {
      setIsAdminAuthenticated(true);
    } else {
      setIsAdminAuthenticated(false);
    }
  };

  const login = async (name: string, pass: string) => {
    setLoadError(null);
    nameHintRef.current = name;
    const email = `${name.toLowerCase()}@example.com`;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });
    if (error) throw error;
    await loadProfile(data.session, name);
    return data.session;
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setIsAdminAuthenticated(false);
    await saveData(STORAGE_KEYS.PROFILE, null);
  };

  return { 
    profile, 
    setProfile, 
    isAdminAuthenticated, 
    setIsAdminAuthenticated, 
    sessionDuration, 
    isInitialized, 
    loadError,
    loadProfile,
    login,
    logout 
  };
};
