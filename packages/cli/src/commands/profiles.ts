import { Command } from 'commander';
import chalk from 'chalk';
import { initProfileManager, getProfileManager, getKeyVault } from '@eamilos/core';

export function registerProfilesCommand(program: Command): void {
  const profileCmd = program
    .command('profile')
    .description('Manage profiles (create, switch, list, delete)');

  profileCmd
    .command('create')
    .description('Create a new profile')
    .argument('<name>', 'Profile name')
    .option('-e, --email <email>', 'Email address')
    .action(async (name: string, options: { email?: string }) => {
      try {
        const pm = initProfileManager();
        const profile = pm.createProfile(name, options.email || `${name}@eamilos.local`);

        console.log(chalk.green(`\n✓ Profile created successfully`));
        console.log(chalk.gray('─'.repeat(40)));
        console.log(`ID: ${chalk.bold(profile.id)}`);
        console.log(`Name: ${profile.name}`);
        console.log(`Email: ${profile.email}`);
        console.log(`Status: ${chalk.green('Active')}`);
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      }
    });

  profileCmd
    .command('list')
    .description('List all profiles')
    .action(async () => {
      try {
        const pm = getProfileManager();
        const profiles = pm.listProfiles();
        const active = pm.getActiveProfile();

        if (profiles.length === 0) {
          console.log(chalk.yellow('No profiles found. Create one with: eamilos profile create <name>'));
          return;
        }

        console.log(chalk.bold('\n📋 Profiles\n'));
        console.log(chalk.gray('─'.repeat(60)));

        for (const p of profiles) {
          const isActive = active?.id === p.id;
          const teamInfo = p.teamId ? ` (Team: ${p.teamId})` : '';
          console.log(
            `${isActive ? chalk.green('●') : chalk.gray('○')} ${p.name} ${chalk.gray(`(${p.id})`)} ${teamInfo}`
          );
          console.log(`  Email: ${p.email} | Last active: ${new Date(p.lastActive).toLocaleString()}`);
        }

        console.log(chalk.gray('\n─'.repeat(60)));
        console.log(`Total: ${profiles.length} profile(s)`);
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      }
    });

  profileCmd
    .command('switch')
    .description('Switch to a different profile')
    .argument('<id>', 'Profile ID')
    .action(async (id: string) => {
      try {
        const pm = getProfileManager();
        const success = pm.setActiveProfile(id);

        if (success) {
          const profile = pm.getProfile(id);
          console.log(chalk.green(`\n✓ Switched to profile: ${profile?.name} (${id})`));
        } else {
          console.log(chalk.red(`\n✗ Profile not found: ${id}`));
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      }
    });

  profileCmd
    .command('delete')
    .description('Delete a profile')
    .argument('<id>', 'Profile ID')
    .action(async (id: string) => {
      try {
        const pm = getProfileManager();
        const kv = getKeyVault();

        const profile = pm.getProfile(id);
        if (!profile) {
          console.log(chalk.red(`Profile not found: ${id}`));
          return;
        }

        kv.wipeProfile(id);
        const success = pm.deleteProfile(id);

        if (success) {
          console.log(chalk.green(`\n✓ Profile deleted: ${profile.name} (${id})`));
        } else {
          console.log(chalk.red(`\n✗ Failed to delete profile`));
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      }
    });

  profileCmd
    .command('set-key')
    .description('Set an API key for the current profile')
    .argument('<provider>', 'Provider name (openai, anthropic, google, etc.)')
    .argument('<key>', 'API key value')
    .action(async (provider: string, key: string) => {
      try {
        const pm = getProfileManager();
        const kv = getKeyVault();

        const profile = pm.getActiveProfile();
        if (!profile) {
          console.log(chalk.red('No active profile. Create or switch to a profile first.'));
          return;
        }

        kv.setKey(profile.id, provider, key);
        console.log(chalk.green(`\n✓ API key set for ${provider}`));
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      }
    });

  profileCmd
    .command('show-keys')
    .description('List stored API key providers for current profile')
    .action(async () => {
      try {
        const pm = getProfileManager();
        const kv = getKeyVault();

        const profile = pm.getActiveProfile();
        if (!profile) {
          console.log(chalk.red('No active profile.'));
          return;
        }

        const keys = kv.listKeys(profile.id);
        if (keys.length === 0) {
          console.log(chalk.yellow('No API keys stored.'));
          return;
        }

        console.log(chalk.bold('\n🔑 Stored API Keys\n'));
        console.log(chalk.gray('─'.repeat(40)));
        for (const k of keys) {
          console.log(`  ${k.provider} (added ${new Date(k.createdAt).toLocaleString()})`);
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      }
    });

  profileCmd
    .command('export')
    .description('Export profile data (GDPR)')
    .argument('<id>', 'Profile ID')
    .action(async (id: string) => {
      try {
        const pm = getProfileManager();
        const data = pm.exportProfileData(id);

        if (!data) {
          console.log(chalk.red('Profile not found'));
          return;
        }

        console.log(data);
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      }
    });
}
