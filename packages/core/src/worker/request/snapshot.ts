/**
 * Request snapshot module for failover isolation
 * Captures request state before plugin execution to enable clean retries
 */

import { logger } from '../../logger';
import type { RequestSnapshot } from '../types';

/**
 * Maximum allowed request body size for snapshot creation
 * Prevents memory exhaustion from large uploads
 */
const MAX_SNAPSHOT_BODY_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Creates a snapshot of the request for failover isolation
 *
 * This function captures the complete request state before any plugin modifications.
 * Each upstream retry will receive a clean copy reconstructed from this snapshot,
 * ensuring that plugin modifications don't affect subsequent retries.
 *
 * **Key features:**
 * - JSON body: Parsed but NOT immediately cloned (lazy clone optimization)
 * - Binary body: Stored as ArrayBuffer (can be reused multiple times)
 * - Headers: Captured as plain object
 * - Size limit: Rejects bodies larger than 10MB to prevent OOM
 *
 * @param req - Incoming HTTP request
 * @returns Promise resolving to request snapshot
 * @throws {Error} If request body exceeds size limit
 * @throws {Error} If JSON body parsing fails
 *
 * @example
 * ```typescript
 * const snapshot = await createRequestSnapshot(req);
 *
 * // First attempt - uses original parsed body (no clone)
 * const response = await proxyRequest(snapshot, ...);
 *
 * // Failover retry - ensure body is cloned before retry
 * if (needsRetry) {
 *   ensureSnapshotBodyCloned(snapshot);
 *   const retryResponse = await proxyRequest(snapshot, ...);
 * }
 * ```
 */
export async function createRequestSnapshot(req: Request): Promise<RequestSnapshot> {
  // Check content length to prevent memory overflow
  const contentLength = req.headers.get('content-length');
  if (contentLength && parseInt(contentLength) > MAX_SNAPSHOT_BODY_SIZE) {
    const sizeMB = parseInt(contentLength) / 1024 / 1024;
    const maxMB = MAX_SNAPSHOT_BODY_SIZE / 1024 / 1024;
    throw new Error(
      `Request body too large for failover (max: ${maxMB}MB, got: ${sizeMB.toFixed(2)}MB)`
    );
  }

  // Capture headers
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const contentType = req.headers.get('content-type') || '';
  const isJsonBody = contentType.includes('application/json');

  let body: any = null;

  if (req.body) {
    if (isJsonBody) {
      // JSON body - parse but DO NOT clone immediately (lazy clone optimization)
      // Clone will be done on-demand when failover retry is needed
      try {
        body = await req.clone().json();
        // 不再立即 structuredClone，延迟到 ensureSnapshotBodyCloned() 调用时
      } catch (err) {
        logger.error({ error: err }, 'Failed to parse JSON body for snapshot');
        throw new Error('Invalid JSON body: ' + (err as Error).message);
      }
    } else {
      // Non-JSON body - read as ArrayBuffer (can be reused multiple times)
      // ArrayBuffer is a byte array, not a stream, so it's safe to reuse
      body = await req.clone().arrayBuffer();
    }
  }

  return {
    method: req.method,
    url: req.url,
    headers,  // Already a new object from forEach, no need to clone
    body,
    contentType,
    isJsonBody,
    isBodyCloned: false  // 标记为未克隆
  };
}

/**
 * Ensures the snapshot's JSON body is deep cloned (for failover retries)
 *
 * This function implements the lazy clone strategy:
 * - First call: Executes structuredClone and marks as cloned
 * - Subsequent calls: No-op, returns immediately
 *
 * **When to call:**
 * - Before the second and subsequent upstream retry attempts
 * - NOT needed for the first attempt (uses original parsed body)
 *
 * **Why lazy clone:**
 * - ~95% of requests succeed on first attempt (no failover needed)
 * - structuredClone is expensive (1-10ms for typical JSON bodies)
 * - Lazy clone avoids this overhead for the majority of requests
 *
 * @param snapshot - Request snapshot to ensure body is cloned
 * @returns The same snapshot (mutated in-place)
 *
 * @example
 * ```typescript
 * // In failover loop
 * if (attemptNumber > 1) {
 *   ensureSnapshotBodyCloned(snapshot);
 * }
 * ```
 */
export function ensureSnapshotBodyCloned(snapshot: RequestSnapshot): RequestSnapshot {
  // Skip if already cloned, not JSON, or no body
  if (snapshot.isBodyCloned || !snapshot.isJsonBody || snapshot.body === null) {
    return snapshot;
  }

  // Execute deep clone
  snapshot.body = structuredClone(snapshot.body);
  snapshot.isBodyCloned = true;

  logger.debug(
    { bodySize: JSON.stringify(snapshot.body).length },
    'Snapshot body cloned for failover retry (lazy clone)'
  );

  return snapshot;
}
