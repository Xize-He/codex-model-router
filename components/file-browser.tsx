'use client';
import { useEffect, useRef, useState } from 'react';
import { ChevronRight, FileText, Folder, RefreshCw, X } from 'lucide-react';
type Entry = { name: string; path: string; directory: boolean };
export function FileBrowser({ sessionId, cwd, requestedPath }: { sessionId?: string; cwd?: string; requestedPath?: string }) {
  const [tree, setTree] = useState<Record<string, Entry[]>>({});
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [file, setFile] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const generation = useRef(0);
  const previewGeneration = useRef(0);
  const root = cwd || '';
  async function request(route: string, body: object) {
    const state = await fetch('/api/state').then(response => response.json());
    const response = await fetch(`/api/files/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Router-Token': state.csrf }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '读取失败');
    return data;
  }
  async function load(path: string) {
    const current = generation.current;
    try {
      const data = await request('list', { sessionId, path });
      if (current !== generation.current) return;
      setTree(previous => ({ ...previous, [path]: data.entries })); setError('');
    } catch (e) { if (current === generation.current) setError((e as Error).message); }
  }
  async function preview(path: string) {
    const current = ++previewGeneration.current;
    setFile(path); setContent('正在读取…');
    try {
      const data = await request('read', { path });
      if (current === previewGeneration.current) setContent(data.text);
    } catch (e) { if (current === previewGeneration.current) setContent((e as Error).message); }
  }
  useEffect(() => {
    generation.current++; setTree({}); setOpened({}); setFile(''); setError('');
    void load(root);
    return () => { generation.current++; previewGeneration.current++; };
  }, [sessionId, root]);
  useEffect(() => { if (requestedPath) void preview(requestedPath); }, [requestedPath, sessionId]);
  function rows(path: string, depth = 0): React.ReactNode {
    return tree[path]?.map(entry => <div key={entry.path}>
      <button className="file-browser-row" style={{ paddingLeft: 8 + depth * 14 }} title={entry.path} aria-expanded={entry.directory ? !!opened[entry.path] : undefined} onClick={() => {
        if (!entry.directory) { void preview(entry.path); return; }
        setOpened(previous => ({ ...previous, [entry.path]: !previous[entry.path] }));
        if (!tree[entry.path]) void load(entry.path);
      }}>
        {entry.directory ? <><ChevronRight size={12} style={{ transform: opened[entry.path] ? 'rotate(90deg)' : undefined }} /><Folder size={15} /></> : <FileText size={15} />}
        <span>{entry.name}</span>
      </button>
      {entry.directory && opened[entry.path] && rows(entry.path, depth + 1)}
    </div>);
  }
  return <div className="file-browser">
    <header><span title={root}>{root.split(/[\\/]/).filter(Boolean).at(-1) || '工作目录'}</span><button aria-label="刷新文件" onClick={() => { setTree({}); setOpened({}); void load(root); }}><RefreshCw size={15} /></button></header>
    {error && <p role="alert">{error}</p>}
    <div className="file-browser-tree">{rows(root)}{tree[root]?.length === 0 && <p>目录为空</p>}</div>
    {file && <div className="file-browser-preview"><header><span title={file}>{file.split(/[\\/]/).at(-1)}</span><button aria-label="关闭文件预览" onClick={() => setFile('')}><X size={15} /></button></header><pre>{content}</pre></div>}
  </div>;
}
