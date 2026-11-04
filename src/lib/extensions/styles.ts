import type { DeclarativePage, DeclarativeStyleRule } from '$lib/extensions/api';

const MAX_STYLES_BYTES = 16 * 1024;
const MAX_STYLE_RULES = 64;
const MAX_STYLE_DECLARATIONS = 16;

const HOST_STYLE_CLASSES = new Set([
  'extension-page',
  'extension-page-header',
  'extension-page-title',
  'extension-page-description',
  'extension-grid',
  'extension-block',
  'extension-block--text',
  'extension-block--status_card',
  'extension-block--alert',
  'extension-block--progress',
  'extension-block--list',
  'extension-block--table',
  'extension-block--empty_state',
  'extension-block--form',
  'extension-block--actions',
  'extension-tab',
  'extension-tab-list',
  'extension-tab--active',
  'extension-heading',
  'extension-caption',
  'extension-card',
  'extension-alert',
  'extension-wide',
  'extension-form-field',
  'extension-form-label',
  'extension-control',
  'extension-actions',
  'extension-button',
  'extension-result-heading',
  'extension-result-banner',
  'extension-result-banner--success',
  'extension-result-banner--danger',
  'extension-block--result',
  'tone-default',
  'tone-info',
  'tone-success',
  'tone-warning',
  'tone-danger',
  'extension-muted',
  'extension-error-message',
]);

const STYLE_PROPERTIES = new Set([
  'align-items',
  'background-color',
  'border',
  'border-color',
  'border-radius',
  'border-style',
  'border-width',
  'box-sizing',
  'color',
  'column-gap',
  'display',
  'flex',
  'flex-basis',
  'flex-direction',
  'flex-grow',
  'flex-shrink',
  'flex-wrap',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'gap',
  'grid-auto-flow',
  'grid-column',
  'grid-template-columns',
  'grid-template-rows',
  'height',
  'justify-content',
  'letter-spacing',
  'line-height',
  'margin',
  'margin-block',
  'margin-inline',
  'max-height',
  'max-width',
  'min-height',
  'min-width',
  'outline',
  'outline-color',
  'outline-offset',
  'outline-style',
  'outline-width',
  'overflow',
  'overflow-x',
  'overflow-y',
  'padding',
  'padding-block',
  'padding-inline',
  'resize',
  'row-gap',
  'text-align',
  'text-decoration',
  'text-overflow',
  'vertical-align',
  'white-space',
  'width',
]);

const SAFE_FUNCTIONS = new Set([
  'calc',
  'clamp',
  'hsl',
  'hsla',
  'max',
  'min',
  'minmax',
  'repeat',
  'rgb',
  'rgba',
  'var',
]);
const SELECTOR_CLASS = String.raw`\.(?:plugin-[a-z][a-z0-9_-]{0,54}|extension-[a-z0-9_-]{1,63})(?::(?:hover|focus|focus-visible|active|disabled|checked))?`;
const SELECTOR_PATTERN = new RegExp(
  `^${SELECTOR_CLASS}(?:(?:\\s+|\\s*>\\s*)${SELECTOR_CLASS})*$`,
);
const CLASS_NAME_PATTERN = /^plugin-[a-z][a-z0-9_-]{0,54}$/;
const VALUE_CHARACTERS = /^[a-zA-Z0-9#(),.%\s_+/-]+$/;
const MEDIA_PATTERN = /^\((?:max|min)-width:\s*\d{1,4}(?:\.\d{1,2})?(?:px|rem|em)\)$/;
const HOST_THEME_VARIABLE = /^--(?:color(?:Brand|Neutral|Status)[A-Za-z0-9]*|explorer[A-Za-z0-9-]*)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateClassName(value: unknown, label: string, pluginClasses: Set<string>) {
  if (value === undefined) return;
  if (typeof value !== 'string' || value.length > 512) {
    throw new Error(`${label} must contain up to eight plugin-* class names`);
  }
  const classes = value.trim().split(/\s+/);
  if (
    classes.length > 8
    || classes.some((name) => !CLASS_NAME_PATTERN.test(name))
    || new Set(classes).size !== classes.length
  ) {
    throw new Error(`${label} must contain up to eight unique plugin-* class names`);
  }
  for (const name of classes) pluginClasses.add(name);
}

function validateCssValue(property: string, value: unknown, label: string): asserts value is string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 256
    || value !== value.trim()
    || !VALUE_CHARACTERS.test(value)
    || (property !== 'grid-column' && value.includes('/'))
  ) {
    throw new Error(`${label} contains an unsupported CSS value`);
  }

  let depth = 0;
  for (const char of value) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (depth < 0) throw new Error(`${label} contains an invalid CSS value`);
  }
  if (depth !== 0) throw new Error(`${label} contains an invalid CSS value`);

  for (const match of value.matchAll(/([a-z-]+)\s*\(/gi)) {
    if (!SAFE_FUNCTIONS.has(match[1].toLowerCase())) {
      throw new Error(`${label} uses a disallowed CSS function`);
    }
  }

  for (const match of value.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)/g)) {
    if (!HOST_THEME_VARIABLE.test(match[1])) {
      throw new Error(`${label} references a disallowed theme variable`);
    }
  }

  const enumValues: Record<string, string[]> = {
    'align-items': ['baseline', 'center', 'end', 'flex-end', 'flex-start', 'normal', 'start', 'stretch'],
    'box-sizing': ['border-box', 'content-box'],
    display: ['block', 'flex', 'grid', 'inline', 'inline-flex', 'inline-grid'],
    'flex-direction': ['column', 'column-reverse', 'row', 'row-reverse'],
    'flex-wrap': ['nowrap', 'wrap', 'wrap-reverse'],
    'font-style': ['italic', 'normal', 'oblique'],
    'font-weight': ['bold', 'normal', '100', '200', '300', '400', '500', '600', '700', '800', '900'],
    'grid-auto-flow': ['column', 'column dense', 'dense', 'row', 'row dense'],
    'justify-content': ['center', 'end', 'flex-end', 'flex-start', 'left', 'normal', 'right', 'space-around', 'space-between', 'space-evenly', 'start', 'stretch'],
    'outline-style': ['dashed', 'dotted', 'double', 'groove', 'none', 'solid'],
    overflow: ['auto', 'scroll', 'visible'],
    'overflow-x': ['auto', 'scroll', 'visible'],
    'overflow-y': ['auto', 'scroll', 'visible'],
    resize: ['both', 'horizontal', 'none', 'vertical'],
    'text-align': ['center', 'end', 'justify', 'left', 'right', 'start'],
    'text-decoration': ['line-through', 'none', 'overline', 'underline'],
    'text-overflow': ['clip', 'ellipsis'],
    'white-space': ['break-spaces', 'normal', 'nowrap', 'pre-line', 'pre-wrap'],
  };
  if (enumValues[property] && !enumValues[property].includes(value.toLowerCase())) {
    throw new Error(`${label} has an unsupported value for ${property}`);
  }
  if (property === 'display' && value.toLowerCase() === 'none') {
    throw new Error(`${label} cannot hide page content`);
  }
  if (property === 'grid-column' && !/^(?:auto|-?\d+|span \d+)(?:\s*\/\s*(?:auto|-?\d+|span \d+))?$/i.test(value)) {
    throw new Error(`${label} has an unsupported grid-column value`);
  }
}

function validateRules(page: DeclarativePage, pluginClasses: Set<string>, cssSourceBytes: number) {
  const rules = page.styles ?? [];
  if (!Array.isArray(rules) || rules.length > MAX_STYLE_RULES) {
    throw new Error(`Extension page styles must contain at most ${MAX_STYLE_RULES} rules`);
  }
  if (new TextEncoder().encode(JSON.stringify(rules)).length + cssSourceBytes > MAX_STYLES_BYTES) {
    throw new Error('Extension page styles exceed the 16 KiB limit');
  }

  return rules.map((rule, index): DeclarativeStyleRule => {
    const label = `Extension page styles[${index}]`;
    if (!isRecord(rule) || typeof rule.selector !== 'string' || !SELECTOR_PATTERN.test(rule.selector)) {
      throw new Error(`${label} has an unsupported selector`);
    }
    if (rule.selector.length > 256) throw new Error(`${label} selector is too long`);
    const selectorClasses = [...rule.selector.matchAll(/\.([a-z][a-z0-9_-]{0,63})/g)].map((match) => match[1]);
    for (const className of selectorClasses) {
      if (!HOST_STYLE_CLASSES.has(className) && !pluginClasses.has(className)) {
        throw new Error(`${label} refers to an undeclared class: ${className}`);
      }
    }

    if (
      rule.media !== undefined
      && (typeof rule.media !== 'string' || !MEDIA_PATTERN.test(rule.media)
        || Number(rule.media.match(/\d+(?:\.\d+)?/)?.[0] ?? 0) > 4096)
    ) {
      throw new Error(`${label} has an unsupported media condition`);
    }
    if (!isRecord(rule.declarations)) throw new Error(`${label}.declarations must be an object`);
    const rawDeclarations = Object.entries(rule.declarations);
    if (rawDeclarations.length === 0 || rawDeclarations.length > MAX_STYLE_DECLARATIONS) {
      throw new Error(`${label} must contain between 1 and ${MAX_STYLE_DECLARATIONS} declarations`);
    }

    const declarations: Record<string, string> = {};
    for (const [property, value] of rawDeclarations) {
      if (!STYLE_PROPERTIES.has(property)) {
        throw new Error(`${label} uses a disallowed CSS property: ${property}`);
      }
      validateCssValue(property, value, `${label}.${property}`);
      declarations[property] = value;
    }
    return {
      selector: rule.selector,
      ...(typeof rule.media === 'string' ? { media: rule.media } : {}),
      declarations,
    };
  });
}

function parseCssBlock(css: string): DeclarativeStyleRule[] {
  const label = 'Extension CSS block';
  if (typeof css !== 'string' || css.length === 0) {
    throw new Error(`${label} must contain CSS text`);
  }
  if (new TextEncoder().encode(css).length > MAX_STYLES_BYTES) {
    throw new Error(`${label} exceeds the 16 KiB limit`);
  }
  if (css.includes('/*') || css.includes('*/')) {
    throw new Error(`${label} does not allow comments`);
  }

  const rules: DeclarativeStyleRule[] = [];
  let cursor = 0;

  function parseRules(media?: string): void {
    while (cursor < css.length) {
      while (/\s/.test(css[cursor] ?? '')) cursor += 1;
      if (css[cursor] === '}') {
        if (!media) throw new Error(`${label} contains an unexpected closing brace`);
        cursor += 1;
        return;
      }
      if (cursor >= css.length) break;

      const open = css.indexOf('{', cursor);
      if (open < 0) throw new Error(`${label} contains an incomplete rule`);
      const header = css.slice(cursor, open).trim();
      cursor = open + 1;

      if (header.startsWith('@media')) {
        const match = /^@media\s+(\((?:max|min)-width:\s*\d{1,4}(?:\.\d{1,2})?(?:px|rem|em)\))$/.exec(header);
        if (!match || media || Number(match[1].match(/\d+(?:\.\d+)?/)?.[0] ?? 0) > 4096) {
          throw new Error(`${label} has an unsupported media rule`);
        }
        parseRules(match[1]);
        continue;
      }

      const close = css.indexOf('}', cursor);
      const nestedOpen = css.indexOf('{', cursor);
      if (close < 0 || (nestedOpen >= 0 && nestedOpen < close)) {
        throw new Error(`${label} contains an invalid declaration block`);
      }
      const declarations: Record<string, string> = {};
      for (const declaration of css.slice(cursor, close).split(';')) {
        const trimmed = declaration.trim();
        if (!trimmed) continue;
        const colon = trimmed.indexOf(':');
        if (colon < 1) throw new Error(`${label} contains an invalid declaration`);
        const property = trimmed.slice(0, colon).trim();
        const value = trimmed.slice(colon + 1).trim();
        if (!STYLE_PROPERTIES.has(property)) {
          throw new Error(`${label} uses a disallowed CSS property: ${property}`);
        }
        if (Object.prototype.hasOwnProperty.call(declarations, property)) {
          throw new Error(`${label} contains a duplicate CSS property`);
        }
        declarations[property] = value;
      }
      rules.push({
        selector: header,
        ...(media ? { media } : {}),
        declarations,
      });
      if (rules.length > MAX_STYLE_RULES) {
        throw new Error(`Extension page styles must contain at most ${MAX_STYLE_RULES} rules`);
      }
      cursor = close + 1;
    }

    if (media) throw new Error(`${label} contains an unclosed media rule`);
  }

  parseRules();
  if (rules.length === 0) throw new Error(`${label} must contain at least one style rule`);
  return rules;
}

export function createExtensionStylesheet(page: DeclarativePage, scopeId: string): string {
  if (!Array.isArray(page.blocks)) throw new Error('Extension page blocks must be an array');
  if (!/^extension-[a-zA-Z0-9_-]{1,128}$/.test(scopeId)) {
    throw new Error('Invalid extension style scope');
  }

  const pluginClasses = new Set<string>();
  validateClassName(page.class_name, 'Extension page class_name', pluginClasses);
  for (const [index, block] of page.blocks.entries()) {
    if (!isRecord(block)) continue;
    if (block.type !== 'css') {
      validateClassName(block.class_name, `Extension page blocks[${index}].class_name`, pluginClasses);
    }
    if (block.type === 'form' && Array.isArray(block.fields)) {
      for (const [fieldIndex, field] of block.fields.entries()) {
        if (isRecord(field)) {
          validateClassName(
            field.class_name,
            `Extension page blocks[${index}].fields[${fieldIndex}].class_name`,
            pluginClasses,
          );
        }
      }
    }
    if (block.type === 'actions' && Array.isArray(block.actions)) {
      for (const [actionIndex, action] of block.actions.entries()) {
        if (isRecord(action)) {
          validateClassName(
            action.class_name,
            `Extension page blocks[${index}].actions[${actionIndex}].class_name`,
            pluginClasses,
          );
        }
      }
    }
  }

  const cssBlocks = page.blocks.filter((block) => block.type === 'css');
  const cssSourceBytes = cssBlocks.reduce(
    (total, block) => total + new TextEncoder().encode(block.css).length,
    0,
  );
  if (page.styles !== undefined && !Array.isArray(page.styles)) {
    throw new Error(`Extension page styles must contain at most ${MAX_STYLE_RULES} rules`);
  }
  const rules = validateRules({
    ...page,
    styles: [
      ...(page.styles ?? []),
      ...cssBlocks.flatMap((block) => parseCssBlock(block.css)),
    ],
  }, pluginClasses, cssSourceBytes);
  return rules
    .map((rule) => {
      const declarations = Object.entries(rule.declarations)
        .map(([property, value]) => `${property}:${value}`)
        .join(';');
      const scope = `[data-extension-style-scope="${scopeId}"]`;
      const scopedRule = `${scope}${rule.selector},${scope} ${rule.selector}{${declarations}}`;
      return rule.media ? `@media ${rule.media}{${scopedRule}}` : scopedRule;
    })
    .join('\n');
}
