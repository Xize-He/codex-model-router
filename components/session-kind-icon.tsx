import { sessionKindLabels } from '@/lib/session-kind.mjs';

const brands = { 'gpt-codex': 'openai', 'deepseek-harness': 'deepseek' };

export function SessionKindIcon({ kind, className = '' }: {
  kind: keyof typeof sessionKindLabels;
  className?: string;
}) {
  const brand = brands[kind];
  const label = sessionKindLabels[kind];
  return <span className={`session-kind-icon ${className}`} data-brand={brand} role="img" aria-label={label} title={label}>
    <img src={`/brands/${brand}.svg`} width={16} height={16} alt="" aria-hidden="true" />
  </span>;
}
