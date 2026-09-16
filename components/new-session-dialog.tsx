import { useState } from 'react';
import { Check, LoaderCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { sessionKindLabels } from '@/lib/session-kind.mjs';

export type SessionKind = keyof typeof sessionKindLabels;
const descriptions: Record<SessionKind, string> = {
  'gpt-codex': 'Codex 模型 · 支持 Auto 路由',
  'deepseek-codex': 'DeepSeek 模型 · Codex 工具与上下文',
  'deepseek-harness': 'DeepSeek 模型 · Harness 工具与上下文',
};
export function NewSessionDialog({ cwd, onClose, onCreate }: {
  cwd: string | null;
  onClose: () => void;
  onCreate: (kind: SessionKind) => Promise<void>;
}) {
  const [creating, setCreating] = useState<SessionKind | null>(null);
  const [error, setError] = useState('');
  async function create(kind: SessionKind) {
    if (creating) return;
    setCreating(kind); setError('');
    try { await onCreate(kind); }
    catch (error) { setError(error instanceof Error ? error.message : '创建失败，请重试'); }
    finally { setCreating(null); }
  }
  return <Dialog open={cwd !== null} onOpenChange={open => { if (!open && !creating) { setError(''); onClose(); } }}>
    <DialogContent className="new-session-dialog">
      <DialogHeader>
        <DialogTitle>新建对话</DialogTitle>
        <DialogDescription>{cwd ? `在 ${cwd.replace(/\\/g, '/').split('/').filter(Boolean).at(-1)} 中选择会话类型` : '选择会话类型'}</DialogDescription>
      </DialogHeader>
      <div className="session-kind-options">
        {(Object.keys(sessionKindLabels) as SessionKind[]).map(kind => <button type="button" key={kind} disabled={!!creating} onClick={() => void create(kind)}>
          <span><strong>{sessionKindLabels[kind]}</strong><small>{descriptions[kind]}</small></span>
          {creating === kind ? <LoaderCircle className="spin" size={17} /> : <Check className="session-kind-check" size={17} />}
        </button>)}
      </div>
      {error && <p role="alert" className="inline-error">{error}</p>}
    </DialogContent>
  </Dialog>;
}
