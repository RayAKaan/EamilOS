import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

export interface TestContext {
  testId: string;
  baseDir: string;
  dbPath: string;
  configPath: string;
  cleanup: () => void;
}

export function createTestContext(): TestContext {
  const testId = randomUUID().slice(0, 8);
  const baseDir = join(tmpdir(), `eamilos-test-${testId}`);
  const dbPath = join(baseDir, "eamilos.db");
  const configPath = join(baseDir, "eamilos.config.yaml");

  mkdirSync(baseDir, { recursive: true });

  return {
    testId,
    baseDir,
    dbPath,
    configPath,
    cleanup: () => {
      rmSync(baseDir, { recursive: true, force: true });
    },
  };
}

export function createTestConfig(overrides: Record<string, unknown> = {}): string {
  const config = {
    workspace_path: "/tmp/test-workspace",
    model: {
      provider: "openai",
      model_name: "gpt-4o-mini",
      api_key: "test-key",
      max_tokens: 4000,
    },
    budget: {
      monthly_limit_usd: 100,
      warn_at_percentage: 80,
      max_burst_per_minute: 10,
    },
    logging: {
      level: "info",
      file: "eamilos.log",
      live: true,
    },
    ...overrides,
  };

  return `workspace_path: ${config.workspace_path}
model:
  provider: ${config.model.provider}
  model_name: ${config.model.model_name}
  api_key: ${config.model.api_key}
  max_tokens: ${config.model.max_tokens}
budget:
  monthly_limit_usd: ${config.budget.monthly_limit_usd}
  warn_at_percentage: ${config.budget.warn_at_percentage}
  max_burst_per_minute: ${config.budget.max_burst_per_minute}
logging:
  level: ${config.logging.level}
  file: ${config.logging.file}
  live: ${config.logging.live}
`;
}
