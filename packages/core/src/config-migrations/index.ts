import type { ConfigMigration } from './types';
import { v1ToV2Migration } from './versions/v1-to-v2';
import { v2ToV3Migration } from './versions/v2-to-v3';
import { v3ToV4Migration } from './versions/v3-to-v4';

export const CONFIG_MIGRATIONS: ConfigMigration[] = [
  v1ToV2Migration,
  v2ToV3Migration,
  v3ToV4Migration,
];
