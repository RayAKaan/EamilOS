import { Team, TeamMember, TeamInvite, Role } from '../auth/types.js';
import { nanoid } from 'nanoid';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class TeamManager {
  private teamsDir: string;
  private teams: Map<string, Team> = new Map();
  private members: Map<string, TeamMember[]> = new Map();
  private invites: Map<string, TeamInvite[]> = new Map();

  constructor(teamsDir?: string) {
    this.teamsDir = teamsDir || path.join(os.homedir(), '.eamilos', 'teams');
    this.ensureDir();
    this.loadData();
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.teamsDir)) {
      fs.mkdirSync(this.teamsDir, { recursive: true });
    }
  }

  private teamFilePath(): string {
    return path.join(this.teamsDir, 'teams.json');
  }

  private membersFilePath(): string {
    return path.join(this.teamsDir, 'members.json');
  }

  private invitesFilePath(): string {
    return path.join(this.teamsDir, 'invites.json');
  }

  private loadData(): void {
    try {
      if (fs.existsSync(this.teamFilePath())) {
        const teams = JSON.parse(fs.readFileSync(this.teamFilePath(), 'utf-8')) as Team[];
        for (const t of teams) this.teams.set(t.id, t);
      }
      if (fs.existsSync(this.membersFilePath())) {
        const members = JSON.parse(fs.readFileSync(this.membersFilePath(), 'utf-8')) as TeamMember[];
        for (const m of members) {
          const teamMembers = this.members.get(m.teamId) || [];
          teamMembers.push(m);
          this.members.set(m.teamId, teamMembers);
        }
      }
      if (fs.existsSync(this.invitesFilePath())) {
        const invites = JSON.parse(fs.readFileSync(this.invitesFilePath(), 'utf-8')) as TeamInvite[];
        for (const inv of invites) {
          const teamInvites = this.invites.get(inv.teamId) || [];
          teamInvites.push(inv);
          this.invites.set(inv.teamId, teamInvites);
        }
      }
    } catch {
      // Ignore corrupted data
    }
  }

  private saveData(): void {
    fs.writeFileSync(this.teamFilePath(), JSON.stringify(Array.from(this.teams.values()), null, 2), 'utf-8');

    const allMembers: TeamMember[] = [];
    for (const members of this.members.values()) allMembers.push(...members);
    fs.writeFileSync(this.membersFilePath(), JSON.stringify(allMembers, null, 2), 'utf-8');

    const allInvites: TeamInvite[] = [];
    for (const invites of this.invites.values()) allInvites.push(...invites);
    fs.writeFileSync(this.invitesFilePath(), JSON.stringify(allInvites, null, 2), 'utf-8');
  }

  createTeam(name: string, ownerId: string, ownerEmail: string): Team {
    const team: Team = {
      id: nanoid(12),
      name,
      ownerId,
      createdAt: Date.now(),
      settings: {
        maxAgents: 10,
        maxCostPerMonth: 500,
        allowedProviders: ['openai', 'anthropic', 'google', 'ollama'],
        defaultRole: 'member',
      },
    };

    this.teams.set(team.id, team);

    const ownerMember: TeamMember = {
      userId: ownerId,
      teamId: team.id,
      role: 'owner',
      joinedAt: Date.now(),
      lastActive: Date.now(),
      email: ownerEmail,
    };

    const teamMembers = this.members.get(team.id) || [];
    teamMembers.push(ownerMember);
    this.members.set(team.id, teamMembers);

    this.saveData();
    return team;
  }

  getTeam(id: string): Team | undefined {
    return this.teams.get(id);
  }

  listTeams(): Team[] {
    return Array.from(this.teams.values());
  }

  getTeamMembers(teamId: string): TeamMember[] {
    return this.members.get(teamId) || [];
  }

  updateTeamSettings(teamId: string, settings: Partial<Team['settings']>): boolean {
    const team = this.teams.get(teamId);
    if (!team) return false;

    team.settings = { ...team.settings, ...settings };
    this.saveData();
    return true;
  }

  deleteTeam(teamId: string): boolean {
    if (!this.teams.has(teamId)) return false;

    this.teams.delete(teamId);
    this.members.delete(teamId);
    this.invites.delete(teamId);
    this.saveData();
    return true;
  }

  removeMember(teamId: string, userId: string): boolean {
    const teamMembers = this.members.get(teamId);
    if (!teamMembers) return false;

    const idx = teamMembers.findIndex(m => m.userId === userId);
    if (idx < 0) return false;

    const member = teamMembers[idx];
    if (member.role === 'owner') {
      const team = this.teams.get(teamId);
      if (team && team.ownerId === userId) {
        throw new Error('Cannot remove team owner. Transfer ownership first.');
      }
    }

    teamMembers.splice(idx, 1);
    this.members.set(teamId, teamMembers);
    this.saveData();
    return true;
  }

  updateMemberRole(teamId: string, userId: string, role: Role): boolean {
    const teamMembers = this.members.get(teamId);
    if (!teamMembers) return false;

    const member = teamMembers.find(m => m.userId === userId);
    if (!member) return false;

    member.role = role;
    this.saveData();
    return true;
  }

  createInvite(teamId: string, email: string, role: Role): TeamInvite | null {
    const team = this.teams.get(teamId);
    if (!team) return null;

    const invite: TeamInvite = {
      id: nanoid(12),
      teamId,
      email,
      role,
      token: crypto.randomUUID(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      used: false,
      createdAt: Date.now(),
    };

    const teamInvites = this.invites.get(teamId) || [];
    teamInvites.push(invite);
    this.invites.set(teamId, teamInvites);
    this.saveData();
    return invite;
  }

  getTeamInvites(teamId: string): TeamInvite[] {
    return this.invites.get(teamId) || [];
  }

  acceptInvite(token: string, userId: string, email: string): TeamMember | null {
    for (const [teamId, teamInvites] of this.invites.entries()) {
      const invite = teamInvites.find(i => i.token === token && !i.used && i.expiresAt > Date.now() && i.email === email);
      if (!invite) continue;

      invite.used = true;

      const member: TeamMember = {
        userId,
        teamId,
        role: invite.role,
        joinedAt: Date.now(),
        lastActive: Date.now(),
        email,
      };

      const teamMembers = this.members.get(teamId) || [];
      teamMembers.push(member);
      this.members.set(teamId, teamMembers);

      this.saveData();
      return member;
    }

    return null;
  }

  getUserTeams(userId: string): Array<{ team: Team; member: TeamMember }> {
    const result: Array<{ team: Team; member: TeamMember }> = [];

    for (const [teamId, teamMembers] of this.members.entries()) {
      const member = teamMembers.find(m => m.userId === userId);
      if (member) {
        const team = this.teams.get(teamId);
        if (team) {
          result.push({ team, member });
        }
      }
    }

    return result;
  }

  getMemberCount(teamId: string): number {
    return this.members.get(teamId)?.length ?? 0;
  }
}

let globalTeamManager: TeamManager | null = null;

export function initTeamManager(dir?: string): TeamManager {
  globalTeamManager = new TeamManager(dir);
  return globalTeamManager;
}

export function getTeamManager(): TeamManager {
  if (!globalTeamManager) {
    return initTeamManager();
  }
  return globalTeamManager;
}
