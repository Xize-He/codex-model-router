import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function DeepseekSettings({ configured, checkedAt, disabled, harness }: { configured: boolean; checkedAt?: number | null; disabled: boolean; harness?: { installed: boolean; version: string | null } }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function connect(checkOnly = false) {
    setBusy(true); setMessage('');
    try {
      const state = await fetch('/api/state').then(r => r.json()) as { csrf: string };
      const response = await fetch('/api/providers/deepseek', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Router-Token': state.csrf },
        body: JSON.stringify(checkOnly ? { checkOnly: true } : { apiKey: key }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || '连接失败');
      setKey(''); setMessage('模型接口检测通过');
    } catch (error) { setMessage(error instanceof Error ? error.message : '连接失败'); }
    finally { setBusy(false); }
  }
  return <section><details className="inspector-details">
    <summary className="inspector-section-summary"><span className="inspector-section-title">DeepSeek</span><ChevronRight className="inspector-section-chevron" size={14} /></summary>
    <div className="inspector-section-content">
      <p>{configured ? (checkedAt ? '已配置 · 检测通过' : '已配置 · 尚未检测') : '尚未配置'}</p>
      <Input type="password" aria-label="DeepSeek API Key" placeholder="DeepSeek API Key" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} disabled={busy || disabled} />
      <div className="deepseek-settings-actions">
        <Button variant="outline" disabled={busy || disabled || !key.trim()} onClick={() => connect()}>{busy ? '检测中…' : '连接'}</Button>
        <Button variant="ghost" disabled={busy || disabled || !configured} onClick={() => connect(true)}>重新检测</Button>
      </div>
      {message && <p role="status">{message}</p>}
      <p className="muted">密钥仅保留到服务关闭。长期使用可设置本机环境变量 DEEPSEEK_API_KEY。使用 DeepSeek API 独立计费。</p>
      <p>Harness · {harness?.installed ? '已安装' : '未安装'}</p>
      {!harness?.installed && <p className="muted">在项目目录执行 <code>npm run harness:install</code>，完成后刷新页面。</p>}
      <p className="muted">新建对话，选择 DeepSeek V4.1 Flash · Harness。使用 Harness 的工具、会话与上下文管理；额外权限由你确认。已有 Codex 会话继续使用原引擎。</p>
    </div>
  </details></section>;
}
