import { FeedbackLoop } from '@eamilos/core';
import * as path from 'path';
import * as os from 'os';

interface ExplainRoutingOptions {
  role?: string;
  taskType?: string;
  complexity?: string;
  model?: string;
}

export async function explainRoutingCommand(options: ExplainRoutingOptions): Promise<void> {
  const storagePath = path.join(os.homedir(), '.eamilos', 'learning');

  const feedbackLoop = new FeedbackLoop({
    storagePath,
    enableAutoApply: false,
  });

  await feedbackLoop.initialize();

  const explanation = feedbackLoop.explainRouting({
    role: options.role,
    taskType: options.taskType,
    complexity: options.complexity,
    model: options.model,
  });

  console.log('\n=== Routing Explanation ===\n');
  console.log(explanation);
  console.log('');
}
