import { join } from 'path';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import type { AppState } from '../state/store';

const CONFIG_DIR = join(process.env.APPDATA || process.env.HOME || '.', '.eamilos');
const WORKSPACE_FILE = join(CONFIG_DIR, 'workspace.json');

export interface Workspace {
  version: string;
  lastOpened: number;
  currentSession: AppState['currentSession'] | null;
  recentSessions: AppState['recentSessions'];
  view: string;
  panelSizes: number[];
}

export const loadWorkspace = (): Workspace | null => {
  try {
    if (!existsSync(WORKSPACE_FILE)) return null;
    const data = readFileSync(WORKSPACE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
};

export const saveWorkspace = (workspace: Workspace): void => {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(WORKSPACE_FILE, JSON.stringify(workspace, null, 2));
  } catch (e) {
    console.error('Failed to save workspace:', e);
  }
};

export const createWorkspace = (view: string = 'dashboard'): Workspace => ({
  version: '1.0',
  lastOpened: Date.now(),
  currentSession: null,
  recentSessions: [],
  view,
  panelSizes: [50, 50],
});

export const clearWorkspace = (): void => {
  try {
    if (existsSync(WORKSPACE_FILE)) {
      const { unlinkSync } = require('fs');
      unlinkSync(WORKSPACE_FILE);
    }
  } catch {
    // Ignore
  }
};