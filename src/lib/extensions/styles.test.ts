import { describe, expect, it } from 'vitest';

import type { DeclarativePage } from '$lib/api/extensions';
import { createExtensionStylesheet } from './styles';

function page(overrides: Partial<DeclarativePage> = {}): DeclarativePage {
  return {
    schema_version: 1,
    title: 'Styled page',
    class_name: 'plugin-page',
    blocks: [
      {
        type: 'form',
        id: 'tool',
        class_name: 'plugin-tool-form',
        fields: [{ id: 'input', label: 'Input', type: 'text', class_name: 'plugin-input' }],
      },
    ],
    styles: [
      {
        selector: '.plugin-page .plugin-tool-form',
        declarations: { display: 'grid', gap: '1rem', color: 'var(--colorNeutralForeground1)' },
      },
      {
        selector: '.plugin-input:focus-visible',
        media: '(max-width: 700px)',
        declarations: { 'grid-column': '1 / -1' },
      },
    ],
    ...overrides,
  };
}

describe('extension page styles', () => {
  it('scopes styles to the extension root and supports bounded media rules', () => {
    const css = createExtensionStylesheet(page(), 'extension-test-1');
    expect(css).toContain('[data-extension-style-scope="extension-test-1"].plugin-page');
    expect(css).toContain('[data-extension-style-scope="extension-test-1"] .plugin-page .plugin-tool-form');
    expect(css).toContain('@media (max-width: 700px)');
    expect(css).not.toContain('body');
  });

  it.each([
    ['global selector', { selector: 'body', declarations: { color: 'red' } }],
    ['undeclared plugin class', { selector: '.plugin-missing', declarations: { color: 'red' } }],
    ['external resource', { selector: '.plugin-tool-form', declarations: { 'background-color': 'url(https://example.test/a)' } }],
    ['unsafe property', { selector: '.plugin-tool-form', declarations: { position: 'fixed' } }],
    ['hidden content', { selector: '.plugin-tool-form', declarations: { display: 'none' } }],
  ])('rejects %s', (_label, style) => {
    expect(() => createExtensionStylesheet(page({ styles: [style as never] }), 'extension-test-1')).toThrow();
  });

  it('rejects malformed or host-owned class names', () => {
    const invalidPage = page({
      blocks: [{ type: 'form', id: 'tool', class_name: 'plugin-good body', fields: [] }],
      styles: [],
    });
    expect(() => createExtensionStylesheet(invalidPage, 'extension-test-1')).toThrow(/plugin-\*/);
  });

  it('rejects an invalid style scope identifier', () => {
    expect(() => createExtensionStylesheet(page(), 'extension-test"{}')).toThrow(/scope/);
  });
});