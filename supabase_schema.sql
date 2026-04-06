DROP TABLE IF EXISTS staff CASCADE;
DROP TABLE IF EXISTS requests CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS app_config CASCADE;

-- 1. スタッフテーブル (Staff)
CREATE TABLE staff (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  placement TEXT NOT NULL,
  position TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '出勤',
  profession TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '一般職員',
  no_holiday BOOLEAN DEFAULT false,
  phone TEXT,
  password TEXT DEFAULT '0000',
  is_approved BOOLEAN DEFAULT false,
  pin TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. シフト・申請テーブル (Requests)
CREATE TABLE requests (
  id TEXT PRIMARY KEY,
  staff_name TEXT NOT NULL,
  date TEXT NOT NULL, -- YYYY-MM-DD
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected
  details JSONB DEFAULT '{}'::jsonb,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. メッセージテーブル (Messages)
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL,
  from_name TEXT NOT NULL,
  to_id TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL, -- global, private
  attachments JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. 設定テーブル (Config - 制限数など)
CREATE TABLE app_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

ALTER TABLE staff DISABLE ROW LEVEL SECURITY;
ALTER TABLE requests DISABLE ROW LEVEL SECURITY;
ALTER TABLE messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE app_config DISABLE ROW LEVEL SECURITY;
