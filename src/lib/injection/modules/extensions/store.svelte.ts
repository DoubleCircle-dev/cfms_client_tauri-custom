import { listen } from '@tauri-apps/api/event';
import {
  getExtensionOverview,
  installExtensionFromCatalog,
  recordExtensionScheduleRun,
  refreshExtensionCatalog,
  setExtensionEnabled,
  updateExtensionSchedule,
  type ExtensionCapability,
  type ExtensionInstallation,
  type ExtensionCatalog,
  type ExtensionOverview,
  type ExtensionScheduleTask,
} from '$lib/injection/modules/extensions/api';
import { runExtensionWorkflow } from '$lib/injection/modules/extensions/workflows';
import { getScheduleDueAt, isScheduleOccurrenceMissed } from '$lib/injection/modules/extensions/schedule-timing';
import { canAutoUpdateExtension } from '$lib/injection/modules/extensions/trust';
import { notificationStore } from '$lib/stores.svelte';

class ExtensionsStore {
  overview = $state<ExtensionOverview | null>(null);
  loading = $state(false);
  error = $state<string | null>(null);
  private accountScope: string | null = null;
  private timers = new Map<string, number>();
  private scheduleTickTimer: number | null = null;
  private scheduleTickRunning = false;
  private runningSchedules = new Set<string>();
  private scheduleControllers = new Map<string, AbortController>();
  private pendingSchedules = new Set<string>();
  private scheduleLastRuns = new Map<string, number>();
  private scheduleFailures = new Map<string, number>();
  private running = new Set<string>();
  private controllers = new Map<string, AbortController>();
  private failures = new Map<string, number>();
  private eventListenerReady = false;
  private scheduleEventListenerReady = false;
  private catalogAttempted = false;
  private catalogTimer: number | null = null;

  get enabledInstallations(): ExtensionInstallation[] {
    return (this.overview?.installed ?? []).filter((installation) =>
      this.overview?.accountStates[installation.manifest.id]?.enabled,
    );
  }

  async refresh(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      this.overview = await getExtensionOverview();
      const currentScheduleKeys = new Set(
        Object.entries(this.overview.schedules).flatMap(([extensionId, tasks]) =>
          tasks.map((task) => scheduleKey(extensionId, task.id)),
        ),
      );
      for (const key of this.pendingSchedules) {
        if (!currentScheduleKeys.has(key)) this.pendingSchedules.delete(key);
      }
      for (const key of this.scheduleLastRuns.keys()) {
        if (!currentScheduleKeys.has(key)) this.scheduleLastRuns.delete(key);
      }
      for (const key of this.scheduleFailures.keys()) {
        if (!currentScheduleKeys.has(key)) this.scheduleFailures.delete(key);
      }
      const enabledIds = new Set(this.enabledInstallations.map((item) => item.manifest.id));
      const managedIds = new Set([
        ...(this.overview?.installed ?? []).map((item) => item.manifest.id),
        ...[...this.timers.keys()].map((key) => key.slice(0, key.indexOf(':'))),
        ...this.scheduleControllers.keys(),
        ...[...this.pendingSchedules].map((key) => key.split('\0', 1)[0]),
        ...[...this.scheduleLastRuns.keys()].map((key) => key.split('\0', 1)[0]),
      ]);
      for (const extensionId of managedIds) {
        if (!enabledIds.has(extensionId)) this.clearExtensionTimers(extensionId);
      }
      if (this.accountScope) this.scheduleIntervals();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.loading = false;
    }
  }

  async changeEnabled(
    extensionId: string,
    enabled: boolean,
    capabilities: ExtensionCapability[],
  ): Promise<void> {
    await setExtensionEnabled(extensionId, enabled, capabilities);
    await this.refresh();
    void this.syncCatalogOnce();
    this.clearExtensionTimers(extensionId);
    if (enabled) {
      const installation = this.overview?.installed.find((item) => item.manifest.id === extensionId);
      for (const trigger of installation?.manifest.background_triggers ?? []) {
        if (trigger.type === 'on_enable') void this.runBackground(extensionId, trigger.workflow);
      }
      this.scheduleIntervals();
      void this.runScheduledTasks();
    }
  }

  async activateForAccount(scope: string | null): Promise<void> {
    if (scope === this.accountScope) return;
    this.accountScope = scope;
    this.ensureEventListener();
    this.clearTimers();
    this.failures.clear();
    await this.refresh();
    void this.syncCatalogOnce();
    if (!scope) return;
    for (const installation of this.enabledInstallations) {
      for (const trigger of installation.manifest.background_triggers) {
        if (trigger.type === 'on_login') void this.runBackground(installation.manifest.id, trigger.workflow);
      }
    }
    this.scheduleIntervals();
    this.startScheduleTicker();
    void this.runScheduledTasks();
  }

  private ensureEventListener() {
    if (this.eventListenerReady || typeof window === 'undefined') return;
    this.eventListenerReady = true;
    if (!this.scheduleEventListenerReady) {
      this.scheduleEventListenerReady = true;
      void listen<{ extensionId: string }>('cfms:extension-schedules-changed', () => {
        void this.refresh();
      }).catch((error: unknown) => {
        console.warn('[cfms] Could not subscribe to extension schedule changes.', error);
      });
      const refreshSchedules = () => {
        if (!this.accountScope || document.visibilityState !== 'visible') return;
        void this.refresh().then(() => this.runScheduledTasks());
      };
      document.addEventListener('visibilitychange', refreshSchedules);
      window.addEventListener('focus', refreshSchedules);
    }
    this.catalogTimer = window.setInterval(() => void this.syncCatalog(), 24 * 60 * 60_000);
    window.addEventListener('cfms:extension-event', (event) => {
      const eventName = (event as CustomEvent<string>).detail;
      for (const installation of this.enabledInstallations) {
        for (const trigger of installation.manifest.background_triggers) {
          if (trigger.type === 'event' && trigger.event === eventName) {
            void this.runBackground(installation.manifest.id, trigger.workflow);
          }
        }
      }
    });
  }

  private async syncCatalogOnce() {
    if (this.catalogAttempted) return;
    this.catalogAttempted = true;
    await this.syncCatalog();
  }

  private async syncCatalog() {
    if (!this.overview?.trustedKeysConfigured) return;
    try {
      const catalog = await refreshExtensionCatalog();
      await this.applyCompatibleUpdates(catalog);
      await this.refresh();
    } catch {
      // A stale signed cache remains usable and catalog outages never block core startup.
    }
  }

  private async applyCompatibleUpdates(catalog: ExtensionCatalog) {
    for (const installed of this.overview?.installed ?? []) {
      if (installed.state === 'bundled') continue;
      const candidate = catalog.extensions.find((entry) =>
        entry.manifest.id === installed.manifest.id
        && !entry.revoked
        && canAutoUpdateExtension(installed.signing_key_id, entry.key_id)
        && compareVersions(entry.manifest.version, installed.manifest.version) > 0,
      );
      if (!candidate) continue;
      const oldCapabilities = new Set(installed.manifest.requested_capabilities);
      if (!candidate.manifest.requested_capabilities.every((capability) => oldCapabilities.has(capability))) {
        continue;
      }
      try {
        await installExtensionFromCatalog(candidate.manifest.id);
      } catch {
        // Keep the last verified version active; the management page exposes retry details.
      }
    }
  }

  private scheduleIntervals() {
    for (const installation of this.enabledInstallations) {
      for (const trigger of installation.manifest.background_triggers) {
        if (trigger.type !== 'interval') continue;
        const key = `${installation.manifest.id}:${trigger.workflow}`;
        if (this.timers.has(key)) continue;
        const timer = window.setInterval(
          () => void this.runBackground(installation.manifest.id, trigger.workflow),
          Math.max(trigger.minutes, 15) * 60_000,
        );
        this.timers.set(key, timer);
      }
    }
  }

  private startScheduleTicker() {
    if (!this.accountScope || this.scheduleTickTimer !== null) return;
    this.scheduleTickTimer = window.setInterval(() => {
      void this.runScheduledTasks();
    }, 30_000);
  }

  private async runScheduledTasks() {
    if (!this.accountScope || !this.overview || this.scheduleTickRunning) return;
    this.scheduleTickRunning = true;
    try {
      const now = Date.now();
      for (const installation of this.enabledInstallations) {
        const extensionId = installation.manifest.id;
        const dueTasks: Array<{ task: ExtensionScheduleTask; key: string }> = [];
        for (const task of this.overview.schedules[extensionId] ?? []) {
          if (!task.enabled) continue;
          const key = scheduleKey(extensionId, task.id);
          const lastRunAt = this.scheduleLastRuns.get(key);
          const dueAt = this.pendingSchedules.has(key)
            ? now
            : getScheduleDueAt(
              lastRunAt === undefined ? task : { ...task, last_run_at: lastRunAt },
              now,
            );
          if (dueAt === null) continue;

          if (
            task.kind === 'fixed_time'
            && !task.catch_up
            && isScheduleOccurrenceMissed(dueAt, now)
          ) {
            this.pendingSchedules.delete(key);
            await this.recordScheduleRun(extensionId, task.id, key, 'skipped', 'Missed occurrence was not caught up');
            continue;
          }
          dueTasks.push({ task, key });
        }
        if (dueTasks.length === 0) continue;

        const tasksToDefer = this.runningSchedules.has(extensionId)
          ? dueTasks
          : dueTasks.slice(1);
        for (const { task, key } of tasksToDefer) {
          this.pendingSchedules.add(key);
          await this.recordScheduleRun(extensionId, task.id, key, 'skipped', 'Deferred while another task was running');
        }
        if (this.runningSchedules.has(extensionId)) continue;

        const next = dueTasks[0];
        this.pendingSchedules.delete(next.key);
        this.runningSchedules.add(extensionId);
        const controller = new AbortController();
        this.scheduleControllers.set(extensionId, controller);
        try {
          await this.runScheduledTask(extensionId, next.task, next.key, controller.signal);
        } finally {
          this.scheduleControllers.delete(extensionId);
          this.runningSchedules.delete(extensionId);
        }
      }
    } finally {
      this.scheduleTickRunning = false;
    }
  }

  private async runScheduledTask(
    extensionId: string,
    task: ExtensionScheduleTask,
    key: string,
    signal: AbortSignal,
  ) {
    try {
      const result = await runExtensionWorkflow(extensionId, task.workflow, {
        background: true,
        input: { task },
        signal,
      });
      if (signal.aborted) return;
      if (isRecord(result) && result.ok === false) {
        throw new Error(typeof result.error === 'string' ? result.error : 'Scheduled workflow failed');
      }
      this.scheduleFailures.delete(key);
      const summary = isRecord(result) && typeof result.output === 'string'
        ? result.output.slice(0, 1_000)
        : null;
      await this.recordScheduleRun(extensionId, task.id, key, 'success', summary);
      if (task.notify === 'always') {
        notificationStore.success(summary ?? `${task.name} completed.`);
      }
    } catch (error) {
      if (signal.aborted) return;
      const summary = (error instanceof Error ? error.message : String(error)).slice(0, 1_000);
      const failures = (this.scheduleFailures.get(key) ?? 0) + 1;
      this.scheduleFailures.set(key, failures);
      await this.recordScheduleRun(extensionId, task.id, key, 'failure', summary);
      if (task.notify === 'always' || task.notify === 'problems_only') {
        notificationStore.error(`${task.name}: ${summary}`);
      }
      if (failures >= 5) await this.disableRepeatedlyFailingSchedule(extensionId, task, key);
    }
  }

  private async recordScheduleRun(
    extensionId: string,
    taskId: string,
    key: string,
    status: 'success' | 'failure' | 'skipped',
    summary: string | null,
  ) {
    this.scheduleLastRuns.set(key, Date.now());
    try {
      const updated = await recordExtensionScheduleRun(extensionId, taskId, status, summary);
      if (updated.last_run_at !== null) this.scheduleLastRuns.set(key, updated.last_run_at);
    } catch (error) {
      console.error(`[cfms] Could not record extension schedule ${taskId}.`, error);
      notificationStore.error(`Could not record scheduled task "${taskId}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async disableRepeatedlyFailingSchedule(
    extensionId: string,
    task: ExtensionScheduleTask,
    key: string,
  ) {
    try {
      await updateExtensionSchedule(extensionId, task.id, { ...task, enabled: false });
      this.scheduleFailures.delete(key);
      notificationStore.error(`Scheduled task "${task.name}" was disabled after five consecutive failures.`);
    } catch (error) {
      console.error(`[cfms] Could not disable repeatedly failing schedule ${task.id}.`, error);
      notificationStore.error(`Could not disable scheduled task "${task.name}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async runBackground(extensionId: string, workflow: string) {
    const key = `${extensionId}:${workflow}`;
    if (this.running.has(key)) return;
    this.running.add(key);
    const controller = new AbortController();
    this.controllers.set(key, controller);
    try {
      await runExtensionWorkflow(extensionId, workflow, {
        background: true,
        signal: controller.signal,
      });
      this.failures.delete(extensionId);
    } catch (error) {
      const failures = (this.failures.get(extensionId) ?? 0) + 1;
      this.failures.set(extensionId, failures);
      if (failures >= 5) {
        const installation = this.overview?.installed.find((item) => item.manifest.id === extensionId);
        await setExtensionEnabled(
          extensionId,
          false,
          installation?.manifest.requested_capabilities ?? [],
        ).catch(() => undefined);
        this.clearExtensionTimers(extensionId);
        notificationStore.error(`${installation?.manifest.name ?? extensionId} was disabled after repeated background failures.`);
        await this.refresh();
      }
    } finally {
      this.controllers.delete(key);
      this.running.delete(key);
    }
  }

  private clearExtensionTimers(extensionId: string) {
    for (const [key, timer] of this.timers) {
      if (key.startsWith(`${extensionId}:`)) {
        window.clearInterval(timer);
        this.timers.delete(key);
      }
    }
    for (const [key, controller] of this.controllers) {
      if (key.startsWith(`${extensionId}:`)) {
        controller.abort();
        this.controllers.delete(key);
      }
    }
    this.scheduleControllers.get(extensionId)?.abort();
    const schedulePrefix = `${extensionId}\0`;
    for (const key of this.pendingSchedules) {
      if (key.startsWith(schedulePrefix)) this.pendingSchedules.delete(key);
    }
    for (const key of this.scheduleLastRuns.keys()) {
      if (key.startsWith(schedulePrefix)) this.scheduleLastRuns.delete(key);
    }
    for (const key of this.scheduleFailures.keys()) {
      if (key.startsWith(schedulePrefix)) this.scheduleFailures.delete(key);
    }
  }

  private clearTimers() {
    for (const timer of this.timers.values()) window.clearInterval(timer);
    this.timers.clear();
    if (this.scheduleTickTimer !== null) {
      window.clearInterval(this.scheduleTickTimer);
      this.scheduleTickTimer = null;
    }
    this.pendingSchedules.clear();
    this.scheduleLastRuns.clear();
    this.scheduleFailures.clear();
    for (const controller of this.scheduleControllers.values()) controller.abort();
    this.scheduleControllers.clear();
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
  }
}

export const extensionsStore = new ExtensionsStore();

function compareVersions(left: string, right: string): number {
  const parse = (value: string) => value.split('-', 1)[0].split('.').map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scheduleKey(extensionId: string, taskId: string): string {
  return `${extensionId}\0${taskId}`;
}
