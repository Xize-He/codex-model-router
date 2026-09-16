'use client';
import { Children, isValidElement, memo, useState, type ReactNode } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Check, Copy } from 'lucide-react';
import './markdown-answer.css';

function plainText(children: ReactNode): string {
  return Children.toArray(children).map(child => isValidElement<{ children?: ReactNode }>(child)
    ? plainText(child.props.children) : typeof child === 'string' || typeof child === 'number' ? String(child) : '').join('');
}
function CopyButton({ text, label = '复制' }: { text: string; label?: string }) {
  const [status, setStatus] = useState('idle');
  async function copy() {
    try { await navigator.clipboard.writeText(text); setStatus('copied'); }
    catch { setStatus('failed'); }
  }
  return <button type="button" className="answer-copy" onClick={copy} aria-label={label}>
    {status === 'copied' ? <Check size={14} /> : <Copy size={14} />}
    <span role="status">{status === 'copied' ? '已复制' : status === 'failed' ? '复制失败，请重试' : label}</span>
  </button>;
}
function CodeBlock({ children }: { children?: ReactNode }) {
  const code = Children.toArray(children).find(child => isValidElement(child));
  const className = isValidElement<{ className?: string }>(code) ? code.props.className || '' : '';
  const language = /language-([\w+-]+)/.exec(className)?.[1] || 'text';
  return <div className="answer-code"><div className="answer-code-header"><span>{language}</span><CopyButton text={plainText(children)} label="复制代码" /></div><pre tabIndex={0}>{children}</pre></div>;
}
function localFilePath(value: string): string | null {
  let decoded = value;
  try { decoded = decodeURIComponent(value); } catch { /* Keep malformed escapes literal. */ }
  if (/^file:\/\/\//i.test(decoded)) decoded = decoded.replace(/^file:\/\/\//i, '');
  if (/^\/?[a-z]:[\\/]/i.test(decoded)) return decoded.replace(/^\//, '').replace(/:\d+(?::\d+)?$/, '');
  if (decoded.startsWith('/') && !decoded.startsWith('//')) return decoded.replace(/:\d+(?::\d+)?$/, '');
  return null;
}
function AnswerLink({ href, children }: { href?: string; children?: ReactNode }) {
  const file = localFilePath(href || '') || (!href ? localFilePath(plainText(children)) : null);
  const [preview, setPreview] = useState<string | null>(null);
  async function openFile() {
    setPreview('正在读取…');
    try {
      const state = await fetch('/api/state').then(response => response.json());
      const response = await fetch('/api/files/read', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Router-Token': state.csrf },
        body: JSON.stringify({ path: file }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '文件读取失败');
      setPreview(result.text);
    } catch (error) { setPreview((error as Error).message); }
  }
  if (!file) return href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>;
  return <><a href="#local-file" title={file} onClick={event => { event.preventDefault(); void openFile(); }}>{children}</a>
    {preview !== null && <div className="local-file-overlay" onClick={() => setPreview(null)}>
      <section className="local-file-preview" role="dialog" aria-modal="true" aria-label={file} onClick={event => event.stopPropagation()}>
        <header><strong>{file}</strong><button autoFocus type="button" onClick={() => setPreview(null)}>关闭</button></header>
        <pre>{preview}</pre>
      </section>
    </div>}
  </>;
}
const components = {
  pre: CodeBlock,
  table: ({ children }: { children?: ReactNode }) => <div className="answer-table" tabIndex={0} role="region" aria-label="回复表格"><table>{children}</table></div>,
  a: AnswerLink,
  // Avoid automatic requests to image URLs supplied by generated content.
  img: ({ src, alt }: { src?: string | Blob; alt?: string }) => typeof src === 'string' && src ? <a href={src} target="_blank" rel="noopener noreferrer">{alt || '查看图片'}</a> : <span>{alt}</span>,
};
export const MarkdownAnswer = memo(function MarkdownAnswer({ text, showCopy = true, copyText }: { text: string; showCopy?: boolean; copyText?: string }) {
  return <div className="answer-text"><div className="answer-markdown"><Markdown urlTransform={(url) => localFilePath(url) ? url : defaultUrlTransform(url)} remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: false }]]} components={components} skipHtml>{text}</Markdown></div>{showCopy && <div className="answer-actions"><CopyButton text={copyText || text} label="复制回复" /></div>}</div>;
});
