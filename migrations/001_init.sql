PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','essential','professional')),
  plan_status TEXT NOT NULL DEFAULT 'trial' CHECK (plan_status IN ('trial','active','past_due','canceled','manual_review')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'technician' CHECK (role IN ('admin','manager','technician','viewer')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS equipment (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  description TEXT NOT NULL,
  manufacturer TEXT,
  model TEXT,
  serial_number TEXT,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'operacional' CHECK (status IN ('operacional','atenção','parado','desativado')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, code)
);

CREATE TABLE IF NOT EXISTS work_orders (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  equipment_id TEXT REFERENCES equipment(id) ON DELETE SET NULL,
  number TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('baixa','normal','alta','crítica')),
  responsible TEXT,
  status TEXT NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','em andamento','concluída','cancelada')),
  opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  scheduled_for TEXT,
  executed_at TEXT,
  closed_at TEXT,
  labor_cost REAL NOT NULL DEFAULT 0 CHECK (labor_cost >= 0),
  material_cost REAL NOT NULL DEFAULT 0 CHECK (material_cost >= 0),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, number)
);

CREATE TABLE IF NOT EXISTS preventive_plans (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  equipment_id TEXT REFERENCES equipment(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  task TEXT NOT NULL,
  frequency_days INTEGER NOT NULL CHECK (frequency_days > 0),
  next_due TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'un',
  current_stock REAL NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
  minimum_stock REAL NOT NULL DEFAULT 0 CHECK (minimum_stock >= 0),
  unit_cost REAL NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id, sku)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('entrada','saída')),
  quantity REAL NOT NULL CHECK (quantity > 0),
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payment_events (
  id TEXT PRIMARY KEY,
  company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
  external_id TEXT,
  status TEXT NOT NULL,
  payload TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(external_id)
);

CREATE INDEX IF NOT EXISTS idx_equipment_company ON equipment(company_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_company_status ON work_orders(company_id, status);
CREATE INDEX IF NOT EXISTS idx_preventive_company_due ON preventive_plans(company_id, next_due);
CREATE INDEX IF NOT EXISTS idx_materials_company ON materials(company_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
