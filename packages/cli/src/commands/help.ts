export function helpCommand(version: string): void {
  console.log(`
  ╔══════════════════════════════════════════════╗
  ║           EamilOS v${version.padEnd(27)}║
  ║     AI Execution Kernel                      ║
  ╚══════════════════════════════════════════════╝

  USAGE:
    eamilos <command> [options]

  COMMANDS:
    run <goal>           Generate code from natural language
    init                 Initialize configuration (first-time setup)
    setup                Interactive guided setup wizard
    doctor               Diagnose system health and fix issues
    benchmark            Test and rank available models
    plugins <action>     Manage plugins (list, install, remove, info, health)
    status [project]    Show project status
    list                 List all projects
    pause <project>      Pause a project
    resume <project>     Resume a paused project
    cancel <project>     Cancel a project
    retry <project>      Retry failed tasks
    help                 Show this help
    version              Show version

  OPTIONS:
    --debug              Show detailed output and stack traces
    --verbose            Show detailed progress
    --model <name>       Override model selection (e.g., --model gpt-4o)
    --provider <name>    Override provider (e.g., --provider ollama)
    --output <dir>       Output directory for generated files
    --fix                Attempt auto-repairs (doctor command)

  PLUGINS:
    eamilos plugins list          Show installed plugins
    eamilos plugins install <src> Install from path or URL
    eamilos plugins remove <id>   Remove a plugin
    eamilos plugins info <id>     Show plugin details
    eamilos plugins health        Check plugin health

  EXAMPLES:
    eamilos run "Create a Python calculator with add, subtract, multiply, divide"
    eamilos run "Build a REST API with Express.js" --model gpt-4o
    eamilos run "Create an HTML landing page" --debug
    eamilos benchmark --model phi3:mini
    eamilos doctor --fix
    eamilos plugins list

  QUICK START:
    1. eamilos setup          (guided configuration)
    2. eamilos doctor         (verify everything works)
    3. eamilos benchmark       (rank your available models)
    4. eamilos run "..."      (generate code)

  DOCUMENTATION:
    https://github.com/eamilos/eamilos#readme
    `);
}
