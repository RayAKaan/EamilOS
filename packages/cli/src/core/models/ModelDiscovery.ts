import * as os from 'os';

export interface ModelProfile {
  id: string;
  provider: string;
  name: string;
  description: string;
  minRAM: number;
  contextWindow: number;
  strengths: string[];
  typicalUseCases: string[];
  speed: 'fast' | 'medium' | 'slow';
  quality: 'basic' | 'good' | 'excellent';
}

export interface SystemProfile {
  totalRAM: number;
  availableRAM: number;
  cpuCores: number;
  os: string;
}

export interface ModelRecommendation {
  model: ModelProfile;
  reason: string;
  score: number;
}

const MODEL_REGISTRY: Record<string, ModelProfile> = {
  'phi3:mini': {
    id: 'phi3:mini',
    provider: 'ollama',
    name: 'Phi-3 Mini',
    description: 'Microsoft\'s compact 3.8B model optimized for speed and efficiency',
    minRAM: 2,
    contextWindow: 4096,
    strengths: ['fast responses', 'low memory', 'good for simple tasks'],
    typicalUseCases: ['quick analysis', 'simple transformations', 'draft generation'],
    speed: 'fast',
    quality: 'basic',
  },
  'phi3': {
    id: 'phi3',
    provider: 'ollama',
    name: 'Phi-3',
    description: 'Microsoft\'s 7B model with strong reasoning',
    minRAM: 4,
    contextWindow: 4096,
    strengths: ['reasoning', 'code completion', 'low latency'],
    typicalUseCases: ['coding tasks', 'problem solving', 'documentation'],
    speed: 'fast',
    quality: 'good',
  },
  'llama3.2:1b': {
    id: 'llama3.2:1b',
    provider: 'ollama',
    name: 'Llama 3.2 1B',
    description: 'Meta\'s lightweight model for resource-constrained environments',
    minRAM: 2,
    contextWindow: 8192,
    strengths: ['fast', 'efficient', 'open source'],
    typicalUseCases: ['simple tasks', 'real-time applications', 'mobile'],
    speed: 'fast',
    quality: 'basic',
  },
  'llama3.2:3b': {
    id: 'llama3.2:3b',
    provider: 'ollama',
    name: 'Llama 3.2 3B',
    description: 'Meta\'s balanced model with good quality/performance ratio',
    minRAM: 4,
    contextWindow: 8192,
    strengths: ['balanced', 'versatile', 'good context'],
    typicalUseCases: ['general tasks', 'writing', 'analysis'],
    speed: 'fast',
    quality: 'good',
  },
  'llama3.1:8b': {
    id: 'llama3.1:8b',
    provider: 'ollama',
    name: 'Llama 3.1 8B',
    description: 'Meta\'s capable 8B model with extended context',
    minRAM: 8,
    contextWindow: 32768,
    strengths: ['long context', 'reasoning', 'open source'],
    typicalUseCases: ['complex analysis', 'document processing', 'multi-file tasks'],
    speed: 'medium',
    quality: 'good',
  },
  'llama3.1:70b': {
    id: 'llama3.1:70b',
    provider: 'ollama',
    name: 'Llama 3.1 70B',
    description: 'Meta\'s flagship model for highest quality responses',
    minRAM: 64,
    contextWindow: 32768,
    strengths: ['premium quality', 'complex reasoning', 'creative tasks'],
    typicalUseCases: ['complex coding', 'architecture design', 'critical analysis'],
    speed: 'slow',
    quality: 'excellent',
  },
  'mistral:7b': {
    id: 'mistral:7b',
    provider: 'ollama',
    name: 'Mistral 7B',
    description: 'Mistral AI\'s efficient 7B model',
    minRAM: 6,
    contextWindow: 8192,
    strengths: ['balanced', 'good at following instructions', 'efficient'],
    typicalUseCases: ['instruction following', 'summarization', 'general tasks'],
    speed: 'medium',
    quality: 'good',
  },
  'qwen2.5:7b': {
    id: 'qwen2.5:7b',
    provider: 'ollama',
    name: 'Qwen 2.5 7B',
    description: 'Alibaba\'s model with strong coding capabilities',
    minRAM: 6,
    contextWindow: 8192,
    strengths: ['coding', 'math', 'multilingual'],
    typicalUseCases: ['code generation', 'debugging', 'technical writing'],
    speed: 'medium',
    quality: 'good',
  },
  'codellama:13b': {
    id: 'codellama:13b',
    provider: 'ollama',
    name: 'Code Llama 13B',
    description: 'Meta\'s specialized code model',
    minRAM: 12,
    contextWindow: 16384,
    strengths: ['code generation', 'completion', 'debugging'],
    typicalUseCases: ['code writing', 'refactoring', 'code review'],
    speed: 'medium',
    quality: 'good',
  },
  'gpt-4o-mini': {
    id: 'gpt-4o-mini',
    provider: 'openai',
    name: 'GPT-4o Mini',
    description: 'OpenAI\'s fast and affordable small model',
    minRAM: 0,
    contextWindow: 128000,
    strengths: ['fast', 'cost-effective', 'good reasoning'],
    typicalUseCases: ['quick tasks', 'high-volume applications', 'cost-sensitive'],
    speed: 'fast',
    quality: 'good',
  },
  'gpt-4o': {
    id: 'gpt-4o',
    provider: 'openai',
    name: 'GPT-4o',
    description: 'OpenAI\'s flagship multimodal model',
    minRAM: 0,
    contextWindow: 128000,
    strengths: ['multimodal', 'reasoning', 'creative'],
    typicalUseCases: ['complex tasks', 'multimodal analysis', 'premium quality'],
    speed: 'medium',
    quality: 'excellent',
  },
  'claude-3-5-haiku': {
    id: 'claude-3-5-haiku',
    provider: 'anthropic',
    name: 'Claude 3.5 Haiku',
    description: 'Anthropic\'s fast and affordable model',
    minRAM: 0,
    contextWindow: 200000,
    strengths: ['fast', 'precise', 'good at following style'],
    typicalUseCases: ['quick tasks', 'high-volume', 'style matching'],
    speed: 'fast',
    quality: 'good',
  },
  'claude-3-5-sonnet': {
    id: 'claude-3-5-sonnet',
    provider: 'anthropic',
    name: 'Claude 3.5 Sonnet',
    description: 'Anthropic\'s balanced high-quality model',
    minRAM: 0,
    contextWindow: 200000,
    strengths: ['reasoning', 'analysis', 'writing'],
    typicalUseCases: ['complex analysis', 'long documents', 'quality writing'],
    speed: 'medium',
    quality: 'excellent',
  },
};

export class ModelDiscovery {
  private systemProfile: SystemProfile;

  constructor(systemProfile?: SystemProfile) {
    this.systemProfile = systemProfile || this.detectSystem();
  }

  private detectSystem(): SystemProfile {
    return {
      totalRAM: os.totalmem() / (1024 * 1024 * 1024),
      availableRAM: os.freemem() / (1024 * 1024 * 1024),
      cpuCores: os.cpus().length,
      os: os.platform(),
    };
  }

  getSystemProfile(): SystemProfile {
    return { ...this.systemProfile };
  }

  getModelProfile(modelId: string): ModelProfile | null {
    return MODEL_REGISTRY[modelId] || null;
  }

  getAllModels(): ModelProfile[] {
    return Object.values(MODEL_REGISTRY);
  }

  getModelsByProvider(provider: string): ModelProfile[] {
    return Object.values(MODEL_REGISTRY).filter(m => m.provider === provider);
  }

  getCompatibleModels(): ModelProfile[] {
    const { availableRAM } = this.systemProfile;
    return Object.values(MODEL_REGISTRY).filter(
      m => m.provider === 'ollama' ? m.minRAM <= availableRAM : true
    );
  }

  recommendModels(options: {
    useCase?: string;
    priority?: 'speed' | 'quality' | 'balanced';
    budget?: 'low' | 'medium' | 'high';
    minQuality?: 'basic' | 'good' | 'excellent';
  }): ModelRecommendation[] {
    const { priority = 'balanced', minQuality = 'basic' } = options;
    const compatible = this.getCompatibleModels();

    const qualityOrder = { basic: 0, good: 1, excellent: 2 };
    const filtered = compatible.filter(
      m => qualityOrder[m.quality] >= qualityOrder[minQuality]
    );

    const scored = filtered.map(model => {
      let score = 50;

      if (priority === 'speed') {
        const speedScore = { fast: 100, medium: 60, slow: 20 };
        score = speedScore[model.speed];
      } else if (priority === 'quality') {
        const qualityScore = { basic: 20, good: 70, excellent: 100 };
        score = qualityScore[model.quality];
      } else {
        const speedScore = { fast: 60, medium: 80, slow: 40 };
        const qualityScore = { basic: 30, good: 70, excellent: 100 };
        score = (speedScore[model.speed] + qualityScore[model.quality]) / 2;
      }

      if (model.provider !== 'ollama') {
        score -= 20;
      }

      if (model.minRAM > 0 && model.minRAM <= this.systemProfile.availableRAM / 2) {
        score += 10;
      }

      return { model, score };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ model, score }) => ({
        model,
        score,
        reason: this.generateReason(model),
      }));
  }

  private generateReason(model: ModelProfile): string {
    const reasons: string[] = [];

    if (model.provider === 'ollama') {
      reasons.push('runs locally');
    }
    if (model.speed === 'fast') {
      reasons.push('fast responses');
    }
    if (model.quality === 'excellent') {
      reasons.push('highest quality');
    } else if (model.quality === 'good') {
      reasons.push('good quality');
    }
    if (model.minRAM <= 4) {
      reasons.push('low memory');
    }

    return reasons.length > 0 ? reasons.join(', ') : 'balanced option';
  }

  explainModelChoice(modelId: string): string {
    const profile = this.getModelProfile(modelId);
    if (!profile) {
      return `Unknown model: ${modelId}`;
    }

    const parts: string[] = [
      `**${profile.name}**`,
      profile.description,
      '',
      '**Specs:**',
      `- RAM: ${profile.minRAM > 0 ? `${profile.minRAM} GB minimum` : 'cloud (no local RAM needed)'}`,
      `- Context: ${profile.contextWindow.toLocaleString()} tokens`,
      `- Speed: ${profile.speed}`,
      `- Quality: ${profile.quality}`,
      '',
      '**Strengths:**',
      ...profile.strengths.map(s => `- ${s}`),
      '',
      '**Use cases:**',
      ...profile.typicalUseCases.map(u => `- ${u}`),
    ];

    return parts.join('\n');
  }
}

export const modelDiscovery = new ModelDiscovery();
