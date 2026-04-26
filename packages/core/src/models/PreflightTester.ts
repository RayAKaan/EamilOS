import { getProviderManager } from '../providers/ProviderManager.js';
import type { ModelProfile, PreflightTestResult } from './types.js';
import { ChatMessage } from '../types.js';

export class PreflightTester {
  private timeoutMs: number = 10000;

  constructor() {}

  async testModel(provider: string, modelName: string): Promise<ModelProfile> {
    const profile: ModelProfile = {
      name: modelName,
      provider,
      supportsTools: false,
      supportsJSON: false,
      supportsStreaming: false,
      maxContextTokens: 4096,
      maxOutputTokens: 2048,
      reliabilityScore: 0.1,
      jsonComplianceRate: 0.0,
      avgResponseTimeMs: 0,
      testedAt: new Date().toISOString(),
      testResults: [],
    };

    const responseTimes: number[] = [];

    const testA = await this.runJSONComplianceTest(provider, modelName);
    profile.testResults.push(testA);
    responseTimes.push(testA.responseTimeMs);
    profile.jsonComplianceRate = this.extractJSONScore(testA);

    const testB = await this.runStructuredCodeTest(provider, modelName);
    profile.testResults.push(testB);
    responseTimes.push(testB.responseTimeMs);
    
    if (testB.passed) {
      profile.reliabilityScore = Math.min(1, profile.reliabilityScore + 0.4);
    } else if (testB.details.includes('valid JSON')) {
      profile.reliabilityScore = Math.min(1, profile.reliabilityScore + 0.2);
    }

    if (provider !== 'ollama') {
      const testC = await this.runToolCallingTest(provider, modelName);
      profile.testResults.push(testC);
      responseTimes.push(testC.responseTimeMs);
      if (testC.passed) {
        profile.supportsTools = true;
      }
    }

    profile.avgResponseTimeMs = responseTimes.length > 0
      ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
      : 0;

    profile.supportsJSON = profile.jsonComplianceRate >= 0.5;
    profile.reliabilityScore = Math.max(0, Math.min(1, profile.reliabilityScore));

    return profile;
  }

  private async runJSONComplianceTest(
    provider: string,
    _modelName: string
  ): Promise<PreflightTestResult> {
    const startTime = Date.now();
    const systemPrompt = 'You are a JSON output machine. Output only valid JSON. No text. No markdown.';
    const userPrompt = 'Respond with ONLY this exact JSON, nothing else: {"status": "ok", "number": 42}';

    try {
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];

      const response = await this.callWithTimeout(
        getProviderManager().chat(messages, undefined, provider),
        this.timeoutMs
      );

      const responseTimeMs = Date.now() - startTime;
      const content = response?.content || '';

      let parsed: any;
      try {
        parsed = JSON.parse(content);
      } catch {
        const extracted = this.extractJSON(content);
        if (extracted) {
          parsed = JSON.parse(extracted);
          return {
            testName: 'JSON Compliance',
            passed: false,
            responseTimeMs,
            details: 'Valid JSON extracted from markdown wrapper (score: 0.5)',
          };
        }
        return {
          testName: 'JSON Compliance',
          passed: false,
          responseTimeMs,
          details: 'No valid JSON found',
        };
      }

      if (parsed.status === 'ok' && parsed.number === 42) {
        return {
          testName: 'JSON Compliance',
          passed: true,
          responseTimeMs,
          details: 'Perfect JSON match (score: 1.0)',
        };
      }

      return {
        testName: 'JSON Compliance',
        passed: false,
        responseTimeMs,
        details: 'Valid JSON but wrong values (score: 0.7)',
      };
    } catch (error) {
      return {
        testName: 'JSON Compliance',
        passed: false,
        responseTimeMs: Date.now() - startTime,
        details: `Error: ${error instanceof Error ? error.message : 'Unknown'}`,
      };
    }
  }

  private async runStructuredCodeTest(
    provider: string,
    _modelName: string
  ): Promise<PreflightTestResult> {
    const startTime = Date.now();
    const systemPrompt = 'You are a JSON output machine. Output only valid JSON. No text. No markdown.';
    const userPrompt = 'Respond with ONLY this JSON: {"summary":"test","files":[{"path":"hello.py","content":"print(42)","language":"python"}]}';

    try {
      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];

      const response = await this.callWithTimeout(
        getProviderManager().chat(messages, undefined, provider),
        this.timeoutMs
      );

      const responseTimeMs = Date.now() - startTime;
      const content = response?.content || '';

      try {
        const parsed = JSON.parse(content);
        
        if (Array.isArray(parsed.files) && parsed.files.length > 0) {
          const file = parsed.files[0];
          if (file.path && file.content) {
            return {
              testName: 'Structured Code Output',
              passed: true,
              responseTimeMs,
              details: 'Perfect structure match',
            };
          }
        }
        
        return {
          testName: 'Structured Code Output',
          passed: false,
          responseTimeMs,
          details: 'Valid JSON but structure does not match expected format',
        };
      } catch {
        return {
          testName: 'Structured Code Output',
          passed: false,
          responseTimeMs,
          details: 'No valid JSON',
        };
      }
    } catch (error) {
      return {
        testName: 'Structured Code Output',
        passed: false,
        responseTimeMs: Date.now() - startTime,
        details: `Error: ${error instanceof Error ? error.message : 'Unknown'}`,
      };
    }
  }

  private async runToolCallingTest(
    _provider: string,
    _modelName: string
  ): Promise<PreflightTestResult> {
    const startTime = Date.now();

    return {
      testName: 'Tool Calling',
      passed: false,
      responseTimeMs: Date.now() - startTime,
      details: 'Tool calling test skipped - implement if provider supports it',
    };
  }

  private extractJSON(content: string): string | null {
    const match = content.match(/```json\s*([\s\S]*?)\s*```/i);
    if (match) {
      return match[1].trim();
    }

    const firstBrace = content.indexOf('{');
    const lastBrace = content.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return content.substring(firstBrace, lastBrace + 1);
    }

    return null;
  }

  private extractJSONScore(test: PreflightTestResult): number {
    const details = test.details;
    if (details.includes('score: 1.0') || details.includes('Perfect')) return 1.0;
    if (details.includes('score: 0.7')) return 0.7;
    if (details.includes('score: 0.5')) return 0.5;
    return 0.0;
  }

  private async callWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Preflight test timeout')), timeoutMs)
      ),
    ]);
  }
}
