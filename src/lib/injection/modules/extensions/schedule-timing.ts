import type { ExtensionScheduleTask } from '$lib/injection/modules/extensions/api';

export function getScheduleDueAt(task: ExtensionScheduleTask, now: number): number | null {
  const lastRunAt = task.last_run_at ?? task.created_at;
  if (task.kind === 'interval') {
    if (task.interval_minutes === null) return null;
    const dueAt = lastRunAt + task.interval_minutes * 60_000;
    return dueAt <= now ? dueAt : null;
  }

  if (!task.time_of_day) return null;
  const [hour, minute] = task.time_of_day.split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  const today = new Date(now);
  for (let daysAgo = 0; daysAgo < 7; daysAgo += 1) {
    const day = new Date(today);
    day.setDate(today.getDate() - daysAgo);
    const isoWeekday = day.getDay() || 7;
    if (!task.days.includes(isoWeekday)) continue;
    day.setHours(hour, minute, 0, 0);
    const dueAt = day.getTime();
    if (dueAt <= now && dueAt > lastRunAt) return dueAt;
  }
  return null;
}

export function isScheduleOccurrenceMissed(dueAt: number, now: number): boolean {
  return now - dueAt > 60_000;
}
