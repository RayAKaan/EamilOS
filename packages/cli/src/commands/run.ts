import { EamilOS } from '../core/index.js';
import { header, success, info, kv, divider, error as printError } from '../ui.js';
import { SwarmOrchestrator, type ExecutionStrategy } from '../multi-agent/orchestrator/SwarmOrchestrator.js';
import {
  AdaptiveMultiplexer,
  getAdaptiveMultiplexer,
  getConstraintEnforcer,
  type AgentOperationalMode,
  type AgentTerminalDef,
} from '../terminal/index.js';
import chalk from 'chalk';

interface RunOptions {
  template?: string;
  constraints?: string[];
  budget?: number;
  forceInit?: boolean;
}

export async function run(
  eamilos: EamilOS,
  goal: string,
  options: RunOptions
): Promise<void> {
  header('Creating Project');

  const projectName = goal.length > 50 ? goal.substring(0, 47) + '...' : goal;

  info(`Goal: ${goal}`);

  const project = await eamilos.createProject({
    name: projectName,
    goal,
    path: './data/projects',
    template: options.template,
    constraints: options.constraints,
    budgetUsd: options.budget,
  });

  success(`Created project: ${project.name}`);
  kv('Project ID', project.id);
  kv('Status', project.status);
  divider();

  info('Creating task from goal...');

  const task = await eamilos.createTask({
    projectId: project.id,
    title: goal,
    description: `Execute the goal: ${goal}`,
    type: 'coding',
  });

  kv('Task ID', task.id);
  divider();

  const orchestrator = new SwarmOrchestrator({
    strategy: 'parallel',
    workingDir: process.cwd(),
    env: { EAMILOS_PROJECT_ID: project.id },
  });

  const health = await orchestrator.healthCheck();

  const terminalEnv = AdaptiveMultiplexer.detectEnvironment();
  const canMultiplex = AdaptiveMultiplexer.isMultiplexingSupported();

  if (canMultiplex) {
    console.log(chalk.cyan(`  🖥️  Adaptive Terminal Multiplexing: ${terminalEnv}\n`));
  } else {
    console.log(chalk.gray('  📟 Single viewport mode (no multiplex-capable terminal detected)\n'));
  }

  const agentTerminals: AgentTerminalDef[] = [];
  const agentMap: Record<string, { id: string; callsign: string; mode: AgentOperationalMode; emoji: string }> = {
    'opencode': { id: 'opencode', callsign: 'BETA', mode: 'unrestricted_execution', emoji: '🤖' },
    'claude-code': { id: 'claude-code', callsign: 'ALPHA', mode: 'unrestricted_execution', emoji: '🧠' },
    'aider': { id: 'aider', callsign: 'DELTA', mode: 'unrestricted_execution', emoji: '🔧' },
    'goose': { id: 'goose', callsign: 'EPSILON', mode: 'unrestricted_execution', emoji: '🦆' },
    'gemini-cli': { id: 'gemini-cli', callsign: 'GAMMA', mode: 'communication_only', emoji: '✨' },
  };

  const agentCommandMap: Record<string, { command: string; args: string[] }> = {
    'opencode': { command: 'npx', args: ['opencode', 'run', goal] },
    'claude-code': { command: 'npx', args: ['--yes', '@anthropic-ai/claude-code', '--print', goal] },
    'aider': { command: 'aider', args: ['--message', goal, '--yes'] },
    'goose': { command: 'npx', args: ['--yes', '@block/goose', 'run', goal] },
    'gemini-cli': { command: 'npx', args: ['--yes', '@google/gemini-cli', 'run', goal] },
  };

  const availableAgents: string[] = [];

  if (health.opencode.available) {
    availableAgents.push('OpenCode');
    const def = agentMap['opencode'];
    const cmd = agentCommandMap['opencode'];
    agentTerminals.push({ ...def, ...cmd });
  }
  if (health.claudeCode.available) {
    availableAgents.push('Claude Code');
    const def = agentMap['claude-code'];
    const cmd = agentCommandMap['claude-code'];
    agentTerminals.push({ ...def, ...cmd });
  }
  if (health.aider.available) {
    availableAgents.push('Aider');
    const def = agentMap['aider'];
    const cmd = agentCommandMap['aider'];
    agentTerminals.push({ ...def, ...cmd });
  }
  if (health.goose.available) {
    availableAgents.push('Goose');
    const def = agentMap['goose'];
    const cmd = agentCommandMap['goose'];
    agentTerminals.push({ ...def, ...cmd });
  }
  if (health.gemini.available) {
    availableAgents.push('Gemini');
    const def = agentMap['gemini-cli'];
    const cmd = agentCommandMap['gemini-cli'];
    agentTerminals.push({ ...def, ...cmd });
  }

  if (availableAgents.length === 0) {
    info('No CLI agents detected. Install one: npm install -g opencode-ai');
    const result = await eamilos.executeTask(task.id);
    divider();
    if (result.success) {
      success('Task completed successfully!');
      kv('Artifacts created', result.artifacts.length.toString());
      for (const artifact of result.artifacts) {
        kv('  File', artifact);
      }
      kv('Tool calls', result.toolCalls.toString());
    } else {
      printError('Task failed');
      if (result.error) kv('Error', result.error);
    }
    divider();
    info(`Run "eamilos status ${project.id}" to see project details`);
    eamilos.shutdown();
    process.exit(0);
    return;
  }

  info(`Detected agents: ${availableAgents.join(', ')}`);

  if (canMultiplex && agentTerminals.length > 0) {
    info('Spawning adaptive terminal panes...');

    for (const at of agentTerminals) {
      const emoji = agentMap[at.id]?.emoji || '⚡';
      const modeLabel = at.mode === 'unrestricted_execution'
        ? chalk.green('UNRESTRICTED_EXECUTION')
        : chalk.yellow('COMMUNICATION_ONLY');
      console.log(`  ${emoji} ${chalk.bold(at.callsign)} ${at.id} → ${modeLabel}`);
    }

    const multiplexer = getAdaptiveMultiplexer();
    await multiplexer.spawnAgentTerminals(agentTerminals);
    kv('Terminals spawned', String(agentTerminals.length));
    divider();
  }

  info('Executing task with multi-agent swarm...');

  try {
    const result = await orchestrator.execute(goal, 'parallel');

    divider();

    if (result.success) {
      success('Task completed successfully!');
      kv('Strategy', result.strategy);
      kv('Agent', result.agentUsed || 'unknown');
      kv('Attempts', result.attempts.toString());
      kv('Duration', `${(result.duration / 1000).toFixed(1)}s`);
      kv('Artifacts created', result.files.length.toString());
      for (const file of result.files) {
        kv('  File', file.path);
      }
      kv('Tool calls', result.attempts.toString());
    } else {
      printError('Task failed');
      if (result.errors.length > 0) {
        for (const err of result.errors.slice(0, 3)) {
          kv('Error', err.slice(0, 120));
        }
      }
    }

    divider();
    info(`Run "eamilos status ${project.id}" to see project details`);
  } catch (err) {
    divider();
    printError(`Execution failed: ${err instanceof Error ? err.message : String(err)}`);
    info(`Run "eamilos status ${project.id}" to see project details`);
  } finally {
    if (canMultiplex) {
      getAdaptiveMultiplexer().terminateAll();
    }
    await orchestrator.terminate();
    eamilos.shutdown();
    process.exit(0);
  }
}
