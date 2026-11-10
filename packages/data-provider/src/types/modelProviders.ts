/** Request format understood by a user-configured endpoint. */
export type TModelProviderKind = 'openai' | 'anthropic';

/** One user-configured endpoint, as shown in Settings. */
export interface TModelProvider {
  name: string;
  baseURL: string;
  models: string[];
  provider: TModelProviderKind;
  hasApiKey: boolean;
  /** Masked preview; the key itself never leaves the server. */
  apiKeyPreview?: string;
}

/** A provider write. Omitting `apiKey` keeps the key already stored for that name. */
export interface TModelProviderInput {
  name: string;
  baseURL: string;
  models: string[];
  provider?: TModelProviderKind;
  apiKey?: string;
}

export interface TModelProvidersResponse {
  providers: TModelProvider[];
}

export interface TModelProvidersInput {
  providers: TModelProviderInput[];
}

/** Ask the server to read a provider's `/models` list. */
export interface TModelProviderModelsInput {
  /** Existing provider name, used to reuse its stored key. */
  name?: string;
  baseURL: string;
  provider?: TModelProviderKind;
  apiKey?: string;
}

export interface TModelProviderModelsResponse {
  models: string[];
}
