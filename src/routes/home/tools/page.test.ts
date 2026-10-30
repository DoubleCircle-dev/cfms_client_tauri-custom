// @vitest-environment jsdom

import '$lib/i18n';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { locale } from 'svelte-i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ToolsPage from './+page.svelte';

const { openUrlMock } = vi.hoisted(() => ({ openUrlMock: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: openUrlMock }));

function cellLabel(row: number, col: number): string {
  return `Row ${row}, column ${col}`;
}

beforeEach(() => {
  locale.set('en');
  openUrlMock.mockReset();
  openUrlMock.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe('tools page', () => {
  it('renders the matrix tab and all tool tabs', () => {
    render(ToolsPage);
    expect(screen.getByRole('tab', { name: /Matrix Generator/ })).toBeTruthy();
    for (const name of ['ASCII', 'A1Z26', 'Radix', 'BASE', 'Morse', 'Caesar', 'ADFGVX', 'SHA-256']) {
      expect(screen.getByRole('tab', { name: new RegExp(name) })).toBeTruthy();
    }
  });

  it('encodes and decodes ASCII through the UI', async () => {
    render(ToolsPage);
    await fireEvent.click(screen.getByRole('tab', { name: 'ASCII' }));

    const input = screen.getByLabelText('Input:');
    await fireEvent.input(input, { target: { value: 'Hello' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Encrypt' }));

    await waitFor(() => {
      expect((screen.getByLabelText('Output:') as HTMLTextAreaElement).value).toBe(
        '72 101 108 108 111',
      );
    });
  });

  it('generates and decodes a 7×7 matrix through the UI', async () => {
    render(ToolsPage);

    const ipInput = screen.getByLabelText('IP address:');
    await fireEvent.input(ipInput, { target: { value: '192.168.1.100' } });
    const portInput = screen.getByLabelText('Port:');
    await fireEvent.input(portInput, { target: { value: '7573' } });

    await fireEvent.click(screen.getByRole('button', { name: 'Generate Matrix' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Decode' }));

    await waitFor(() => {
      const result = screen.getByText(/Endpoint:/);
      expect(result.textContent).toContain('192.168.1.100:7573');
      expect(result.textContent).toContain('Validation: valid');
    });
  });

  it('reports matrix validation errors through the UI', async () => {
    render(ToolsPage);
    await fireEvent.input(screen.getByLabelText('IP address:'), { target: { value: 'bad-ip' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Generate Matrix' }));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Invalid IP address');
    });
  });

  it('fills decoy cells so the 7×7 grid round-trips', () => {
    render(ToolsPage);
    const cells = Array.from(
      { length: 49 },
      (_, index) => screen.getByLabelText(cellLabel(Math.floor(index / 7) + 1, (index % 7) + 1)),
    );
    expect(cells).toHaveLength(49);
  });

  it('offers the toolbox promo and hands the link to the system browser', async () => {
    render(ToolsPage);

    expect(screen.getByText(/Can’t find the tool you need\? Try/)).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Mistarg Toolbox' });
    expect(link.getAttribute('href')).toBe('https://www.tool.mistarg.cn/');
    expect(link.getAttribute('target')).toBe('_blank');

    await fireEvent.click(link);
    expect(openUrlMock).toHaveBeenCalledWith('https://www.tool.mistarg.cn/');
  });

  it('keeps the Chinese promo sentence tight around the link', () => {
    locale.set('zh-CN');
    render(ToolsPage);

    const link = screen.getByRole('link', { name: '迷雾工具箱' });
    expect(link.parentElement?.textContent?.trim()).toBe('没有找到对应的工具？试试迷雾工具箱！');
  });
});
