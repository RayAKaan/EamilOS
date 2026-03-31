import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  rmSync,
  copyFileSync,
} from 'fs';
import { createHash } from 'crypto';
import { join, resolve, dirname, relative } from 'path';
import { simpleGit } from 'simple-git';
import { validateAndResolvePath, validateFileSize } from './security.js';
import { PathValidator, PathSecurityError } from './security/index.js';
import { getConfig } from './config.js';
import { ArtifactInfo } from './types.js';

export class Workspace {
  private baseDir: string;
  private maxFileSizeMb: number;
  private gitEnabled: boolean;

  constructor() {
    const config = getConfig();
    this.baseDir = resolve(config.workspace.base_dir);
    this.maxFileSizeMb = config.workspace.max_file_size_mb;
    this.gitEnabled = config.workspace.git_enabled;

    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
    }
  }

  createProjectDir(projectId: string): string {
    const projectPath = join(this.baseDir, projectId);
    if (!existsSync(projectPath)) {
      mkdirSync(projectPath, { recursive: true });
    }
    return projectPath;
  }

  async initGit(projectId: string): Promise<boolean> {
    if (!this.gitEnabled) {
      return false;
    }

    try {
      const projectPath = join(this.baseDir, projectId);
      const git = simpleGit(projectPath);
      await git.init();

      await git.addConfig('user.email', 'eamilos@local');
      await git.addConfig('user.name', 'EamilOS');

      return true;
    } catch (error) {
      console.warn(`Git init failed for project ${projectId}:`, error);
      return false;
    }
  }

  writeArtifact(
    projectId: string,
    filePath: string,
    content: string
  ): void {
    const projectPath = join(this.baseDir, projectId);
    const pathValidator = new PathValidator(projectPath);
    const validation = pathValidator.validate(filePath);

    if (!validation.safe) {
      throw new PathSecurityError(
        `PATH_REJECTED: ${validation.rejectionReason}`
      );
    }

    const resolvedPath = join(projectPath, validation.normalizedPath);

    const size = Buffer.byteLength(content, 'utf-8');
    validateFileSize(size, this.maxFileSizeMb);

    const dir = dirname(resolvedPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const tmpPath = resolvedPath + '.tmp';
    writeFileSync(tmpPath, content, 'utf-8');

    try {
      if (existsSync(resolvedPath)) {
        rmSync(resolvedPath);
      }
      copyFileSync(tmpPath, resolvedPath);
    } finally {
      if (existsSync(tmpPath)) {
        rmSync(tmpPath);
      }
    }
  }

  readArtifact(projectId: string, filePath: string): string {
    const resolvedPath = validateAndResolvePath(this.baseDir, projectId, filePath);

    if (!existsSync(resolvedPath)) {
      throw new Error(`Artifact not found: ${filePath}`);
    }

    return readFileSync(resolvedPath, 'utf-8');
  }

  artifactExists(projectId: string, filePath: string): boolean {
    try {
      const resolvedPath = validateAndResolvePath(this.baseDir, projectId, filePath);
      return existsSync(resolvedPath);
    } catch {
      return false;
    }
  }

  listFiles(projectId: string): ArtifactInfo[] {
    const projectPath = join(this.baseDir, projectId);
    if (!existsSync(projectPath)) {
      return [];
    }

    const files: ArtifactInfo[] = [];
    this.walkDir(projectPath, projectPath, files);
    return files;
  }

  private walkDir(dir: string, baseDir: string, files: ArtifactInfo[]): void {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (entry === '.git') {
        continue;
      }

      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        this.walkDir(fullPath, baseDir, files);
      } else {
        const relPath = relative(baseDir, fullPath);
        files.push({
          path: relPath.replace(/\\/g, '/'),
          size: stat.size,
          createdBy: 'unknown',
          createdAt: stat.mtime,
        });
      }
    }
  }

  deleteArtifact(projectId: string, filePath: string): void {
    const resolvedPath = validateAndResolvePath(this.baseDir, projectId, filePath);
    if (existsSync(resolvedPath)) {
      rmSync(resolvedPath);
    }
  }

  getProjectPath(projectId: string): string {
    return join(this.baseDir, projectId);
  }

  async commitArtifact(
    projectId: string,
    filePath: string,
    message: string
  ): Promise<boolean> {
    if (!this.gitEnabled) {
      return false;
    }

    try {
      const projectPath = join(this.baseDir, projectId);
      const git = simpleGit(projectPath);
      const resolvedPath = validateAndResolvePath(this.baseDir, projectId, filePath);

      await git.add(resolvedPath);
      await git.commit(message);

      return true;
    } catch (error) {
      console.warn(`Git commit failed for ${projectId}/${filePath}:`, error);
      return false;
    }
  }

  computeHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  getWorkspaceSize(projectId: string): number {
    const projectPath = join(this.baseDir, projectId);
    if (!existsSync(projectPath)) {
      return 0;
    }

    let totalSize = 0;
    const entries = readdirSync(projectPath);
    for (const entry of entries) {
      const fullPath = join(projectPath, entry);
      totalSize += this.getDirSize(fullPath);
    }
    return totalSize;
  }

  private getDirSize(dir: string): number {
    let size = 0;
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        size += this.getDirSize(fullPath);
      } else {
        size += stat.size;
      }
    }
    return size;
  }
}

let globalWorkspace: Workspace | null = null;

export function initWorkspace(): Workspace {
  if (globalWorkspace) {
    return globalWorkspace;
  }
  globalWorkspace = new Workspace();
  return globalWorkspace;
}

export function getWorkspace(): Workspace {
  if (!globalWorkspace) {
    return initWorkspace();
  }
  return globalWorkspace;
}
