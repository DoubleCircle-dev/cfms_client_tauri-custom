// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AuditLogFilter from './AuditLogFilter.svelte';

vi.mock('svelte-i18n', () => ({
  _: {
    subscribe(run: (translate: (key: string) => string) => void) {
      run((key) => key);
      return () => undefined;
    },
  },
}));

vi.mock('$lib/motion/transitions', () => ({
  menuScale: () => ({ duration: 0 }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AuditLogFilter', () => {
  it('stages suggested and custom exact actions until Apply is selected', async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(AuditLogFilter, {
      props: {
        availableActions: ['login', 'create_directory'],
        selectedActions: [],
        onApply,
      },
    });

    const trigger = screen.getByRole('button', { name: 'manage.auditFilterButton' });
    await fireEvent.click(trigger);
    await fireEvent.click(screen.getByRole('option', { name: 'login' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();

    const input = screen.getByLabelText('manage.auditFilterSearch');
    await fireEvent.input(input, { target: { value: '  extension_action  ' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('option', { name: 'extension_action' }).getAttribute('aria-selected')).toBe('true');
    expect(onApply).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'manage.auditFilterApply' }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(['extension_action', 'login']));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('discards staged changes when closed with Escape or the dismiss layer', async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(AuditLogFilter, {
      props: {
        availableActions: ['login', 'diagnostics'],
        selectedActions: ['login'],
        onApply,
      },
    });

    const trigger = screen.getByRole('button', { name: 'manage.auditFilterButton' });
    await fireEvent.click(trigger);
    await fireEvent.click(screen.getByRole('option', { name: 'login' }));
    await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    await fireEvent.click(trigger);
    expect(screen.getByRole('option', { name: 'login' }).getAttribute('aria-selected')).toBe('true');
    await fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('trims and deduplicates custom actions and exposes disabled state', async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(AuditLogFilter, {
      props: {
        availableActions: [],
        selectedActions: [],
        onApply,
      },
    });

    const trigger = screen.getByRole('button', { name: 'manage.auditFilterButton' });
    await fireEvent.click(trigger);
    const input = screen.getByLabelText('manage.auditFilterSearch');
    await fireEvent.input(input, { target: { value: '  custom_action  ' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await fireEvent.input(input, { target: { value: 'custom_action' } });
    await fireEvent.keyDown(input, { key: 'Enter' });
    await fireEvent.click(screen.getByRole('button', { name: 'manage.auditFilterApply' }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(['custom_action']));

    await rerender({
      availableActions: [],
      selectedActions: [],
      disabled: true,
      onApply,
    });
    expect((screen.getByRole('button', { name: 'manage.auditFilterButton' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens above the trigger and constrains its height when space below is limited', async () => {
    const originalWidth = window.innerWidth;
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });

    render(AuditLogFilter, {
      props: {
        availableActions: Array.from({ length: 40 }, (_, index) => `action_${index}`),
        selectedActions: [],
        onApply: vi.fn(),
      },
    });
    const trigger = screen.getByRole('button', { name: 'manage.auditFilterButton' });
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      x: 620,
      y: 400,
      top: 400,
      right: 700,
      bottom: 432,
      left: 620,
      width: 80,
      height: 32,
      toJSON: () => ({}),
    });

    await fireEvent.click(trigger);
    const panel = screen.getByRole('dialog') as HTMLElement;
    expect(panel.classList.contains('filter-panel--above')).toBe(true);
    expect(panel.style.left).toBe('-272px');
    expect(panel.style.maxHeight).toBe('376px');
    expect(screen.getAllByRole('option')).toHaveLength(40);

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight });
  });
});
