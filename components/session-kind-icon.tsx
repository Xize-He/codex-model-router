import { Bot, CodeXml, Workflow } from 'lucide-react';
import { sessionKindLabels } from '@/lib/session-kind.mjs';

const icons = { 'gpt-codex': Bot, 'deepseek-codex': CodeXml, 'deepseek-harness': Workflow };

export function SessionKindIcon({ kind, className = '' }: {
  kind: keyof typeof sessionKindLabels;
  className?: string;
}) {
  const Icon = icons[kind];
  const label = sessionKindLabels[kind];
  return <span className={`session-kind-icon ${className}`} role="img" aria-label={label} title={label}>
    <Icon size={16} strokeWidth={1.6} aria-hidden="true" />
  </span>;
}
