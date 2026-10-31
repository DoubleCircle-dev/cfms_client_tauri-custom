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

  it('allows plugins to style exposed page structure classes', () => {
    const css = createExtensionStylesheet(page({
      styles: [
        { selector: '.extension-page-title', declarations: { 'font-size': '28px' } },
        { selector: '.extension-tab-list', declarations: { display: 'flex', gap: '4px' } },
        { selector: '.extension-result-heading', declarations: { 'justify-content': 'space-between' } },
      ],
    }), 'extension-test-1');

    expect(css).toContain('.extension-page-title{font-size:28px}');
    expect(css).toContain('.extension-tab-list{display:flex;gap:4px}');
    expect(css).toContain('.extension-result-heading{justify-content:space-between}');
  });

  it('parses CSS blocks and scopes their rules without rendering raw CSS', () => {
    const css = createExtensionStylesheet(page({
      styles: [],
      blocks: [
        { type: 'text', text: 'Ready', class_name: 'plugin-status' },
        { type: 'css', css: '.plugin-status { color: red; }\n@media (max-width: 700px) { .plugin-status { display: block; } }' },
      ],
    }), 'extension-test-1');

    expect(css).toContain('[data-extension-style-scope="extension-test-1"] .plugin-status{color:red}');
    expect(css).toContain('@media (max-width: 700px)');
    expect(css).toContain('display:block');
  });

  it.each([
    ['global selector', 'body { color: red; }'],
    ['undeclared class', '.plugin-missing { color: red; }'],
    ['external resource', '.plugin-input { background-color: url(https://example.test/a); }'],
    ['unknown at-rule', '@import "https://example.test/a.css";'],
    ['comments', '.plugin-input { color: red; /* comment */ }'],
    ['unclosed rule', '.plugin-input { color: red;'],
  ])('rejects unsafe CSS block: %s', (_label, css) => {
    expect(() => createExtensionStylesheet(page({
      styles: [],
      blocks: [{ type: 'css', css }],
    }), 'extension-test-1')).toThrow();
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