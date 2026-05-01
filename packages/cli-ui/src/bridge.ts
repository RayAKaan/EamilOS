import { EventEmitter } from 'events';
import { useStore } from './state/store.js';
import { parseSlashCommand } from './ui/components/chat/SlashCommandParser.js';
import { getHelpText } from './ui/commands/slash-commands.js';

interface BridgeConfig {
  mockMode?: boolean;
}

interface BridgeMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  agent?: string;
  timestamp: number;
  metrics?: { tokens?: number; cost?: number; duration?: number };
}

export class UIBridge extends EventEmitter {
  private syncInterval?: NodeJS.Timeout;
  private mockMode: boolean;
  private core: any | null = null;
  private coreModule: any | null = null;
  private messages: BridgeMessage[] = [];
  private activeProjectId: string | null = null;
  private profileManager: any = null;
  private keyVault: any = null;
  private teamManager: any = null;
  private auditLogger: any = null;

  constructor(config?: BridgeConfig) {
    super();
    this.mockMode = config?.mockMode ?? process.env.MOCK === 'true';
  }

  async initialize(): Promise<void> {
    if (this.mockMode) {
      this.initializeMockMode();
      return;
    }

    try {
      const coreModule = await import('@eamilos/core');
      this.coreModule = coreModule;
      this.core = await coreModule.initEamilOS();
      this.profileManager = this.core.getProfileManager?.();
      this.keyVault = this.core.getKeyVault?.();
      this.teamManager = this.core.getTeamManager?.();
      this.auditLogger = this.core.getAuditLogger?.();
      this.forwardCoreState();
      this.setupEventForwarding();
    } catch (error) {
      this.mockMode = true;
      this.initializeMockMode();
      this.addSystemMessage(`Core unavailable, running in mock mode: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private setupEventForwarding(): void {
    if (!this.core || !this.core.eventBus) return;

    const bus = this.core.eventBus;
    if (bus.on) {
      bus.on('task.completed', (data: any) => {
        this.emit('task:complete', data);
      });
      bus.on('task.failed', (data: any) => {
        this.emit('task:failed', data);
        this.addSystemMessage(`Task failed: ${data?.error || 'Unknown error'}`);
      });
      bus.on('project.created', (data: any) => {
        this.emit('project:created', data);
      });
    }
  }

  private initializeMockMode(): void {
    console.log('[Bridge] Running in mock mode');
  }

  private forwardCoreState(): void {
    this.syncInterval = setInterval(() => {
      try {
        const state = useStore.getState();
        if (this.activeProjectId && this.core) {
          state.setTasks(this.core.getProjectTasks(this.activeProjectId));
        }
      } catch {
        // UI polling should never crash the terminal.
      }
    }, 2000);
  }

  private addMessage(message: Omit<BridgeMessage, 'timestamp'>): BridgeMessage {
    const fullMessage = { ...message, timestamp: Date.now() };
    this.messages.push(fullMessage);
    this.emit('message:add', fullMessage);
    return fullMessage;
  }

  private addSystemMessage(content: string): BridgeMessage {
    return this.addMessage({ role: 'system', content });
  }

  async createTask(input: string): Promise<any> {
    const taskId = `task-${Date.now()}`;
    const store = useStore.getState();
    store.addNode(null, {
      id: taskId,
      status: 'running',
      children: [],
      type: 'task'
    } as any);
    store.setRunning(true);

    if (this.mockMode || !this.core) {
      return { taskId, success: true, output: `Task created: ${taskId}` };
    }

    if (!this.activeProjectId) {
      const project = await this.core.createProject({
        name: `TUI Session ${new Date().toISOString()}`,
        goal: input,
      });
      this.activeProjectId = project.id;
      this.auditLogger?.log(
        this.getActiveProfileId(),
        'resource',
        'project_created',
        { projectId: project.id, goal: input },
      );
    }

    const task = await this.core.createTask({
      projectId: this.activeProjectId,
      title: input.slice(0, 80),
      description: input,
      type: this.classifyTaskType(input),
      priority: 'medium',
      dependsOn: [],
    });

    store.setTasks(this.core.getProjectTasks(this.activeProjectId));
    this.emit('task:created', task);
    return { taskId: task.id, success: true };
  }

  async sendMessage(text: string): Promise<any> {
    this.addMessage({ role: 'user', content: text });
    this.emit('agent:typing', { active: true });

    try {
      const created = await this.createTask(text);
      let output = `Task created: ${created.taskId}`;
      let agent = 'mock-agent';
      let metrics = undefined;

      if (!this.mockMode && this.core) {
        const startTime = Date.now();
        const result = await this.core.executeTask(created.taskId);
        const duration = Date.now() - startTime;

        output = result.output || (result.artifacts?.length ? `Created artifacts: ${result.artifacts.join(', ')}` : 'Task completed.');
        agent = result.agentId || 'EamilOS Core';
        metrics = { duration };

        if (result.success) {
          this.auditLogger?.log(
            this.getActiveProfileId(),
            'resource',
            'task_executed',
            { taskId: created.taskId, duration, success: true },
          );

          const costSnapshot = this.core.getCostSnapshot?.();
          if (costSnapshot?.cost) {
            metrics.cost = costSnapshot.cost.total;
            metrics.tokens = costSnapshot.cost.tokens;
            this.auditLogger?.logCost(
              this.getActiveProfileId(),
              costSnapshot.cost.total || 0,
              { taskId: created.taskId },
            );
          }
        }

        this.emit('task:complete', { ...result, metrics });
      }

      const message = this.addMessage({
        role: 'assistant',
        content: output,
        agent,
        metrics,
      });
      this.emit('agent:output', { output: message.content, agentId: message.agent, metrics });
      return { ...created, output: message.content, agent, metrics };
    } catch (error) {
      const content = `Execution failed: ${error instanceof Error ? error.message : String(error)}`;
      this.addSystemMessage(content);
      this.emit('task:failed', { error: content });
      this.auditLogger?.log(
        this.getActiveProfileId(),
        'security',
        'task_failed',
        { error: content },
        'failure',
      );
      return { success: false, output: content };
    } finally {
      this.emit('agent:typing', { active: false });
    }
  }

  async executeSlashCommand(input: string): Promise<string> {
    const command = parseSlashCommand(input);
    const args = command.args;

    switch (command.handler) {
      case 'ui:help':
        return getHelpText();
      case 'session:new':
        this.messages = [];
        this.activeProjectId = null;
        useStore.getState().resetExecution();
        if (this.core?.getSessionManager) {
          const sessionManager = this.core.getSessionManager();
          sessionManager.setMessages([]);
          const newId = `session-${Date.now()}`;
          sessionManager.setCurrentSession(newId);
        }
        return 'New session started with clean context.';
      case 'system:exit':
        await this.shutdown();
        process.exit(0);
      case 'agents:list':
        return this.listAgents();
      case 'agent:switch':
        return args[0] ? `Primary agent preference set to ${args[0]}.` : 'Usage: /agent <id>';
      case 'models:list':
        return this.listModels();
      case 'tasks:list':
        return this.listTasks();
      case 'task:pause':
        await this.pauseCurrentTask();
        return 'Current task paused.';
      case 'task:resume':
        return args[0] ? `Resume requested for ${args[0]}.` : 'Usage: /resume <id>';
      case 'workspace:edit':
        this.navigateTo('editor');
        return args[0] ? `Opening ${args[0]} in editor mode.` : 'Opening editor mode.';
      case 'workspace:find':
        return args.length ? `Searching workspace for: ${args.join(' ')}` : 'Usage: /find <pattern>';
      case 'context:compress':
        return this.compressContext();
      case 'orchestration:parallel':
        return args.length ? this.executeParallel(args.join(' ')) : 'Usage: /parallel <task>';
      case 'orchestration:delegate':
        return args.length >= 2 ? this.delegate(args[0], args.slice(1).join(' ')) : 'Usage: /delegate <agent> <task>';
      case 'cost:report':
        return this.getCostReport();
      case 'template:use':
        return args.length ? this.executeTemplate(args[0], args.slice(1)) : 'Usage: /template <name> [vars...]';
      case 'profile:switch':
        return args[0] ? this.switchProfile(args[0]) : 'Usage: /profile <id>';
      case 'team:list':
        return this.listTeams();
      case 'audit:log':
        return this.showAuditLog(args);
      case 'health:report':
        return this.getHealthReport();
      case 'session:manage':
        return this.handleSessionCommand(args);
      case 'template:list':
        return this.listTemplates();
      case 'template:show':
        return args[0] ? this.showTemplate(args[0]) : 'Usage: /template show <id>';
      case 'learning:report':
        return this.getLearningReport();
      case 'config:show':
        return this.showConfig();
      default:
        return `Unknown command: ${command.command}. Type /help for available commands.`;
    }
  }

  async executeTemplate(templateId: string, vars: string[]): Promise<string> {
    if (this.mockMode || !this.core) {
      return `Template execution (mock): ${templateId}`;
    }

    try {
      const engine = this.core.getTemplateEngine?.();
      if (!engine) return 'Template engine not available.';

      const variables: Record<string, string> = {};
      for (const v of vars) {
        const [key, value] = v.split('=');
        if (key && value) variables[key] = value;
      }

      const result = await engine.execute(templateId, variables);
      this.auditLogger?.log(
        this.getActiveProfileId(),
        'resource',
        'template_executed',
        { templateId, variables },
      );
      return `Template ${templateId} executed successfully. Generated ${result?.files?.length || 0} files.`;
    } catch (error) {
      return `Template error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async executeParallel(task: string): Promise<string> {
    const agents = this.getAvailableAgents();
    if (agents.length === 0) {
      await this.sendMessage(`[parallel] ${task}`);
      return 'No registered agents yet; routed through default execution path.';
    }

    const settled = await Promise.allSettled(
      agents.map(async (agent: any) => ({
        id: agent.id,
        result: await this.sendMessage(`[${agent.id}] ${task}`),
      }))
    );

    const succeeded = settled.filter((item) => item.status === 'fulfilled').length;
    return `Parallel execution dispatched to ${agents.length} agent(s); ${succeeded} completed.`;
  }

  async delegate(agentId: string, subTask: string): Promise<string> {
    const agents = this.getAvailableAgents();
    const agent = agents.find((item: any) => item.id === agentId || item.name === agentId);
    if (!agent) {
      return `Agent not found: ${agentId}`;
    }
    await this.sendMessage(`[delegate:${agentId}] ${subTask}`);
    return `Delegated task to ${agentId}.`;
  }

  async pauseAgent(_agentId: string): Promise<void> {
    // pause agent
  }

  async killAgent(_agentId: string): Promise<void> {
    const store = useStore.getState();
    store.setTree(null);
  }

  async pauseCurrentTask(): Promise<void> {
    const store = useStore.getState();
    store.setRunning(false);
  }

  async stopCurrentTask(): Promise<void> {
    const store = useStore.getState();
    store.resetExecution();
  }

  createTaskPrompt(): void {}

  navigateTo(view: string): void {
    this.emit('navigate', view);
  }

  getState(): any {
    const store = useStore.getState();
    return {
      ...store,
      messages: this.messages,
      agents: this.getAvailableAgents(),
      tasks: this.activeProjectId && this.core ? this.core.getProjectTasks(this.activeProjectId) : store.tasks,
      currentAgent: this.getAvailableAgents()[0] || null,
      profile: this.getActiveProfile(),
    };
  }

  getStore() {
    return useStore;
  }

  getCostReport(): string {
    if (this.mockMode || !this.core) {
      return 'Cost tracking unavailable in mock mode.';
    }

    try {
      const snapshot = this.core.getCostSnapshot();
      if (!snapshot?.cost) return 'No cost data available.';

      const cost = snapshot.cost;
      let report = `Cost Report\n`;
      report += `─`.repeat(40) + `\n`;
      report += `Total: $${(cost.total || 0).toFixed(4)}\n`;
      report += `Tokens: ${(cost.tokens || 0).toLocaleString()}\n`;
      if (cost.daily) {
        report += `Today: $${(cost.daily.total || 0).toFixed(4)}\n`;
      }
      if (snapshot.budget) {
        report += `Budget: ${((snapshot.budget.used || 0) / (snapshot.budget.limit || 1) * 100).toFixed(1)}% used\n`;
      }
      return report;
    } catch {
      return 'Failed to generate cost report.';
    }
  }

  getHealthReport(): string {
    if (this.mockMode || !this.core) {
      return 'Health monitoring unavailable in mock mode.\nAgents: ' + this.getAvailableAgents().length + ' registered';
    }

    try {
      const report = this.core.getHealthReport();
      if (!report) return 'Health report unavailable.';

      let output = `Health Report\n`;
      output += `─`.repeat(50) + `\n`;
      output += `Total Agents: ${report.total}\n`;
      output += `Healthy:  ${report.healthy}  Degraded:  ${report.degraded}  Unhealthy:  ${report.unhealthy}  Offline:  ${report.offline}\n`;
      output += `Average Score: ${report.averageScore.toFixed(0)}%\n`;
      output += `\n`;

      for (const agent of report.agents) {
        const icon = agent.status === 'healthy' ? '✅' : agent.status === 'degraded' ? '⚠️' : agent.status === 'unhealthy' ? '❌' : '⏸️';
        output += `${icon} ${agent.agentId} | Score: ${agent.score}% | ${agent.status}`;
        if (agent.latency != null) output += ` | ${agent.latency}ms`;
        if (agent.error) output += ` | Error: ${agent.error}`;
        output += `\n`;
      }

      output += `\nLast check: ${new Date(report.timestamp).toLocaleTimeString()}`;
      return output;
    } catch {
      return 'Failed to generate health report.';
    }
  }

  async shutdown(): Promise<void> {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
    if (this.core) {
      try {
        this.core.shutdown();
      } catch {
        // Ignore shutdown errors
      }
    }
    this.emit('shutdown');
  }

  private classifyTaskType(input: string): 'research' | 'coding' | 'qa' | 'planning' | 'design' | 'deploy' | 'custom' {
    const lower = input.toLowerCase();
    if (/(test|qa|verify|validate)/.test(lower)) return 'qa';
    if (/(plan|roadmap|architecture)/.test(lower)) return 'planning';
    if (/(design|ui|ux)/.test(lower)) return 'design';
    if (/(deploy|release|publish)/.test(lower)) return 'deploy';
    if (/(research|investigate|find out)/.test(lower)) return 'research';
    if (/(build|code|implement|refactor|fix|api|component)/.test(lower)) return 'coding';
    return 'custom';
  }

  private getAvailableAgents(): any[] {
    try {
      if (!this.core) return useStore.getState().agents;
      const registry = this.coreModule?.getAgentRegistry?.();
      return registry?.getAllAgents?.() || useStore.getState().agents;
    } catch {
      return useStore.getState().agents;
    }
  }

  private getActiveProfile(): any {
    try {
      return this.profileManager?.getActiveProfile?.() || null;
    } catch {
      return null;
    }
  }

  private getActiveProfileId(): string | null {
    const profile = this.getActiveProfile();
    return profile?.id || null;
  }

  async switchProfile(profileId: string): Promise<string> {
    if (!this.profileManager) return 'Profile manager not available.';
    const success = this.profileManager.setActiveProfile(profileId);
    if (success) {
      const profile = this.profileManager.getProfile(profileId);
      this.auditLogger?.log(profileId, 'auth', 'profile_switched', { profileId });
      return `Switched to profile: ${profile?.name || profileId}`;
    }
    return `Profile not found: ${profileId}`;
  }

  async listTeams(): Promise<string> {
    if (!this.teamManager) return 'Team manager not available.';
    const profile = this.getActiveProfile();
    if (!profile) return 'No active profile.';

    const userTeams = this.teamManager.getUserTeams(profile.userId);
    if (userTeams.length === 0) return 'Not a member of any teams.';

    return userTeams.map(({ team, member }: any) => `${team.name} (${team.id}) - ${member.role}`).join('\n');
  }

  async showAuditLog(args: string[]): Promise<string> {
    if (!this.auditLogger) return 'Audit logger not available.';

    const limit = args[0] ? parseInt(args[0]) : 10;
    const events = this.auditLogger.getEvents({ limit });
    if (events.length === 0) return 'No audit events.';

    return events.map((e: any) => `[${new Date(e.timestamp).toLocaleTimeString()}] ${e.action} (${e.type}) - ${e.result}`).join('\n');
  }

  private listAgents(): string {
    const agents = this.getAvailableAgents();
    if (agents.length === 0) {
      return this.mockMode
        ? 'Mock mode agents:\n- mock-agent - task simulation'
        : 'No agents registered yet.';
    }
    return agents.map((agent: any) => `${agent.id || agent.name} - ${(agent.capabilities || []).join(', ')}`).join('\n');
  }

  private listModels(): string {
    try {
      if (!this.core) {
        return 'Available model groups:\n- Local: Ollama\n- Cloud: OpenAI/Anthropic\n- CLI: Claude CLI, Codex CLI';
      }
      const providerManager = this.coreModule?.getProviderManager?.();
      const providers = providerManager?.getProviders?.() || [];
      if (providers.length === 0) return 'No providers configured yet.';
      return providers.map((provider: any) => `${provider.id} - ${provider.model} (${provider.type})`).join('\n');
    } catch {
      return 'Available model groups:\n- Local: Ollama\n- Cloud: OpenAI/Anthropic\n- CLI: Claude CLI, Codex CLI';
    }
  }

  private listTasks(): string {
    const tasks = this.activeProjectId && this.core
      ? this.core.getProjectTasks(this.activeProjectId)
      : useStore.getState().tasks;
    return tasks.length
      ? tasks.map((task: any) => `${task.id || task.title}: ${task.status || 'pending'}`).join('\n')
      : 'No active tasks.';
  }

  private compressContext(): string {
    const before = this.messages.reduce((sum, message) => sum + message.content.length, 0);
    if (before < 400000) return 'Context is already within limits.';
    const summary = this.messages.slice(-20);
    this.messages = [
      {
        role: 'system',
        content: `Context compressed. Preserved ${summary.length} recent messages.`,
        timestamp: Date.now(),
      },
      ...summary,
    ];
    const after = this.messages.reduce((sum, message) => sum + message.content.length, 0);
    return `Compressed context from ~${Math.ceil(before / 4)} tokens to ~${Math.ceil(after / 4)} tokens.`;
  }

  private async handleSessionCommand(args: string[]): Promise<string> {
    if (!this.core?.getSessionManager) {
      if (args[0] === 'save') {
        return 'Session saved locally (core unavailable).';
      }
      return 'Session management requires EamilOS core.';
    }

    const sessionManager = this.core.getSessionManager();
    const subcommand = args[0]?.toLowerCase();

    switch (subcommand) {
      case 'save': {
        const sessionId = args[1] || this.core.getSessionManager().getCurrentSession();
        sessionManager.setMessages(this.messages.map((m: BridgeMessage) => ({
          role: m.role,
          content: m.content,
          agent: m.agent,
          timestamp: m.timestamp,
        })));
        sessionManager.setContext({ activeProjectId: this.activeProjectId });
        await this.core.saveSession(sessionId);
        return `Session "${sessionId}" saved.`;
      }
      case 'load': {
        const sessionId = args[1];
        if (!sessionId) return 'Usage: /session load <id>';
        const restored = await this.core.loadSession(sessionId);
        if (restored) {
          const loadedSession = await sessionManager.load(sessionId);
          if (loadedSession) {
            this.messages = loadedSession.data.messages.map((m: any) => ({
              role: m.role,
              content: m.content,
              agent: m.agent,
              timestamp: m.timestamp,
            }));
            this.activeProjectId = loadedSession.data.context?.activeProjectId || null;
            this.emit('messages:restored', { count: this.messages.length });
            return `Session "${sessionId}" restored with ${this.messages.length} messages.`;
          }
        }
        return `Session "${sessionId}" not found.`;
      }
      case 'list': {
        const sessions = await this.core.listSessions();
        if (sessions.length === 0) return 'No saved sessions.';
        const current = sessionManager.getCurrentSession();
        return sessions.map((s: any) => {
          const marker = s.id === current ? ' (active)' : '';
          const time = new Date(s.updatedAt).toLocaleString();
          return `${s.id}${marker} - ${time}`;
        }).join('\n');
      }
      case 'new': {
        const name = args[1] || `session-${Date.now()}`;
        const sessionId = await this.core.createSession(name);
        this.messages = [];
        this.activeProjectId = null;
        return `New session "${sessionId}" created.`;
      }
      case 'delete': {
        const sessionId = args[1];
        if (!sessionId) return 'Usage: /session delete <id>';
        const deleted = await sessionManager.delete(sessionId);
        return deleted ? `Session "${sessionId}" deleted.` : `Session "${sessionId}" not found.`;
      }
      default:
        return 'Usage: /session [save|load|list|new|delete] [args...]';
    }
  }

  private listTemplates(): string {
    if (this.mockMode || !this.core) {
      return 'Template listing unavailable in mock mode.';
    }
    try {
      const registry = this.coreModule?.getTemplateRegistry?.();
      if (!registry) return 'Template registry not available.';
      const templates = registry.listTemplates();
      if (templates.length === 0) return 'No templates registered.';
      let output = `Templates (${templates.length})\n`;
      output += `─`.repeat(60) + `\n`;
      for (const t of templates) {
        const cost = `$${t.estimatedCost.min}–$${t.estimatedCost.max}`;
        output += `${t.name.padEnd(22)} ${t.category.padEnd(8)} ${cost.padEnd(12)} ${t.tags.join(', ')}\n`;
        output += `  ${t.description}\n\n`;
      }
      return output.trimEnd();
    } catch {
      return 'Failed to list templates.';
    }
  }

  private showTemplate(templateId: string): string {
    if (this.mockMode || !this.core) {
      return `Template details unavailable in mock mode.\nID: ${templateId}`;
    }
    try {
      const registry = this.coreModule?.getTemplateRegistry?.();
      if (!registry) return 'Template registry not available.';
      const template = registry.getTemplate(templateId);
      if (!template) return `Template not found: ${templateId}`;
      let output = `${template.name} (${template.id})\n`;
      output += `─`.repeat(40) + `\n`;
      output += `Description: ${template.description}\n`;
      output += `Category: ${template.category}\n`;
      output += `Version: ${template.version}\n`;
      output += `Author: ${template.author}\n`;
      output += `Tags: ${template.tags.join(', ')}\n`;
      output += `Workflow steps: ${template.workflow.steps.length}\n`;
      output += `Files: ${template.files.length}\n`;
      output += `Est. Cost: $${template.estimatedCost.min}–$${template.estimatedCost.max}\n`;
      output += `\nVariables:\n`;
      for (const v of template.variables) {
        const req = v.required ? ' (required)' : '';
        const def = v.default !== undefined ? ` [default: ${v.default}]` : '';
        output += `  ${v.name}${req}${def} — ${v.description}\n`;
      }
      return output;
    } catch {
      return `Failed to show template: ${templateId}`;
    }
  }

  private getLearningReport(): string {
    if (this.mockMode || !this.core) {
      return 'Learning report unavailable in mock mode.';
    }
    try {
      const feedback = this.core.getFeedbackLoop();
      if (!feedback) return 'Feedback loop not initialized.';
      const insights = feedback.getInsights();
      if (!insights) return 'No learning insights available.';
      let output = `Learning Report\n`;
      output += `─`.repeat(40) + `\n`;
      output += `Total feedback: ${insights.totalFeedback || 0}\n`;
      output += `Applied changes: ${insights.appliedChanges || 0}\n`;
      if (insights.topPatterns && insights.topPatterns.length > 0) {
        output += `\nTop Patterns:\n`;
        for (const p of insights.topPatterns) {
          output += `  • ${p}\n`;
        }
      }
      if (insights.modelPreferences) {
        output += `\nModel Preferences:\n`;
        for (const [model, score] of Object.entries(insights.modelPreferences)) {
          output += `  ${model}: ${(score as number).toFixed(2)}\n`;
        }
      }
      return output;
    } catch {
      return 'Failed to generate learning report.';
    }
  }

  private showConfig(): string {
    if (this.mockMode || !this.core) {
      return 'Config unavailable in mock mode.';
    }
    try {
      const config = this.coreModule?.getConfig?.();
      if (!config) return 'No config available.';
      let output = `Configuration\n`;
      output += `─`.repeat(40) + `\n`;
      output += JSON.stringify(config, null, 2);
      return output;
    } catch {
      return 'Failed to show config.';
    }
  }
}

export const createBridge = (config?: BridgeConfig): UIBridge => {
  return new UIBridge(config);
};
