import { Command } from 'commander';
import chalk from 'chalk';
import { initTeamManager, getTeamManager, getProfileManager } from '@eamilos/core';

export function registerTeamCommand(program: Command): void {
  const teamCmd = program
    .command('team')
    .description('Manage teams (create, invite, members, settings)');

  teamCmd
    .command('create')
    .description('Create a new team')
    .argument('<name>', 'Team name')
    .action(async (name: string) => {
      try {
        const pm = getProfileManager();
        const tm = initTeamManager();

        const profile = pm.getActiveProfile();
        if (!profile) {
          console.log(chalk.red('No active profile. Create or switch to a profile first.'));
          return;
        }

        const team = tm.createTeam(name, profile.userId, profile.email);
        pm.joinTeam(profile.id, team.id, 'owner');

        console.log(chalk.green(`\n✓ Team created successfully`));
        console.log(chalk.gray('─'.repeat(40)));
        console.log(`ID: ${chalk.bold(team.id)}`);
        console.log(`Name: ${team.name}`);
        console.log(`Owner: ${profile.name}`);
        console.log(`Created: ${new Date(team.createdAt).toLocaleString()}`);
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      }
    });

  teamCmd
    .command('list')
    .description('List teams you are a member of')
    .action(async () => {
      try {
        const pm = getProfileManager();
        const tm = getTeamManager();

        const profile = pm.getActiveProfile();
        if (!profile) {
          console.log(chalk.red('No active profile.'));
          return;
        }

        const userTeams = tm.getUserTeams(profile.userId);
        if (userTeams.length === 0) {
          console.log(chalk.yellow('Not a member of any teams.'));
          return;
        }

        console.log(chalk.bold('\n👥 Teams\n'));
        console.log(chalk.gray('─'.repeat(60)));

        for (const { team, member } of userTeams) {
          const memberCount = tm.getMemberCount(team.id);
          console.log(`${chalk.bold(team.name)} ${chalk.gray(`(${team.id})`)}`);
          console.log(`  Role: ${member.role} | Members: ${memberCount}`);
          console.log(`  Created: ${new Date(team.createdAt).toLocaleString()}`);
          console.log('');
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      }
    });

  teamCmd
    .command('invite')
    .description('Invite someone to a team')
    .argument('<team-id>', 'Team ID')
    .argument('<email>', 'Email to invite')
    .option('-r, --role <role>', 'Role (owner, admin, member, viewer)', 'member')
    .action(async (teamId: string, email: string, options: { role?: string }) => {
      try {
        const tm = getTeamManager();

        const invite = tm.createInvite(teamId, email, options.role as any);
        if (!invite) {
          console.log(chalk.red('Team not found'));
          return;
        }

        console.log(chalk.green(`\n✓ Invite created`));
        console.log(chalk.gray('─'.repeat(40)));
        console.log(`Team: ${teamId}`);
        console.log(`Email: ${email}`);
        console.log(`Role: ${invite.role}`);
        console.log(`Token: ${invite.token}`);
        console.log(`Expires: ${new Date(invite.expiresAt).toLocaleString()}`);
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      }
    });

  teamCmd
    .command('accept-invite')
    .description('Accept a team invite')
    .argument('<token>', 'Invite token')
    .action(async (token: string) => {
      try {
        const pm = getProfileManager();
        const tm = getTeamManager();

        const profile = pm.getActiveProfile();
        if (!profile) {
          console.log(chalk.red('No active profile.'));
          return;
        }

        const member = tm.acceptInvite(token, profile.userId, profile.email);
        if (!member) {
          console.log(chalk.red('Invalid or expired invite token'));
          return;
        }

        pm.joinTeam(profile.id, member.teamId, member.role);

        console.log(chalk.green(`\n✓ Joined team successfully`));
        console.log(chalk.gray('─'.repeat(40)));
        console.log(`Team ID: ${member.teamId}`);
        console.log(`Role: ${member.role}`);
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      }
    });

  teamCmd
    .command('members')
    .description('List team members')
    .argument('<team-id>', 'Team ID')
    .action(async (teamId: string) => {
      try {
        const tm = getTeamManager();

        const team = tm.getTeam(teamId);
        if (!team) {
          console.log(chalk.red('Team not found'));
          return;
        }

        const members = tm.getTeamMembers(teamId);

        console.log(chalk.bold(`\n👥 Members of ${team.name}\n`));
        console.log(chalk.gray('─'.repeat(60)));

        for (const m of members) {
          const isOwner = team.ownerId === m.userId;
          console.log(`${chalk.bold(m.email)} ${isOwner ? chalk.yellow('(Owner)') : ''}`);
          console.log(`  Role: ${m.role} | Joined: ${new Date(m.joinedAt).toLocaleString()}`);
          console.log('');
        }

        console.log(`Total: ${members.length} member(s)`);
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      }
    });

  teamCmd
    .command('remove-member')
    .description('Remove a member from a team')
    .argument('<team-id>', 'Team ID')
    .argument('<user-id>', 'User ID to remove')
    .action(async (teamId: string, userId: string) => {
      try {
        const tm = getTeamManager();

        const success = tm.removeMember(teamId, userId);
        if (success) {
          console.log(chalk.green(`\n✓ Member removed from team`));
        } else {
          console.log(chalk.red('\n✗ Failed to remove member'));
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      }
    });

  teamCmd
    .command('update-role')
    .description('Update a member\'s role')
    .argument('<team-id>', 'Team ID')
    .argument('<user-id>', 'User ID')
    .argument('<role>', 'New role (owner, admin, member, viewer)')
    .action(async (teamId: string, userId: string, role: string) => {
      try {
        const tm = getTeamManager();

        const success = tm.updateMemberRole(teamId, userId, role as any);
        if (success) {
          console.log(chalk.green(`\n✓ Role updated to ${role}`));
        } else {
          console.log(chalk.red('\n✗ Failed to update role'));
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      }
    });

  teamCmd
    .command('settings')
    .description('View or update team settings')
    .argument('<team-id>', 'Team ID')
    .option('--max-agents <number>', 'Maximum agents allowed')
    .option('--max-cost <number>', 'Maximum monthly cost (USD)')
    .action(async (teamId: string, options: { maxAgents?: string; maxCost?: string }) => {
      try {
        const tm = getTeamManager();

        const team = tm.getTeam(teamId);
        if (!team) {
          console.log(chalk.red('Team not found'));
          return;
        }

        const updates: Record<string, unknown> = {};
        if (options.maxAgents) updates.maxAgents = parseInt(options.maxAgents);
        if (options.maxCost) updates.maxCostPerMonth = parseFloat(options.maxCost);

        if (Object.keys(updates).length > 0) {
          tm.updateTeamSettings(teamId, updates);
          console.log(chalk.green('\n✓ Team settings updated'));
        }

        const updated = tm.getTeam(teamId)!;
        console.log(chalk.bold(`\n⚙️  Team Settings: ${team.name}\n`));
        console.log(chalk.gray('─'.repeat(40)));
        console.log(`Max Agents: ${updated.settings.maxAgents}`);
        console.log(`Max Monthly Cost: $${updated.settings.maxCostPerMonth}`);
        console.log(`Allowed Providers: ${updated.settings.allowedProviders.join(', ')}`);
        console.log(`Default Role: ${updated.settings.defaultRole}`);
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      }
    });
}
