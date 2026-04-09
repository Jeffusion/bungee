import { describe, expect, test } from 'bun:test';
import {
  PluginRuntimeMultiWorkerConvergenceTracker,
  PluginRuntimeMultiWorkerCoordinator,
} from '../../src/plugin-runtime-multi-worker-convergence';

describe('plugin multi-worker convergence', () => {
  test('all workers converge to the same generation after reconcile', () => {
    const tracker = new PluginRuntimeMultiWorkerConvergenceTracker(100);

    tracker.upsertWorker(1, 101);
    tracker.upsertWorker(2, 102);
    tracker.recordWorkerReady(1, 1, 101);
    tracker.recordWorkerReady(2, 1, 102);

    tracker.beginGeneration(2, [1, 2]);
    const duringReconcile = tracker.getStatusReport();
    expect(duringReconcile.status).toBe('pending');
    expect(duringReconcile.targetGeneration).toBe(2);
    expect(duringReconcile.staleWorkers).toEqual([1, 2]);

    tracker.recordWorkerSuccess(1, 2, 2, 101);
    tracker.recordWorkerSuccess(2, 2, 2, 102);

    const report = tracker.getStatusReport();
    expect(report.status).toBe('converged');
    expect(report.targetGeneration).toBe(2);
    expect(report.convergedGeneration).toBe(2);
    expect(report.failedWorkers).toEqual([]);
    expect(report.staleWorkers).toEqual([]);
    expect(report.pendingWorkers).toEqual([]);
    expect(report.convergedWorkers).toEqual([1, 2]);
    expect(report.workers).toEqual([
      expect.objectContaining({
        workerId: 1,
        pid: 101,
        status: 'converged',
        servingGeneration: 2,
        lastRequestedGeneration: 2,
        lastAppliedGeneration: 2,
        failureGeneration: null,
        error: null,
      }),
      expect.objectContaining({
        workerId: 2,
        pid: 102,
        status: 'converged',
        servingGeneration: 2,
        lastRequestedGeneration: 2,
        lastAppliedGeneration: 2,
        failureGeneration: null,
        error: null,
      }),
    ]);
  });

  test('worker reconcile failure remains visible instead of being overwritten by partial success', () => {
    const tracker = new PluginRuntimeMultiWorkerConvergenceTracker(100);

    tracker.recordWorkerReady(1, 1, 101);
    tracker.recordWorkerReady(2, 1, 102);
    tracker.beginGeneration(2, [1, 2]);

    tracker.recordWorkerSuccess(1, 2, 2, 101);
    tracker.recordWorkerFailure(2, 2, 'replacement artifact missing version', 1, 102);

    const report = tracker.getStatusReport();
    expect(report.status).toBe('failed');
    expect(report.targetGeneration).toBe(2);
    expect(report.convergedGeneration).toBeNull();
    expect(report.failedWorkers).toEqual([2]);
    expect(report.staleWorkers).toEqual([2]);
    expect(report.pendingWorkers).toEqual([]);
    expect(report.convergedWorkers).toEqual([1]);

    const failedWorker = report.workers.find((worker) => worker.workerId === 2);
    expect(failedWorker).toEqual(expect.objectContaining({
      workerId: 2,
      pid: 102,
      status: 'failed',
      servingGeneration: 1,
      lastRequestedGeneration: 2,
      lastAppliedGeneration: 2,
      failureGeneration: 2,
      error: 'replacement artifact missing version',
    }));
  });

  test('stale workers are reported explicitly and deadline expiry turns convergence into failure', () => {
    const tracker = new PluginRuntimeMultiWorkerConvergenceTracker(10);

    tracker.recordWorkerReady(1, 1, 101);
    tracker.recordWorkerReady(2, 1, 102);
    tracker.beginGeneration(2, [1, 2]);
    tracker.recordWorkerSuccess(1, 2, 2, 101);

    const pendingReport = tracker.getStatusReport();
    expect(pendingReport.status).toBe('pending');
    expect(pendingReport.failedWorkers).toEqual([]);
    expect(pendingReport.staleWorkers).toEqual([2]);
    expect(pendingReport.workers.find((worker) => worker.workerId === 2)?.status).toBe('stale');

    const expiredReport = tracker.getStatusReport(Date.now() + 20);
    expect(expiredReport.status).toBe('failed');
    expect(expiredReport.failedWorkers).toEqual([]);
    expect(expiredReport.staleWorkers).toEqual([2]);
    expect(expiredReport.pendingWorkers).toEqual([]);
    expect(expiredReport.convergedWorkers).toEqual([1]);
  });

  test('wired coordinator dispatches reconcile commands and aggregates worker success', async () => {
    const coordinator = new PluginRuntimeMultiWorkerCoordinator(
      new PluginRuntimeMultiWorkerConvergenceTracker(100),
      5,
    );
    const sentCommands: Array<{ workerId: number; generation: number }> = [];

    coordinator.noteWorkerReady(1, 1, 101);
    coordinator.noteWorkerReady(2, 1, 102);

    const reconcilePromise = coordinator.dispatchReconcile([
      {
        workerId: 1,
        status: 'ready',
        send: (message) => {
          sentCommands.push({ workerId: 1, generation: message.generation });
          queueMicrotask(() => {
            coordinator.noteWorkerReconcileSuccess(1, message.generation, message.generation, 101);
          });
        },
      },
      {
        workerId: 2,
        status: 'ready',
        send: (message) => {
          sentCommands.push({ workerId: 2, generation: message.generation });
          queueMicrotask(() => {
            coordinator.noteWorkerReconcileSuccess(2, message.generation, message.generation, 102);
          });
        },
      },
    ]);

    const report = await reconcilePromise;
    expect(sentCommands).toEqual([
      { workerId: 1, generation: 2 },
      { workerId: 2, generation: 2 },
    ]);
    expect(report.status).toBe('converged');
    expect(report.targetGeneration).toBe(2);
    expect(report.convergedGeneration).toBe(2);
    expect(report.failedWorkers).toEqual([]);
    expect(report.staleWorkers).toEqual([]);
    expect(report.convergedWorkers).toEqual([1, 2]);
  });

  test('wired coordinator keeps worker failure visible in aggregated convergence result', async () => {
    const coordinator = new PluginRuntimeMultiWorkerCoordinator(
      new PluginRuntimeMultiWorkerConvergenceTracker(100),
      5,
    );
    const sentCommands: Array<{ workerId: number; generation: number }> = [];

    coordinator.noteWorkerReady(1, 1, 101);
    coordinator.noteWorkerReady(2, 1, 102);

    const reconcilePromise = coordinator.dispatchReconcile([
      {
        workerId: 1,
        status: 'ready',
        send: (message) => {
          sentCommands.push({ workerId: 1, generation: message.generation });
          queueMicrotask(() => {
            coordinator.noteWorkerReconcileSuccess(1, message.generation, message.generation, 101);
          });
        },
      },
      {
        workerId: 2,
        status: 'ready',
        send: (message) => {
          sentCommands.push({ workerId: 2, generation: message.generation });
          queueMicrotask(() => {
            coordinator.noteWorkerReconcileFailure(2, message.generation, 'runtime reconcile failed', 1, 102);
          });
        },
      },
    ]);

    const report = await reconcilePromise;
    expect(sentCommands).toEqual([
      { workerId: 1, generation: 2 },
      { workerId: 2, generation: 2 },
    ]);
    expect(report.status).toBe('failed');
    expect(report.targetGeneration).toBe(2);
    expect(report.convergedGeneration).toBeNull();
    expect(report.failedWorkers).toEqual([2]);
    expect(report.staleWorkers).toEqual([2]);
    expect(report.convergedWorkers).toEqual([1]);
    expect(report.workers.find((worker) => worker.workerId === 2)).toEqual(
      expect.objectContaining({
        workerId: 2,
        status: 'failed',
        servingGeneration: 1,
        lastRequestedGeneration: 2,
        failureGeneration: 2,
        error: 'runtime reconcile failed',
      }),
    );
  });
});
