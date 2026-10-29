import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);

test('web search chrome lets results receive pointer input while its field remains interactive', async () => {
  const bundle = await build({
    bundle: true, write: false, platform: 'node', format: 'cjs',
    alias: { 'react-native': 'react-native-web' },
    plugins: [{ name: 'desktop-platform', setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/platform$/ }, () => ({ path: 'platform', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const DESKTOP_OS = "darwin";' }));
    } }],
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { View, StyleSheet } from 'react-native';
      import { SearchTransition } from './src/components/search/SearchTransition';
      const html = renderToStaticMarkup(<SearchTransition active
        activeContent={<View testID="search-results" />}
        activeChrome={<View testID="search-field" />}
        onActivate={() => {}} onCancel={() => {}}>
        <View testID="resting-list" />
      </SearchTransition>);
      module.exports = { html, css: StyleSheet.getSheet().textContent };
    ` },
  });
  const output = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, output, output.exports);
  const { html } = output.exports;
  const css = output.exports.css.replace(/\s+/g, '');
  const parent = html.match(/<div([^>]*)><div[^>]*data-testid="search-field"/);
  assert.ok(parent, 'search field must be mounted in its chrome wrapper');
  const classes = parent[1].match(/class="([^"]*)"/)?.[1].split(' ') ?? [];
  assert.ok(classes.some(name => css.includes(`.${name}{pointer-events:none!important;}`)
    && css.includes(`.${name}>*{pointer-events:auto;}`)),
  'chrome must compile box-none into a noninteractive parent and interactive children');
});
