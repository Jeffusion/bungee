# Bungee UpstreamPool 功能设计文档

## 1. 引言 (Introduction)

目前 Bungee 的上游服务器（Upstream）定义是完全内联在每个路由配置中的（`RouteConfig.upstreams`）。这种设计在简单的场景下非常直观，但在复杂的生产环境中存在以下问题：

- **配置冗余**：当多个路由需要转发到同一组后端服务器时，必须在每个路由中重复定义相同的上游列表。
- **状态隔离**：由于运行时状态（如健康检查结果、失败计数等）是按路由路径隔离的，即使多个路由指向相同的物理后端，它们也无法共享健康状态。这会导致重复的健康检查探测，且一个路由发现后端故障后，其他路由仍会尝试请求该故障后端。
- **维护困难**：更新后端服务器列表时，需要修改所有相关的路由配置，容易出错。

为了解决这些问题，我们提议引入 **UpstreamPool**（上游池）功能，允许用户定义可复用的上游服务器组，并支持跨路由共享运行时状态。

## 2. 现状分析 (Current State Analysis)

### 2.1 数据模型
目前 `RouteConfig` 直接包含 `upstreams: Upstream[]`。

### 2.2 运行时状态管理
运行时状态存储在 `packages/core/src/worker/state/runtime-state.ts` 中的 `runtimeState` 变量中：
```typescript
export const runtimeState = new Map<string, { upstreams: RuntimeUpstream[] }>();
```
- **Key**: 路由路径 (`route.path`)。
- **Value**: 该路由专属的 `RuntimeUpstream` 数组。

### 2.3 初始化逻辑
在 `initializeRuntimeState` 函数中，系统遍历所有路由，为每个启用了 failover 的路由创建独立的 `RuntimeUpstream` 实例。

## 3. 设计目标 (Design Goals)

- **可复用性**：支持在全局配置中定义上游池，并在多个路由中引用。
- **状态共享**：引用同一个池的多个路由必须共享该池内上游服务器的健康状态。
- **向后兼容**：保留现有的内联定义方式，确保旧配置无需修改即可运行。
- **灵活性**：支持内联定义与池引用并存（但在单个路由中互斥）。
- **简单性**：保持配置结构清晰，易于理解和维护。

## 4. 详细设计 (Proposed Design)

### 4.1 数据模型变更

#### 4.1.1 `UpstreamPool` 接口
在 `packages/types/src/types.ts` 中新增：
```typescript
export interface UpstreamPool {
  id: string;      // 唯一标识符，用于路由引用
  name: string;    // 易读名称
  upstreams: Upstream[];
  failover?: FailoverConfig; // 池级别的故障转移配置
}
```

#### 4.1.2 `AppConfig` 变更
```typescript
export interface AppConfig {
  // ...
  pools?: UpstreamPool[]; // 新增：全局上游池定义
  routes: RouteConfig[];
}
```

#### 4.1.3 `RouteConfig` 变更
```typescript
export interface RouteConfig extends ModificationRules {
  // ...
  upstreams?: Upstream[];      // 可选：内联定义
  upstreamPool?: string;       // 可选：引用池 ID
  // 验证逻辑：upstreams 与 upstreamPool 互斥
}
```

### 4.2 运行时行为

#### 4.2.1 状态键名空间化 (Namespacing)
为了支持共享状态，`runtimeState` 的 Key 将采用命名空间格式：
- **池状态**：`pool:${poolId}`
- **路由内联状态**：`route:${routePath}`

#### 4.2.2 状态解析逻辑
当请求进入路由时：
1. 如果路由配置了 `upstreamPool`，则从 `runtimeState` 中获取 `pool:${upstreamPool}` 的状态。
2. 如果路由配置了内联 `upstreams`，则获取 `route:${routePath}` 的状态。

#### 4.2.3 初始化流程更新
`initializeRuntimeState` 将分为两个阶段：
1. **初始化池**：遍历 `config.pools`，为每个池创建 `RuntimeUpstream` 并存入 `runtimeState`（Key 为 `pool:${id}`）。
2. **初始化路由**：
   - 如果是内联 `upstreams`，按原逻辑创建状态（Key 为 `route:${path}`）。
   - 如果是引用 `upstreamPool`，验证池是否存在，并确保该路由能正确关联到已初始化的池状态。

### 4.3 配置示例

#### 场景 A：仅内联定义（保持现状）
```json
{
  "routes": [
    {
      "path": "/api/v1",
      "upstreams": [{ "target": "http://backend-1:3000" }]
    }
  ]
}
```

#### 场景 B：仅使用上游池
```json
{
  "pools": [
    {
      "id": "main-cluster",
      "upstreams": [
        { "target": "http://node-1:3000" },
        { "target": "http://node-2:3000" }
      ]
    }
  ],
  "routes": [
    {
      "path": "/service-a",
      "upstreamPool": "main-cluster"
    },
    {
      "path": "/service-b",
      "upstreamPool": "main-cluster"
    }
  ]
}
```

#### 场景 C：混合模式
```json
{
  "pools": [{ "id": "shared", "upstreams": [...] }],
  "routes": [
    { "path": "/common", "upstreamPool": "shared" },
    { "path": "/special", "upstreams": [{ "target": "http://isolated:3000" }] }
  ]
}
```

## 5. API 变更 (API Changes)

### 5.1 新增 API 端点
- `GET /api/pools`：获取所有上游池列表。
- `POST /api/pools`：创建新的上游池。
- `GET /api/pools/:id`：获取特定池的详细信息及实时健康状态。
- `PUT /api/pools/:id`：更新池配置。
- `DELETE /api/pools/:id`：删除池（需检查是否有路由正在引用）。

### 5.2 现有 API 更新
- `GET /api/routes`：返回结果中应包含 `upstreamPool` 字段，并能通过该字段关联到池状态。
- `GET /api/upstreams`：支持通过查询参数过滤特定池的上游服务器。

## 6. 实施路线图 (Implementation Roadmap)

### 第一阶段：类型与配置解析
1. 修改 `packages/types/src/types.ts`，添加 `UpstreamPool` 相关接口。
2. 修改 `packages/core/src/config.ts`，在加载配置时进行校验：
   - 确保 `upstreamPool` 引用的 ID 存在。
   - 确保 `upstreams` 和 `upstreamPool` 不同时存在。

### 第二阶段：运行时状态重构
1. 修改 `packages/core/src/worker/state/runtime-state.ts`：
   - 更新 `runtimeState` 的 Key 生成逻辑。
   - 重构 `initializeRuntimeState` 以支持池的初始化。
2. 修改 `packages/core/src/worker/request/handler.ts`：
   - 在路由匹配后，根据配置决定使用哪个状态 Key。

### 第三阶段：健康检查与故障转移适配
1. 修改 `packages/core/src/worker/health/scheduler.ts`：
   - 支持按池启动健康检查调度器。
2. 确保 `FailoverCoordinator` 能够正确处理来自池的 `RuntimeUpstream`。

### 第四阶段：API 与 UI
1. 在 `packages/core/src/api/handlers/` 下新增 `pools.ts`。
2. 在 `packages/ui` 中添加上游池的管理界面。

## 7. 向后兼容性 (Backward Compatibility)

- **配置兼容**：现有的 `config.json` 无需任何修改即可继续运行。内联定义的路由将自动映射到 `route:${path}` 命名空间。
- **API 兼容**：现有的路由 API 将继续返回内联上游信息（如果存在）。对于引用池的路由，API 将返回池的 ID。

## 8. 方案对比 (Comparison with Alternatives)

| 特性 | 内联定义 (当前) | 纯池化定义 (Nginx 风格) | 混合模式 (提议) |
| :--- | :--- | :--- | :--- |
| **灵活性** | 高（每个路由独立） | 低（必须先定义池） | **最高** |
| **配置简洁度** | 低（重复配置多） | 高 | **高** |
| **状态共享** | 不支持 | 支持 | **支持** |
| **迁移成本** | 0 | 高 | **极低** |

## 9. 风险与规避 (Risks and Mitigation)

- **风险：池被删除但仍有路由引用**
  - **规避**：在 API 层增加校验，禁止删除仍被引用的池；在启动时进行强校验。
- **风险：配置冲突**
  - **规避**：如果一个路由同时定义了 `upstreams` 和 `upstreamPool`，系统应报错并拒绝启动。
- **风险：性能开销**
  - **规避**：状态查找基于 Map，开销极小。共享状态反而能减少健康检查的 CPU 和网络占用。

