import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

interface GitLogRow {
  hash: string;
  subject: string;
  author: string;
  timestamp: number;
}

function parseRemote(url: string): { repository?: string; api?: string } {
  const match = url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/i);
  if (!match) return {};
  const repository = match[1]!.replace(/\.git$/, '');
  return { repository, api: 'https://api.github.com/repos/' + repository };
}

async function git(args: string[]): Promise<string> {
  const result = await exec('git', args, { cwd: process.cwd(), windowsHide: true, maxBuffer: 2_000_000 });
  return result.stdout.trim();
}

export interface GitHubState {
  available: boolean;
  repository?: string;
  remoteUrl?: string;
  branch?: string;
  dirty: boolean;
  changedFiles: string[];
  commits: GitLogRow[];
  ahead: number;
  behind: number;
  pullRequest?: { number: number; title: string; url: string; state: 'open'|'closed'|'merged'; draft: boolean; updatedAt?: number };
  error?: string;
  refreshedAt?: number;
}

export async function readGitHubState(): Promise<GitHubState> {
  try {
    const remoteUrl = await git(['remote', 'get-url', 'origin']);
    const parsed = parseRemote(remoteUrl);
    const branch = await git(['branch', '--show-current']);
    const status = await git(['status', '--porcelain']);
    const changedFiles = status.split(/\r?\n/).filter(Boolean).map(line => line.slice(3).trim());
    let ahead = 0;
    let behind = 0;
    try {
      const counts = await git(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
      const [left, right] = counts.split(/\s+/).map(Number);
      ahead = Number.isFinite(left) ? left : 0;
      behind = Number.isFinite(right) ? right : 0;
    } catch { /* branch may not have an upstream */ }

    const rawLog = await git(['log', '-8', '--format=%H%x09%s%x09%an%x09%ct']);
    const commits = rawLog.split(/\r?\n/).filter(Boolean).map(line => {
      const [hash, subject, author, timestamp] = line.split('\t');
      return { hash: hash ?? '', subject: subject ?? '', author, timestamp: Number(timestamp) * 1000 };
    });

    const base: GitHubState = {
      available: Boolean(parsed.repository),
      repository: parsed.repository,
      remoteUrl,
      branch,
      dirty: changedFiles.length > 0,
      changedFiles,
      commits,
      ahead,
      behind,
      refreshedAt: Date.now(),
    };

    if (parsed.api && branch) {
      try {
        const response = await fetch(parsed.api + '/pulls?head=' + encodeURIComponent((parsed.repository ?? '').split('/')[0] + ':' + branch) + '&state=open&per_page=1', {
          headers: { accept: 'application/vnd.github+json', 'user-agent': 'EamilOS-TUI' },
        });
        if (response.ok) {
          const pulls = await response.json() as Array<{ number: number; title: string; html_url: string; draft: boolean; updated_at: string }>;
          const pr = pulls[0];
          if (pr) base.pullRequest = { number: pr.number, title: pr.title, url: pr.html_url, state: 'open', draft: pr.draft, updatedAt: Date.parse(pr.updated_at) };
        }
      } catch { /* GitHub API is optional; local git state remains useful */ }
    }

    return base;
  } catch (error) {
    return {
      available: false,
      dirty: false,
      changedFiles: [],
      commits: [],
      ahead: 0,
      behind: 0,
      error: error instanceof Error ? error.message : String(error),
      refreshedAt: Date.now(),
    };
  }
}
