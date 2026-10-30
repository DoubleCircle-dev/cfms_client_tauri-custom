import { describe, expect, it } from 'vitest';

import type { DeclarativePage } from '$lib/api/extensions';
import { createExtensionStylesheet } from './styles';

function page(overrides: Partial<DeclarativePage> = {}): DeclarativePage {
  return {
    schema_version: 1,
    title: 'Styled page',
    blocks: [
      { type: 'form', id: 'tool', class_name: 'plugin-tool-form', fields: [
        { id: 'input', label: 'Input', type: 'text', class_name: 'plugin-input' },
      ] },
    ],
    styles: [
      {
        selector: '.plugin-tool-form .extension-control',
        declarations: { width: '100%', color: 'var(--colorNeutralForeground1)' },
      },
      {
        selector: '.plugin-input:focus',
        media: '(max-width: 700px)',
        declarations: { 'grid-column': '1 / -1' },
      },
    ],
    ...overrides,
  };
}

describe('extension page styles', () => {
  it('scopes validated rules to the extension page and supports bounded media queries', () => {
    const css = createExtensionStylesheet(page(), 'extension-test-1');
    expect(css).toContain('[data-extension-style-scope="extension-test-1"] .plugin-tool-form .extension-control');
    expect(css).toContain('@media (max-width: 700px)');
    expect(css).not.toContain('body');
  });

  it.each([
    ['global selector', { selector: 'body', declarations: { color: 'red' } }],
    ['out-of-scope class', { selector: '.page .plugin-unknown', declarations: { color: 'red' } }],
    ['external resource', { selector: '.plugin-tool-form', declarations: { 'background-color': 'url(https://example.test/a)' } }],
    ['unsafe property', { selector: '.plugin-tool-form', declarations: { position: 'fixed' } }],
    ['hidden content', { selector: '.plugin-tool-form', declarations: { display: 'none' } }],
  ])('rejects %s', (_label, style) => {
    expect(() => createExtensionStylesheet(page({ styles: [style as never] }), 'extension-test-1')).toThrow();
  });

  it('rejects malformed or oversized plugin class names', () => {
    const invalidPage = page({
      blocks: [{ type: 'form', id: 'tool', class_name: 'plugin-good body', fields: [] }],
      styles: [],
    });
    expect(() => createExtensionStylesheet(invalidPage, 'extension-test-1')).toThrow(/plugin-\*/);
  });
});
