import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Transpile the real component for Node, omitting only the CSS import.
const source = readFileSync(new URL('../components/markdown-answer.tsx', import.meta.url), 'utf8').replace("import './markdown-answer.css';", '');
const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exports = {};
new Function('require', 'exports', compiled)(createRequire(import.meta.url), exports);
const render = text => renderToStaticMarkup(createElement(exports.MarkdownAnswer, { text }));
test('answers render headings, lists, GFM tables, highlighted code and copy controls', () => {
  const html = render('# 标题\n\n- **重点**\n\n| 模型 | 用途 |\n| --- | --- |\n| Luna | 翻译 |\n\n```js\nconst x = 1;\n```\n\n> 引用');
  for (const tag of ['<h1>', '<ul>', '<strong>', '<table>', '<blockquote>', 'hljs-keyword', '复制代码', '复制回复']) assert.ok(html.includes(tag), tag);
  assert.ok(render('```python\nprint("未完成代码块")').includes('未完成代码块'));
  assert.ok(!renderToStaticMarkup(createElement(exports.MarkdownAnswer, { text: '中间回复', showCopy: false })).includes('复制回复'));
});
test('generated HTML and unsafe links cannot execute or load external images', () => {
  const html = render('<script>alert(1)</script>\n\n[危险](javascript:alert%281%29)\n\n![图片](https://example.com/image.png)');
  assert.ok(!html.includes('<script')); assert.ok(!html.includes('href="javascript:')); assert.ok(!html.includes('<img'));
  assert.ok(render('[文档](https://example.com)').includes('rel="noopener noreferrer"'));
});
