import { DiscoveredAgent } from '../auto-discovery.js';
import { getLogger } from '../logger.js';

export interface ValidationResult {
  valid: boolean;
  error?: string;
  latency?: number;
}

export class HealthValidator {
  async validateAgent(agent: DiscoveredAgent): Promise<ValidationResult> {
    try {
      switch (agent.type) {
        case 'cli':
          return this.validateCLIAgent(agent);
        case 'ollama':
          return await this.validateOllamaAgent(agent);
        case 'cloud':
          return await this.validateCloudAgent(agent);
        default:
          return { valid: true };
      }
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private validateCLIAgent(agent: DiscoveredAgent): ValidationResult {
    const { execSync } = require('child_process');
    try {
      execSync(`${agent.id} --help`, { stdio: 'ignore', timeout: 5000 });
      return { valid: true, latency: 0 };
    } catch (error) {
      return { valid: false, error: `CLI execution failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async validateOllamaAgent(agent: DiscoveredAgent): Promise<ValidationResult> {
    const start = Date.now();

    try {
      const response = await fetch('http://localhost:11434/api/tags', {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        return { valid: false, error: `Ollama HTTP ${response.status}` };
      }

      const data = (await response.json()) as { models?: Array<{ name: string }> };
      const models = data.models || [];

      if (agent.model) {
        const exists = models.some(m => m.name === agent.model);
        if (!exists) {
          return { valid: false, error: `Model ${agent.model} not found` };
        }
      }

      return { valid: true, latency: Date.now() - start };
    } catch (error) {
      return { valid: false, error: `Ollama API unreachable: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async validateCloudAgent(agent: DiscoveredAgent): Promise<ValidationResult> {
    const start = Date.now();

    try {
      switch (agent.provider) {
        case 'openai':
          return await this.validateOpenAI();
        case 'anthropic':
          return await this.validateAnthropic();
        case 'google':
          return await this.validateGoogle();
        case 'deepseek':
          return await this.validateDeepSeek();
        case 'xai':
          return await this.validateXAI();
        default:
          return { valid: true, latency: Date.now() - start };
      }
    } catch (error) {
      return {
        valid: false,
        error: `${agent.provider} error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async validateOpenAI(): Promise<ValidationResult> {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      signal: AbortSignal.timeout(8000),
    });

    if (response.status === 401) {
      return { valid: false, error: 'Invalid OpenAI API key' };
    }

    if (!response.ok) {
      return { valid: false, error: `OpenAI HTTP ${response.status}` };
    }

    return { valid: true };
  }

  private async validateAnthropic(): Promise<ValidationResult> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (response.status === 401) {
      return { valid: false, error: 'Invalid Anthropic API key' };
    }

    if (response.status === 400) {
      return { valid: true };
    }

    if (!response.ok) {
      return { valid: false, error: `Anthropic HTTP ${response.status}` };
    }

    return { valid: true };
  }

  private async validateGoogle(): Promise<ValidationResult> {
    const response = await fetch('https://generativelanguage.googleapis.com/v1/models?key=' + process.env.GOOGLE_API_KEY, {
      signal: AbortSignal.timeout(8000),
    });

    if (response.status === 403) {
      return { valid: false, error: 'Invalid or restricted Google API key' };
    }

    if (!response.ok) {
      return { valid: false, error: `Google HTTP ${response.status}` };
    }

    return { valid: true };
  }

  private async validateDeepSeek(): Promise<ValidationResult> {
    const response = await fetch('https://api.deepseek.com/v1/models', {
      headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
      signal: AbortSignal.timeout(8000),
    });

    if (response.status === 401) {
      return { valid: false, error: 'Invalid DeepSeek API key' };
    }

    if (!response.ok) {
      return { valid: false, error: `DeepSeek HTTP ${response.status}` };
    }

    return { valid: true };
  }

  private async validateXAI(): Promise<ValidationResult> {
    const response = await fetch('https://api.x.ai/v1/models', {
      headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}` },
      signal: AbortSignal.timeout(8000),
    });

    if (response.status === 401) {
      return { valid: false, error: 'Invalid XAI API key' };
    }

    if (!response.ok) {
      return { valid: false, error: `XAI HTTP ${response.status}` };
    }

    return { valid: true };
  }

  async validateAll(agents: DiscoveredAgent[]): Promise<ValidationResult[]> {
    const logger = getLogger();
    logger.info(`Validating ${agents.length} discovered agents...`);

    const results = await Promise.allSettled(
      agents.map(agent => this.validateAgent(agent))
    );

    let validCount = 0;
    let invalidCount = 0;

    const mapped = results.map((result, i) => {
      const agent = agents[i];

      if (result.status === 'fulfilled') {
        const validation = result.value;
        if (validation.valid) {
          validCount++;
        } else {
          invalidCount++;
          logger.warn(`Agent ${agent.id} validation failed: ${validation.error}`);
        }
        return validation;
      } else {
        invalidCount++;
        logger.error(`Agent ${agent.id} validation crashed: ${result.reason}`);
        return { valid: false, error: String(result.reason) };
      }
    });

    logger.info(`Validation complete: ${validCount} valid, ${invalidCount} invalid`);
    return mapped;
  }
}
