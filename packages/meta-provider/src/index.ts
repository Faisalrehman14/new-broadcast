import { MetaGraphProvider } from './meta-graph-provider.js';
import { MockMetaProvider } from './mock-meta-provider.js';
import type { MetaProvider, MetaProviderConfig } from './types.js';

export * from './types.js';
export { MetaGraphProvider } from './meta-graph-provider.js';
export { MockMetaProvider } from './mock-meta-provider.js';

export function createMetaProvider(
  mode: 'meta' | 'mock',
  config: MetaProviderConfig
): MetaProvider {
  if (mode === 'mock') {
    return new MockMetaProvider(config);
  }
  if (!config.appId || !config.appSecret) {
    throw new Error(
      'META_PROVIDER=meta requires META_APP_ID and META_APP_SECRET. Use META_PROVIDER=mock for local development.'
    );
  }
  return new MetaGraphProvider(config);
}
