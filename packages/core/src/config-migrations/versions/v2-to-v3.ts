import type { ConfigMigration, MigrationChange, MigrationWarning } from '../types';
import { cleanupEmptyObjects, cloneJson, isPlainRecord } from '../utils';

const CAMEL_TO_SNAKE_MAPPINGS: [string, string][] = [
  ['configVersion', 'config_version'],
  ['logLevel', 'log_level'],
  ['bodyParserLimit', 'body_parser_limit'],
  ['pathRewrite', 'path_rewrite'],
  ['stickySession', 'sticky_session'],
  ['keyExpression', 'key_expression'],
  ['connectMs', 'connect_ms'],
  ['requestMs', 'request_ms'],
  ['retryOn', 'retry_on'],
  ['passiveHealth', 'passive_health'],
  ['consecutiveFailures', 'consecutive_failures'],
  ['healthySuccesses', 'healthy_successes'],
  ['autoDisableThreshold', 'auto_disable_threshold'],
  ['autoEnableOnActiveHealthCheck', 'auto_enable_on_active_health_check'],
  ['probeIntervalMs', 'probe_interval_ms'],
  ['probeTimeoutMs', 'probe_timeout_ms'],
  ['slowStart', 'slow_start'],
  ['durationMs', 'duration_ms'],
  ['initialWeightFactor', 'initial_weight_factor'],
  ['healthCheck', 'health_check'],
  ['intervalMs', 'interval_ms'],
  ['timeoutMs', 'timeout_ms'],
  ['expectedStatus', 'expected_status'],
  ['unhealthyThreshold', 'unhealthy_threshold'],
  ['healthyThreshold', 'healthy_threshold'],
  ['contentType', 'content_type'],
  ['maxSize', 'max_size'],
  ['retentionDays', 'retention_days'],
  ['upstreams', 'endpoints'],
];

function renameKeysRecursive(obj: unknown, mappings: [string, string][], changes: MigrationChange[]): unknown {
  if (Array.isArray(obj)) {
    return obj.map(item => renameKeysRecursive(item, mappings, changes));
  }

  if (!isPlainRecord(obj)) {
    return obj;
  }

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const mapping = mappings.find(([from]) => from === key);
    const newKey = mapping ? mapping[1] : key;

    if (mapping) {
      changes.push({
        type: 'rename',
        path: key,
        from: key,
        to: newKey,
        message: `Renamed ${key} to ${newKey}`,
      });
    }

    result[newKey] = renameKeysRecursive(value, mappings, changes);
  }

  return result;
}

function migrateRoutesToServiceRef(config: Record<string, any>, changes: MigrationChange[], warnings: MigrationWarning[]): void {
  if (!Array.isArray(config.routes)) return;

  const upstreamSignatureMap = new Map<string, string>();
  const services: Array<Record<string, any>> = [];

  for (const route of config.routes) {
    if (!isPlainRecord(route)) continue;

    const endpoints = route.endpoints;
    if (!Array.isArray(endpoints) || endpoints.length === 0) {
      warnings.push({
        path: `route "${route.path || 'unknown'}"`,
        message: 'Route has no endpoints; skipping service extraction',
      });
      continue;
    }

    const signature = JSON.stringify(endpoints.map((u: any) => ({
      target: u.target,
      weight: u.weight,
      priority: u.priority,
    })));

    let serviceName = upstreamSignatureMap.get(signature);
    if (!serviceName) {
      serviceName = `service-${services.length + 1}`;
      upstreamSignatureMap.set(signature, serviceName);

      const service: Record<string, any> = {
        name: serviceName,
        endpoints: endpoints,
      };

      if (isPlainRecord(route.health_check)) {
        service.health_check = route.health_check;
      }

      services.push(service);
      changes.push({
        type: 'move',
        path: `route "${route.path}".endpoints`,
        from: 'route.endpoints',
        to: `services.${serviceName}.endpoints`,
        message: `Extracted endpoints to service "${serviceName}"`,
      });
    }

    route.service = serviceName;
    delete route.endpoints;
  }

  config.services = services;
}

export const v2ToV3Migration: ConfigMigration = {
  fromVersion: 2,
  toVersion: 3,
  description: 'Migrate camelCase to snake_case and extract upstreams into services',
  migrate(input) {
    const config = cloneJson(input);
    if (!isPlainRecord(config)) {
      throw new Error('Config must be an object');
    }

    const changes: MigrationChange[] = [];
    const warnings: MigrationWarning[] = [];

    const renamedConfig = renameKeysRecursive(config, CAMEL_TO_SNAKE_MAPPINGS, changes) as Record<string, any>;

    migrateRoutesToServiceRef(renamedConfig, changes, warnings);

    renamedConfig.config_version = 3;

    return {
      config: cleanupEmptyObjects(renamedConfig) as any,
      changes,
      warnings,
    };
  },
};
