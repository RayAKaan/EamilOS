export const INITIAL_MIGRATION = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  path TEXT NOT NULL,
  user_context TEXT,
  constraints TEXT,
  template TEXT,
  total_tasks INTEGER DEFAULT 0,
  completed_tasks INTEGER DEFAULT 0,
  failed_tasks INTEGER DEFAULT 0,
  total_tokens_used INTEGER DEFAULT 0,
  total_cost_usd REAL DEFAULT 0,
  budget_usd REAL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  paused_at TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  priority TEXT DEFAULT 'medium',
  depends_on TEXT NOT NULL DEFAULT '[]',
  assigned_agent TEXT,
  required_capabilities TEXT,
  input_context TEXT,
  output TEXT,
  artifacts TEXT NOT NULL DEFAULT '[]',
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  requires_human_approval INTEGER DEFAULT 0,
  token_usage INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  error TEXT,
  locked_by TEXT,
  correlation_id TEXT,
  parent_task_id TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  path TEXT NOT NULL,
  hash TEXT NOT NULL,
  size INTEGER NOT NULL,
  type TEXT NOT NULL,
  created_by TEXT NOT NULL,
  version INTEGER DEFAULT 1,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  type TEXT NOT NULL,
  project_id TEXT,
  task_id TEXT,
  agent_id TEXT,
  correlation_id TEXT,
  data TEXT NOT NULL DEFAULT '{}',
  human_readable TEXT
);

CREATE TABLE IF NOT EXISTS agent_metrics (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  tasks_completed INTEGER DEFAULT 0,
  tasks_failed INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  total_cost_usd REAL DEFAULT 0,
  avg_duration_ms REAL DEFAULT 0,
  avg_artifacts_per_task REAL DEFAULT 0,
  retry_rate REAL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  context TEXT,
  project_id TEXT,
  task_id TEXT,
  agent_id TEXT,
  importance REAL DEFAULT 0.5,
  access_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  last_accessed TEXT,
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_locked ON tasks(locked_by);
CREATE INDEX IF NOT EXISTS idx_artifacts_project ON artifacts(project_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_task ON artifacts(task_id);
CREATE INDEX IF NOT EXISTS idx_events_project ON events(project_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
CREATE INDEX IF NOT EXISTS idx_memory_scope ON memory(scope);
CREATE INDEX IF NOT EXISTS idx_memory_project ON memory(project_id);

CREATE TABLE IF NOT EXISTS cost_history (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  project_id TEXT,
  task_id TEXT,
  agent_id TEXT,
  model TEXT NOT NULL,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  latency_ms REAL DEFAULT 0,
  success INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_cost_history_project ON cost_history(project_id);
CREATE INDEX IF NOT EXISTS idx_cost_history_timestamp ON cost_history(timestamp);
CREATE INDEX IF NOT EXISTS idx_cost_history_model ON cost_history(model);

CREATE TABLE IF NOT EXISTS daily_cost_summary (
  date TEXT PRIMARY KEY,
  total_cost_usd REAL DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  total_calls INTEGER DEFAULT 0,
  top_model TEXT,
  top_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_daily_cost_date ON daily_cost_summary(date);
`;
