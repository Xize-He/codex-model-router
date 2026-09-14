import { useState } from 'react';
import { SquarePlus, Undo2, ScanText, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription } from '@/components/ui/alert-dialog';

export type ChangedFile = { path: string; kind: string; movePath?: string | null; diffs: string[] };
export type UndoState = { status: string; reason?: string; at?: number };

type DiffStats = { additions: number; deletions: number };

function contentLineCount(value: string) {
  if (!value) return 0;
  const lines = value.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines.length;
}

function getDiffStats(file: ChangedFile): DiffStats {
  return file.diffs.reduce<DiffStats>((total, diff) => {
    const lines = diff.replace(/\r\n/g, '\n').split('\n');
    const unified = lines.some(line => line.startsWith('@@'));
    if (unified) {
      total.additions += lines.filter(line => line.startsWith('+') && !line.startsWith('+++')).length;
      total.deletions += lines.filter(line => line.startsWith('-') && !line.startsWith('---')).length;
    } else if (file.kind === 'add') {
      total.additions += contentLineCount(diff);
    } else if (file.kind === 'delete') {
      total.deletions += contentLineCount(diff);
    }
    return total;
  }, { additions: 0, deletions: 0 });
}

function PathLabel({ path }: { path: string }) {
  const splitAt = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (splitAt < 0) return <span className="changed-file-name">{path}</span>;
  return <><span className="changed-file-directory">{path.slice(0, splitAt + 1)}</span><span className="changed-file-name">{path.slice(splitAt + 1)}</span></>;
}

function FileList({ files, expanded = false }: { files: ChangedFile[]; expanded?: boolean }) {
  return <>{files.map(file => {
    const stats = getDiffStats(file);
    return <details key={file.path} className="changed-file" open={expanded || undefined}>
      <summary><span className="changed-file-path" title={file.path}><PathLabel path={file.path} /></span><span className="changed-file-stats"><span className="diff-count-added">+{stats.additions}</span><span className="diff-count-removed">-{stats.deletions}</span></span></summary>
      {file.movePath && <p className="changed-file-destination">新路径：{file.movePath}</p>}
      {file.diffs.length ? file.diffs.map((diff, index) => <pre key={index} tabIndex={0} aria-label={`${file.path} 修改内容 ${index + 1}`}>{diff.split('\n').map((line, lineIndex) => <span key={lineIndex} className={line.startsWith('+') && !line.startsWith('+++') ? 'diff-added' : line.startsWith('-') && !line.startsWith('---') ? 'diff-removed' : line.startsWith('@@') ? 'diff-location' : undefined}>{line}{'\n'}</span>)}</pre>) : <p>该操作未返回修改内容。</p>}
    </details>;
  })}</>;
}

export function ChangedFiles({ files, undo, onUndo, running }: { files?: ChangedFile[]; undo?: UndoState; onUndo?: () => Promise<void>; running?: boolean }) {
  const [reviewing, setReviewing] = useState(false), [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [undone, setUndone] = useState(false);
  if (!files?.length) return null;
  const isUndone = undone || undo?.status === 'undone';
  const totalStats = files.reduce<DiffStats>((total, file) => {
    const stats = getDiffStats(file);
    total.additions += stats.additions;
    total.deletions += stats.deletions;
    return total;
  }, { additions: 0, deletions: 0 });
  const reason = isUndone ? '本轮文件改动已撤销' : running ? '请等当前任务结束后再撤销' : undo?.status === 'available' ? '' : undo?.reason || '旧记录没有完整的撤销快照，仅支持审阅';
  async function performUndo() {
    if (!onUndo || busy) return;
    setBusy(true); setError('');
    try { await onUndo(); setUndone(true); setConfirming(false); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="changed-files" aria-label="本轮修改的文件">
    <div className="changed-files-toolbar"><h3><SquarePlus size={16} /><span className="changed-files-heading-copy"><span>Edited {files.length} {files.length === 1 ? 'file' : 'files'}</span><small><span className="diff-count-added">+{totalStats.additions}</span><span className="diff-count-removed">-{totalStats.deletions}</span></small></span></h3><div className="changed-files-actions">
      <span title={reason || '撤销本轮全部文件改动'}><Button size="sm" variant="outline" disabled={!!reason || !onUndo || busy} onClick={() => { setError(''); setConfirming(true); }}><Undo2 size={15} />{isUndone ? 'Undone' : 'Undo'}</Button></span>
      <Button size="sm" variant="outline" onClick={() => setReviewing(true)}><ScanText size={15} />Review</Button>
    </div></div>
    <FileList files={files} />
    <Dialog open={reviewing} onOpenChange={setReviewing}>
      <DialogContent className="file-review-dialog">
        <DialogTitle>Review · 本轮文件改动</DialogTitle>
        <DialogDescription>{files.length} 个文件 · {isUndone ? '改动已撤销，以下保留原始差异记录' : '查看本轮记录的新增、删除和修改内容'}</DialogDescription>
        <div className="review-file-list"><FileList files={files} expanded /></div>
      </DialogContent>
    </Dialog>
    <AlertDialog open={confirming} onOpenChange={open => { if (!busy) setConfirming(open); }}>
      <AlertDialogContent className="file-undo-dialog">
        <AlertDialogTitle>撤销本轮文件改动？</AlertDialogTitle>
        <AlertDialogDescription>将恢复本轮修改或删除的文件，并移除本轮新增的文件。对话记录会保留；如文件已有后续改动，会停止撤销并提示。</AlertDialogDescription>
        <ul className="undo-file-list">{files.map(file => <li key={file.path}>{file.path}</li>)}</ul>
        {error && <p className="undo-error" role="alert">{error}</p>}
        <div className="changed-files-actions"><Button variant="outline" disabled={busy} onClick={() => setConfirming(false)}>取消</Button><Button disabled={busy || running} onClick={performUndo}>{busy ? <LoaderCircle size={15} className="spin" /> : <Undo2 size={15} />}{busy ? '正在撤销…' : '确认撤销本轮'}</Button></div>
      </AlertDialogContent>
    </AlertDialog>
  </section>;
}
