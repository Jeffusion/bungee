export type PluginRuntimeConvergenceWorkerStatus =
  | 'starting'
  | 'ready'
  | 'reconciling'
  | 'converged'
  | 'failed'
  | 'stale'
  | 'stopped';

export type PluginRuntimeConvergenceSummaryStatus = 'idle' | 'pending' | 'converged' | 'failed';

export interface PluginRuntimeWorkerConvergenceState {
  workerId: number;
  pid: number | null;
  status: PluginRuntimeConvergenceWorkerStatus;
  servingGeneration: number | null;
  lastRequestedGeneration: number | null;
  lastAppliedGeneration: number | null;
  failureGeneration: number | null;
  error: string | null;
  updatedAt: string | null;
}

export interface PluginRuntimeConvergenceStatusReport {
  targetGeneration: number | null;
  convergedGeneration: number | null;
  startedAt: string | null;
  deadlineAt: string | null;
  status: PluginRuntimeConvergenceSummaryStatus;
  failedWorkers: number[];
  staleWorkers: number[];
  pendingWorkers: number[];
  convergedWorkers: number[];
  workers: PluginRuntimeWorkerConvergenceState[];
}

export interface PluginRuntimeConvergenceWorkerProcess {
  workerId: number;
  status: 'starting' | 'ready' | 'shutting_down' | 'stopped';
  send: ((message: PluginRuntimeWorkerReconcileCommand) => void) | undefined;
}

interface MutableWorkerState {
  workerId: number;
  pid: number | null;
  baseStatus: Exclude<PluginRuntimeConvergenceWorkerStatus, 'converged' | 'stale'>;
  servingGeneration: number | null;
  lastRequestedGeneration: number | null;
  lastAppliedGeneration: number | null;
  failureGeneration: number | null;
  error: string | null;
  updatedAt: number | null;
}

export class PluginRuntimeMultiWorkerConvergenceTracker {
  private readonly workers = new Map<number, MutableWorkerState>();
  private targetGeneration: number | null = null;
  private startedAt: number | null = null;
  private deadlineAt: number | null = null;

  constructor(private readonly convergenceDeadlineMs: number = 5000) {}

  upsertWorker(workerId: number, pid: number | null = null): void {
    const existing = this.workers.get(workerId);
    if (existing) {
      existing.pid = pid;
      if (existing.baseStatus === 'stopped') {
        existing.baseStatus = 'starting';
      }
      existing.updatedAt = Date.now();
      return;
    }

    this.workers.set(workerId, {
      workerId,
      pid,
      baseStatus: 'starting',
      servingGeneration: null,
      lastRequestedGeneration: null,
      lastAppliedGeneration: null,
      failureGeneration: null,
      error: null,
      updatedAt: Date.now(),
    });
  }

  recordWorkerReady(workerId: number, generation: number | null, pid: number | null = null): void {
    const worker = this.getOrCreateWorker(workerId, pid);
    worker.pid = pid ?? worker.pid;
    worker.baseStatus = 'ready';
    worker.servingGeneration = generation;
    worker.lastAppliedGeneration = generation;
    worker.error = null;
    worker.updatedAt = Date.now();
  }

  beginGeneration(targetGeneration: number, workerIds?: number[]): void {
    this.targetGeneration = targetGeneration;
    this.startedAt = Date.now();
    this.deadlineAt = this.startedAt + Math.max(0, this.convergenceDeadlineMs);

    for (const workerId of workerIds ?? Array.from(this.workers.keys())) {
      const worker = this.getOrCreateWorker(workerId);
      worker.lastRequestedGeneration = targetGeneration;
      worker.failureGeneration = worker.failureGeneration === targetGeneration ? null : worker.failureGeneration;
      worker.error = worker.failureGeneration === targetGeneration ? null : worker.error;
      if (worker.baseStatus !== 'stopped') {
        worker.baseStatus = 'reconciling';
      }
      worker.updatedAt = Date.now();
    }
  }

  recordWorkerSuccess(workerId: number, generation: number, servingGeneration: number | null = generation, pid: number | null = null): void {
    const worker = this.getOrCreateWorker(workerId, pid);
    worker.pid = pid ?? worker.pid;
    worker.baseStatus = 'ready';
    worker.lastAppliedGeneration = generation;
    worker.servingGeneration = servingGeneration;
    worker.failureGeneration = null;
    worker.error = null;
    worker.updatedAt = Date.now();
  }

  recordWorkerFailure(workerId: number, generation: number, error: string, servingGeneration: number | null, pid: number | null = null): void {
    const worker = this.getOrCreateWorker(workerId, pid);
    worker.pid = pid ?? worker.pid;
    worker.baseStatus = 'failed';
    worker.lastAppliedGeneration = generation;
    worker.failureGeneration = generation;
    worker.servingGeneration = servingGeneration;
    worker.error = error;
    worker.updatedAt = Date.now();
  }

  recordWorkerStopped(workerId: number): void {
    const worker = this.getOrCreateWorker(workerId);
    worker.baseStatus = 'stopped';
    worker.updatedAt = Date.now();
  }

  getStatusReport(now: number = Date.now()): PluginRuntimeConvergenceStatusReport {
    const targetGeneration = this.targetGeneration;
    const deadlineExceeded = this.deadlineAt !== null && now > this.deadlineAt;
    const workers = Array.from(this.workers.values())
      .sort((left, right) => left.workerId - right.workerId)
      .map((worker) => {
        const status = deriveWorkerStatus(worker, targetGeneration);
        return {
          workerId: worker.workerId,
          pid: worker.pid,
          status,
          servingGeneration: worker.servingGeneration,
          lastRequestedGeneration: worker.lastRequestedGeneration,
          lastAppliedGeneration: worker.lastAppliedGeneration,
          failureGeneration: worker.failureGeneration,
          error: worker.error,
          updatedAt: worker.updatedAt ? new Date(worker.updatedAt).toISOString() : null,
        } satisfies PluginRuntimeWorkerConvergenceState;
      });

    const failedWorkers = workers
      .filter((worker) => worker.status === 'failed')
      .map((worker) => worker.workerId);
    const staleWorkers = workers
      .filter((worker) => worker.status === 'stale' || (worker.status === 'failed' && targetGeneration !== null && worker.servingGeneration !== null && worker.servingGeneration < targetGeneration))
      .map((worker) => worker.workerId);
    const pendingWorkers = workers
      .filter((worker) => worker.status === 'reconciling' || worker.status === 'starting' || worker.status === 'ready')
      .map((worker) => worker.workerId);
    const convergedWorkers = workers
      .filter((worker) => worker.status === 'converged')
      .map((worker) => worker.workerId);

    let status: PluginRuntimeConvergenceSummaryStatus = 'idle';
    let convergedGeneration: number | null = null;

    if (targetGeneration !== null) {
      if (failedWorkers.length > 0 || (deadlineExceeded && (staleWorkers.length > 0 || pendingWorkers.length > 0))) {
        status = 'failed';
      } else if (workers.length > 0 && convergedWorkers.length === workers.length) {
        status = 'converged';
        convergedGeneration = targetGeneration;
      } else {
        status = 'pending';
      }
    }

    return {
      targetGeneration,
      convergedGeneration,
      startedAt: this.startedAt ? new Date(this.startedAt).toISOString() : null,
      deadlineAt: this.deadlineAt ? new Date(this.deadlineAt).toISOString() : null,
      status,
      failedWorkers,
      staleWorkers,
      pendingWorkers,
      convergedWorkers,
      workers,
    };
  }

  private getOrCreateWorker(workerId: number, pid: number | null = null): MutableWorkerState {
    const existing = this.workers.get(workerId);
    if (existing) {
      if (pid !== null) {
        existing.pid = pid;
      }
      return existing;
    }

    const worker: MutableWorkerState = {
      workerId,
      pid,
      baseStatus: 'starting',
      servingGeneration: null,
      lastRequestedGeneration: null,
      lastAppliedGeneration: null,
      failureGeneration: null,
      error: null,
      updatedAt: null,
    };
    this.workers.set(workerId, worker);
    return worker;
  }
}

export class PluginRuntimeMultiWorkerCoordinator {
  private requestedGeneration = 0;

  constructor(
    private readonly tracker = new PluginRuntimeMultiWorkerConvergenceTracker(),
    private readonly pollIntervalMs: number = 50,
  ) {}

  noteWorkerReady(workerId: number, generation: number | null, pid: number | null = null): void {
    this.requestedGeneration = Math.max(this.requestedGeneration, generation ?? 0);
    this.tracker.recordWorkerReady(workerId, generation, pid);
  }

  noteWorkerStarting(workerId: number, pid: number | null = null): void {
    this.tracker.upsertWorker(workerId, pid);
  }

  noteWorkerStopped(workerId: number): void {
    this.tracker.recordWorkerStopped(workerId);
  }

  noteWorkerReconcileSuccess(workerId: number, generation: number, servingGeneration: number | null = generation, pid: number | null = null): void {
    this.requestedGeneration = Math.max(this.requestedGeneration, generation);
    this.tracker.recordWorkerSuccess(workerId, generation, servingGeneration, pid);
  }

  noteWorkerReconcileFailure(workerId: number, generation: number, error: string, servingGeneration: number | null, pid: number | null = null): void {
    this.requestedGeneration = Math.max(this.requestedGeneration, generation);
    this.tracker.recordWorkerFailure(workerId, generation, error, servingGeneration, pid);
  }

  getStatusReport(now: number = Date.now()): PluginRuntimeConvergenceStatusReport {
    return this.tracker.getStatusReport(now);
  }

  async dispatchReconcile(workers: PluginRuntimeConvergenceWorkerProcess[]): Promise<PluginRuntimeConvergenceStatusReport> {
    const activeWorkers = workers.filter((worker) => worker.status === 'ready');
    const targetGeneration = this.requestedGeneration + 1;
    this.requestedGeneration = targetGeneration;

    this.tracker.beginGeneration(
      targetGeneration,
      activeWorkers.map((worker) => worker.workerId),
    );

    const command: PluginRuntimeWorkerReconcileCommand = {
      command: 'reconcile-plugin-runtime',
      generation: targetGeneration,
    };

    for (const worker of activeWorkers) {
      worker.send?.(command);
    }

    if (activeWorkers.length === 0) {
      return this.tracker.getStatusReport();
    }

    return await new Promise((resolve) => {
      const poller = setInterval(() => {
        const report = this.tracker.getStatusReport();
        if (report.status === 'converged' || report.status === 'failed') {
          clearInterval(poller);
          resolve(report);
        }
      }, this.pollIntervalMs);
    });
  }
}

function deriveWorkerStatus(
  worker: MutableWorkerState,
  targetGeneration: number | null,
): PluginRuntimeConvergenceWorkerStatus {
  if (worker.baseStatus === 'stopped' || worker.baseStatus === 'failed') {
    return worker.baseStatus;
  }

  if (targetGeneration === null) {
    return worker.baseStatus;
  }

  if (worker.servingGeneration === targetGeneration) {
    return 'converged';
  }

  if (worker.servingGeneration !== null && worker.servingGeneration < targetGeneration) {
    return 'stale';
  }

  return worker.baseStatus;
}

export interface PluginRuntimeWorkerReadyMessage {
  status: 'ready';
  pid: number;
  pluginRuntime: {
    generation: number | null;
  };
}

export interface PluginRuntimeWorkerErrorMessage {
  status: 'error';
  error: string;
}

export interface PluginRuntimeWorkerReconcileCommand {
  command: 'reconcile-plugin-runtime';
  generation: number;
}

export interface PluginRuntimeWorkerReconcileSuccessMessage {
  status: 'plugin-runtime-reconcile-complete';
  pid: number;
  generation: number;
  servingGeneration: number | null;
}

export interface PluginRuntimeWorkerReconcileFailureMessage {
  status: 'plugin-runtime-reconcile-failed';
  pid: number;
  generation: number;
  servingGeneration: number | null;
  error: string;
}

export interface PluginRuntimeClusterReconcileRequestMessage {
  command: 'cluster-reconcile-plugin-runtime';
  requestId: string;
}

export interface PluginRuntimeClusterReconcileResultMessage {
  status: 'cluster-plugin-runtime-reconcile-result';
  requestId: string;
  convergence: PluginRuntimeConvergenceStatusReport | null;
  error?: string;
}

export type PluginRuntimeWorkerMessage =
  | PluginRuntimeWorkerReadyMessage
  | PluginRuntimeWorkerErrorMessage
  | PluginRuntimeWorkerReconcileSuccessMessage
  | PluginRuntimeWorkerReconcileFailureMessage
  | PluginRuntimeClusterReconcileRequestMessage
  | PluginRuntimeClusterReconcileResultMessage;
