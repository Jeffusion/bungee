# Bungee V3 重构执行计划：引入 `services` 与统一 `snake_case` 命名规范

## 1. 项目概述

本计划旨在指导 Bungee 项目从 V2 到 V3 的深度重构。此次重构包含两个核心目标：

1.  **引入 `services`（服务/上游池）**：将内嵌在 `RouteConfig` 中的 `upstreams` 抽象为全局可复用的 `services`，实现路由与后端服务的解耦。
2.  **统一 `snake_case` 命名规范**：全面替换项目中现有的 `camelCase` 和 `PascalCase` 命名，以符合基础设施配置的通用惯例，提升代码可读性和跨语言兼容性。

我们将利用 Bungee 已有的配置迁移基础设施 `config-migrations`，将这两个破坏性变更封装为自动化的 V2 -> V3 迁移脚本，确保现有用户的平滑过渡。

---

## 2. Phase 1: 核心数据模型与类型重构 (1-2 天)

### 目标
完成 `packages/types/src/types.ts` 的定义，将所有新接口和修改后的接口确立下来，为整个重构提供类型基础。

### 关键任务与产出

#### 2.1 `snake_case` 命名规范定义

在整个 V3 模型中，以下所有项必须使用 `snake_case`：
- JSON/YAML 配置文件中的所有键名
- TypeScript 接口的属性名
- 函数参数名
- 变量名

**旧命名 -> 新命名映射表（核心部分）**

| 旧命名 (V2) | 新命名 (V3) | 归属 |
| :--- | :--- | :--- |
| `target` | `target` | Endpoint |
| `weight` | `weight` | Endpoint |
| `priority` | `priority` | Endpoint |
| `condition` | `condition` | Endpoint |
| `plugins` | `plugins` | Endpoint |
| `disabled` | `is_disabled` | Endpoint |
| `upstreams` | `endpoints` | Service/Routes (概念替换) |
| `stickySession`| `sticky_session` | RouteConfig |
| `maxRetries` | `max_retries` | RouteConfig |
| `connectTimeout` | `connect_timeout` | RouteConfig |
| `requestTimeout` | `request_timeout` | RouteConfig |
| `healthCheck` | `health_check` | Service/Route |
| `failover` | `failover` | Service/Route |
| `serviceRef` | `service_ref` | RouteConfig |
| `configVersion` | `config_version` | AppConfig |

#### 2.2 新接口定义

我们将创建三个核心新接口：**`Endpoint`**、**`Service`** 和 **`HealthCheck`**。

**`Endpoint` 接口**
作为 `Upstream` 的替代，`Endpoint` 代表一个具体的目标服务器地址。

```typescript
// packages/types/src/types.ts
export interface Endpoint {
  target: string;
  weight?: number;
  priority?: number;
  condition?: string;
  plugins?: PluginConfig[];
  is_disabled?: boolean; // 替换 disabled
}
```

**`Service` 接口**
`Service` 是一个可复用的全局实体，聚合了多个 `Endpoint` 和共享的健康检查/故障转移逻辑。

```typescript
export interface Service {
  name: string; // 全局唯一标识，name 引用
  endpoints: Endpoint[];
  health_check?: HealthCheckConfig; // 旧 healthCheck
  failover?: FailoverConfig; // 旧 failover
  // ... 其他共享属性
}
```

**`HealthCheckConfig` 接口 (统一规范)**
统一所有与上游健康检查相关的属性，可以应用于 `RouteConfig` 或 `Service`。

```typescript
export interface HealthCheckConfig {
  enabled?: boolean;
  interval_ms?: number; // 旧 intervalMs
  timeout_ms?: number;  // 旧 timeoutMs
  unhealthy_threshold?: number; // 旧 unhealthyThreshold
  healthy_threshold?: number;   // 旧 healthyThreshold
  path?: string;
  // ...
}
```

#### 2.3 `RouteConfig` 接口重构

移除内联 `upstreams`，引入 `service_ref`。

```typescript
export interface RouteConfig {
  id: string; // 保持不变
  path: string; // 保持不变
  methods?: string[]; // 保持不变
  
  // 核心变更：从“拥有 upstreams”变为“引用 service”
  service_ref: string; // 新增：引用全局 services 中的某个 Service
  
  // 移除以下旧属性，其功能迁移到 Service 中
  // upstreams: Upstream[]; // 已移除
  // health_check: ... // 已移除
  // failover: ... // 已移除
  
  // 保留的 Route 特有属性
  is_sticky?: boolean; // 旧 stickySession
  plugins?: PluginConfig[];
  auth?: AuthConfig;
}
```

#### 2.4 `AppConfig` 接口重构

将 `services` 提升为顶层数组，并增加版本号。

```typescript
export interface AppConfig {
  config_version: number; // 旧 configVersion，从 2 升级到 3
  routes: RouteConfig[];
  services: Service[]; // 新增：全局服务定义
  plugins?: PluginConfig[];
  // ... 其他全局属性
}
```

#### 2.5 产出与验收标准
- [ ] `packages/types/src/types.ts` 文件更新，所有旧类型被新类型覆盖或重命名。
- [ ] 所有新的接口必须使用 `snake_case`。
- [ ] 项目 `bun run build:types` 成功编译。

---

## 3. Phase 2: V2 -> V3 配置迁移脚本 (2-3 天)

### 目标
基于 `packages/core/src/config-migrations` 框架，编写 `v2-to-v3` 迁移脚本，实现从 V2 结构到 V3 结构的自动化转换。

### 关键任务与产出

#### 3.1 迁移脚本路径
`src/config-migrations/versions/v2-to-v3.ts`

#### 3.2 迁移逻辑
- **常量定义**：定义旧 `camelCase` 到 V3 `snake_case` 的完整字段映射表。
- **遍历所有 Route**：对于每个 `RouteConfig`：
  1. **命名规范化**：递归遍历对象，将所有 `camelCase` 键名转换为 `snake_case`。
  2. **结构转换**：提取当前的 `upstreams` 列表。检查 `AppConfig.services` 中是否已存在完全相同的 `Service`。
     - **如果存在**：直接使用该 `Service` 的 `name` 作为 `service_ref`。
     - **如果不存在**：在 `AppConfig.services` 中创建一个新的 `Service`，并生成一个唯一的 `name`，然后将其设为该 Route 的 `service_ref`。
  3. **移除旧字段**：从 `RouteConfig` 中移除 `upstreams`、`healthCheck` 等旧属性。
- **生成报告**：记录所有迁移操作（字段重命名、结构移动、新生成的 Service 列表）。

#### 3.3 产出与验收标准
- [ ] `v2-to-v3.ts` 迁移脚本编写完成并可正常执行。
- [ ] **测试用例覆盖**：
  - [ ] 空配置文件
  - [ ] 包含多个 Route 的复杂配置
  - [ ] 包含自定义插件的配置
  - [ ] 包含 `healthCheck` 和 `failover` 的配置
  - [ ] 验证 `camelCase` 到 `snake_case` 的转换是否完整
- [ ] 迁移后的 V3 配置文件通过所有验证。

---

## 4. Phase 3: 运行时重构与适配 (3-4 天)

### 目标
重构请求处理链路、运行时状态管理、上游选择逻辑，使其适配新的 `Service` 和 `Endpoint` 数据模型。

### 关键任务与产出

#### 4.1 运行时状态管理 (`runtime-state.ts`)

运行时状态 `Map` 的 Key 需从 `route` 维度切换到 `service` 维度，实现跨 `Route` 的状态共享。

```typescript
// 旧 V2 模型
const runtimeState = new Map<string, { upstreams: RuntimeUpstream[] }>();
// Key: route.path

// 新 V3 模型
const runtimeState = new Map<string, { endpoints: RuntimeEndpoint[], service_name: string }>();
// Key: service_name
```

#### 4.2 请求处理器 (`handler.ts`)

修改请求处理主流程，适配新的模型。

```typescript
export async function handleRequest(req: Request, config: AppConfig): Promise<Response> {
  // 1. 路由匹配
  const route = find(config.routes, (r) => url.pathname.startsWith(r.path));
  
  // 2. 通过 service_ref 查找全局 Service
  const service = find(config.services, (s) => s.name === route.service_ref);
  
  // 3. 获取 Service 的 endpoints
  const serviceState = runtimeState.get(route.service_ref) || initializeServiceState(service);
  const endpoints = serviceState.endpoints;

  // 4. 从 Service 的 endpoints 中选择目标
  const selectedEndpoint = selectEndpoint(endpoints);

  // 5. 执行转发... (其余逻辑不变)
  return proxyRequest(req, selectedEndpoint);
}
```

#### 4.3 上游选择器 (`selector.ts`)

修改入参，从接受一个 `Route` 变为接受一个 `Service` 的 `endpoints`。

#### 4.4 健康检查与故障转移

将健康检查逻辑从针对 `Route` 改为针对 `Service`。当某个 `endpoint` 被标记为不健康时，`Service` 层面的 `runtimeState` 将共享给所有引用它的 `Route`。

#### 4.5 产出与验收标准
- [ ] 核心运行时文件（`handler.ts`, `selector.ts`, `runtime-state.ts`）完成代码重构。
- [ ] 单元测试覆盖率 > 80%，重点测试 `selectEndpoint` 和服务状态共享逻辑。
- [ ] 集成测试验证多 `Route` 引用同一 `Service` 时的状态一致性。

---

## 5. Phase 4: API、Dashboard 与外围适配 (2-3 天)

### 目标
更新对外接口、管理界面和示例文件，确保整个生态的同步。

### 关键任务与产出

#### 5.1 Admin API 改造
- **`/api/routes`**：返回列表时，将 `Route` 对象的 `upstreams` 替换为 `service_name`。
- **`/api/upstreams`**：该接口的含义将变更为“列出指定 Service 下的 Endpoints”或“列出所有 Services”。建议新增或修改接口以 `/api/services` 为主。
- **新增 API**：
  - `GET /api/services`: 列出所有 Service
  - `GET /api/services/:name`: 获取特定 Service 的 Endpoints
  - `PUT /api/services/:name/toggle`: 切换 Service 下所有 Endpoint 的状态

#### 5.2 Svelte Dashboard 改造
- **Routes 页面**：移除展示 upstreams 的列，改为展示绑定的 `service_name` 列。
- **新增 Services 页面**：实现 `Service` 的列表展示（包含 Endpoints 数量和整体健康状态）。

#### 5.3 配置示例与文档 (`config.example.json` & `docs/`)
- 更新 `config.example.json` 为 V3 格式，并附带详细的注释说明。
- 在 `docs/configuration.md` 中，增加 V3 配置结构的详细说明，并提供 V2 -> V3 的迁移指南。

#### 5.4 产出与验收标准
- [ ] Admin API 测试通过，返回值满足 V3 结构。
- [ ] Dashboard 能够正常展示 Services 列表和单个 Service 的 Endpoints。
- [ ] `config.example.json` 和 `docs/configuration.md` 更新完成。

---

## 6. 综合任务清单与优先级

| 任务 | 文件/模块 | 优先级 | 依赖 |
| :--- | :--- | :--- | :--- |
| 重构 Types | `packages/types/src/types.ts` | P0 | 无 |
| 编写 V2->V3 迁移脚本 | `config-migrations/versions/v2-to-v3.ts` | P0 | 完成 Types |
| 重构运行时 | `runtime-state.ts`, `handler.ts`, `selector.ts` | P0 | 完成 Types |
| 改造 Admin API | `api/handlers/routes.ts`, `upstreams.ts` | P1 | 完成运行时 |
| 改造 Dashboard | `packages/ui/...` | P1 | 完成 API |
| 配置文档 | `docs/configuration.md`, `config.example.json` | P1 | 完成 API |

---

## 7. 风险评估与缓解策略

| 风险 | 影响 | 缓解措施 |
| :--- | :--- | :--- |
| **迁移脚本复杂度** | 中 | 编写详尽的单元测试，覆盖各种 V2 边界情况。 |
| **运行时状态丢失** | 高 | V3 重构时确保状态 Map 的 Key 平滑过渡，或设计状态预热机制。 |
| **Dashboard 同步滞后** | 低 | 先完成核心 API，Dashboard UI 可以并行开发。 |
| **旧版本向后兼容** | 中 | 依赖自动化的迁移脚本。在文档中明确说明迁移是不可逆的。 |

## 8. 总结

此执行计划是 Bungee 项目向更模块化、标准化和可维护性迈进的关键一步。通过分阶段的精细规划和严格的代码审查，我们将在一个敏捷的周期内（约 8-12 天）完成从 V2 到 V3 的平稳过渡。