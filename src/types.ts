export type AIProvider = 'anthropic' | 'gemini' | 'openai' | 'deepseek' | 'custom';

export interface AIModelOption {
  id: string;
  name: string;
  provider: AIProvider;
  description: string;
  badge?: string;
  isPopular?: boolean;
}

export interface AIUserConfig {
  provider: AIProvider;
  model: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
  deepseekApiKey?: string;
  customEndpoint?: string;
  customApiKey?: string;
  customModelName?: string;
  temperature?: number;
  analysisStyle?: 'comprehensive' | 'concise' | 'technical';
  enableMarketGrounding?: boolean;
}

export const DEFAULT_AI_CONFIG: AIUserConfig = {
  provider: 'gemini',
  model: 'gemini-3.1-pro-preview',
  analysisStyle: 'comprehensive',
  enableMarketGrounding: true
};

export const POPULAR_AI_MODELS: AIModelOption[] = [
  // Anthropic Claude
  {
    id: 'claude-3-7-sonnet-20250219',
    name: 'Claude 3.7 Sonnet',
    provider: 'anthropic',
    description: 'Anthropic flagship model with hybrid thinking and supreme financial reasoning',
    badge: 'Flagship Reasoning',
    isPopular: true
  },
  {
    id: 'claude-3-5-sonnet-20241022',
    name: 'Claude 3.5 Sonnet v2',
    provider: 'anthropic',
    description: 'High intelligence and fast response times for deep equity research',
    isPopular: true
  },
  {
    id: 'claude-3-5-haiku-20241022',
    name: 'Claude 3.5 Haiku',
    provider: 'anthropic',
    description: 'Ultra-fast, cost-effective model for rapid stock overviews'
  },
  {
    id: 'claude-3-opus-20240229',
    name: 'Claude 3 Opus',
    provider: 'anthropic',
    description: 'Deep analytical capabilities for complex macro & portfolio strategies'
  },

  // Google Gemini
  {
    id: 'gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro Preview',
    provider: 'gemini',
    description: 'Google next-generation preview model with exceptional multimodal reasoning',
    badge: 'Pro Preview',
    isPopular: true
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'gemini',
    description: 'Ultra-fast, high-accuracy model with live Google Search grounding',
    badge: 'Fast & Grounded',
    isPopular: true
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    provider: 'gemini',
    description: 'Advanced reasoning, deep financial logic, and real-time market search',
    isPopular: true
  },
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    provider: 'gemini',
    description: 'High-speed analysis with low latency'
  },

  // OpenAI
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    description: 'OpenAI flagship multimodal model with strong analytical benchmarks',
    badge: 'Omni Flagship',
    isPopular: true
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openai',
    description: 'Lightweight, fast model for snappy portfolio summaries'
  },
  {
    id: 'o3-mini',
    name: 'o3-mini',
    provider: 'openai',
    description: 'Advanced reasoning model with deep chain-of-thought calculation',
    badge: 'Reasoning'
  },
  {
    id: 'o1',
    name: 'o1',
    provider: 'openai',
    description: 'Top-tier STEM and complex mathematical equity analysis model'
  },

  // DeepSeek
  {
    id: 'deepseek-chat',
    name: 'DeepSeek-V3',
    provider: 'deepseek',
    description: 'High-performance 671B MoE model with exceptional financial comprehension'
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek-R1',
    provider: 'deepseek',
    description: 'Specialized reasoning model with step-by-step logic exploration',
    badge: 'R1 Reasoning'
  }
];

export const PROVIDER_INFO: Record<AIProvider, { name: string; iconLabel: string; color: string; badgeBg: string }> = {
  anthropic: {
    name: 'Anthropic Claude',
    iconLabel: 'Claude',
    color: 'text-amber-600 dark:text-amber-400',
    badgeBg: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
  },
  gemini: {
    name: 'Google Gemini',
    iconLabel: 'Gemini',
    color: 'text-indigo-600 dark:text-indigo-400',
    badgeBg: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800'
  },
  openai: {
    name: 'OpenAI ChatGPT',
    iconLabel: 'OpenAI',
    color: 'text-emerald-600 dark:text-emerald-400',
    badgeBg: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
  },
  deepseek: {
    name: 'DeepSeek',
    iconLabel: 'DeepSeek',
    color: 'text-blue-600 dark:text-blue-400',
    badgeBg: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
  },
  custom: {
    name: 'Custom / OpenAI API',
    iconLabel: 'Custom',
    color: 'text-purple-600 dark:text-purple-400',
    badgeBg: 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800'
  }
};
