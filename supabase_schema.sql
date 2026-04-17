-- Staff table
CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  placement TEXT,
  position TEXT,
  profession TEXT,
  status TEXT,
  role TEXT,
  no_holiday BOOLEAN DEFAULT FALSE,
  phone TEXT,
  password TEXT,
  pin TEXT,
  is_approved BOOLEAN DEFAULT FALSE,
  is_locked BOOLEAN DEFAULT FALSE,
  locked_months JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Requests table
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  staff_name TEXT NOT NULL,
  staff_id TEXT,
  date TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  reason TEXT,
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- App Config table (for locks, monthly limits, etc.)
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value JSONB,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  from_id TEXT,
  from_name TEXT,
  to_id TEXT,
  content TEXT,
  type TEXT,
  attachments JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
