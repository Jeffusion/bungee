/**
 * 生成 token-stats 插件的测试数据
 * 运行: bun scripts/seed-token-stats.ts
 */
import { Database } from 'bun:sqlite';
import { resolve } from 'path';

const DB_PATH = resolve(import.meta.dir, '../logs/access.db');
const PLUGIN_NAME = 'token-stats';

// 测试路由
const ROUTES = [
  'openai-chat',
  'claude-api',
  'gemini-pro',
  'deepseek-coder',
  'qwen-turbo',
];

// 测试 upstream
const UPSTREAMS = [
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'api.deepseek.com',
  'dashscope.aliyuncs.com',
];

function getDateKey(daysAgo: number = 0): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().split('T')[0];
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function seedData() {
  console.log(`Opening database: ${DB_PATH}`);
  const db = new Database(DB_PATH);

  // 确保表存在
  db.run(`
    CREATE TABLE IF NOT EXISTS plugin_storage (
      plugin_name TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      ttl INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (plugin_name, key)
    )
  `);

  const now = Math.floor(Date.now() / 1000) * 1000;
  const currentHour = new Date().getHours();
  const today = getDateKey(0);

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO plugin_storage (plugin_name, key, value, ttl, updated_at)
    VALUES (?, ?, ?, NULL, ?)
  `);

  let count = 0;

  // 生成过去 24 小时的数据
  for (let hoursAgo = 0; hoursAgo < 24; hoursAgo++) {
    const date = new Date();
    date.setHours(date.getHours() - hoursAgo);
    const dateKey = date.toISOString().split('T')[0];
    const hour = date.getHours().toString().padStart(2, '0');

    // 为每个路由生成数据
    for (let i = 0; i < ROUTES.length; i++) {
      const routeId = ROUTES[i];
      const upstreamId = UPSTREAMS[i];

      // 模拟不同路由的使用量差异
      const baseInput = randomBetween(500, 5000) * (i + 1);
      const baseOutput = randomBetween(200, 2000) * (i + 1);
      const requests = randomBetween(5, 50) * (i + 1);

      const inputTokens = baseInput + randomBetween(-500, 500);
      const outputTokens = baseOutput + randomBetween(-200, 200);

      const value = JSON.stringify({
        input_tokens: Math.max(0, inputTokens),
        output_tokens: Math.max(0, outputTokens),
        requests: requests,
      });

      // 按路由存储（使用 # 分隔符）
      const routeKey = `tokens#${routeId}#${dateKey}#${hour}`;
      stmt.run(PLUGIN_NAME, routeKey, value, now);
      count++;

      // 按 upstream 存储（使用 # 分隔符）
      const upstreamKey = `tokens#upstream#${upstreamId}#${dateKey}#${hour}`;
      stmt.run(PLUGIN_NAME, upstreamKey, value, now);
      count++;

      // 细粒度数据（使用 # 分隔符）
      const detailKey = `tokens#detail#${routeId}#${upstreamId}#${dateKey}#${hour}`;
      stmt.run(PLUGIN_NAME, detailKey, value, now);
      count++;
    }
  }

  db.close();
  console.log(`✅ 已生成 ${count} 条测试数据`);
  console.log(`   - 路由: ${ROUTES.join(', ')}`);
  console.log(`   - Upstream: ${UPSTREAMS.join(', ')}`);
  console.log(`   - 时间范围: 过去 24 小时`);
}

seedData().catch(console.error);
