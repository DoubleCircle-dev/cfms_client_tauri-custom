// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authStore } from '$lib/stores.svelte';
import AuthenticationManagement from './AuthenticationManagement.svelte';

const mocks = vi.hoisted(() => ({ inventory: vi.fn(), policies: vi.fn(), register: vi.fn(), update: vi.fn(), remove: vi.fn() }));
vi.mock('$lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof import('$lib/api')>(),
  getUserAuthentication: mocks.inventory, setUserAuthPolicies: mocks.policies,
  registerUserAuthPublicKey: mocks.register, updateUserAuthPublicKey: mocks.update, deleteUserAuthPublicKey: mocks.remove,
}));
vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'windows' }));
vi.mock('svelte-i18n', () => ({ _: { subscribe(run: (t: (key: string) => string) => void) { run((key) => key); return () => {}; } } }));

const userId = 'aabbccdd-0000-4000-8000-000000000001';
const inventory = () => ({
  user_id: userId,
  methods: { password: { purposes: ['login', 'mfa', 'escalation'] }, publickey: { purposes: ['login', 'mfa', 'escalation'] } },
  credentials: [{ method: 'password', credential_id: 'password-id', active: true, label: 'Password', key_identity: null }],
  policies: { login: { revision: 3, chains: [[{ method: 'password', credential_ids: ['password-id'] }]] }, mfa: { revision: 0, chains: [] }, escalation: { revision: 0, chains: [] } },
});

beforeEach(() => {
  authStore.apply({ user_id: userId, username: 'alice', nickname: 'Alice', has_token: true, token_exp: 2e9, escalation_exp: Date.now() / 1000 + 300, permissions: [], groups: [] });
  mocks.inventory.mockResolvedValue(inventory());
  mocks.policies.mockResolvedValue({ policies: { mfa: { revision: 1, chains: [[{ method: 'password', credential_ids: ['password-id'] }]] } } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); authStore.clear(); });

describe('authentication management', () => {
  it('reads another account by UUID and keeps writes disabled without elevation', async () => {
    authStore.escalationExp = null;
    render(AuthenticationManagement, { userId });
    await screen.findByText('Password', { selector: 'strong' });
    expect(mocks.inventory).toHaveBeenCalledWith(userId);
    expect((screen.getByRole('button', { name: 'authManagement.registerKey' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toContain('authManagement.elevationRequired');
  });

  it('submits only modified policies with their original revisions and preserves edits on conflict', async () => {
    mocks.policies.mockRejectedValue(new Error('Server returned 409: Conflict\nCFMS_ERROR_DATA:{"reason":"revision_conflict"}'));
    render(AuthenticationManagement, { userId });
    const group = await screen.findByRole('group', { name: /authManagement.purposes.mfa/ });
    await fireEvent.click(within(group).getByRole('button', { name: 'authManagement.addAlternative' }));
    await fireEvent.click(within(group).getByRole('checkbox'));
    await fireEvent.click(screen.getByRole('button', { name: 'authManagement.savePolicies' }));
    await waitFor(() => expect(mocks.policies).toHaveBeenCalledWith([{ purpose: 'mfa', expected_revision: 0, chains: [[{ method: 'password', credential_ids: ['password-id'] }]] }], userId));
    expect((await screen.findByRole('alert')).textContent).toBe('authManagement.errors.revision_conflict');
    expect((within(group).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('button', { name: 'authManagement.savePolicies' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('registers a public key without granting it a policy', async () => {
    mocks.register.mockResolvedValue({ credential_id: 'key-id', fingerprint: 'abc123', label: 'Work key' });
    render(AuthenticationManagement);
    await screen.findByText('Password', { selector: 'strong' });
    await fireEvent.input(screen.getByLabelText('authManagement.publicKey'), { target: { value: 'ssh-ed25519 AAAA' } });
    await fireEvent.input(screen.getByLabelText('authManagement.keyLabel'), { target: { value: 'Work key' } });
    await fireEvent.click(screen.getByRole('button', { name: 'authManagement.registerKey' }));
    await waitFor(() => expect(mocks.register).toHaveBeenCalledWith('ssh-ed25519 AAAA', 'Work key', undefined));
    expect(await screen.findByText('Work key')).toBeTruthy();
    expect(mocks.policies).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'authManagement.savePolicies' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
