'use client';
import { Children, isValidElement, memo, useState, type ReactNode } from 'react';
import Markdown from 'react-markdown';
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
const components = {
  pre: CodeBlock,
  table: ({ children }: { children?: ReactNode }) => <div className="answer-table" tabIndex={0} role="region" aria-label="回复表格"><table>{children}</table></div>,
  a: ({ href, children }: { href?: string; children?: ReactNode }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
  // Avoid automatic requests to image URLs supplied by generated content.
  img: ({ src, alt }: { src?: string | Blob; alt?: string }) => typeof src === 'string' && src ? <a href={src} target="_blank" rel="noopener noreferrer">{alt || '查看图片'}</a> : <span>{alt}</span>,
};
export const MarkdownAnswer = memo(function MarkdownAnswer({ text, showCopy = true, copyText }: { text: string; showCopy?: boolean; copyText?: string }) {
  return <div className="answer-text"><div className="answer-markdown"><Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: false }]]} components={components} skipHtml>{text}</Markdown></div>{showCopy && <div className="answer-actions"><CopyButton text={copyText || text} label="复制回复" /></div>}</div>;
});
