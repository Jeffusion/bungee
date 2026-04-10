import type { LLMProvider } from '../core/types';
import type {
  ProviderTokenAccountingCapabilities,
  ProviderTokenAccountingCapabilityMatrix,
  SupportedTokenAccountingProvider
} from './types';

export const PROVIDER_TOKEN_ACCOUNTING_CAPABILITY_MATRIX = {
  openai: {
    provider: 'openai',
    supportsOfficialResponseUsage: true,
    supportsStreamingResponseUsage: true,
    supportsDedicatedCountEndpoint: true,
    supportsLocalTokenizer: true,
    supportsHeuristicFallback: true,
    dedicatedCountEndpoint: {
      supported: true,
      mode: 'input_estimate_only',
      defaultEnabled: false,
      endpoint: '/responses/input_tokens',
      livePathAuthority: false
    }
  },
  anthropic: {
    provider: 'anthropic',
    supportsOfficialResponseUsage: true,
    supportsStreamingResponseUsage: true,
    supportsDedicatedCountEndpoint: true,
    supportsLocalTokenizer: true,
    supportsHeuristicFallback: true,
    dedicatedCountEndpoint: {
      supported: true,
      mode: 'input_estimate_only',
      livePathAuthority: false,
      endpoint: '/v1/messages/count_tokens'
    }
  },
  gemini: {
    provider: 'gemini',
    supportsOfficialResponseUsage: true,
    supportsStreamingResponseUsage: true,
    supportsDedicatedCountEndpoint: true,
    supportsLocalTokenizer: true,
    supportsHeuristicFallback: true,
    countTokens: {
      supported: true,
      mode: 'input_estimate_only',
      livePathAuthority: false
    }
  }
} as const satisfies ProviderTokenAccountingCapabilityMatrix;

function normalizeProvider(provider: LLMProvider): SupportedTokenAccountingProvider {
  return String(provider).trim().toLowerCase() as SupportedTokenAccountingProvider;
}

export function getProviderTokenAccountingCapabilities(provider: LLMProvider): ProviderTokenAccountingCapabilities {
  const capabilities = PROVIDER_TOKEN_ACCOUNTING_CAPABILITY_MATRIX[normalizeProvider(provider)];
  if (!capabilities) {
    throw new Error(`Unsupported token accounting provider: ${provider}`);
  }

  return capabilities;
}
