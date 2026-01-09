<script lang="ts">
  import type { FailoverConfig } from '../types';
  import { _ } from '../i18n';

  export let value: FailoverConfig | undefined = undefined;
  export let label: string = 'Failover';
  export let showHelp: boolean = true;

  let enabled = false;
  let initialized = false;

  // 基础配置
  let retryableStatusCodes: (number | string)[] = [];
  let statusCodesInput = '';

  // 被动健康检查配置
  let consecutiveFailuresThreshold: number | undefined;
  let healthyThreshold: number | undefined;
  let requestTimeoutMs: number | undefined;
  let connectTimeoutMs: number | undefined;
  let recoveryIntervalMs: number | undefined;
  let recoveryTimeoutMs: number | undefined;
  
  // 自动禁用配置
  let autoDisableThreshold: number | undefined;
  let autoEnableOnHealthCheck: boolean = true;

  // 主动健康检查配置
  let healthCheckEnabled = false;
  let healthCheckIntervalMs: number | undefined;
  let healthCheckTimeoutMs: number | undefined;
  let healthCheckPath: string | undefined;
  let healthCheckMethod: string | undefined;
  let healthCheckBody: string | undefined;
  let healthCheckContentType: string | undefined;
  let healthCheckHeaders: Record<string, string> | undefined;
  let healthCheckQuery: Record<string, string> | undefined;
  let healthCheckHeadersInput = '';
  let healthCheckQueryInput = '';
  let healthCheckExpectedStatus: number[] = [];
  let healthCheckExpectedStatusInput = '';
  let healthCheckUnhealthyThreshold: number | undefined;
  let healthCheckHealthyThreshold: number | undefined;

  // 慢启动配置
  let slowStartEnabled = false;
  let slowStartDurationMs: number | undefined;
  let slowStartInitialWeightFactor: number | undefined;

  // 响应式初始化和同步
  $: {
    // 从 prop 初始化（仅一次）
    if (!initialized && value) {
      enabled = value.enabled || false;

      // 基础配置
      retryableStatusCodes = value.retryableStatusCodes || [500, 502, 503, 504];
      statusCodesInput = retryableStatusCodes.join(', ');

      // 被动健康检查
      consecutiveFailuresThreshold = value.consecutiveFailuresThreshold;
      healthyThreshold = value.healthyThreshold;
      requestTimeoutMs = value.requestTimeoutMs;
      connectTimeoutMs = value.connectTimeoutMs;
      recoveryIntervalMs = value.recoveryIntervalMs;
      recoveryTimeoutMs = value.recoveryTimeoutMs;
      
      // 自动禁用配置
      autoDisableThreshold = value.autoDisableThreshold;
      autoEnableOnHealthCheck = value.autoEnableOnHealthCheck ?? true;

      // 主动健康检查
      if (value.healthCheck) {
        healthCheckEnabled = value.healthCheck.enabled || false;
        healthCheckIntervalMs = value.healthCheck.intervalMs;
        healthCheckTimeoutMs = value.healthCheck.timeoutMs;
        healthCheckPath = value.healthCheck.path;
        healthCheckMethod = value.healthCheck.method;
        healthCheckBody = value.healthCheck.body;
        healthCheckContentType = value.healthCheck.contentType;
        healthCheckHeaders = value.healthCheck.headers;
        healthCheckQuery = value.healthCheck.query;
        healthCheckHeadersInput = formatKeyValuePairs(value.healthCheck.headers);
        healthCheckQueryInput = formatKeyValuePairs(value.healthCheck.query);
        healthCheckExpectedStatus = value.healthCheck.expectedStatus || [200];
        healthCheckExpectedStatusInput = healthCheckExpectedStatus.join(', ');
        healthCheckUnhealthyThreshold = value.healthCheck.unhealthyThreshold;
        healthCheckHealthyThreshold = value.healthCheck.healthyThreshold;
      }

      // 慢启动
      if (value.slowStart) {
        slowStartEnabled = value.slowStart.enabled || false;
        slowStartDurationMs = value.slowStart.durationMs;
        slowStartInitialWeightFactor = value.slowStart.initialWeightFactor;
      }

      initialized = true;
    }

    // 从本地状态更新 prop
    if (enabled) {
      if (!value) {
        value = {
          enabled: true,
          retryableStatusCodes: retryableStatusCodes.length > 0 ? retryableStatusCodes : [500, 502, 503, 504]
        };
      } else {
        value.enabled = true;
        value.retryableStatusCodes = retryableStatusCodes.length > 0 ? retryableStatusCodes : [500, 502, 503, 504];

        // 被动健康检查
        if (consecutiveFailuresThreshold !== undefined) value.consecutiveFailuresThreshold = consecutiveFailuresThreshold;
        if (healthyThreshold !== undefined) value.healthyThreshold = healthyThreshold;
        if (requestTimeoutMs !== undefined) value.requestTimeoutMs = requestTimeoutMs;
        if (connectTimeoutMs !== undefined) value.connectTimeoutMs = connectTimeoutMs;
        if (recoveryIntervalMs !== undefined) value.recoveryIntervalMs = recoveryIntervalMs;
        if (recoveryTimeoutMs !== undefined) value.recoveryTimeoutMs = recoveryTimeoutMs;
        
        // 自动禁用配置
        if (autoDisableThreshold !== undefined) value.autoDisableThreshold = autoDisableThreshold;
        value.autoEnableOnHealthCheck = autoEnableOnHealthCheck;

        // 主动健康检查
        if (healthCheckEnabled) {
          value.healthCheck = {
            enabled: true,
            intervalMs: healthCheckIntervalMs,
            timeoutMs: healthCheckTimeoutMs,
            path: healthCheckPath,
            method: healthCheckMethod,
            body: healthCheckBody,
            contentType: healthCheckContentType,
            headers: healthCheckHeaders,
            query: healthCheckQuery,
            expectedStatus: healthCheckExpectedStatus.length > 0 ? healthCheckExpectedStatus : [200],
            unhealthyThreshold: healthCheckUnhealthyThreshold,
            healthyThreshold: healthCheckHealthyThreshold
          };
        } else {
          value.healthCheck = undefined;
        }

        // 慢启动
        if (slowStartEnabled) {
          value.slowStart = {
            enabled: true,
            durationMs: slowStartDurationMs,
            initialWeightFactor: slowStartInitialWeightFactor
          };
        } else {
          value.slowStart = undefined;
        }
      }
    } else {
      value = undefined;
    }
  }

  // 解析状态码输入
  function parseStatusCodes(input: string): (number | string)[] {
    return input
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .map(s => {
        const n = parseInt(s);
        // 如果是纯数字且解析正确，返回数字
        if (!isNaN(n) && n.toString() === s) {
          return n;
        }
        // 否则返回字符串（保留表达式）
        return s;
      });
  }

  function parseNumberStatusCodes(input: string): number[] {
    return input
      .split(',')
      .map(s => parseInt(s.trim()))
      .filter(n => !isNaN(n) && n >= 100 && n < 600);
  }

  // 格式化键值对为多行文本
  function formatKeyValuePairs(obj: Record<string, string> | undefined): string {
    if (!obj) return '';
    return Object.entries(obj)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');
  }

  // 解析多行文本为键值对
  function parseKeyValuePairs(input: string): Record<string, string> | undefined {
    if (!input.trim()) return undefined;
    
    const result: Record<string, string> = {};
    const lines = input.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      const colonIndex = trimmed.indexOf(':');
      if (colonIndex === -1) continue;
      
      const key = trimmed.substring(0, colonIndex).trim();
      const value = trimmed.substring(colonIndex + 1).trim();
      
      if (key) {
        result[key] = value;
      }
    }
    
    return Object.keys(result).length > 0 ? result : undefined;
  }

  $: retryableStatusCodes = parseStatusCodes(statusCodesInput);
  $: healthCheckExpectedStatus = parseNumberStatusCodes(healthCheckExpectedStatusInput);
</script>

<div class="form-control w-full">
  <div class="label">
    <span class="label-text font-semibold">{label}</span>
    {#if showHelp}
      <span class="label-text-alt text-xs">
        {$_('routeEditor.failoverHelp')}
      </span>
    {/if}
  </div>

  <div class="space-y-4">
    <!-- 启用/禁用故障转移 -->
    <div class="form-control">
      <label class="label cursor-pointer justify-start gap-4">
        <input
          type="checkbox"
          class="checkbox"
          bind:checked={enabled}
          on:change={() => {
            initialized = true;
          }}
        />
        <span class="label-text">{$_('routeEditor.enableFailover')}</span>
      </label>
    </div>

    {#if enabled}
      <!-- 基础配置 -->
      <div class="form-control">
        <label class="label" for="failover-status-codes">
          <span class="label-text">{$_('routeEditor.retryableStatusCodes')}</span>
        </label>
        <input
          id="failover-status-codes"
          type="text"
          placeholder={$_('routeEditor.retryableStatusCodesPlaceholder')}
          class="input input-bordered input-sm"
          bind:value={statusCodesInput}
        />
        <div class="label">
          <span class="label-text-alt text-xs">{$_('routeEditor.retryableStatusCodesHelp')}</span>
        </div>
      </div>

      <!-- 被动健康检查配置 -->
      <div class="collapse collapse-arrow bg-base-200">
        <input type="checkbox" />
        <div class="collapse-title text-sm font-medium">
          {$_('routeEditor.passiveHealthCheck')}
        </div>
        <div class="collapse-content space-y-4">
          <!-- 说明提示 -->
          <div class="text-xs text-base-content/60 bg-base-300 rounded p-2 flex gap-2 items-start">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-4 h-4">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            <span>{$_('routeEditor.passiveHealthCheckTooltip')}</span>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="form-control">
              <label class="label" for="consecutive-failures-threshold">
                <span class="label-text">{$_('routeEditor.consecutiveFailuresThreshold')}</span>
              </label>
              <input
                id="consecutive-failures-threshold"
                type="number"
                placeholder="3"
                class="input input-bordered input-sm"
                bind:value={consecutiveFailuresThreshold}
                min="1"
              />
              <div class="label">
                <span class="label-text-alt text-xs">{$_('routeEditor.consecutiveFailuresThresholdHelp')}</span>
              </div>
            </div>

            <div class="form-control">
              <label class="label" for="healthy-threshold">
                <span class="label-text">{$_('routeEditor.healthyThreshold')}</span>
              </label>
              <input
                id="healthy-threshold"
                type="number"
                placeholder="2"
                class="input input-bordered input-sm"
                bind:value={healthyThreshold}
                min="1"
              />
              <div class="label">
                <span class="label-text-alt text-xs">{$_('routeEditor.healthyThresholdHelp')}</span>
              </div>
            </div>

            <div class="form-control">
              <label class="label" for="request-timeout-ms">
                <span class="label-text">{$_('routeEditor.requestTimeoutMs')}</span>
              </label>
              <input
                id="request-timeout-ms"
                type="number"
                placeholder="30000"
                class="input input-bordered input-sm"
                bind:value={requestTimeoutMs}
                min="100"
              />
              <div class="label">
                <span class="label-text-alt text-xs">{$_('routeEditor.requestTimeoutMsHelp')}</span>
              </div>
            </div>

            <div class="form-control">
              <label class="label" for="connect-timeout-ms">
                <span class="label-text">{$_('routeEditor.connectTimeoutMs')}</span>
              </label>
              <input
                id="connect-timeout-ms"
                type="number"
                placeholder="5000"
                class="input input-bordered input-sm"
                bind:value={connectTimeoutMs}
                min="100"
              />
              <div class="label">
                <span class="label-text-alt text-xs">{$_('routeEditor.connectTimeoutMsHelp')}</span>
              </div>
            </div>

            <div class="form-control">
              <label class="label" for="recovery-interval-ms">
                <span class="label-text">{$_('routeEditor.recoveryIntervalMs')}</span>
              </label>
              <input
                id="recovery-interval-ms"
                type="number"
                placeholder="5000"
                class="input input-bordered input-sm"
                bind:value={recoveryIntervalMs}
                min="1000"
              />
              <div class="label">
                <span class="label-text-alt text-xs">{$_('routeEditor.recoveryIntervalHelp')}</span>
              </div>
            </div>

            <div class="form-control">
              <label class="label" for="recovery-timeout-ms">
                <span class="label-text">{$_('routeEditor.recoveryTimeoutMs')}</span>
              </label>
              <input
                id="recovery-timeout-ms"
                type="number"
                placeholder="3000"
                class="input input-bordered input-sm"
                bind:value={recoveryTimeoutMs}
                min="100"
              />
              <div class="label">
                <span class="label-text-alt text-xs">{$_('routeEditor.recoveryTimeoutHelp')}</span>
              </div>
            </div>

            <!-- 新增：自动禁用配置 -->
            <div class="form-control">
              <label class="label" for="auto-disable-threshold">
                <span class="label-text">{$_('routeEditor.autoDisableThreshold')}</span>
              </label>
              <input
                id="auto-disable-threshold"
                type="number"
                placeholder={$_('routeEditor.autoDisableThresholdPlaceholder')}
                class="input input-bordered input-sm"
                bind:value={autoDisableThreshold}
                min="1"
              />
              <div class="label">
                <span class="label-text-alt text-xs">{$_('routeEditor.autoDisableThresholdHelp')}</span>
              </div>
            </div>

            <div class="form-control">
              <label class="label cursor-pointer justify-start gap-2">
                <input
                  type="checkbox"
                  class="checkbox checkbox-sm"
                  bind:checked={autoEnableOnHealthCheck}
                />
                <span class="label-text">{$_('routeEditor.autoEnableOnHealthCheck')}</span>
              </label>
              <div class="label">
                <span class="label-text-alt text-xs">{$_('routeEditor.autoEnableOnHealthCheckHelp')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 主动健康检查配置 -->
      <div class="collapse collapse-arrow bg-base-200">
        <input type="checkbox" />
        <div class="collapse-title text-sm font-medium">
          {$_('routeEditor.activeHealthCheck')}
        </div>
        <div class="collapse-content space-y-4">
          <!-- 说明提示 -->
          <div class="text-xs text-base-content/60 bg-base-300 rounded p-2 flex gap-2 items-start">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-4 h-4">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            <span>{$_('routeEditor.activeHealthCheckTooltip')}</span>
          </div>

          <div class="form-control">
            <label class="label cursor-pointer justify-start gap-4">
              <input
                type="checkbox"
                class="checkbox checkbox-sm"
                bind:checked={healthCheckEnabled}
              />
              <span class="label-text">{$_('routeEditor.enableActiveHealthCheck')}</span>
            </label>
          </div>

          {#if healthCheckEnabled}
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="form-control">
                <label class="label" for="health-check-interval-ms">
                  <span class="label-text">{$_('routeEditor.healthCheckIntervalMs')}</span>
                </label>
                <input
                  id="health-check-interval-ms"
                  type="number"
                  placeholder="10000"
                  class="input input-bordered input-sm"
                  bind:value={healthCheckIntervalMs}
                  min="1000"
                />
                <div class="label">
                  <span class="label-text-alt text-xs">{$_('routeEditor.healthCheckIntervalMsHelp')}</span>
                </div>
              </div>

              <div class="form-control">
                <label class="label" for="health-check-timeout-ms">
                  <span class="label-text">{$_('routeEditor.healthCheckTimeoutMs')}</span>
                </label>
                <input
                  id="health-check-timeout-ms"
                  type="number"
                  placeholder="3000"
                  class="input input-bordered input-sm"
                  bind:value={healthCheckTimeoutMs}
                  min="100"
                />
                <div class="label">
                  <span class="label-text-alt text-xs">{$_('routeEditor.healthCheckTimeoutMsHelp')}</span>
                </div>
              </div>

              <div class="form-control">
                <label class="label" for="health-check-path">
                  <span class="label-text">{$_('routeEditor.healthCheckPath')}</span>
                </label>
                <input
                  id="health-check-path"
                  type="text"
                  placeholder="/health"
                  class="input input-bordered input-sm"
                  bind:value={healthCheckPath}
                />
                <div class="label">
                  <span class="label-text-alt text-xs">{$_('routeEditor.healthCheckPathHelp')}</span>
                </div>
              </div>

              <div class="form-control">
                <label class="label" for="health-check-method">
                  <span class="label-text">{$_('routeEditor.healthCheckMethod')}</span>
                </label>
                <select
                  id="health-check-method"
                  class="select select-bordered select-sm"
                  bind:value={healthCheckMethod}
                >
                  <option value="">GET (default)</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="PATCH">PATCH</option>
                  <option value="HEAD">HEAD</option>
                </select>
              </div>

              <div class="form-control">
                <label class="label" for="health-check-expected-status">
                  <span class="label-text">{$_('routeEditor.healthCheckExpectedStatus')}</span>
                </label>
                <input
                  id="health-check-expected-status"
                  type="text"
                  placeholder="200"
                  class="input input-bordered input-sm"
                  bind:value={healthCheckExpectedStatusInput}
                />
                <div class="label">
                  <span class="label-text-alt text-xs">{$_('routeEditor.healthCheckExpectedStatusHelp')}</span>
                </div>
              </div>

              <div class="form-control">
                <label class="label" for="health-check-unhealthy-threshold">
                  <span class="label-text">{$_('routeEditor.healthCheckUnhealthyThreshold')}</span>
                </label>
                <input
                  id="health-check-unhealthy-threshold"
                  type="number"
                  placeholder="3"
                  class="input input-bordered input-sm"
                  bind:value={healthCheckUnhealthyThreshold}
                  min="1"
                />
                <div class="label">
                  <span class="label-text-alt text-xs">{$_('routeEditor.healthCheckUnhealthyThresholdHelp')}</span>
                </div>
              </div>

              <div class="form-control">
                <label class="label" for="health-check-healthy-threshold">
                  <span class="label-text">{$_('routeEditor.healthCheckHealthyThreshold')}</span>
                </label>
                <input
                  id="health-check-healthy-threshold"
                  type="number"
                  placeholder="2"
                  class="input input-bordered input-sm"
                  bind:value={healthCheckHealthyThreshold}
                  min="1"
                />
                <div class="label">
                  <span class="label-text-alt text-xs">{$_('routeEditor.healthCheckHealthyThresholdHelp')}</span>
                </div>
              </div>

              <!-- 仅当选择POST/PUT/PATCH时显示 -->
              {#if healthCheckMethod && ['POST', 'PUT', 'PATCH'].includes(healthCheckMethod.toUpperCase())}
                <div class="form-control md:col-span-2">
                  <label class="label" for="health-check-content-type">
                    <span class="label-text">{$_('routeEditor.healthCheckContentType')}</span>
                  </label>
                  <select
                    id="health-check-content-type"
                    class="select select-bordered select-sm"
                    bind:value={healthCheckContentType}
                  >
                    <option value="">application/json (default)</option>
                    <option value="application/json">application/json</option>
                    <option value="application/x-www-form-urlencoded">application/x-www-form-urlencoded</option>
                    <option value="text/plain">text/plain</option>
                  </select>
                  <div class="label">
                    <span class="label-text-alt text-xs">{$_('routeEditor.healthCheckContentTypeHelp')}</span>
                  </div>
                </div>

                <div class="form-control md:col-span-2">
                  <label class="label" for="health-check-body">
                    <span class="label-text">{$_('routeEditor.healthCheckBody')}</span>
                  </label>
                  <textarea
                    id="health-check-body"
                    placeholder={$_('routeEditor.healthCheckBodyPlaceholder')}
                    class="textarea textarea-bordered textarea-sm"
                    rows="4"
                    bind:value={healthCheckBody}
                  />
                  <div class="label">
                    <span class="label-text-alt text-xs">{$_('routeEditor.healthCheckBodyHelp')}</span>
                  </div>
                </div>
              {/if}

              <!-- 自定义 Headers -->
              <div class="form-control md:col-span-2">
                <label class="label" for="health-check-headers">
                  <span class="label-text">{$_('routeEditor.healthCheckHeaders')}</span>
                </label>
                <textarea
                  id="health-check-headers"
                  placeholder={$_('routeEditor.healthCheckHeadersPlaceholder')}
                  class="textarea textarea-bordered textarea-sm font-mono text-xs"
                  rows="4"
                  bind:value={healthCheckHeadersInput}
                  on:blur={() => {
                    healthCheckHeaders = parseKeyValuePairs(healthCheckHeadersInput);
                  }}
                />
                <div class="label">
                  <span class="label-text-alt text-xs">{$_('routeEditor.healthCheckHeadersHelp')}</span>
                </div>
              </div>

              <!-- 自定义 Query 参数 -->
              <div class="form-control md:col-span-2">
                <label class="label" for="health-check-query">
                  <span class="label-text">{$_('routeEditor.healthCheckQuery')}</span>
                </label>
                <textarea
                  id="health-check-query"
                  placeholder={$_('routeEditor.healthCheckQueryPlaceholder')}
                  class="textarea textarea-bordered textarea-sm font-mono text-xs"
                  rows="3"
                  bind:value={healthCheckQueryInput}
                  on:blur={() => {
                    healthCheckQuery = parseKeyValuePairs(healthCheckQueryInput);
                  }}
                />
                <div class="label">
                  <span class="label-text-alt text-xs">{$_('routeEditor.healthCheckQueryHelp')}</span>
                </div>
              </div>
            </div>
          {/if}
        </div>
      </div>

      <!-- 慢启动配置 -->
      <div class="collapse collapse-arrow bg-base-200">
        <input type="checkbox" />
        <div class="collapse-title text-sm font-medium">
          {$_('routeEditor.slowStart')}
        </div>
        <div class="collapse-content space-y-4">
          <!-- 说明提示 -->
          <div class="text-xs text-base-content/60 bg-base-300 rounded p-2 flex gap-2 items-start">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-4 h-4">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            <span>{$_('routeEditor.slowStartTooltip')}</span>
          </div>

          <div class="form-control">
            <label class="label cursor-pointer justify-start gap-4">
              <input
                type="checkbox"
                class="checkbox checkbox-sm"
                bind:checked={slowStartEnabled}
              />
              <span class="label-text">{$_('routeEditor.enableSlowStart')}</span>
            </label>
          </div>

          {#if slowStartEnabled}
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="form-control">
                <label class="label" for="slow-start-duration-ms">
                  <span class="label-text">{$_('routeEditor.slowStartDurationMs')}</span>
                </label>
                <input
                  id="slow-start-duration-ms"
                  type="number"
                  placeholder="30000"
                  class="input input-bordered input-sm"
                  bind:value={slowStartDurationMs}
                  min="1000"
                />
                <div class="label">
                  <span class="label-text-alt text-xs">{$_('routeEditor.slowStartDurationMsHelp')}</span>
                </div>
              </div>

              <div class="form-control">
                <label class="label" for="slow-start-initial-weight-factor">
                  <span class="label-text">{$_('routeEditor.slowStartInitialWeightFactor')}</span>
                </label>
                <input
                  id="slow-start-initial-weight-factor"
                  type="number"
                  placeholder="0.1"
                  class="input input-bordered input-sm"
                  bind:value={slowStartInitialWeightFactor}
                  min="0.01"
                  max="1"
                  step="0.01"
                />
                <div class="label">
                  <span class="label-text-alt text-xs">{$_('routeEditor.slowStartInitialWeightFactorHelp')}</span>
                </div>
              </div>
            </div>
          {/if}
        </div>
      </div>

      <!-- 配置说明 -->
      <div class="alert alert-info shadow-sm text-xs">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-4 h-4">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
        <div>
          {$_('routeEditor.failoverInfoNotice')}
        </div>
      </div>
    {/if}
  </div>
</div>
