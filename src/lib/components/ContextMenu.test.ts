// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ContextMenu from './ContextMenu.svelte';

vi.mock('$lib/motion/transitions', () => ({
  menuScale: () => ({ duration: 0 }),
}));

Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value: vi.fn(),
});

afterEach(cleanup);

describe('ContextMenu keyboard interaction', () => {
  it.each(['contentCopy', 'adminPanelSettings', 'passwordReset', 'accountCircle'] as const)(
    'uses the %s accent only for enabled, non-dangerous actions', (icon) => {
      render(ContextMenu, {
        open: true, x: 10, y: 10, onClose: vi.fn(),
        items: [
          { id: 'enabled', label: 'Enabled', icon, onSelect: vi.fn() },
          { id: 'disabled', label: 'Disabled', icon, disabled: true, onSelect: vi.fn() },
          { id: 'danger', label: 'Danger', icon, danger: true, onSelect: vi.fn() },
        ],
      });
      const accentPath = 'path[fill="var(--cfms-icon-accent, currentColor)"]';
      expect(screen.getByRole('menuitem', { name: 'Enabled' }).querySelector(accentPath)).not.toBeNull();
      expect(screen.getByRole('menuitem', { name: 'Disabled' }).querySelector(accentPath)).toBeNull();
      expect(screen.getByRole('menuitem', { name: 'Danger' }).querySelector(accentPath)).toBeNull();
    },
  );

  it('filters permissions and separators, ignores disabled actions, and closes before selection', async () => {
    const order: string[] = [];
    const disabledAction = vi.fn();
    render(ContextMenu, {
      open: true, x: 10, y: 10,
      userPermissions: [],
      onClose: () => { order.push('close'); },
      items: [
        { type: 'divider' },
        { id: 'hidden', label: 'Restricted', icon: 'lock', requiredPermissions: ['admin'], onSelect: vi.fn() },
        { id: 'disabled', label: 'Disabled', icon: 'folderUpload', disabled: true, onSelect: disabledAction },
        { type: 'divider' },
        { id: 'upload', label: 'Upload folder', icon: 'folderUpload', onSelect: () => { order.push('select'); } },
        { type: 'divider' },
      ],
    });
    expect(screen.queryByRole('menuitem', { name: 'Restricted' })).toBeNull();
    expect(screen.getAllByRole('separator')).toHaveLength(1);
    const disabled = screen.getByRole('menuitem', { name: 'Disabled' });
    const upload = screen.getByRole('menuitem', { name: 'Upload folder' });
    await waitFor(() => expect(document.activeElement).toBe(upload));
    await fireEvent.click(disabled);
    expect(disabledAction).not.toHaveBeenCalled();
    expect(order).toEqual([]);
    await fireEvent.click(upload);
    expect(order).toEqual(['close', 'select']);
  });

  it('focuses actions, navigates with arrows, and restores the trigger on Escape', async () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const onClose = vi.fn();
    const { unmount } = render(ContextMenu, {
      props: {
        open: true,
        x: 10,
        y: 10,
        sourceElement: trigger,
        onClose,
        items: [
          { id: 'open', label: 'Open', icon: 'folderOpen', onSelect: vi.fn() },
          { id: 'disabled', label: 'Disabled', icon: 'info', disabled: true, onSelect: vi.fn() },
          { id: 'delete', label: 'Delete', icon: 'delete', onSelect: vi.fn() },
        ],
      },
    });

    const open = screen.getByRole('menuitem', { name: 'Open' });
    const remove = screen.getByRole('menuitem', { name: 'Delete' });
    await waitFor(() => expect(document.activeElement).toBe(open));
    await fireEvent.keyDown(open, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(remove);
    await fireEvent.keyDown(remove, { key: 'Home' });
    expect(document.activeElement).toBe(open);
    await fireEvent.keyDown(open, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
