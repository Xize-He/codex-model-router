'use client';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  ArrowUp,
  Plus,
  Square,
  SlidersHorizontal,
  Network,
  CircleCheck,
  CircleAlert,
  LoaderCircle,
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  Cable,
  ArrowRight,
  RefreshCw,
  Gauge,
  Minimize2,
  Search,
  History,
  Clock3,
  Moon,
  Sun,
  FileText,
  FilePenLine,
  SquareTerminal,
  Wrench,
  Globe2,
  Image as ImageIcon,
  Copy,
  Pencil,
  GitBranch,
  ThumbsUp,
  ThumbsDown,
  MoreHorizontal,
  Archive,
  ArchiveRestore,
  Trash2,
  LockKeyhole,
  Maximize2,
  LogIn,
  LogOut,
  KeyRound,
  ExternalLink,
  PanelLeftClose,
  PanelLeftOpen,
  MessageCirclePlus,
  GitFork,
  GripVertical,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from '@/components/ui/select';
import { MarkdownAnswer } from '@/components/markdown-answer';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ChangedFiles,
  type ChangedFile,
  type UndoState,
} from '@/components/changed-files';
import './theme.css';

type ReasoningOption = { reasoningEffort: string; description?: string };
type Model = {
  model: string;
  displayName: string;
  description?: string;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: ReasoningOption[];
  isDefault?: boolean;
  inputModalities?: string[];
};
type Attachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: 'image' | 'file';
};
type TokenBreakdown = {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
};
type ThreadUsage = {
  total: TokenBreakdown;
  last: TokenBreakdown;
  modelContextWindow: number | null;
};
type Task = {
  undo?: UndoState;
  files?: ChangedFile[];
  id: string;
  turnId?: string;
  turnIds?: string[];
  escalationAvailable?: boolean;
  routeHistory?: {
    from: { level: string; model: string; effort: string; reason: string; confidence?: number };
    to: { level: string; model: string; effort: string };
    reason: string; evidence: string[]; at: number;
  }[];
  native?: boolean;
  prompt: string;
  attachments?: Attachment[];
  status: string;
  route?: {
    model: string;
    effort: string;
    reason: string;
    level: string;
    classifier: string | null;
    confidence?: number;
    taskType?: string;
    escalation?: { targetLevel: string; signals: string[] } | null;
  } | null;
  messages: { id: string; text: string }[];
  events: { label: string; at: number; kind?: string }[];
  usage?: ThreadUsage;
  error?: string | null;
  rating?: 'good' | 'bad';
  startedAt: number;
  endedAt?: number;
};
type Session = {
  id: string;
  archived?: boolean;
  threadId?: string | null;
  native?: boolean;
  source?: string;
  title: string;
  tasks: Task[];
  createdAt: number;
  updatedAt?: number;
  cwd?: string;
  model?: string | null;
  historyLoaded?: boolean;
  historyLoading?: boolean;
  historyError?: string;
  context?: ThreadUsage | null;
  compaction?: { status: string; lastAt?: number | null; error?: string };
  nativeStatus?: { type: string };
  occupied?: boolean;
  occupancyChecking?: boolean;
  occupancyCheckedAt?: number | null;
  occupancyError?: string | null;
  approvalMode?: 'ask' | 'approve-for-me';
};
type Approval = {
  id: string;
  taskId: string;
  kind: string;
  title: string;
  details: unknown;
  questions?: {
    id: string;
    question: string;
    options?: { label: string; description?: string }[];
  }[];
};
type RateWindow = {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
};
type RateLimit = {
  id: string;
  name: string;
  planType?: string | null;
  primary: RateWindow | null;
  secondary: RateWindow | null;
  reached?: string | null;
  credits?: { unlimited?: boolean; balance?: string | number | null } | null;
};
type RouteTier = {
  level: string;
  label: string;
  guidance: string;
  escalationGuidance: string;
  model: string;
  effort: string;
};
type AccountState = {
  loading: boolean;
  authenticated: boolean;
  requiresOpenaiAuth: boolean;
  type: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  email?: string | null;
  planType?: string | null;
  credentialSource?: string | null;
  error?: string | null;
  login?: {
    status: string;
    type: string;
    loginId?: string | null;
    authUrl?: string | null;
    verificationUrl?: string | null;
    userCode?: string | null;
    error?: string | null;
  } | null;
};

type PanelSide = 'left' | 'right';
type InspectorSectionKey = 'usage' | 'mcp' | 'workspace';
type InspectorSections = Record<InspectorSectionKey, boolean>;

const CLOSED_INSPECTOR_SECTIONS: InspectorSections = {
  usage: false,
  mcp: false,
  workspace: false,
};

const PANEL_LIMITS = {
  left: { min: 190, max: 420, fallback: 270 },
  right: { min: 280, max: 520, fallback: 400 },
} as const;

function clampPanelWidth(side: PanelSide, width: number) {
  const limits = PANEL_LIMITS[side];
  return Math.min(limits.max, Math.max(limits.min, width));
}

function storedPanelWidth(side: PanelSide) {
  const fallback = PANEL_LIMITS[side].fallback;
  try {
    if (typeof window === 'undefined') return fallback;
    const saved = Number(localStorage.getItem(`model-router-${side}-panel-width`));
    return Number.isFinite(saved) && saved > 0
      ? clampPanelWidth(side, saved)
      : fallback;
  } catch {
    return fallback;
  }
}

function storedInspectorSections(): InspectorSections {
  try {
    if (typeof window === 'undefined') return { ...CLOSED_INSPECTOR_SECTIONS };
    const saved = JSON.parse(localStorage.getItem('model-router-inspector-sections') || '{}');
    return Object.fromEntries(
      Object.keys(CLOSED_INSPECTOR_SECTIONS).map((key) => [key, saved[key] === true]),
    ) as InspectorSections;
  } catch {
    return { ...CLOSED_INSPECTOR_SECTIONS };
  }
}
type State = {
  csrf?: string;
  status: string;
  error?: string;
  activeId?: string;
  cwd: string;
  models: Model[];
  sessions: Session[];
  approvals: Approval[];
  account: AccountState;
  history: {
    loading: boolean;
    archivedLoading?: boolean;
    archivedLoaded?: boolean;
    occupancyLoading?: boolean;
    occupancyLastCheckedAt?: number | null;
    error?: string | null;
    lastSyncedAt?: number | null;
    truncated?: boolean;
  };
  usage: {
    loading: boolean;
    error?: string | null;
    limits: RateLimit[];
    resetCredits?: number | null;
    updatedAt?: number | null;
  };
  mcpServers: {
    name: string;
    connected: boolean;
    enabled: boolean;
  }[];
  config: {
    classifier: string;
    classifierEffort?: string;
    routes: Record<string, { model: string; effort: string }>;
    routeLabels?: Record<string, string>;
    routeGuidance?: Record<string, string>;
    routeEscalationGuidance?: Record<string, string>;
  };
};
const statusText: Record<string, string> = {
  classifying: '正在判断难度',
  escalating: '正在交接升档',
  starting: '正在准备',
  running: '执行中',
  waiting: '等待你的操作',
  stopping: '正在停止',
  interrupted: '已停止',
  completed: '已完成',
  failed: '执行失败',
};
const levelText: Record<string, string> = {
  instant: '极速任务',
  light: '轻量任务',
  focused: '小型开发',
  standard: '常规开发',
  agentic: '多步执行',
  advanced: '困难任务',
  expert: '专家任务',
  extreme: '极难任务',
  native: '原生会话',
};
const accountTypeText: Record<string, string> = {
  chatgpt: 'ChatGPT',
  apiKey: 'API Key',
  apikey: 'API Key',
  amazonBedrock: 'Amazon Bedrock',
  external: '外部凭据',
  personalAccessToken: '访问令牌',
  agentIdentity: 'Agent Identity',
};
const shortModel = (m = '') => m.replace('gpt-', 'GPT-');
const accountInitial = (name?: string | null) =>
  Array.from((name || 'C').trim())[0]?.toUpperCase() || 'C';
const isFinished = (s: string) =>
  ['completed', 'failed', 'interrupted'].includes(s);
const workedFor = (startedAt: number, endedAt?: number) => {
  const totalSeconds = Math.max(
    1,
    Math.round(((endedAt || startedAt) - startedAt) / 1000),
  );
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [
    hours ? `${hours}h` : '',
    minutes ? `${minutes}m` : '',
    seconds || (!hours && !minutes) ? `${seconds}s` : '',
  ]
    .filter(Boolean)
    .join(' ');
};
type ActivityKind = 'file' | 'command' | 'tool' | 'web' | 'image' | 'other';
type TaskEvent = Task['events'][number];
const activityKind = (event: TaskEvent): ActivityKind => {
  const value = `${event.kind || ''} ${event.label}`.toLowerCase();
  if (/filechange|edited|reverted|文件|撤销/.test(value)) return 'file';
  if (/dynamictoolcall|mcptoolcall|toolsearch|loaded tool|mcp/.test(value))
    return 'tool';
  if (/commandexecution|ran command|命令/.test(value)) return 'command';
  if (/websearch|searched the web/.test(value)) return 'web';
  if (/imageview|viewed image/.test(value)) return 'image';
  return 'other';
};
const activitySummary = (events: TaskEvent[]) => {
  const kinds = new Set(events.map(activityKind));
  const actions = [
    ['file', 'edited files'],
    ['tool', 'loaded a tool'],
    ['command', 'ran commands'],
    ['web', 'searched the web'],
    ['image', 'viewed an image'],
  ]
    .filter(([kind]) => kinds.has(kind as ActivityKind))
    .map(([, label]) => label);
  if (!actions.length) return '';
  const summary = actions.join(', ');
  return summary[0].toUpperCase() + summary.slice(1);
};
function ActivityIcon({ kind }: { kind: ActivityKind }) {
  if (kind === 'file') return <FilePenLine size={14} />;
  if (kind === 'command') return <SquareTerminal size={14} />;
  if (kind === 'tool') return <Wrench size={14} />;
  if (kind === 'web') return <Globe2 size={14} />;
  if (kind === 'image') return <ImageIcon size={14} />;
  return <Clock3 size={14} />;
}
function WorkSummary({ task }: { task: Task }) {
  const finished = isFinished(task.status);
  const [now, setNow] = useState(task.startedAt);
  useEffect(() => {
    if (finished) return;
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [finished, task.id, task.startedAt]);
  const duration = workedFor(
    task.startedAt,
    finished ? task.endedAt || task.events.at(-1)?.at : now,
  );
  const summary = activitySummary(task.events);
  const heading = (
    <>
      <span className="activity-summary-copy">
        <strong>Worked for {duration}</strong>
        {summary && <small>{summary}</small>}
      </span>
    </>
  );
  if (!task.events.length)
    return <div className="activity activity-static">{heading}</div>;
  return (
    <details className="activity">
      <summary>
        {heading}
        <ChevronRight className="activity-chevron" size={14} />
      </summary>
      <div className="activity-events">
        {task.events.map((event, index) => {
          const kind = activityKind(event);
          return (
            <div className="activity-event" key={index}>
              <span className={`activity-event-icon ${kind}`}>
                <ActivityIcon kind={kind} />
              </span>
              <span className="activity-event-copy">
                <span>{event.label}</span>
                <time>{new Date(event.at).toLocaleTimeString()}</time>
              </span>
            </div>
          );
        })}
      </div>
    </details>
  );
}
const number = (value = 0) =>
  new Intl.NumberFormat('zh-CN', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
const remaining = (window?: RateWindow | null) =>
  Math.max(0, 100 - (window?.usedPercent || 0));
const resetText = (timestamp?: number | null) =>
  timestamp
    ? new Date(timestamp * 1000).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '时间未知';

const attachmentSize = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function AttachmentList({
  items,
  onRemove,
}: {
  items: Attachment[];
  onRemove?: (id: string) => void;
}) {
  if (!items.length) return null;
  return (
    <div className={`attachment-list ${onRemove ? 'attachment-draft' : ''}`}>
      {items.map((item) => (
        <div className="attachment-item" key={item.id}>
          {item.kind === 'image' ? (
            // Local attachment previews do not need a framework image optimizer.
            // eslint-disable-next-line next/no-img-element
            <img
              src={`/api/attachments/${item.id}`}
              alt={item.name}
              loading="lazy"
            />
          ) : (
            <span className="attachment-file-icon">
              <FileText size={18} />
            </span>
          )}
          <a
            href={`/api/attachments/${item.id}`}
            target="_blank"
            rel="noreferrer"
            title={item.name}
          >
            <span>{item.name}</span>
            <small>{attachmentSize(item.size)}</small>
          </a>
          {onRemove && (
            <button
              type="button"
              aria-label={`移除 ${item.name}`}
              onClick={() => onRemove(item.id)}
            >
              <X size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function RoutingModelSelect({
  models,
  model,
  effort,
  label,
  disabled,
  onChange,
}: {
  models: Model[];
  model: string;
  effort: string;
  label: string;
  disabled?: boolean;
  onChange: (model: string, effort: string) => void;
}) {
  const selectedModel = models.find((item) => item.model === model);
  return (
    <Select
      value={`${model}::${effort}`}
      disabled={disabled}
      onValueChange={(value) => {
        if (!value) return;
        const [nextModel, nextEffort] = value.split('::');
        onChange(nextModel, nextEffort);
      }}
    >
      <SelectTrigger
        className="composer-select-trigger routing-config-trigger"
        aria-label={label}
        onClick={(event) => event.stopPropagation()}
      >
        <span className="composer-select-value">
          {selectedModel?.displayName || shortModel(model)} · {effort}
        </span>
      </SelectTrigger>
      <SelectContent
        className="composer-select-content routing-config-content"
        side="bottom"
        align="end"
        alignItemWithTrigger={false}
      >
        {models.map((item) => {
          const efforts = [...new Set([
            item.defaultReasoningEffort,
            ...item.supportedReasoningEfforts.map((option) => option.reasoningEffort),
          ].filter(Boolean))];
          return (
            <SelectGroup key={item.model}>
              <SelectLabel>{item.displayName}</SelectLabel>
              {efforts.map((reasoningEffort) => (
                <SelectItem
                  className="composer-select-item"
                  key={reasoningEffort}
                  value={`${item.model}::${reasoningEffort}`}
                >
                  {item.displayName} · {reasoningEffort}
                </SelectItem>
              ))}
            </SelectGroup>
          );
        })}
      </SelectContent>
    </Select>
  );
}

export default function Home() {
  const [state, setState] = useState<State | null>(null),
    [selected, setSelected] = useState(''),
    [draft, setDraft] = useState(''),
    [model, setModel] = useState('auto'),
    [effort, setEffort] = useState('auto'),
    [approvalMode, setApprovalMode] = useState<'ask' | 'approve-for-me'>(
      'approve-for-me',
    );
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [dragActive, setDragActive] = useState(false),
    [attachments, setAttachments] = useState<Attachment[]>([]),
    [settings, setSettings] = useState(false),
    [inspectorSections, setInspectorSections] = useState(storedInspectorSections),
    [online, setOnline] = useState(false),
    [historySearch, setHistorySearch] = useState(''),
    [historySearchOpen, setHistorySearchOpen] = useState(false),
    [opening, setOpening] = useState(''),
    [copiedTask, setCopiedTask] = useState(''),
    [ratingTask, setRatingTask] = useState(''),
    [replyActionBusy, setReplyActionBusy] = useState(''),
    [sessionView, setSessionView] = useState<'active' | 'archived'>('active'),
    [sessionMenu, setSessionMenu] = useState(''),
    [sessionActionBusy, setSessionActionBusy] = useState(''),
    [renameTarget, setRenameTarget] = useState<Session | null>(null),
    [renameTitle, setRenameTitle] = useState(''),
    [deleteTarget, setDeleteTarget] = useState<Session | null>(null),
    [accountMenu, setAccountMenu] = useState(false),
    [accountBusy, setAccountBusy] = useState(''),
    [routingBusy, setRoutingBusy] = useState(''),
    [routingOpen, setRoutingOpen] = useState(false),
    [routingError, setRoutingError] = useState(''),
    [routeLabelDrafts, setRouteLabelDrafts] = useState<Record<string, string>>({}),
    [draggedTier, setDraggedTier] = useState(''),
    [dragTarget, setDragTarget] = useState<{ level: string; position: 'before' | 'after' } | null>(null),
    [apiKey, setApiKey] = useState(''),
    [activeTurnIndex, setActiveTurnIndex] = useState(0),
    [hoveredTurnIndex, setHoveredTurnIndex] = useState<number | null>(null),
    [sidebarWidth, setSidebarWidth] = useState(() => storedPanelWidth('left')),
    [inspectorWidth, setInspectorWidth] = useState(() => storedPanelWidth('right')),
    [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
      try {
        return typeof window !== 'undefined' &&
          localStorage.getItem('model-router-sidebar-collapsed') === 'true';
      } catch {
        return false;
      }
    }),
    [conversationMode, setConversationMode] = useState<'flow' | 'cards'>(() => {
      try {
        return typeof window !== 'undefined' &&
          localStorage.getItem('model-router-conversation-mode') === 'cards'
          ? 'cards'
          : 'flow';
      } catch {
        return 'flow';
      }
    }),
    [focusMode, setFocusMode] = useState(() => {
      try {
        return typeof window !== 'undefined' &&
          localStorage.getItem('model-router-focus-mode') === 'true';
      } catch {
        return false;
      }
    });
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return typeof window !== 'undefined' &&
        localStorage.getItem('model-router-theme') === 'dark'
        ? 'dark'
        : 'light';
    } catch {
      return 'light';
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('model-router-theme', theme);
    } catch {
      /* The theme still works when browser storage is unavailable. */
    }
  }, [theme]);
  useEffect(() => {
    try {
      localStorage.setItem('model-router-conversation-mode', conversationMode);
    } catch {
      /* The view choice still works when browser storage is unavailable. */
    }
  }, [conversationMode]);
  useEffect(() => {
    try {
      localStorage.setItem('model-router-focus-mode', String(focusMode));
    } catch {
      /* Focus mode still works when browser storage is unavailable. */
    }
  }, [focusMode]);
  useEffect(() => {
    try {
      localStorage.setItem('model-router-sidebar-collapsed', String(sidebarCollapsed));
    } catch {
      /* Sidebar collapsing still works when browser storage is unavailable. */
    }
  }, [sidebarCollapsed]);
  useEffect(() => {
    try {
      localStorage.setItem('model-router-inspector-sections', JSON.stringify(inspectorSections));
    } catch {
      /* The status sections still work when browser storage is unavailable. */
    }
  }, [inspectorSections]);
  const csrf = useRef(''),
    sessionViewRef = useRef<'active' | 'archived'>('active'),
    fileInput = useRef<HTMLInputElement>(null),
    composerInput = useRef<HTMLTextAreaElement>(null),
    historySearchInput = useRef<HTMLInputElement>(null),
    routingButtonRef = useRef<HTMLButtonElement>(null),
    routingDialogRef = useRef<HTMLDivElement>(null),
    accountMenuRef = useRef<HTMLDivElement>(null),
    conversationRef = useRef<HTMLDivElement>(null),
    workbenchRef = useRef<HTMLDivElement>(null),
    resizeFrameRef = useRef<number | null>(null),
    resizePreviewRef = useRef<{
      element: HTMLDivElement;
      delta: number;
    } | null>(null),
    resizeStartRef = useRef<{
      side: PanelSide;
      clientX: number;
      width: number;
    } | null>(null);
  useEffect(
    () => () => {
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
      }
    },
    [],
  );
  async function post<T = { error?: string; id?: string }>(
    route: string,
    data = {},
  ) {
    const response = await fetch(`/api/${route}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Router-Token': csrf.current,
      },
      body: JSON.stringify(data),
    });
    const result = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(result.error || '请求失败');
    return result;
  }
  useEffect(() => {
    let disposed = false,
      events: EventSource | null = null;
    fetch('/api/state')
      .then((r) => r.json() as Promise<State>)
      .then((s: State) => {
        if (disposed) return;
        csrf.current = s.csrf || '';
        setState(s);
        if (s.status === 'signed-out') setSettings(true);
        setSelected(
          s.sessions.find((item) => !item.archived && !item.native)?.id ||
            s.sessions.find((item) => !item.archived)?.id ||
            '',
        );
        events = new EventSource('/api/events');
        events.onopen = () => {
          setOnline(true);
          setError('');
        };
        events.onmessage = (e) => {
          const next = JSON.parse(e.data) as State;
          setState(next);
          setSelected((current) => {
            const archived = sessionViewRef.current === 'archived';
            if (current && next.sessions.some((item) => item.id === current && Boolean(item.archived) === archived)) return current;
            return next.sessions.find((item) => Boolean(item.archived) === archived)?.id || '';
          });
        };
        events.onerror = () => setOnline(false);
        void post('sessions/occupancy/refresh').catch((error) =>
          setError((error as Error).message),
        );
      })
      .catch(() =>
        setError('无法连接本地服务。请运行“启动工作台.cmd”后刷新。'),
      );
    return () => {
      disposed = true;
      events?.close();
    };
  }, []);
  const session = state?.sessions.find((s) => s.id === selected),
    tasks = session?.tasks || [],
    last = tasks.at(-1);
  const activeTaskIsSelected = Boolean(
    state?.activeId && tasks.some((task) => task.id === state.activeId),
  );
  const visibleSessions = useMemo(
    () =>
      (state?.sessions || []).filter(
        (item) => Boolean(item.archived) === (sessionView === 'archived'),
      ),
    [state?.sessions, sessionView],
  );
  const searchResults = useMemo(() => {
    const query = historySearch.trim().toLocaleLowerCase();
    return [...(state?.sessions || [])]
      .filter((item) => !query || item.title.toLocaleLowerCase().includes(query))
      .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
      .slice(0, 30);
  }, [state?.sessions, historySearch]);
  const activeSessionCount = state?.sessions.filter((item) => !item.archived).length || 0,
    archivedSessionCount = state?.sessions.filter((item) => item.archived).length || 0;
  const primaryLimit =
    state?.usage.limits.find((item) => item.id === 'codex') ||
    state?.usage.limits[0];
  const classifierModel = state?.models.find((item) => item.model === state.config.classifier);
  const classifierEffort = state?.config.classifierEffort || classifierModel?.defaultReasoningEffort || '';
  const routingTiers: RouteTier[] = Object.entries(state?.config.routes || {}).map(([level, route]) => ({
    level,
    label: state?.config.routeLabels?.[level] || levelText[level] || level,
    guidance: state?.config.routeGuidance?.[level] || '',
    escalationGuidance: state?.config.routeEscalationGuidance?.[level] || '',
    model: route.model,
    effort: route.effort,
  }));
  const contextTokens = session?.context?.last?.totalTokens || 0,
    contextWindow = session?.context?.modelContextWindow || 0;
  const contextPercent = contextWindow
    ? Math.min(100, (contextTokens / contextWindow) * 100)
    : 0;
  const rulerEntries = useMemo(() => {
    const entries = tasks.map((task, index) => ({ task, index }));
    const windowSize = 51;
    if (entries.length <= windowSize) return entries;
    const start = Math.max(
      0,
      Math.min(activeTurnIndex - 36, entries.length - windowSize),
    );
    return entries.slice(start, start + windowSize);
  }, [tasks, activeTurnIndex]);
  useEffect(() => {
    const conversation = conversationRef.current;
    if (!conversation || !tasks.length) {
      setActiveTurnIndex(0);
      return;
    }
    const index = tasks.length - 1;
    setActiveTurnIndex(index);
    requestAnimationFrame(() => {
      if (conversationMode === 'cards') {
        conversation.scrollTo({ left: index * conversation.clientWidth, behavior: 'smooth' });
        const turn = conversation.querySelector<HTMLElement>(`[data-turn-index="${index}"]`);
        turn?.scrollTo({ top: turn.scrollHeight, behavior: 'smooth' });
      } else {
        conversation.scrollTo({ top: conversation.scrollHeight, behavior: 'smooth' });
      }
    });
  }, [selected, tasks.length, last?.status, conversationMode]);

  function goToTurn(index: number) {
    const conversation = conversationRef.current;
    if (!conversation || !tasks.length) return;
    const safeIndex = Math.max(0, Math.min(index, tasks.length - 1));
    const turn = conversation.querySelector<HTMLElement>(
      `[data-turn-index="${safeIndex}"]`,
    );
    setActiveTurnIndex(safeIndex);
    if (conversationMode === 'cards') {
      conversation.scrollTo({
        left: safeIndex * conversation.clientWidth,
        behavior: 'smooth',
      });
    } else if (turn) {
      conversation.scrollTo({
        top: Math.max(0, turn.offsetTop - conversation.offsetTop - 24),
        behavior: 'smooth',
      });
    }
  }

  function trackConversationPosition() {
    const conversation = conversationRef.current;
    if (!conversation || !tasks.length) return;
    if (conversationMode === 'cards') {
      const width = Math.max(1, conversation.clientWidth);
      setActiveTurnIndex(
        Math.max(0, Math.min(tasks.length - 1, Math.round(conversation.scrollLeft / width))),
      );
      return;
    }
    const top = conversation.getBoundingClientRect().top + 48;
    let closest = 0;
    conversation.querySelectorAll<HTMLElement>('[data-turn-index]').forEach((turn) => {
      if (turn.getBoundingClientRect().top <= top) {
        closest = Number(turn.dataset.turnIndex || 0);
      }
    });
    setActiveTurnIndex(closest);
  }
  useEffect(() => {
    setApprovalMode('approve-for-me');
  }, [session?.id]);
  useEffect(() => {
    if (!sessionMenu) return;
    const close = () => setSessionMenu('');
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [sessionMenu]);
  useEffect(() => {
    if (!accountMenu) return;
    const closeOutside = (event: PointerEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) setAccountMenu(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAccountMenu(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeWithEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeWithEscape);
    };
  }, [accountMenu]);
  useEffect(() => {
    if (!historySearchOpen) return;
    const focus = window.requestAnimationFrame(() => historySearchInput.current?.focus());
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHistorySearchOpen(false);
    };
    document.addEventListener('keydown', closeWithEscape);
    return () => {
      window.cancelAnimationFrame(focus);
      document.removeEventListener('keydown', closeWithEscape);
    };
  }, [historySearchOpen]);
  useEffect(() => {
    if (
      !session?.native ||
      session.historyLoaded ||
      session.historyLoading ||
      session.historyError ||
      opening === session.id
    )
      return;
    setOpening(session.id);
    post('history/open', { sessionId: session.id })
      .catch((e) => setError((e as Error).message))
      .finally(() => setOpening(''));
  }, [
    session?.id,
    session?.native,
    session?.historyLoaded,
    session?.historyLoading,
    opening,
  ]);
  async function uploadFiles(files: FileList | File[]) {
    const incoming = Array.from(files);
    if (!incoming.length || uploading) return;
    if (attachments.length + incoming.length > 8) {
      setError('每次最多添加 8 个附件');
      return;
    }
    if (incoming.some((file) => file.size > 20 * 1024 * 1024)) {
      setError('单个附件不能超过 20 MB');
      return;
    }
    setUploading(true);
    setError('');
    const uploaded: Attachment[] = [];
    try {
      for (const file of incoming) {
        const response = await fetch(
          `/api/attachments?name=${encodeURIComponent(file.name)}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': file.type || 'application/octet-stream',
              'X-Router-Token': csrf.current,
            },
            body: file,
          },
        );
        const result = (await response.json()) as Attachment & {
          error?: string;
        };
        if (!response.ok) throw new Error(result.error || '附件上传失败');
        uploaded.push(result);
      }
      setAttachments((current) => [...current, ...uploaded]);
    } catch (e) {
      setError((e as Error).message);
      if (uploaded.length)
        setAttachments((current) => [...current, ...uploaded]);
    } finally {
      setUploading(false);
    }
  }
  async function create() {
    setBusy(true);
    try {
      const s = await post<{ id: string }>('sessions');
      sessionViewRef.current = 'active';
      setSessionView('active');
      setSelected(s.id);
      setDraft('');
      setAttachments([]);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    if ((!draft.trim() && !attachments.length) || busy || uploading || state?.activeId || session?.archived)
      return;
    setBusy(true);
    setError('');
    try {
      let id = selected;
      if (!id) {
        const s = await post<{ id: string }>('sessions');
        id = s.id;
        setSelected(id);
      }
      await post('submit', {
        sessionId: id,
        prompt: draft,
        attachments: attachments.map(({ id }) => ({ id })),
        model,
        effort,
        approvalMode,
      });
      setDraft('');
      setAttachments([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function action(route: string, body = {}) {
    try {
      setError('');
      await post(route, body);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function rememberInspectorSection(key: InspectorSectionKey, open: boolean) {
    setInspectorSections((current) => current[key] === open ? current : { ...current, [key]: open });
  }
  async function updateRoutingConfig(
    key: string,
    input: {
      classifier?: string;
      classifierEffort?: string;
      level?: string;
      model?: string;
      effort?: string;
      label?: string;
      guidance?: string;
      escalationGuidance?: string;
      tiers?: RouteTier[];
      routeOrder?: string[];
    },
  ): Promise<boolean> {
    try {
      setError('');
      setRoutingError('');
      setRoutingBusy(key);
      const result = await post<{ ok: boolean; config: State['config'] }>('config/routing', input);
      setState((current) => current ? { ...current, config: result.config } : current);
      return true;
    } catch (e) {
      setError((e as Error).message);
      setRoutingError((e as Error).message);
      return false;
    } finally {
      setRoutingBusy('');
    }
  }
  async function saveRouteText(tier: RouteTier, field: 'label' | 'guidance' | 'escalationGuidance', value: string) {
    const normalized = value.trim();
    if ((!normalized && field !== 'escalationGuidance') || normalized === tier[field]) return true;
    return updateRoutingConfig(`${tier.level}:${field}`, {
      level: tier.level,
      [field]: normalized,
    });
  }
  function replaceRoutingTiers(key: string, tiers: RouteTier[]) {
    void updateRoutingConfig(key, { tiers });
  }
  function dropRoutingTier(sourceLevel: string, targetLevel: string, position: 'before' | 'after') {
    if (!sourceLevel || sourceLevel === targetLevel) return;
    const next = [...routingTiers];
    const sourceIndex = next.findIndex((tier) => tier.level === sourceLevel);
    if (sourceIndex < 0 || !next.some((tier) => tier.level === targetLevel)) return;
    const [moved] = next.splice(sourceIndex, 1);
    const targetIndex = next.findIndex((tier) => tier.level === targetLevel);
    next.splice(targetIndex + (position === 'after' ? 1 : 0), 0, moved);
    if (next.every((tier, index) => tier.level === routingTiers[index]?.level)) return;
    void updateRoutingConfig('tiers:reorder', { routeOrder: next.map((tier) => tier.level) });
  }
  function addRoutingTier() {
    if (routingTiers.length >= 12) return;
    const previous = routingTiers.at(-1);
    const fallbackModel = previous?.model || state?.models[0]?.model;
    const fallbackCatalog = state?.models.find((item) => item.model === fallbackModel);
    const fallbackEffort = previous?.effort || fallbackCatalog?.defaultReasoningEffort || '';
    if (!fallbackModel || !fallbackEffort) return;
    let sequence = routingTiers.length + 1;
    while (routingTiers.some((tier) => tier.level === `custom-${sequence}`)) sequence += 1;
    const level = `custom-${sequence}`;
    replaceRoutingTiers('tiers:add', [
      ...routingTiers,
      {
        level,
        label: `自定义任务 ${routingTiers.length + 1}`,
        escalationGuidance: '',
        guidance: previous
          ? `比“${previous.label}”更复杂、影响范围更广或错误成本更高的任务`
          : '根据任务复杂度、工具步骤、影响范围和错误成本选择该档位',
        model: fallbackModel,
        effort: fallbackEffort,
      },
    ]);
  }
  function removeRoutingTier(index: number) {
    if (routingTiers.length <= 2) return;
    replaceRoutingTiers('tiers:remove', routingTiers.filter((_, tierIndex) => tierIndex !== index));
  }
  async function startLogin(type: 'chatgpt' | 'chatgptDeviceCode' | 'apiKey') {
    try {
      setError('');
      setAccountBusy(type);
      const result = await post<NonNullable<AccountState['login']>>(
        'account/login',
        type === 'apiKey' ? { type, apiKey } : { type },
      );
      if (type === 'apiKey') setApiKey('');
      const target = result.authUrl || result.verificationUrl;
      if (target) window.open(target, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAccountBusy('');
    }
  }
  async function refreshSessions() {
    try {
      setError('');
      await post('history/refresh');
      await post('sessions/occupancy/refresh');
    } catch (error) {
      setError((error as Error).message);
    }
  }
  async function copyReply(task: Task) {
    try {
      await navigator.clipboard.writeText(
        task.messages.map((item) => item.text).join('\n\n'),
      );
      setCopiedTask(task.id);
      window.setTimeout(
        () => setCopiedTask((current) => (current === task.id ? '' : current)),
        1800,
      );
    } catch {
      setError('复制失败，请允许浏览器访问剪贴板后重试');
    }
  }
  async function copyUserMessage(task: Task) {
    try {
      await navigator.clipboard.writeText(task.prompt);
      setCopiedTask(`user:${task.id}`);
      window.setTimeout(
        () => setCopiedTask((current) => (current === `user:${task.id}` ? '' : current)),
        1800,
      );
    } catch {
      setError('复制失败，请允许浏览器访问剪贴板后重试');
    }
  }
  function editUserMessage(task: Task) {
    setDraft(task.prompt);
    setAttachments([]);
    window.requestAnimationFrame(() => {
      composerInput.current?.focus();
      composerInput.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }
  async function rateReply(task: Task, rating: 'good' | 'bad') {
    setReplyActionBusy(`rate:${task.id}`);
    try {
      setError('');
      await post('rate', { sessionId: selected, taskId: task.id, rating });
      setRatingTask('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReplyActionBusy('');
    }
  }
  async function branchReply(task: Task) {
    setReplyActionBusy(`branch:${task.id}`);
    try {
      setError('');
      const branch = await post<{ id: string }>('branch', {
        sessionId: selected,
        taskId: task.id,
      });
      setSelected(branch.id);
      setDraft('');
      setAttachments([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReplyActionBusy('');
    }
  }
  async function showSessionView(view: 'active' | 'archived') {
    sessionViewRef.current = view;
    setSessionView(view);
    setSessionMenu('');
    const next = state?.sessions.find((item) => Boolean(item.archived) === (view === 'archived'));
    setSelected(next?.id || '');
    if (view === 'archived' && !state?.history.archivedLoaded && !state?.history.archivedLoading)
      await action('history/archived');
  }
  async function openSessionSearch() {
    setHistorySearch('');
    setHistorySearchOpen(true);
    if (!state?.history.archivedLoaded && !state?.history.archivedLoading) {
      await action('history/archived');
    }
  }
  function chooseSearchResult(target: Session) {
    const view = target.archived ? 'archived' : 'active';
    sessionViewRef.current = view;
    setSessionView(view);
    setSelected(target.id);
    setSessionMenu('');
    setHistorySearchOpen(false);
    setHistorySearch('');
  }
  async function manageSession(target: Session, operation: 'archive' | 'unarchive') {
    setSessionActionBusy(target.id);
    try {
      setError('');
      await post(`sessions/${operation}`, { sessionId: target.id });
      setSessionMenu('');
      if (operation === 'unarchive') {
        sessionViewRef.current = 'active';
        setSessionView('active');
        setSelected(target.id);
      } else if (selected === target.id) {
        setSelected(
          state?.sessions.find((item) => !item.archived && item.id !== target.id)?.id || '',
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSessionActionBusy('');
    }
  }
  async function confirmDeleteSession() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setSessionActionBusy(target.id);
    try {
      setError('');
      await post('sessions/delete', { sessionId: target.id, confirmed: true });
      setDeleteTarget(null);
      setSessionMenu('');
      if (selected === target.id) {
        setSelected(
          state?.sessions.find(
            (item) => item.id !== target.id && Boolean(item.archived) === (sessionView === 'archived'),
          )?.id || '',
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSessionActionBusy('');
    }
  }
  async function confirmRenameSession() {
    if (!renameTarget || !renameTitle.trim()) return;
    const target = renameTarget;
    setSessionActionBusy(target.id);
    try {
      setError('');
      await post('sessions/rename', { sessionId: target.id, title: renameTitle });
      setRenameTarget(null);
      setRenameTitle('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSessionActionBusy('');
    }
  }
  function widthFromPointer(side: PanelSide, clientX: number) {
    return clampPanelWidth(
      side,
      side === 'left' ? clientX : window.innerWidth - clientX,
    );
  }
  function applyPanelWidth(side: PanelSide, width: number) {
    workbenchRef.current?.style.setProperty(
      side === 'left' ? '--sidebar-width' : '--inspector-width',
      `${width}px`,
    );
  }
  function startPanelResize(
    side: PanelSide,
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeStartRef.current = {
      side,
      clientX: event.clientX,
      width: Math.round(
        (side === 'left'
          ? document.querySelector('.sidebar')
          : document.querySelector('.inspector')
        )?.getBoundingClientRect().width ||
          (side === 'left' ? sidebarWidth : inspectorWidth),
      ),
    };
    workbenchRef.current?.classList.add('resizing-panel');
  }
  function movePanelResize(
    side: PanelSide,
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const start = resizeStartRef.current;
    if (!start || start.side !== side) return;
    const pointerDelta = event.clientX - start.clientX;
    const width = clampPanelWidth(
      side,
      start.width + (side === 'left' ? pointerDelta : -pointerDelta),
    );
    resizePreviewRef.current = {
      element: event.currentTarget,
      delta: side === 'left' ? width - start.width : start.width - width,
    };
    if (resizeFrameRef.current !== null) return;
    resizeFrameRef.current = requestAnimationFrame(() => {
      const preview = resizePreviewRef.current;
      if (preview) {
        preview.element.style.transform = `translate3d(${preview.delta}px, 0, 0)`;
      }
      resizeFrameRef.current = null;
    });
  }
  function finishPanelResize(
    side: PanelSide,
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const width = widthFromPointer(side, event.clientX);
    if (resizeFrameRef.current !== null) {
      cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = null;
    }
    resizePreviewRef.current = null;
    resizeStartRef.current = null;
    event.currentTarget.style.transform = '';
    event.currentTarget.releasePointerCapture(event.pointerId);
    applyPanelWidth(side, width);
    if (side === 'left') setSidebarWidth(width);
    else setInspectorWidth(width);
    try {
      localStorage.setItem(`model-router-${side}-panel-width`, String(width));
    } catch {
      /* Resizing still works when browser storage is unavailable. */
    }
    workbenchRef.current?.classList.remove('resizing-panel');
  }
  function cancelPanelResize(
    side: PanelSide,
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (resizeFrameRef.current !== null) {
      cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = null;
    }
    resizePreviewRef.current = null;
    resizeStartRef.current = null;
    event.currentTarget.style.transform = '';
    applyPanelWidth(side, side === 'left' ? sidebarWidth : inspectorWidth);
    workbenchRef.current?.classList.remove('resizing-panel');
  }
  function resizePanelWithKeyboard(
    side: PanelSide,
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const current = side === 'left' ? sidebarWidth : inspectorWidth;
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const width = clampPanelWidth(
      side,
      current + (side === 'left' ? direction : -direction) * 12,
    );
    applyPanelWidth(side, width);
    if (side === 'left') setSidebarWidth(width);
    else setInspectorWidth(width);
    try {
      localStorage.setItem(`model-router-${side}-panel-width`, String(width));
    } catch {
      /* Keyboard resizing still works without browser storage. */
    }
  }
  return (
    <div
      ref={workbenchRef}
      className={`workbench ${focusMode ? 'focus-mode' : ''} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}
      style={{
        '--sidebar-width': `${sidebarWidth}px`,
        '--inspector-width': `${inspectorWidth}px`,
      } as CSSProperties}
    >
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-title">Codex</div>
          <div className="sidebar-header-actions">
            <button
              type="button"
              aria-label="搜索会话"
              title="搜索会话"
              onClick={() => void openSessionSearch()}
            >
              <Search size={17} />
            </button>
            <button
              type="button"
              aria-label="收起左侧栏"
              title="收起左侧栏"
              onClick={() => {
                setSidebarCollapsed(true);
                setHistorySearchOpen(false);
              }}
            >
              <PanelLeftClose size={17} />
            </button>
          </div>
        </div>
        <div className="sidebar-primary-actions">
          <Button
            className="new-chat"
            onClick={create}
            disabled={busy || !online}
          >
            <MessageCirclePlus className="sidebar-action-icon" size={18} strokeWidth={1.75} />
            新对话
          </Button>
          <Button
            ref={routingButtonRef}
            variant="ghost"
            className="routing-settings-button"
            aria-label="模型路由配置"
            title="模型路由配置"
            aria-haspopup="dialog"
            onClick={() => { setRoutingError(''); setRoutingOpen(true); }}
            disabled={!state}
          >
            <GitFork className="sidebar-action-icon" size={18} strokeWidth={1.75} />
            <span>模型路由配置</span>
          </Button>
        </div>
        <div className="sidebar-label">
          <span>
            会话管理
          </span>
          <button
            aria-label="刷新原生历史"
            title="刷新原生历史"
            onClick={() => void refreshSessions()}
            disabled={state?.history.loading || state?.history.occupancyLoading}
          >
            <RefreshCw
              size={13}
              className={state?.history.loading || state?.history.occupancyLoading ? 'spin' : ''}
            />
          </button>
        </div>
        <div className="session-view-toggle" aria-label="会话范围">
          <button
            className={sessionView === 'active' ? 'selected' : ''}
            onClick={() => void showSessionView('active')}
          >
            会话 <b>{activeSessionCount}</b>
          </button>
          <button
            className={sessionView === 'archived' ? 'selected' : ''}
            onClick={() => void showSessionView('archived')}
          >
            {state?.history.archivedLoading && <LoaderCircle size={12} className="spin" />}
            已归档 <b>{archivedSessionCount}</b>
          </button>
        </div>
        <nav className="session-list" aria-label="对话记录">
          {!visibleSessions.length && (
            <div className="session-empty">
              {sessionView === 'archived' ? '没有已归档的会话' : '没有会话'}
            </div>
          )}
          {visibleSessions.map((s) => (
            <div className="session-row" key={s.id}>
              <button
                className={`session-button ${s.id === selected ? 'selected' : ''}`}
                onClick={() => { setSelected(s.id); setSessionMenu(''); }}
              >
                <span className="session-copy">
                  <span>{s.title}</span>
                  {(s.occupancyChecking || s.occupied) && (
                    <small>
                    {s.occupancyChecking ? (
                      <span className="occupancy-checking">检测中</span>
                    ) : s.occupied ? (
                      <span
                        className="occupied-badge"
                        title={s.occupancyCheckedAt ? `检测于 ${new Date(s.occupancyCheckedAt).toLocaleTimeString()}` : '已检测到其他客户端占用'}
                      >
                        <LockKeyhole size={10} />被占用
                      </span>
                    ) : null}
                    </small>
                  )}
                </span>
                {(s.tasks.some((t) => !isFinished(t.status)) || s.nativeStatus?.type === 'active') && (
                  <LoaderCircle
                    size={14}
                    className="session-running spin"
                    aria-label="正在运行"
                  />
                )}
              </button>
              <button
                type="button"
                className="session-manage"
                aria-label={`管理会话：${s.title}`}
                aria-expanded={sessionMenu === s.id}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => setSessionMenu((current) => current === s.id ? '' : s.id)}
              >
                <MoreHorizontal size={15} />
              </button>
              {sessionMenu === s.id && (
                <div className="session-menu" onPointerDown={(event) => event.stopPropagation()}>
                  <button
                    disabled={!!state?.activeId || sessionActionBusy === s.id}
                    onClick={() => {
                      setRenameTarget(s);
                      setRenameTitle(s.title);
                      setSessionMenu('');
                    }}
                  >
                    <Pencil size={14} />
                    重命名
                  </button>
                  <button
                    disabled={!!state?.activeId || sessionActionBusy === s.id}
                    onClick={() => void manageSession(s, s.archived ? 'unarchive' : 'archive')}
                  >
                    {s.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                    {s.archived ? '恢复会话' : '归档会话'}
                  </button>
                  <button
                    className="danger"
                    disabled={!!state?.activeId || sessionActionBusy === s.id}
                    onClick={() => { setDeleteTarget(s); setSessionMenu(''); }}
                  >
                    <Trash2 size={14} />
                    永久删除
                  </button>
                </div>
              )}
            </div>
          ))}
        </nav>
        {state?.history.error && (
          <div className="history-error">
            历史同步失败：{state.history.error}
          </div>
        )}
        <div className="connection-box account-connection" ref={accountMenuRef}>
          {accountMenu && (
            <div className="account-popover" role="dialog" aria-label="Codex 账户操作">
              <h4 className="account-popover-heading">
                <span className="account-heading-copy">
                  Codex 账户
                  {state?.account?.planType && <span className="account-plan"> · {state.account.planType}</span>}
                </span>
              </h4>
              {state?.account?.authenticated && primaryLimit?.primary && (
                <div
                  className="account-usage-brief"
                  title={`Codex 剩余用量 ${remaining(primaryLimit.primary).toFixed(0)}%`}
                >
                  <span>剩余</span>
                  <strong>{remaining(primaryLimit.primary).toFixed(0)}%</strong>
                </div>
              )}
              {state?.account?.authenticated ? (
                <div className="account-actions">
                  <Button
                    variant="ghost"
                    onClick={() => action('account/refresh')}
                    disabled={state.account.loading || !!state.activeId}
                  >
                    <RefreshCw size={14} className={state.account.loading ? 'spin' : ''} />
                    刷新
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => action('account/logout')}
                    disabled={!!state.activeId}
                  >
                    <LogOut size={14} />
                    退出登录
                  </Button>
                </div>
              ) : (
                <div className="account-login">
                  <Button
                    className="account-primary-login"
                    onClick={() => void startLogin('chatgpt')}
                    disabled={!!accountBusy || state?.account?.loading}
                  >
                    {accountBusy === 'chatgpt' ? <LoaderCircle size={15} className="spin" /> : <LogIn size={15} />}
                    使用 ChatGPT 登录
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void startLogin('chatgptDeviceCode')}
                    disabled={!!accountBusy || state?.account?.loading}
                  >
                    {accountBusy === 'chatgptDeviceCode' ? <LoaderCircle size={15} className="spin" /> : <KeyRound size={15} />}
                    使用设备码
                  </Button>
                  <details className="api-key-login">
                    <summary>使用 API Key</summary>
                    <Input
                      type="password"
                      value={apiKey}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="sk-…"
                      aria-label="OpenAI API Key"
                      onChange={(event) => setApiKey(event.target.value)}
                    />
                    <Button
                      variant="outline"
                      onClick={() => void startLogin('apiKey')}
                      disabled={!apiKey.trim() || !!accountBusy || state?.account?.loading}
                    >
                      {accountBusy === 'apiKey' ? <LoaderCircle size={15} className="spin" /> : <LogIn size={15} />}
                      登录
                    </Button>
                  </details>
                </div>
              )}
              {state?.account?.login && (
                <div className={`login-progress ${state.account.login.status}`}>
                  {state.account.login.status === 'failed' ? (
                    <p className="inline-error">{state.account.login.error || '登录失败'}</p>
                  ) : state.account.login.type === 'chatgptDeviceCode' ? (
                    <>
                      <span>在登录页面输入设备码</span>
                      <strong>{state.account.login.userCode}</strong>
                      {state.account.login.verificationUrl && (
                        <a href={state.account.login.verificationUrl} target="_blank" rel="noreferrer">
                          打开登录页面 <ExternalLink size={13} />
                        </a>
                      )}
                    </>
                  ) : state.account.login.type === 'chatgpt' ? (
                    <>
                      <span>请在浏览器中完成 ChatGPT 登录</span>
                      {state.account.login.authUrl && (
                        <a href={state.account.login.authUrl} target="_blank" rel="noreferrer">
                          重新打开登录页面 <ExternalLink size={13} />
                        </a>
                      )}
                    </>
                  ) : (
                    <span>正在验证账户…</span>
                  )}
                  {state.account.login.loginId && state.account.login.status !== 'failed' && (
                    <button type="button" onClick={() => action('account/login/cancel')}>取消</button>
                  )}
                </div>
              )}
              {state?.account?.error && <p className="inline-error">{state.account.error}</p>}
            </div>
          )}
          <button
            type="button"
            className="account-trigger"
            aria-expanded={accountMenu}
            aria-haspopup="dialog"
            onClick={() => setAccountMenu((open) => !open)}
          >
            {online && state?.status === 'ready' && state.account?.authenticated ? (
              <div className="account-trigger-content">
                <Avatar className="account-avatar" aria-hidden="true">
                  {state.account.avatarUrl && (
                    <AvatarImage src={state.account.avatarUrl} alt="" referrerPolicy="no-referrer" />
                  )}
                  <AvatarFallback>{accountInitial(state.account.displayName)}</AvatarFallback>
                </Avatar>
                <span className="account-trigger-copy">
                  <strong className="connection-account-name">
                    {state.account.displayName || 'ChatGPT 用户'}
                  </strong>
                  <small className="connection-account-meta">
                    <span className="dot green" />
                    <span>
                      Codex 已连接
                      {state.account.type
                        ? ` · ${accountTypeText[state.account.type] || state.account.type}`
                        : ''}
                    </span>
                  </small>
                </span>
              </div>
            ) : (
              <span className="connection-state-row">
                <span
                  className={`dot ${online && state?.status === 'ready' ? 'green' : 'amber'}`}
                />
                <span>
                  {online
                    ? state?.status === 'signed-out'
                      ? 'Codex 未登录'
                      : state?.status === 'ready'
                        ? 'Codex 已连接'
                        : 'Codex 准备中'
                    : '正在连接本地服务'}
                </span>
              </span>
            )}
          </button>
        </div>
        <div
          className="panel-resizer panel-resizer-left"
          role="separator"
          aria-label="调整会话栏宽度"
          aria-orientation="vertical"
          aria-valuemin={PANEL_LIMITS.left.min}
          aria-valuemax={PANEL_LIMITS.left.max}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          onPointerDown={(event) => startPanelResize('left', event)}
          onPointerMove={(event) => movePanelResize('left', event)}
          onPointerUp={(event) => finishPanelResize('left', event)}
          onPointerCancel={(event) => cancelPanelResize('left', event)}
          onKeyDown={(event) => resizePanelWithKeyboard('left', event)}
        />
      </aside>
      <main className="main">
        <header>
          <div className="header-title">
            {sidebarCollapsed && !focusMode && (
              <Button
                variant="ghost"
                size="icon"
                className="sidebar-expand"
                aria-label="展开左侧栏"
                title="展开左侧栏"
                onClick={() => setSidebarCollapsed(false)}
              >
                <PanelLeftOpen size={17} />
              </Button>
            )}
            {session?.title || '新对话'}
            <span className="version">V3</span>
            {session?.occupied && (
              <span className="source-chip occupied-chip" title="该会话正由 Codex 桌面版或其他客户端持有">
                <LockKeyhole size={12} />
                被占用
              </span>
            )}
          </div>
          <div className="header-actions">
            <div className="theme-picker" title="页面风格">
              <Select
                value={theme}
                onValueChange={(value) => value && setTheme(value as 'light' | 'dark')}
              >
                <SelectTrigger
                  className="composer-select-trigger theme-select-trigger"
                  aria-label="选择页面风格"
                >
                  {theme === 'dark' ? <Moon size={15} /> : <Sun size={15} />}
                  <span>{theme === 'dark' ? '暗夜' : '浅色'}</span>
                </SelectTrigger>
                <SelectContent
                  className="composer-select-content theme-select-content"
                  side="bottom"
                  align="end"
                  alignItemWithTrigger={false}
                >
                  <SelectItem className="composer-select-item" value="light">
                    <Sun size={14} />浅色
                  </SelectItem>
                  <SelectItem className="composer-select-item" value="dark">
                    <Moon size={14} />暗夜
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="conversation-view-toggle" role="group" aria-label="会话显示方式">
              <button
                type="button"
                className={conversationMode === 'flow' ? 'selected' : ''}
                aria-label="纵向"
                aria-pressed={conversationMode === 'flow'}
                title="纵向连续显示"
                onClick={() => setConversationMode('flow')}
              >
                <span className="view-label-full">纵向</span>
                <span className="view-label-short" aria-hidden="true">纵</span>
              </button>
              <button
                type="button"
                className={conversationMode === 'cards' ? 'selected' : ''}
                aria-label="卡片"
                aria-pressed={conversationMode === 'cards'}
                title="按问答轮次横向切换"
                onClick={() => setConversationMode('cards')}
              >
                <span className="view-label-full">卡片</span>
                <span className="view-label-short" aria-hidden="true">卡</span>
              </button>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="focus-toggle"
              aria-label={focusMode ? '退出专注模式' : '进入专注模式'}
              title={focusMode ? '退出专注模式' : '收起两侧栏，进入专注模式'}
              aria-pressed={focusMode}
              onClick={() => {
                setFocusMode((current) => !current);
                if (!focusMode) setSettings(false);
              }}
            >
              {focusMode ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
            </Button>
            <Button variant="outline" onClick={() => setSettings(!settings)}>
              <SlidersHorizontal size={16} />
              状态
            </Button>
          </div>
        </header>
        {historySearchOpen && (
          <div className="history-search-overlay">
            <button
              type="button"
              className="history-search-dismiss"
              aria-label="关闭会话搜索"
              onClick={() => setHistorySearchOpen(false)}
            />
            <dialog open className="history-search-dialog" aria-label="搜索会话">
              <div className="history-search-dialog-input">
                <Search size={17} />
                <input
                  ref={historySearchInput}
                  aria-label="搜索会话"
                  placeholder="搜索对话"
                  value={historySearch}
                  onChange={(event) => setHistorySearch(event.target.value)}
                />
                <button
                  type="button"
                  aria-label="关闭会话搜索"
                  title="关闭"
                  onClick={() => setHistorySearchOpen(false)}
                >
                  <X size={16} />
                </button>
              </div>
              <div className="history-search-results" aria-label="搜索结果">
                {!searchResults.length && <p>没有找到相关对话</p>}
                {searchResults.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={item.id === selected ? 'selected' : ''}
                    onClick={() => chooseSearchResult(item)}
                  >
                    <span>{item.title}</span>
                    <small>
                      {item.archived
                        ? '已归档'
                        : new Date(item.updatedAt || item.createdAt).toLocaleTimeString('en-US', {
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                    </small>
                  </button>
                ))}
              </div>
            </dialog>
          </div>
        )}
        {(error || state?.error) && (
          <div className="alert" role="alert">
            <CircleAlert size={18} />
            <span>{error || state?.error}</span>
          </div>
        )}
        {state && state.mcpServers.some((server) => server.enabled && !server.connected) && (
          <div className="alert" role="status">
            <Cable size={18} />
            <span>MCP 未连接。普通对话仍可使用。</span>
          </div>
        )}
        <div className={`conversation-stage ${conversationMode}-stage`}>
          {tasks.length > 1 && (
            <nav
              className={`turn-ruler ${rulerEntries[0]?.index ? 'has-hidden-past' : ''}`}
              aria-label="对话轮次导航"
              onPointerLeave={() => setHoveredTurnIndex(null)}
            >
              {rulerEntries.map(({ task, index }) => {
                const preview = task.prompt.replace(/\s+/g, ' ').trim();
                const hoverDistance =
                  hoveredTurnIndex === null
                    ? null
                    : Math.abs(index - hoveredTurnIndex);
                return (
                  <button
                    type="button"
                    key={task.id}
                    className={`${index === activeTurnIndex ? 'active' : ''} ${hoverDistance !== null && hoverDistance <= 3 ? `hover-distance-${hoverDistance}` : ''}`}
                    aria-label={`定位到第 ${index + 1} 轮：${preview.slice(0, 48)}`}
                    aria-current={index === activeTurnIndex ? 'step' : undefined}
                    onPointerEnter={() => setHoveredTurnIndex(index)}
                    onFocus={() => setHoveredTurnIndex(index)}
                    onBlur={() => setHoveredTurnIndex(null)}
                    onClick={() => goToTurn(index)}
                  >
                    <span className="turn-tick" />
                    <span className="turn-preview" role="tooltip">
                      <strong>第 {index + 1} 轮</strong>
                      <span>{preview || '无文字内容'}</span>
                    </span>
                  </button>
                );
              })}
            </nav>
          )}
          {conversationMode === 'cards' && tasks.length > 1 && (
            <>
              <button
                type="button"
                className="card-step card-step-previous"
                aria-label="上一轮"
                title="上一轮"
                disabled={activeTurnIndex === 0}
                onClick={() => goToTurn(activeTurnIndex - 1)}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                className="card-step card-step-next"
                aria-label="下一轮"
                title="下一轮"
                disabled={activeTurnIndex === tasks.length - 1}
                onClick={() => goToTurn(activeTurnIndex + 1)}
              >
                <ChevronRight size={18} />
              </button>
            </>
          )}
          <div
            ref={conversationRef}
            className={`conversation ${conversationMode === 'cards' && tasks.length ? 'card-view' : 'flow-view'}`}
            aria-label="对话内容"
            onScroll={trackConversationPosition}
          >
          {(session?.historyLoading || opening === session?.id) && (
            <div className="history-loading">
              <LoaderCircle className="spin" size={18} />
              正在读取 Codex 原生对话…
            </div>
          )}
          {session?.historyError && (
            <div className="history-loading history-failed">
              <CircleAlert size={18} />
              读取失败：{session.historyError}
              <Button
                variant="outline"
                onClick={() =>
                  action('history/open', { sessionId: session.id })
                }
              >
                重试
              </Button>
            </div>
          )}
          {!tasks.length && !session?.historyLoading && (
            <section className="empty-state">
              <div className="empty-icon">
                {session?.native ? (
                  <History size={34} />
                ) : (
                  <Network size={36} />
                )}
              </div>
              <div className="eyebrow">
                {session?.native ? 'CODEX 原生会话' : '一个入口，合适的模型'}
              </div>
              <h1>
                {session?.native
                  ? '这个会话还没有可显示的消息'
                  : '从你想完成的事开始'}
              </h1>
              <p>
                {session?.native ? (
                  '你可以在这里继续提问，后续内容仍写入同一个 Codex 会话。'
                ) : (
                  <>
                    先判断任务难度，再交给对应模型。
                    <br />
                    也可以手动选择账号里的任意可用模型。
                  </>
                )}
              </p>
              {!session?.native && (
                <div className="suggestions">
                  {[
                    '把这句话翻译成英文：今天的会议改到下午三点。',
                    '查看记忆服务的统计信息，不读取具体记忆内容。',
                    '帮我设计一个支持重试和断点恢复的任务队列。',
                  ].map((s, i) => (
                    <button key={s} onClick={() => setDraft(s)}>
                      <span>{['快速问答', '连接记忆', '深入分析'][i]}</span>
                      {s}
                      <ArrowRight size={16} />
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}
          {tasks.map((task, turnIndex) => (
            <article className="turn" data-turn-index={turnIndex} key={task.id}>
              <div className="user-message-wrap">
                <div className="user-message">
                  {task.prompt === '上下文压缩' && <span className="message-label">Codex</span>}
                  <AttachmentList items={task.attachments || []} />
                  <div>{task.prompt}</div>
                </div>
                <div className="user-message-meta" aria-label="消息操作">
                  <time dateTime={new Date(task.startedAt).toISOString()}>
                    {new Date(task.startedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </time>
                  <button type="button" aria-label="复制消息" title="复制消息" onClick={() => void copyUserMessage(task)}>
                    {copiedTask === `user:${task.id}` ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                  <button type="button" aria-label="编辑并重新发送" title="编辑并重新发送" onClick={() => editUserMessage(task)} disabled={!!session?.archived}>
                    <Pencil size={14} />
                  </button>
                </div>
              </div>
              <div className="assistant-message">
                <WorkSummary task={task} />
                <div className="model-route-block">
                  <div className="assistant-heading">
                    {task.route ? (
                      <details className="route-details">
                        <summary>
                          <span className="route-model">
                            <strong>{shortModel(task.route.model)}</strong>
                            <span>· {task.route.effort}</span>
                          </span>
                          <ChevronRight className="route-chevron" size={14} />
                        </summary>
                        <div className="route-reason">
                          <span>
                            {state?.config.routeLabels?.[task.route.level] || levelText[task.route.level] || task.route.level}
                          </span>
                          <p>{task.route.reason}</p>
                          {task.route.confidence !== undefined && (
                            <p className="route-meta">{task.route.taskType ? `${task.route.taskType} · ` : ''}初始判断信心 {task.route.confidence}%（模型估计）</p>
                          )}
                          {!!task.route.escalation && !task.routeHistory?.length && (
                            <div className="route-escalation">
                              <span>升级条件 · {state?.config.routeLabels?.[task.route.escalation.targetLevel] || task.route.escalation.targetLevel}</span>
                              <ul>{task.route.escalation.signals.map((signal, index) => <li key={index}>{signal}</li>)}</ul>
                            </div>
                          )}
                          {task.routeHistory?.map((transition, index) => (
                            <div className="route-escalation" key={index}>
                              <span>已自动升档 · {shortModel(transition.from.model)} · {transition.from.effort} → {shortModel(transition.to.model)} · {transition.to.effort}</span>
                              <p>初始判断：{transition.from.reason}</p>
                              <ul>{transition.evidence.map((evidence, itemIndex) => <li key={itemIndex}>{evidence}</li>)}</ul>
                            </div>
                          ))}
                          {task.escalationAvailable === false && task.route.classifier && (
                            <p className="route-meta">此旧会话支持初始分流；新建会话可启用执行中升档。</p>
                          )}
                        </div>
                      </details>
                    ) : task.status === 'classifying' ? (
                      <span className="route-pending" role="status">
                        正在选择模型…
                      </span>
                    ) : (
                      <strong>
                        {session?.model ? shortModel(session.model) : 'Codex'}
                      </strong>
                    )}
                    <span className={`task-status ${task.status}`}>
                      {!isFinished(task.status) ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : task.status === 'completed' ? (
                        <CircleCheck size={14} />
                      ) : (
                        <CircleAlert size={14} />
                      )}
                      {statusText[task.status] || task.status}
                    </span>
                  </div>
                </div>
              {task.messages.map((message) => (
                <MarkdownAnswer
                  key={message.id}
                  text={message.text}
                  showCopy={false}
                />
              ))}
                {!task.messages.length && !isFinished(task.status) && task.status !== 'classifying' && (
                  <div className="thinking">等待模型响应…</div>
                )}
                {task.error && <div className="task-error">{task.error}</div>}
                {isFinished(task.status) && (
                  <ChangedFiles
                    files={task.files}
                    undo={task.undo}
                    running={!!state?.activeId}
                    onUndo={async () => {
                      await post('files/undo', {
                        sessionId: selected,
                        taskId: task.id,
                        confirmed: true,
                      });
                    }}
                  />
                )}
                {isFinished(task.status) && task.messages.length > 0 && (
                  <div className="reply-actions" aria-label="回复操作">
                    <button
                      type="button"
                      onClick={() => void copyReply(task)}
                      title="复制整条回复"
                    >
                      {copiedTask === task.id ? <Check size={14} /> : <Copy size={14} />}
                      {copiedTask === task.id ? 'Copied' : 'Copy'}
                    </button>
                    <span className="rate-control">
                      <button
                        type="button"
                        className={task.rating ? 'selected' : ''}
                        aria-expanded={ratingTask === task.id}
                        onClick={() =>
                          setRatingTask((current) => (current === task.id ? '' : task.id))
                        }
                        title="评价这条回复"
                      >
                        {task.rating === 'bad' ? <ThumbsDown size={14} /> : <ThumbsUp size={14} />}
                        Rate
                      </button>
                      {ratingTask === task.id && (
                        <span className="rate-menu">
                          <button
                            type="button"
                            className={task.rating === 'good' ? 'selected' : ''}
                            disabled={replyActionBusy === `rate:${task.id}`}
                            onClick={() => void rateReply(task, 'good')}
                            title="有帮助"
                          >
                            <ThumbsUp size={15} />
                            有帮助
                          </button>
                          <button
                            type="button"
                            className={task.rating === 'bad' ? 'selected' : ''}
                            disabled={replyActionBusy === `rate:${task.id}`}
                            onClick={() => void rateReply(task, 'bad')}
                            title="没有帮助"
                          >
                            <ThumbsDown size={15} />
                            没有帮助
                          </button>
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => void branchReply(task)}
                      disabled={!!state?.activeId || !!session?.archived || replyActionBusy === `branch:${task.id}`}
                      title="从这条回复创建真实的 Codex 分支"
                    >
                      {replyActionBusy === `branch:${task.id}` ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : (
                        <GitBranch size={14} />
                      )}
                      Branch
                    </button>
                  </div>
                )}
              </div>
              {state?.approvals
                .filter((approval) => approval.taskId === task.id)
                .map((approval) => (
                  <ApprovalCard
                    key={approval.id}
                    approval={approval}
                    answer={(answer) => action('answer', { id: approval.id, ...answer })}
                  />
                ))}
            </article>
          ))}
          </div>
        </div>
        <footer>
          <div
            className={`composer ${dragActive ? 'drag-active' : ''} ${session?.archived ? 'archived' : ''}`}
            onDragEnter={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node))
                setDragActive(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              void uploadFiles(e.dataTransfer.files);
            }}
          >
            <input
              ref={fileInput}
              className="attachment-input"
              type="file"
              multiple
              disabled={!!session?.archived}
              aria-label="添加图片或文件"
              onChange={(e) => {
                if (e.target.files) void uploadFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <AttachmentList
              items={attachments}
              onRemove={(id) =>
                setAttachments((current) =>
                  current.filter((item) => item.id !== id),
                )
              }
            />
            {uploading && (
              <div className="attachment-uploading">
                <LoaderCircle size={14} className="spin" />
                正在添加附件…
              </div>
            )}
            <Textarea
              ref={composerInput}
              aria-label="输入问题"
              placeholder={session?.archived ? '会话已归档，恢复后可以继续' : '描述你的问题或任务…'}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onPaste={(e) => {
                if (e.clipboardData.files.length) {
                  e.preventDefault();
                  void uploadFiles(e.clipboardData.files);
                }
              }}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  void send();
                }
              }}
              maxLength={50000}
              disabled={session?.historyLoading || session?.archived}
            />
            <div className="composer-bottom">
              <div className="picker-row">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="attach-button"
                  aria-label="添加图片或文件"
                  title="添加图片或文件"
                  onClick={() => fileInput.current?.click()}
                  disabled={uploading || busy || !online || !!session?.archived}
                >
                  {uploading ? (
                    <LoaderCircle size={17} className="spin" />
                  ) : (
                    <Plus size={20} />
                  )}
                </Button>
                <div
                  className="approval-select"
                  title="替我审批会让 Codex 自动审查工作区外的额外权限请求；不会扩大工作区或网络边界。"
                >
                  <Select
                    value={approvalMode}
                    onValueChange={(value) =>
                      value &&
                      setApprovalMode(
                        value as 'ask' | 'approve-for-me',
                      )
                    }
                  >
                    <SelectTrigger
                      className="composer-select-trigger approval-select-trigger"
                      aria-label="选择审批方式"
                    >
                      <span>{approvalMode === 'approve-for-me' ? 'Approve for me' : 'Ask for approval'}</span>
                    </SelectTrigger>
                    <SelectContent
                      className="composer-select-content"
                      side="top"
                      align="start"
                      alignItemWithTrigger={false}
                    >
                      <SelectItem className="composer-select-item" value="ask">Ask for approval</SelectItem>
                      <SelectItem className="composer-select-item" value="approve-for-me">Approve for me</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <span
                  className="context-ring-wrap"
                  tabIndex={0}
                  aria-label={
                    contextWindow
                      ? `当前上下文 ${contextPercent.toFixed(contextPercent < 10 ? 1 : 0)}%，${number(contextTokens)} / ${number(contextWindow)} Token`
                      : '继续对话后显示上下文占用'
                  }
                >
                  <span
                    className={`context-ring${contextWindow ? '' : ' empty'}`}
                    style={{
                      background: contextWindow
                        ? `conic-gradient(currentColor ${contextPercent * 3.6}deg, var(--context-ring-track) 0)`
                        : undefined,
                    }}
                    aria-hidden="true"
                  />
                  <span className="context-tooltip" role="tooltip">
                    {contextWindow ? (
                      <>
                        <strong>
                          {contextPercent.toFixed(contextPercent < 10 ? 1 : 0)}%
                        </strong>
                        <span>
                          {number(contextTokens)} / {number(contextWindow)} Token
                        </span>
                        {session?.compaction?.status === 'running' && (
                          <small>正在自动压缩上下文</small>
                        )}
                      </>
                    ) : (
                      <span>继续对话后显示上下文占用</span>
                    )}
                  </span>
                </span>
              </div>
              <div className="composer-actions">
                <div className="model-choice">
                  <Select
                    value={model === 'auto' ? 'auto' : `${model}::${effort}`}
                    onValueChange={(value) => {
                      if (!value) return;
                      if (value === 'auto') {
                        setModel('auto');
                        setEffort('auto');
                        return;
                      }
                      const [nextModel, nextEffort] = value.split('::');
                      setModel(nextModel);
                      setEffort(nextEffort);
                    }}
                  >
                    <SelectTrigger
                      className="composer-select-trigger model-select-trigger"
                      aria-label="选择模型和推理强度"
                    >
                      <span className="composer-select-value">
                        {model === 'auto'
                          ? 'Auto'
                          : `${state?.models.find((item) => item.model === model)?.displayName || model} ${effort === 'auto'
                            ? state?.models.find((item) => item.model === model)?.defaultReasoningEffort || ''
                            : effort}`}
                      </span>
                    </SelectTrigger>
                    <SelectContent
                      className="composer-select-content model-select-content"
                      side="top"
                      align="end"
                      alignItemWithTrigger={false}
                    >
                    <SelectItem className="composer-select-item" value="auto">Auto</SelectItem>
                    {state?.models.map((item) => (
                      <SelectGroup key={item.model}>
                        <SelectLabel>{item.displayName}</SelectLabel>
                        <SelectItem className="composer-select-item" value={`${item.model}::auto`}>
                          {item.displayName} {item.defaultReasoningEffort}
                        </SelectItem>
                        {item.supportedReasoningEfforts
                          .filter(
                            (option) =>
                              option.reasoningEffort !==
                              item.defaultReasoningEffort,
                          )
                          .map((option) => (
                            <SelectItem
                              className="composer-select-item"
                              key={option.reasoningEffort}
                              value={`${item.model}::${option.reasoningEffort}`}
                            >
                              {item.displayName} {option.reasoningEffort}
                            </SelectItem>
                          ))}
                      </SelectGroup>
                    ))}
                    </SelectContent>
                  </Select>
                </div>
                {activeTaskIsSelected ? (
                  <Button
                    className="send stop-send"
                    aria-label="停止生成"
                    title="停止生成"
                    onClick={() => action('stop')}
                  >
                    <Square size={10} fill="currentColor" strokeWidth={0} />
                  </Button>
                ) : (
                  <Button
                    className="send"
                    aria-label="发送问题"
                    onClick={send}
                    disabled={
                      (!draft.trim() && !attachments.length) ||
                      busy ||
                      uploading ||
                      !!state?.activeId ||
                      !online ||
                      state?.status !== 'ready' ||
                      !!session?.historyLoading ||
                      !!session?.archived ||
                      !!(session?.native && !session.historyLoaded)
                    }
                  >
                    <ArrowUp size={20} />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </footer>
      </main>
      {settings && (
        <aside className="inspector">
          <div
            className="panel-resizer panel-resizer-right"
            role="separator"
            aria-label="调整状态栏宽度"
            aria-orientation="vertical"
            aria-valuemin={PANEL_LIMITS.right.min}
            aria-valuemax={PANEL_LIMITS.right.max}
            aria-valuenow={inspectorWidth}
            tabIndex={0}
            onPointerDown={(event) => startPanelResize('right', event)}
            onPointerMove={(event) => movePanelResize('right', event)}
            onPointerUp={(event) => finishPanelResize('right', event)}
            onPointerCancel={(event) => cancelPanelResize('right', event)}
            onKeyDown={(event) => resizePanelWithKeyboard('right', event)}
          />
          <div className="inspector-heading">
            <Button
              variant="ghost"
              size="icon"
              aria-label="关闭设置"
              onClick={() => setSettings(false)}
            >
              <X size={18} />
            </Button>
          </div>
          <section>
            <details
              className="inspector-details"
              open={inspectorSections.usage}
              onToggle={(event) => rememberInspectorSection('usage', event.currentTarget.open)}
            >
              <summary className="inspector-section-summary">
                <span className="inspector-section-title">
                  <Gauge size={17} />
                  Codex 剩余用量
                </span>
                <ChevronRight className="inspector-section-chevron" size={14} />
              </summary>
              <div className="inspector-section-content">
            <div className="section-action">
              <span>
                {state?.usage.updatedAt
                  ? `更新于 ${new Date(state.usage.updatedAt).toLocaleTimeString()}`
                  : '正在读取'}
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="刷新剩余用量"
                onClick={() => action('usage/refresh')}
                disabled={state?.usage.loading}
              >
                <RefreshCw
                  size={15}
                  className={state?.usage.loading ? 'spin' : ''}
                />
              </Button>
            </div>
            {state?.usage.error && (
              <p className="inline-error">{state.usage.error}</p>
            )}
            {state?.usage.limits.map((limit) => (
              <div className="quota-card" key={limit.id}>
                <div>
                  <strong>
                    {limit.name === 'codex' ? 'Codex' : limit.name}
                  </strong>
                  {limit.planType && <small>{limit.planType}</small>}
                </div>
                {limit.primary && (
                  <UsageWindow
                    label={windowLabel(limit.primary)}
                    window={limit.primary}
                  />
                )}
                {limit.secondary && (
                  <UsageWindow
                    label={windowLabel(limit.secondary)}
                    window={limit.secondary}
                  />
                )}
                {limit.credits?.balance != null && (
                  <p>积分余额：{String(limit.credits.balance)}</p>
                )}
              </div>
            ))}
            {!state?.usage.loading &&
              !state?.usage.limits.length &&
              !state?.usage.error && <p>当前登录方式没有返回用量窗口。</p>}
            {state?.usage.resetCredits != null && (
              <p>可用重置次数：{state.usage.resetCredits}</p>
            )}
              </div>
            </details>
          </section>
          <section>
            <details
              className="inspector-details"
              open={inspectorSections.mcp}
              onToggle={(event) => rememberInspectorSection('mcp', event.currentTarget.open)}
            >
              <summary className="inspector-section-summary">
                <span className="inspector-section-title">
                  <Cable size={17} />
                  MCP 服务
                </span>
                <ChevronRight className="inspector-section-chevron" size={14} />
              </summary>
              <div className="inspector-section-content">
            <Button
              variant="outline"
              disabled={!!state?.activeId}
              onClick={() => action('mcp/reconnect')}
            >
              重新检测全部
            </Button>
            {state?.mcpServers.length ? state.mcpServers.map((server, index) => (
              <div key={`${server.name}-${index}`} className={`connection-status ${server.connected ? 'connected' : ''}`}>
                {server.connected ? <Check size={16} /> : <CircleAlert size={16} />}
                {server.name} · {server.connected ? '已连接' : server.enabled ? '未连接' : '已停用'}
              </div>
            )) : (
              <div className="connection-status">
                <CircleAlert size={16} />
                未连接
              </div>
            )}
              </div>
            </details>
          </section>

          <section>
            <details
              className="inspector-details"
              open={inspectorSections.workspace}
              onToggle={(event) => rememberInspectorSection('workspace', event.currentTarget.open)}
            >
              <summary className="inspector-section-summary">
                <span className="inspector-section-title">
                  <Clock3 size={17} />
                  任务文件目录
                </span>
                <ChevronRight className="inspector-section-chevron" size={14} />
              </summary>
              <div className="inspector-section-content">
                <code>{session?.cwd || state?.cwd}</code>
                <p>
                  继续原生会话时沿用它记录的工作目录；新对话使用工作台 workspace。
                </p>
              </div>
            </details>
          </section>
        </aside>
      )}
      <Dialog open={routingOpen} onOpenChange={(open) => {
        if (!open && routingDialogRef.current?.contains(document.activeElement) && document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        setRoutingOpen(open);
      }}>
        <DialogContent className="routing-settings-dialog" ref={routingDialogRef} finalFocus={routingButtonRef}>
          <DialogHeader className="routing-settings-header">
            <DialogTitle>模型路由配置</DialogTitle>
            <DialogDescription>管理判断模型、各档位的执行模型和升级规则。点击输入框外自动保存。</DialogDescription>
            {state?.activeId && <p className="routing-settings-notice">任务运行中，配置暂不可修改。</p>}
            {routingBusy && <output className="routing-settings-notice">正在保存…</output>}
            {routingError && <p className="inline-error" role="alert">{routingError}</p>}
          </DialogHeader>
              <div className="routing-details-content">

                {state?.config.classifier && classifierEffort && (
                  <div className="routing-config-row classifier-row">
                    <span>判断模型</span>
                    <RoutingModelSelect
                      models={state.models}
                      model={state.config.classifier}
                      effort={classifierEffort}
                      label="选择判断模型和推理强度"
                      disabled={!!state.activeId || !!routingBusy}
                      onChange={(nextModel, nextEffort) => void updateRoutingConfig('classifier', {
                        classifier: nextModel,
                        classifierEffort: nextEffort,
                      })}
                    />
                  </div>
                )}
                <p>
                  分类器按档位名称、描述和上下文判断复杂度，模型与强度由下方映射决定。
                  请按能力由低到高排列。新建会话在 Auto 模式下可根据执行中发现的复杂度自动升档，每个任务最多一次。
                </p>
                <div className="routing-tier-list">
                  {routingTiers.map((tier, index) => {
                    const visibleLabel = routeLabelDrafts[tier.level] ?? tier.label;
                    return (
                    <details
                      className={`routing-tier-card${draggedTier === tier.level ? ' dragging' : ''}${dragTarget?.level === tier.level ? ` drop-${dragTarget.position}` : ''}`}
                      key={tier.level}
                    >
                      <summary
                        onDragOver={(event) => {
                          if (!draggedTier || draggedTier === tier.level) return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = 'move';
                          const bounds = event.currentTarget.getBoundingClientRect();
                          const position = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
                          setDragTarget((current) => current?.level === tier.level && current.position === position
                            ? current
                            : { level: tier.level, position });
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          const sourceLevel = event.dataTransfer.getData('text/plain') || draggedTier;
                          if (dragTarget?.level === tier.level) {
                            dropRoutingTier(sourceLevel, tier.level, dragTarget.position);
                          }
                          setDraggedTier('');
                          setDragTarget(null);
                        }}
                      >
                        <button
                          type="button"
                          className="routing-tier-drag"
                          draggable={!state?.activeId && !routingBusy}
                          aria-label={`拖动${visibleLabel || tier.label}调整顺序`}
                          title="拖动调整顺序"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                          onDragStart={(event) => {
                            event.stopPropagation();
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData('text/plain', tier.level);
                            setDraggedTier(tier.level);
                            setDragTarget(null);
                          }}
                          onDragEnd={() => {
                            setDraggedTier('');
                            setDragTarget(null);
                          }}
                        >
                          <GripVertical size={14} />
                        </button>
                        <span className="routing-tier-index">{index + 1}</span>
                        <span className="routing-tier-summary">
                          <strong>{visibleLabel}</strong>
                        </span>
                        <ChevronRight className="routing-tier-chevron" size={14} />
                        <RoutingModelSelect
                          models={state?.models || []}
                          model={tier.model}
                          effort={tier.effort}
                          label={`选择${visibleLabel || tier.label}使用的模型和推理强度`}
                          disabled={!!state?.activeId || !!routingBusy}
                          onChange={(nextModel, nextEffort) => void updateRoutingConfig(tier.level, {
                            level: tier.level,
                            model: nextModel,
                            effort: nextEffort,
                          })}
                        />
                      </summary>
                      <div className="routing-tier-editor">
                        <label>
                          <span>名称</span>
                          <input
                            key={`label-${tier.level}-${tier.label}`}
                            defaultValue={tier.label}
                            maxLength={30}
                            disabled={!!state?.activeId || !!routingBusy}
                            onChange={(event) => {
                              const nextLabel = event.currentTarget.value;
                              setRouteLabelDrafts((current) => ({
                                ...current,
                                [tier.level]: nextLabel,
                              }));
                            }}
                            onBlur={async (event) => {
                              const input = event.currentTarget;
                              const nextLabel = input.value.trim();
                              const saved = nextLabel
                                ? await saveRouteText(tier, 'label', nextLabel)
                                : false;
                              if (!saved) input.value = tier.label;
                              setRouteLabelDrafts((current) => {
                                const next = { ...current };
                                delete next[tier.level];
                                return next;
                              });
                            }}
                          />
                        </label>
                        <label>
                          <span>判断描述</span>
                          <textarea
                            key={`guidance-${tier.level}-${tier.guidance}`}
                            defaultValue={tier.guidance}
                            maxLength={600}
                            rows={3}
                            disabled={!!state?.activeId || !!routingBusy}
                            onBlur={(event) => {
                              if (!event.currentTarget.value.trim()) event.currentTarget.value = tier.guidance;
                              else void saveRouteText(tier, 'guidance', event.currentTarget.value);
                            }}
                          />
                        </label>
                        <label>
                          <span>升级判断规则</span>
                          <textarea
                            key={`escalation-${tier.level}-${tier.escalationGuidance}`}
                            defaultValue={tier.escalationGuidance}
                            maxLength={600}
                            rows={3}
                            placeholder="哪些新发现需要升档？留空则由模型按任务判断。"
                            disabled={!!state?.activeId || !!routingBusy}
                            onBlur={async (event) => {
                              const input = event.currentTarget;
                              const saved = await saveRouteText(tier, 'escalationGuidance', input.value);
                              if (!saved) input.value = tier.escalationGuidance;
                            }}
                          />
                        </label>
                        <div className="routing-tier-actions">
                          <button
                            type="button"
                            className="danger"
                            aria-label={`删除${visibleLabel || tier.label}`}
                            disabled={routingTiers.length <= 2 || !!state?.activeId || !!routingBusy}
                            onClick={() => removeRoutingTier(index)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </details>
                    );
                  })}
                  <button
                    type="button"
                    className="routing-tier-add"
                    disabled={routingTiers.length >= 12 || !!state?.activeId || !!routingBusy}
                    onClick={addRoutingTier}
                  >
                    <Plus size={14} />
                    添加档位
                  </button>
                </div>
              </div>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!renameTarget}
        onOpenChange={(open) => {
          if (!open && !sessionActionBusy) {
            setRenameTarget(null);
            setRenameTitle('');
          }
        }}
      >
        <AlertDialogContent className="session-rename-dialog">
          <AlertDialogTitle>重命名会话</AlertDialogTitle>
          <AlertDialogDescription>输入新的会话名称。</AlertDialogDescription>
          <Input
            value={renameTitle}
            maxLength={100}
            aria-label="会话名称"
            onChange={(event) => setRenameTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void confirmRenameSession();
              }
            }}
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!sessionActionBusy}>取消</AlertDialogCancel>
            <Button
              disabled={!!sessionActionBusy || !renameTitle.trim()}
              onClick={() => void confirmRenameSession()}
            >
              {sessionActionBusy ? <LoaderCircle size={14} className="spin" /> : <Pencil size={14} />}
              保存
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !sessionActionBusy) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent className="session-delete-dialog">
          <AlertDialogTitle>永久删除这个会话？</AlertDialogTitle>
          <AlertDialogDescription>
            {deleteTarget?.threadId
              ? '这会通过 Codex 删除该会话及其完整历史。'
              : '这会删除该会话的本地记录。'}
            此操作无法恢复。
          </AlertDialogDescription>
          <div className="session-delete-name">{deleteTarget?.title}</div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!sessionActionBusy}>取消</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={!!sessionActionBusy}
              onClick={() => void confirmDeleteSession()}
            >
              {sessionActionBusy ? <LoaderCircle size={14} className="spin" /> : <Trash2 size={14} />}
              永久删除
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
function windowLabel(window: RateWindow) {
  if (!window.windowDurationMins) return '用量窗口';
  if (window.windowDurationMins % (60 * 24) === 0)
    return `${window.windowDurationMins / (60 * 24)} 天窗口`;
  if (window.windowDurationMins % 60 === 0)
    return `${window.windowDurationMins / 60} 小时窗口`;
  return `${window.windowDurationMins} 分钟窗口`;
}
function UsageWindow({ label, window }: { label: string; window: RateWindow }) {
  return (
    <div className="usage-window">
      <div>
        <span>{label}</span>
        <strong>剩余 {remaining(window).toFixed(0)}%</strong>
      </div>
      <div className="usage-progress">
        <i style={{ width: `${window.usedPercent}%` }} />
      </div>
      <small>
        已用 {window.usedPercent.toFixed(0)}% · {resetText(window.resetsAt)}{' '}
        重置
      </small>
    </div>
  );
}
function ApprovalCard({
  approval,
  answer,
}: {
  approval: Approval;
  answer: (v: {
    approved: boolean;
    answers?: Record<string, { answers: string[] }>;
  }) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>({}),
    [sending, setSending] = useState(false);
  async function respond(approved: boolean) {
    setSending(true);
    try {
      await answer({
        approved,
        answers: approved
          ? Object.fromEntries(
              (approval.questions || []).map((q) => [
                q.id,
                { answers: [values[q.id] || ''] },
              ]),
            )
          : {},
      });
    } finally {
      setSending(false);
    }
  }
  return (
    <section className="approval-card">
      <div className="approval-title">
        <CircleAlert size={18} />
        <h3>{approval.title}</h3>
      </div>
      {approval.details != null && (
        <pre>{JSON.stringify(approval.details, null, 2)}</pre>
      )}
      {approval.questions?.map((q) => (
        <label key={q.id} className="question">
          {q.question}
          <Input
            value={values[q.id] || ''}
            onChange={(e) => setValues({ ...values, [q.id]: e.target.value })}
          />
          {q.options?.map((o) => (
            <Button
              variant="outline"
              key={o.label}
              onClick={() => setValues({ ...values, [q.id]: o.label })}
            >
              {o.label}
            </Button>
          ))}
        </label>
      ))}
      <div className="approval-actions">
        <Button
          variant="outline"
          disabled={sending}
          onClick={() => respond(false)}
        >
          拒绝
        </Button>
        <Button
          disabled={
            sending ||
            (approval.kind === 'input' &&
              approval.questions?.some((q) => !values[q.id]?.trim()))
          }
          onClick={() => respond(true)}
        >
          {approval.kind === 'input' ? '提交回答' : '批准本次'}
        </Button>
      </div>
    </section>
  );
}
