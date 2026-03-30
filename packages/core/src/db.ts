import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { nanoid } from 'nanoid';
import {
  Project,
  ProjectCreate,
  ProjectStatus,
  Task,
  TaskCreate,
  TaskStatus,
  Artifact,
  ArtifactCreate,
  ArtifactInfo,
  EventCreate,
  SystemEvent,
} from './types.js';
import { INITIAL_MIGRATION } from './migrations.js';
import { validateProjectTransition } from './schemas/project.js';
import { validateTaskTransition } from './types.js';

export class DatabaseManager {
  private db: Database.Database;
  private dbPath: string;

  constructor(dbPath: string = './data/eamilos.db') {
    this.dbPath = dbPath;
    this.ensureDirectory();
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.runMigrations();
  }

  private ensureDirectory(): void {
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private runMigrations(): void {
    const statements = INITIAL_MIGRATION.split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const transaction = this.db.transaction(() => {
      for (const stmt of statements) {
        this.db.exec(stmt);
      }
    });

    transaction();
  }

  close(): void {
    this.db.close();
  }

  // Project operations
  createProject(data: ProjectCreate): Project {
    const now = new Date();
    const id = nanoid();
    const project: Project = {
      id,
      name: data.name,
      goal: data.goal,
      status: 'active',
      path: data.path,
      userContext: data.userContext,
      constraints: data.constraints,
      template: data.template,
      budgetUsd: data.budgetUsd,
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      totalTokensUsed: 0,
      totalCostUsd: 0,
      createdAt: now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO projects (
        id, name, goal, status, path, user_context, constraints,
        template, total_tasks, completed_tasks, failed_tasks,
        total_tokens_used, total_cost_usd, budget_usd, created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    stmt.run(
      project.id,
      project.name,
      project.goal,
      project.status,
      project.path,
      project.userContext ?? null,
      JSON.stringify(project.constraints ?? []),
      project.template ?? null,
      project.totalTasks,
      project.completedTasks,
      project.failedTasks,
      project.totalTokensUsed,
      project.totalCostUsd,
      project.budgetUsd ?? null,
      project.createdAt.toISOString()
    );

    return project;
  }

  getProject(id: string): Project | null {
    const stmt = this.db.prepare('SELECT * FROM projects WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToProject(row) : null;
  }

  getAllProjects(): Project[] {
    const stmt = this.db.prepare('SELECT * FROM projects ORDER BY created_at DESC');
    const rows = stmt.all() as Record<string, unknown>[];
    return rows.map((row) => this.rowToProject(row));
  }

  updateProjectStatus(id: string, status: ProjectStatus, completedAt?: Date): void {
    const project = this.getProject(id);
    if (!project) {
      throw new Error(`Project not found: ${id}`);
    }

    validateProjectTransition(project.status, status);

    const updates: Record<string, unknown> = { status };

    if (status === 'completed' && completedAt) {
      updates.completed_at = completedAt.toISOString();
    }
    if (status === 'paused') {
      updates.paused_at = new Date().toISOString();
    }
    if (status === 'active' && project.pausedAt) {
      updates.paused_at = null;
    }

    const setClauses = Object.keys(updates)
      .map((k) => `${k.replace(/([A-Z])/g, '_$1').toLowerCase()} = ?`)
      .join(', ');
    const values = [...Object.values(updates), id];

    const stmt = this.db.prepare(`UPDATE projects SET ${setClauses} WHERE id = ?`);
    stmt.run(...values);
  }

  updateProjectCounts(id: string): void {
    const taskCounts = this.db
      .prepare(
        `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM tasks WHERE project_id = ?
    `
      )
      .get(id) as { total: number; completed: number; failed: number };

    this.db
      .prepare(
        `UPDATE projects SET total_tasks = ?, completed_tasks = ?, failed_tasks = ? WHERE id = ?`
      )
      .run(taskCounts.total, taskCounts.completed, taskCounts.failed, id);
  }

  updateProjectBudget(id: string, costCents: number): void {
    this.db
      .prepare(`UPDATE projects SET total_cost_usd = total_cost_usd + ? WHERE id = ?`)
      .run(costCents / 100, id);
  }

  createMemoryEntry(_entry: unknown): void {
  }

  getMemoryEntries(_projectId: string): unknown[] {
    return [];
  }

  deleteMemoryEntry(_id: string): void {
  }

  clearMemoryEntries(_projectId: string): void {
  }

  private rowToProject(row: Record<string, unknown>): Project {
    return {
      id: row.id as string,
      name: row.name as string,
      goal: row.goal as string,
      status: row.status as ProjectStatus,
      path: row.path as string,
      userContext: row.user_context as string | undefined,
      constraints: row.constraints
        ? (JSON.parse(row.constraints as string) as string[])
        : undefined,
      template: row.template as string | undefined,
      totalTasks: row.total_tasks as number,
      completedTasks: row.completed_tasks as number,
      failedTasks: row.failed_tasks as number,
      totalTokensUsed: row.total_tokens_used as number,
      totalCostUsd: row.total_cost_usd as number,
      budgetUsd: row.budget_usd as number | undefined,
      createdAt: new Date(row.created_at as string),
      startedAt: row.started_at ? new Date(row.started_at as string) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at as string) : undefined,
      pausedAt: row.paused_at ? new Date(row.paused_at as string) : undefined,
    };
  }

  // Task operations
  createTask(data: TaskCreate): Task {
    const now = new Date();
    const id = nanoid();
    const task: Task = {
      id,
      projectId: data.projectId,
      title: data.title,
      description: data.description,
      type: data.type,
      status: data.dependsOn && data.dependsOn.length > 0 ? 'pending' : 'ready',
      priority: data.priority ?? 'medium',
      dependsOn: data.dependsOn ?? [],
      requiredCapabilities: data.requiredCapabilities,
      inputContext: data.inputContext,
      requiresHumanApproval: data.requiresHumanApproval ?? false,
      maxRetries: data.maxRetries ?? 3,
      parentTaskId: data.parentTaskId,
      artifacts: [],
      retryCount: 0,
      tokenUsage: 0,
      costUsd: 0,
      createdAt: now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO tasks (
        id, project_id, title, description, type, status, priority,
        depends_on, required_capabilities, input_context,
        requires_human_approval, max_retries, parent_task_id,
        artifacts, retry_count, token_usage, cost_usd, created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    stmt.run(
      task.id,
      task.projectId,
      task.title,
      task.description,
      task.type,
      task.status,
      task.priority,
      JSON.stringify(task.dependsOn),
      JSON.stringify(task.requiredCapabilities ?? []),
      task.inputContext ?? null,
      task.requiresHumanApproval ? 1 : 0,
      task.maxRetries,
      task.parentTaskId ?? null,
      JSON.stringify(task.artifacts),
      task.retryCount,
      task.tokenUsage,
      task.costUsd,
      task.createdAt.toISOString()
    );

    this.updateProjectCounts(data.projectId);
    return task;
  }

  getTask(id: string): Task | null {
    const stmt = this.db.prepare('SELECT * FROM tasks WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToTask(row) : null;
  }

  getProjectTasks(projectId: string): Task[] {
    const stmt = this.db.prepare(
      'SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at'
    );
    const rows = stmt.all(projectId) as Record<string, unknown>[];
    return rows.map((row) => this.rowToTask(row));
  }

  getReadyTasks(projectId: string): Task[] {
    const tasks = this.getProjectTasks(projectId);
    return tasks.filter((task) => {
      if (task.status !== 'pending' && task.status !== 'ready') {
        return false;
      }
      if (task.dependsOn.length === 0) {
        return true;
      }
      return task.dependsOn.every((depId) => {
        const dep = this.getTask(depId);
        return dep?.status === 'completed';
      });
    });
  }

  getInProgressTasks(projectId: string): Task[] {
    const stmt = this.db.prepare(
      "SELECT * FROM tasks WHERE project_id = ? AND status = 'in_progress'"
    );
    const rows = stmt.all(projectId) as Record<string, unknown>[];
    return rows.map((row) => this.rowToTask(row));
  }

  updateTaskStatus(id: string, status: TaskStatus): void {
    const task = this.getTask(id);
    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }

    validateTaskTransition(task.status, status);

    const updates: Record<string, unknown> = { status };

    if (status === 'in_progress') {
      updates.started_at = new Date().toISOString();
    }
    if (status === 'completed') {
      updates.completed_at = new Date().toISOString();
    }

    const setClauses = Object.keys(updates)
      .map((k) => `${k.replace(/([A-Z])/g, '_$1').toLowerCase()} = ?`)
      .join(', ');
    const values = [...Object.values(updates), id];

    const stmt = this.db.prepare(`UPDATE tasks SET ${setClauses} WHERE id = ?`);
    stmt.run(...values);

    this.updateProjectCounts(task.projectId);
  }

  updateTask(
    id: string,
    updates: Partial<{
      status: TaskStatus;
      assignedAgent: string;
      output: string;
      artifacts: string[];
      retryCount: number;
      error: string;
      lockedBy: string | null;
      correlationId: string;
      tokenUsage: number;
      costUsd: number;
    }>
  ): void {
    const task = this.getTask(id);
    if (!task) {
      throw new Error(`Task not found: ${id}`);
    }

    if (updates.status) {
      validateTaskTransition(task.status, updates.status);
    }

    const dbUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (key === 'artifacts') {
        dbUpdates[dbKey] = JSON.stringify(value);
      } else {
        dbUpdates[dbKey] = value;
      }
    }

    if (Object.keys(dbUpdates).length === 0) {
      return;
    }

    const setClauses = Object.keys(dbUpdates)
      .map((k) => `${k} = ?`)
      .join(', ');
    const values = [...Object.values(dbUpdates), id];

    const stmt = this.db.prepare(`UPDATE tasks SET ${setClauses} WHERE id = ?`);
    stmt.run(...values);

    this.updateProjectCounts(task.projectId);
  }

  lockTask(id: string, instanceId: string): boolean {
    const stmt = this.db.prepare(
      `UPDATE tasks SET locked_by = ? WHERE id = ? AND locked_by IS NULL`
    );
    const result = stmt.run(instanceId, id);
    return result.changes > 0;
  }

  private rowToTask(row: Record<string, unknown>): Task {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      title: row.title as string,
      description: row.description as string,
      type: row.type as Task['type'],
      status: row.status as TaskStatus,
      priority: row.priority as Task['priority'],
      dependsOn: JSON.parse(row.depends_on as string) as string[],
      assignedAgent: row.assigned_agent as string | undefined,
      requiredCapabilities: row.required_capabilities
        ? (JSON.parse(row.required_capabilities as string) as string[])
        : undefined,
      inputContext: row.input_context as string | undefined,
      output: row.output as string | undefined,
      artifacts: JSON.parse(row.artifacts as string) as string[],
      retryCount: row.retry_count as number,
      maxRetries: row.max_retries as number,
      requiresHumanApproval: Boolean(row.requires_human_approval),
      tokenUsage: row.token_usage as number,
      costUsd: row.cost_usd as number,
      error: row.error as string | undefined,
      lockedBy: row.locked_by as string | undefined,
      correlationId: row.correlation_id as string | undefined,
      parentTaskId: row.parent_task_id as string | undefined,
      createdAt: new Date(row.created_at as string),
      startedAt: row.started_at ? new Date(row.started_at as string) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at as string) : undefined,
    };
  }

  // Artifact operations
  insertArtifact(data: ArtifactCreate): Artifact {
    const id = nanoid();
    const now = new Date();
    const artifact: Artifact = {
      id,
      ...data,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const stmt = this.db.prepare(`
      INSERT INTO artifacts (
        id, project_id, task_id, path, hash, size, type,
        created_by, version, description, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      artifact.id,
      artifact.projectId,
      artifact.taskId,
      artifact.path,
      artifact.hash,
      artifact.size,
      artifact.type,
      artifact.createdBy,
      artifact.version,
      artifact.description ?? null,
      artifact.createdAt.toISOString(),
      artifact.updatedAt.toISOString()
    );

    return artifact;
  }

  getProjectArtifacts(projectId: string): ArtifactInfo[] {
    const stmt = this.db.prepare(
      'SELECT path, size, created_by, created_at FROM artifacts WHERE project_id = ? ORDER BY created_at'
    );
    const rows = stmt.all(projectId) as Record<string, unknown>[];
    return rows.map((row) => ({
      path: row.path as string,
      size: row.size as number,
      createdBy: row.created_by as string,
      createdAt: new Date(row.created_at as string),
    }));
  }

  getTaskArtifacts(taskId: string): ArtifactInfo[] {
    const stmt = this.db.prepare('SELECT * FROM artifacts WHERE task_id = ?');
    const rows = stmt.all(taskId) as Record<string, unknown>[];
    return rows.map((row) => ({
      path: row.path as string,
      size: row.size as number,
      createdBy: row.created_by as string,
      createdAt: new Date(row.created_at as string),
    }));
  }

  // Event operations
  createEvent(data: EventCreate): SystemEvent {
    const id = nanoid();
    const now = new Date();
    const event: SystemEvent = {
      id,
      timestamp: now,
      type: data.type,
      projectId: data.projectId,
      taskId: data.taskId,
      agentId: data.agentId,
      correlationId: data.correlationId,
      data: data.data ?? {},
      humanReadable: data.humanReadable,
    };

    const stmt = this.db.prepare(`
      INSERT INTO events (
        id, timestamp, type, project_id, task_id, agent_id,
        correlation_id, data, human_readable
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      event.id,
      event.timestamp.toISOString(),
      event.type,
      event.projectId ?? null,
      event.taskId ?? null,
      event.agentId ?? null,
      event.correlationId ?? null,
      JSON.stringify(event.data),
      event.humanReadable ?? null
    );

    return event;
  }

  getProjectEvents(projectId: string, limit?: number): SystemEvent[] {
    const query = limit
      ? 'SELECT * FROM events WHERE project_id = ? ORDER BY timestamp DESC LIMIT ?'
      : 'SELECT * FROM events WHERE project_id = ? ORDER BY timestamp DESC';
    const stmt = this.db.prepare(query);
    const rows = (limit ? stmt.all(projectId, limit) : stmt.all(projectId)) as Record<
      string,
      unknown
    >[];
    return rows.map((row) => this.rowToEvent(row));
  }

  getDecisionEvents(projectId: string): SystemEvent[] {
    const stmt = this.db.prepare(
      "SELECT * FROM events WHERE project_id = ? AND type = 'decision.made' ORDER BY timestamp"
    );
    const rows = stmt.all(projectId) as Record<string, unknown>[];
    return rows.map((row) => this.rowToEvent(row));
  }

  private rowToEvent(row: Record<string, unknown>): SystemEvent {
    return {
      id: row.id as string,
      timestamp: new Date(row.timestamp as string),
      type: row.type as SystemEvent['type'],
      projectId: row.project_id as string | undefined,
      taskId: row.task_id as string | undefined,
      agentId: row.agent_id as string | undefined,
      correlationId: row.correlation_id as string | undefined,
      data: JSON.parse(row.data as string) as Record<string, unknown>,
      humanReadable: row.human_readable as string | undefined,
    };
  }
}

let globalDb: DatabaseManager | null = null;

export function initDatabase(dbPath?: string): DatabaseManager {
  if (globalDb) {
    return globalDb;
  }
  globalDb = new DatabaseManager(dbPath);
  return globalDb;
}

export function getDatabase(): DatabaseManager {
  if (!globalDb) {
    return initDatabase();
  }
  return globalDb;
}
