import { createMetaProvider } from '@pagebroadcast/meta-provider';
import { config } from './config.js';

export const metaProvider = createMetaProvider(config.META_PROVIDER, {
  appId: config.META_APP_ID,
  appSecret: config.META_APP_SECRET,
  graphVersion: config.META_GRAPH_VERSION,
  redirectUri: config.META_REDIRECT_URI,
});
