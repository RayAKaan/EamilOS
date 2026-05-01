import { Command } from 'commander';
import chalk from 'chalk';
import { getAuditLogger, getAuditReporter, getProfileManager } from '@eamilos/core';

export function registerAuditCommand(program: Command): void {
  const auditCmd = program
    .command('audit')
    .description('View and export audit logs');

  auditCmd
    .command('log')
    .description('View recent audit events')
    .option('-t, --type <type>', 'Filter by type (auth, team, resource, cost, security)')
    .option('-r, --result <result>', 'Filter by result (success, failure)')
    .option('-l, --limit <limit>', 'Max events to show', '20')
    .option('--profile <profile>', 'Filter by profile ID')
    .action(async (options: { type?: string; result?: string; limit?: string; profile?: string }) => {
      try {
        const logger = getAuditLogger();

        const events = logger.getEvents({
          type: options.type as any,
          result: options.result as any,
          profileId: options.profile,
          limit: parseInt(options.limit || '20'),
        });

        if (events.length === 0) {
          console.log(chalk.yellow('No audit events found.'));
          return;
        }

        console.log(chalk.bold('\n📋 Audit Events\n'));
        console.log(chalk.gray('─'.repeat(80)));

        for (const event of events) {
          const resultIcon = event.result === 'success' ? chalk.green('✓') : chalk.red('✗');
          console.log(`${resultIcon} ${chalk.bold(event.action)} ${chalk.gray(`[${event.type}]`)}`);
          console.log(`  Profile: ${event.profileId} | Time: ${new Date(event.timestamp).toLocaleString()}`);
          if (Object.keys(event.details).length > 0) {
            console.log(`  Details: ${JSON.stringify(event.details).slice(0, 100)}`);
          }
          console.log('');
        }

        console.log(chalk.gray('─'.repeat(80)));
        console.log(`Total: ${events.length} event(s)`);
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      }
    });

  auditCmd
    .command('export')
    .description('Export audit logs to file')
    .option('-f, --format <format>', 'Export format (json, csv)', 'json')
    .option('-o, --output <path>', 'Output file path', 'audit-export.json')
    .option('-t, --type <type>', 'Filter by type')
    .option('--from <timestamp>', 'Start timestamp')
    .option('--to <timestamp>', 'End timestamp')
    .action(async (options: { format?: string; output?: string; type?: string; from?: string; to?: string }) => {
      try {
        const reporter = getAuditReporter();

        const reportOptions: any = {};
        if (options.type) reportOptions.type = options.type;
        if (options.from) reportOptions.from = parseInt(options.from);
        if (options.to) reportOptions.to = parseInt(options.to);

        reporter.exportToFile(
          options.output || 'audit-export.json',
          (options.format as any) || 'json',
          reportOptions,
        );

        console.log(chalk.green(`\n✓ Audit log exported to ${options.output}`));
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      }
    });

  auditCmd
    .command('summary')
    .description('Generate audit summary report')
    .option('-t, --type <type>', 'Filter by type')
    .option('--profile <profile>', 'Filter by profile ID')
    .action(async (options: { type?: string; profile?: string }) => {
      try {
        const reporter = getAuditReporter();

        const summary = reporter.generateSummary({
          type: options.type as any,
          profileId: options.profile,
        });

        console.log(chalk.bold('\n📊 Audit Summary\n'));
        console.log(chalk.gray('─'.repeat(50)));
        console.log(`Total Events: ${summary.totalEvents}`);
        console.log(`Failure Rate: ${(summary.failureRate * 100).toFixed(1)}%`);

        console.log(chalk.bold('\nBy Type:'));
        for (const [type, count] of Object.entries(summary.byType)) {
          console.log(`  ${type}: ${count}`);
        }

        console.log(chalk.bold('\nBy Result:'));
        for (const [result, count] of Object.entries(summary.byResult)) {
          console.log(`  ${result}: ${count}`);
        }

        console.log(chalk.gray('\n─'.repeat(50)));
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      }
    });

  auditCmd
    .command('compliance')
    .description('Run compliance check')
    .action(async () => {
      try {
        const { ComplianceManager } = await import('@eamilos/core');
        const logger = getAuditLogger();
        const pm = getProfileManager();
        const { getKeyVault } = await import('@eamilos/core');
        const { getTeamManager } = await import('@eamilos/core');

        const kv = getKeyVault();
        const tm = getTeamManager();

        const compliance = new ComplianceManager(logger, pm, kv, tm);
        const report = compliance.generateComplianceReport();
        const check = compliance.checkCompliance();

        console.log(chalk.bold('\n🛡️  Compliance Report\n'));
        console.log(chalk.gray('─'.repeat(50)));
        console.log(`Status: ${check.compliant ? chalk.green('Compliant') : chalk.red('Issues Found')}`);
        console.log(`Retention Period: ${report.retentionPeriodDays} days`);
        console.log(`Active Profiles: ${report.profileDataExported}`);
        console.log(`Expired Profiles: ${report.profileDataDeleted}`);

        if (check.issues.length > 0) {
          console.log(chalk.bold('\nIssues:'));
          for (const issue of check.issues) {
            console.log(chalk.yellow(`  ⚠ ${issue}`));
          }
        }

        console.log(chalk.gray('\n─'.repeat(50)));
        console.log(`Generated: ${new Date(report.generatedAt).toLocaleString()}`);
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      }
    });

  auditCmd
    .command('purge')
    .description('Purge old audit logs')
    .argument('<days>', 'Purge logs older than this many days')
    .action(async (days: string) => {
      try {
        const logger = getAuditLogger();

        const count = logger.purgeOlderThan(Date.now() - parseInt(days) * 24 * 60 * 60 * 1000);
        console.log(chalk.green(`\n✓ Purged ${count} old audit log(s)`));
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      }
    });

  auditCmd
    .command('stats')
    .description('Show audit log statistics')
    .action(async () => {
      try {
        const logger = getAuditLogger();

        const total = logger.getEventCount();
        const failed = logger.getFailedEvents().length;
        const types = ['auth', 'team', 'resource', 'cost', 'security'] as const;

        console.log(chalk.bold('\n📈 Audit Statistics\n'));
        console.log(chalk.gray('─'.repeat(40)));
        console.log(`Total Events: ${total}`);
        console.log(`Failed Events: ${failed}`);

        console.log(chalk.bold('\nBy Type:'));
        for (const type of types) {
          const count = logger.getEventsByType(type).length;
          if (count > 0) {
            console.log(`  ${type}: ${count}`);
          }
        }

        console.log(chalk.gray('\n─'.repeat(40)));
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
      }
    });
}
