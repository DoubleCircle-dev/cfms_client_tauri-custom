import { beforeEach, describe, expect, it } from 'vitest';

import { notificationStore } from './stores.svelte';

function resetNotifications() {
  notificationStore.clear();
  notificationStore.clearHistory();
}

beforeEach(resetNotifications);

describe('notification history', () => {
  it('records every toast so a missed message can be read back', () => {
    notificationStore.success('Upload finished');
    notificationStore.error('Download failed');

    expect(notificationStore.history.map((entry) => entry.type)).toEqual(['error', 'success']);
    expect(notificationStore.history[1].text).toBe('Upload finished');
  });

  it('keeps one row per group instead of one row per item', () => {
    for (let index = 1; index <= 3; index += 1) {
      notificationStore.error(`File ${index} failed`, 8000, {
        groupKey: 'download-failures',
        groupTitle: 'Downloads failed',
        itemText: `File ${index} failed`,
        summaryText: (count) => `${count} downloads failed`,
      });
    }

    expect(notificationStore.history).toHaveLength(1);
    expect(notificationStore.history[0].text).toBe('3 downloads failed');
    expect(notificationStore.history[0].items).toHaveLength(3);
  });

  it('caps the trail so a long session cannot grow without bound', () => {
    for (let index = 0; index < 260; index += 1) {
      notificationStore.info(`Message ${index}`);
    }

    expect(notificationStore.history).toHaveLength(200);
    expect(notificationStore.history[0].text).toBe('Message 259');
  });

  it('keeps toasts and history independent', () => {
    notificationStore.info('First');
    notificationStore.info('Second');

    // The toast stack is dismissible, the history is not affected by that.
    notificationStore.remove(notificationStore.entries[0].id);

    expect(notificationStore.entries).toHaveLength(1);
    expect(notificationStore.history).toHaveLength(2);
  });

  it('clears the trail on demand', () => {
    notificationStore.info('First');
    notificationStore.clearHistory();

    expect(notificationStore.history).toHaveLength(0);
  });
});
