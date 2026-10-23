// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authStore, serverStateStore } from '$lib/stores.svelte';
import EscalationControl from './EscalationControl.svelte';
import EscalationCountdown from './EscalationCountdown.svelte';

const mocks = vi.hoisted(() => ({ inventory: vi.fn(), escalate: vi.fn(), drop: vi.fn() }));
vi.mock('$lib/api', () => ({ getUserAuthentication: mocks.inventory, requestEscalation: mocks.escalate, dropEscalation: mocks.drop }));
vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'windows' }));
vi.mock('$lib/motion/transitions', () => ({ flyScale: () => ({ duration: 0 }) }));
vi.mock('$lib/appearance', () => ({ isReducedMotionEnabled: () => true }));
vi.mock('svelte-i18n', () => ({ _: { subscribe(run: (t: (key: string) => string) => void) { run((key) => key); return () => {}; } } }));

const status = { username: 'alice', user_id: 'aabbccdd-0000-4000-8000-000000000001', nickname: 'Alice', has_token: true, token_exp: 2e9, permissions: [], groups: [] };
const emptyPolicy = { escalation: { revision: 0, chains: [] } };

Object.defineProperty(Element.prototype, 'animate', {
  configurable: true,
  value: () => ({ cancel() {}, currentTime: 0, effect: {}, finished: Promise.resolve() }),
});

beforeEach(() => {
  authStore.apply(status);
  serverStateStore.connected = true;
  mocks.inventory.mockResolvedValue({ policies: emptyPolicy });
  mocks.escalate.mockResolvedValue({ ...status, escalation_exp: Date.now() / 1000 + 300 });
  mocks.drop.mockResolvedValue({ ...status, escalation_exp: null });
});
afterEach(() => { cleanup(); authStore.clear(); serverStateStore.clear(); vi.useRealTimers(); vi.clearAllMocks(); });

describe('elevation controls', () => {
  it('drops elevation on a second click, preserving login and removing the countdown', async () => {
    authStore.escalationExp = Date.now() / 1000 + 300;
    serverStateStore.connected = false;
    render(EscalationControl);
    render(EscalationCountdown);
    const exit = screen.getByRole('button', { name: 'authentication.exitEscalation' });
    expect(exit.getAttribute('data-active')).toBe('true');
    expect(exit.hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('timer')).toBeTruthy();
    await fireEvent.click(exit);
    await waitFor(() => expect(authStore.escalationExp).toBeNull());
    expect(mocks.drop).toHaveBeenCalledOnce();
    expect(mocks.inventory).not.toHaveBeenCalled();
    expect(mocks.escalate).not.toHaveBeenCalled();
    expect(authStore.isLoggedIn).toBe(true);
    expect(screen.queryByRole('timer')).toBeNull();
    expect(screen.getByRole('button', { name: 'authentication.escalate' }).getAttribute('data-active')).toBe('false');
  });

  it('directly exchanges a token when no additional proof is required', async () => {
    render(EscalationControl);
    await fireEvent.click(screen.getByRole('button', { name: 'authentication.escalate' }));
    await waitFor(() => expect(mocks.escalate).toHaveBeenCalledWith());
    expect(authStore.escalationExp).toBeGreaterThan(Date.now() / 1000);
  });

  it('collects a fresh password only when the escalation policy requires one', async () => {
    mocks.inventory.mockResolvedValue({
      policies: { escalation: { chains: [[{ method: 'password', credential_ids: ['p'] }]] } },
      methods: { password: { purposes: ['escalation'] } },
      credentials: [{ method: 'password', credential_id: 'p', active: true }],
    });
    render(EscalationControl);
    await fireEvent.click(screen.getByRole('button', { name: 'authentication.escalate' }));
    const password = await screen.findByLabelText('login.password');
    expect(mocks.escalate).not.toHaveBeenCalled();
    await fireEvent.input(password, { target: { value: 'fresh-proof' } });
    await fireEvent.click(screen.getByRole('button', { name: 'dialog.twoFactor.verify' }));
    await waitFor(() => expect(mocks.escalate).toHaveBeenCalledWith('password', { password: 'fresh-proof' }));
  });

  it('shows a countdown based on expiry and removes it when the clock reaches expiration', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-24T00:00:00Z'));
    authStore.escalationExp = Date.now() / 1000 + 2;
    render(EscalationCountdown);
    expect(screen.getByRole('timer').textContent).toContain('00:02');
    await vi.advanceTimersByTimeAsync(2000);
    await tick();
    expect(screen.queryByRole('timer')).toBeNull();
    expect(authStore.isLoggedIn).toBe(true);
  });

  it.each(['totp', 'recovery'])('submits a fresh %s code and keeps elevation inactive on failure', async (kind) => {
    mocks.inventory.mockResolvedValue({
      policies: { escalation: { chains: [[{ method: 'totp', credential_ids: ['t'] }]] } },
      methods: { totp: { purposes: ['escalation'] } },
      credentials: [{ method: 'totp', credential_id: 't', active: true }],
    });
    mocks.escalate.mockRejectedValue(new Error('Invalid verification code'));
    render(EscalationControl);
    await fireEvent.click(screen.getByRole('button', { name: 'authentication.escalate' }));
    await screen.findByLabelText('dialog.twoFactor.enterTotp');
    if (kind === 'recovery') {
      await fireEvent.click(screen.getByRole('button', { name: 'dialog.twoFactor.useRecovery' }));
    }
    const code = kind === 'totp' ? '123456' : 'backup-code';
    await fireEvent.input(screen.getByRole('textbox'), { target: { value: code } });
    if (kind === 'recovery') await fireEvent.click(screen.getByRole('button', { name: 'dialog.twoFactor.verify' }));
    await waitFor(() => expect(mocks.escalate).toHaveBeenCalledWith('totp', { token: code }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(authStore.escalationExp).toBeNull();
    expect(authStore.isLoggedIn).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));
    expect(mocks.escalate).toHaveBeenCalledTimes(1);
  });
});
