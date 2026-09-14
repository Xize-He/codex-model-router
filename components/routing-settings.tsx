'use client';
import {
  memo,
  useState,
  useRef,
  useMemo,
  useEffect,
  type RefObject,
} from 'react';
import { createSerialSaveQueue } from '@/lib/serial-save.mjs';
import { ChevronRight, GripVertical, Plus, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from '@/components/ui/select';

type Model = {
  model: string;
  displayName: string;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: { reasoningEffort: string }[];
};
export type RoutingConfig = {
  classifier: string;
  classifierEffort?: string;
  routes: Record<string, { model: string; effort: string }>;
  routeLabels?: Record<string, string>;
  routeGuidance?: Record<string, string>;
  routeEscalationGuidance?: Record<string, string>;
};
type RouteTier = {
  level: string;
  label: string;
  guidance: string;
  escalationGuidance: string;
  model: string;
  effort: string;
};

const shortModel = (model: string) => model.replace(/^gpt-/i, 'GPT-');
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
  const [open, setOpen] = useState(false);
  const selectedModel = models.find((item) => item.model === model);
  return (
    <Select
      open={open}
      onOpenChange={setOpen}
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
      {open && (
        <SelectContent
          className="composer-select-content routing-config-content"
          side="bottom"
          align="end"
          alignItemWithTrigger={false}
        >
          {models.map((item) => {
            const efforts = [
              ...new Set(
                [
                  item.defaultReasoningEffort,
                  ...item.supportedReasoningEfforts.map(
                    (option) => option.reasoningEffort,
                  ),
                ].filter(Boolean),
              ),
            ];
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
      )}
    </Select>
  );
}

// Only routing data crosses this boundary; history/token events do not rerender the editor.
export const RoutingSettings = memo(function RoutingSettings({
  routingOpen,
  setRoutingOpen,
  routingButtonRef,
  snapshot,
  csrfToken,
  onSaved,
}: {
  routingOpen: boolean;
  setRoutingOpen: (open: boolean) => void;
  routingButtonRef: RefObject<HTMLButtonElement | null>;
  snapshot: string;
  csrfToken: string;
  onSaved: (config: RoutingConfig) => void;
}) {
  const state = useMemo(
    () =>
      JSON.parse(snapshot) as {
        config?: RoutingConfig;
        models: Model[];
        activeId: string | null;
      },
    [snapshot],
  );
  const [routingBusy, setRoutingBusy] = useState('');
  const [routingError, setRoutingError] = useState('');
  const [routeLabelDrafts, setRouteLabelDrafts] = useState<
    Record<string, string>
  >({});
  const [draggedTier, setDraggedTier] = useState('');
  const [dragTarget, setDragTarget] = useState<{
    level: string;
    position: 'before' | 'after';
  } | null>(null);
  const routingDialogRef = useRef<HTMLDivElement>(null);
  const saveQueue = useRef(createSerialSaveQueue());
  const pendingText = useRef(new Map<string, string>());
  useEffect(() => {
    if (!routingOpen) return;
    document.documentElement.classList.add('routing-settings-open');
    return () =>
      document.documentElement.classList.remove('routing-settings-open');
  }, [routingOpen]);
  async function post<T>(route: string, body: unknown): Promise<T> {
    const response = await fetch('/api/' + route, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Router-Token': csrfToken,
      },
      body: JSON.stringify(body),
    });
    const result = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(result.error || '保存失败');
    return result as T;
  }
  const classifierModel = state?.models.find(
    (item) => item.model === state.config?.classifier,
  );
  const classifierEffort =
    state.config?.classifierEffort ||
    classifierModel?.defaultReasoningEffort ||
    '';
  const routingTiers: RouteTier[] = Object.entries(
    state.config?.routes || {},
  ).map(([level, route]) => ({
    level,
    label: state.config?.routeLabels?.[level] || level,
    guidance: state.config?.routeGuidance?.[level] || '',
    escalationGuidance: state.config?.routeEscalationGuidance?.[level] || '',
    model: route.model,
    effort: route.effort,
  }));

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
    return saveQueue.current(async () => {
      try {
        setRoutingError('');
        setRoutingBusy(key);
        const result = await post<{ ok: boolean; config: RoutingConfig }>(
          'config/routing',
          input,
        );
        onSaved(result.config);
        return true;
      } catch (e) {
        setRoutingError((e as Error).message);
        return false;
      } finally {
        setRoutingBusy('');
      }
    });
  }
  async function saveRouteText(
    tier: RouteTier,
    field: 'label' | 'guidance' | 'escalationGuidance',
    value: string,
  ) {
    const normalized = value.trim();
    const key = `${tier.level}:${field}`;
    if (
      (!normalized && field !== 'escalationGuidance') ||
      normalized === (pendingText.current.get(key) ?? tier[field])
    )
      return true;
    pendingText.current.set(key, normalized);
    const saved = await updateRoutingConfig(key, {
      level: tier.level,
      [field]: normalized,
    });
    if (pendingText.current.get(key) === normalized)
      pendingText.current.delete(key);
    return saved;
  }
  function replaceRoutingTiers(key: string, tiers: RouteTier[]) {
    void updateRoutingConfig(key, { tiers });
  }
  function dropRoutingTier(
    sourceLevel: string,
    targetLevel: string,
    position: 'before' | 'after',
  ) {
    if (!sourceLevel || sourceLevel === targetLevel) return;
    const next = [...routingTiers];
    const sourceIndex = next.findIndex((tier) => tier.level === sourceLevel);
    if (sourceIndex < 0 || !next.some((tier) => tier.level === targetLevel))
      return;
    const [moved] = next.splice(sourceIndex, 1);
    const targetIndex = next.findIndex((tier) => tier.level === targetLevel);
    next.splice(targetIndex + (position === 'after' ? 1 : 0), 0, moved);
    if (next.every((tier, index) => tier.level === routingTiers[index]?.level))
      return;
    void updateRoutingConfig('tiers:reorder', {
      routeOrder: next.map((tier) => tier.level),
    });
  }
  function addRoutingTier() {
    if (routingTiers.length >= 12) return;
    const previous = routingTiers.at(-1);
    const fallbackModel = previous?.model || state?.models[0]?.model;
    const fallbackCatalog = state?.models.find(
      (item) => item.model === fallbackModel,
    );
    const fallbackEffort =
      previous?.effort || fallbackCatalog?.defaultReasoningEffort || '';
    if (!fallbackModel || !fallbackEffort) return;
    let sequence = routingTiers.length + 1;
    while (routingTiers.some((tier) => tier.level === `custom-${sequence}`))
      sequence += 1;
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
    replaceRoutingTiers(
      'tiers:remove',
      routingTiers.filter((_, tierIndex) => tierIndex !== index),
    );
  }

  return (
    <Dialog
      open={routingOpen}
      onOpenChange={(open) => {
        if (
          !open &&
          routingDialogRef.current?.contains(document.activeElement) &&
          document.activeElement instanceof HTMLElement
        ) {
          document.activeElement.blur();
        }
        setRoutingOpen(open);
      }}
    >
      <DialogContent
        className="routing-settings-dialog"
        ref={routingDialogRef}
        finalFocus={routingButtonRef}
      >
        <DialogHeader className="routing-settings-header">
          <DialogTitle>模型路由配置</DialogTitle>
          <DialogDescription>
            按任务复杂度选择模型，遇到新的复杂问题时自动升档。
          </DialogDescription>
          <output className="routing-settings-notice">
            {state.activeId
              ? '任务运行中，配置暂不可修改'
              : routingBusy
                ? '正在保存…'
                : '修改后自动保存'}
          </output>
          {routingError && (
            <p className="inline-error" role="alert">
              {routingError}
            </p>
          )}
        </DialogHeader>
        <div className="routing-details-content">
          {state.config?.classifier && classifierEffort && (
            <div className="routing-config-row classifier-row">
              <span className="classifier-copy">
                <strong>判断模型</strong>
                <small>负责评估任务，选择合适的档位</small>
              </span>
              <RoutingModelSelect
                models={state.models}
                model={state.config?.classifier}
                effort={classifierEffort}
                label="选择判断模型和推理强度"
                disabled={!!state.activeId}
                onChange={(nextModel, nextEffort) =>
                  void updateRoutingConfig('classifier', {
                    classifier: nextModel,
                    classifierEffort: nextEffort,
                  })
                }
              />
            </div>
          )}
          <div className="routing-list-heading">
            <strong>执行档位</strong>
            <span>从低到高排列 · 拖拽调整顺序</span>
          </div>
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
                      const bounds =
                        event.currentTarget.getBoundingClientRect();
                      const position =
                        event.clientY < bounds.top + bounds.height / 2
                          ? 'before'
                          : 'after';
                      setDragTarget((current) =>
                        current?.level === tier.level &&
                        current.position === position
                          ? current
                          : { level: tier.level, position },
                      );
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const sourceLevel =
                        event.dataTransfer.getData('text/plain') || draggedTier;
                      if (dragTarget?.level === tier.level) {
                        dropRoutingTier(
                          sourceLevel,
                          tier.level,
                          dragTarget.position,
                        );
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
                    <ChevronRight className="routing-tier-chevron" size={14} />
                    <span className="routing-tier-summary">
                      <strong>{visibleLabel}</strong>
                    </span>
                    <RoutingModelSelect
                      models={state?.models || []}
                      model={tier.model}
                      effort={tier.effort}
                      label={`选择${visibleLabel || tier.label}使用的模型和推理强度`}
                      disabled={!!state.activeId}
                      onChange={(nextModel, nextEffort) =>
                        void updateRoutingConfig(tier.level, {
                          level: tier.level,
                          model: nextModel,
                          effort: nextEffort,
                        })
                      }
                    />
                  </summary>
                  <div className="routing-tier-editor">
                    <label>
                      <span>名称</span>
                      <input
                        key={`label-${tier.level}`}
                        defaultValue={tier.label}
                        maxLength={30}
                        disabled={!!state.activeId}
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
                          if (!saved && input.value.trim() === nextLabel)
                            input.value = tier.label;
                          setRouteLabelDrafts((current) => {
                            const next = { ...current };
                            if (next[tier.level]?.trim() === nextLabel)
                              delete next[tier.level];
                            return next;
                          });
                        }}
                      />
                    </label>
                    <label>
                      <span>判断描述</span>
                      <textarea
                        key={`guidance-${tier.level}`}
                        defaultValue={tier.guidance}
                        maxLength={600}
                        rows={3}
                        disabled={!!state.activeId}
                        onBlur={async (event) => {
                          const input = event.currentTarget,
                            value = input.value;
                          if (!value.trim()) {
                            input.value = tier.guidance;
                            return;
                          }
                          const saved = await saveRouteText(
                            tier,
                            'guidance',
                            value,
                          );
                          if (!saved && input.value === value)
                            input.value = tier.guidance;
                        }}
                      />
                    </label>
                    <label>
                      <span>升级判断规则</span>
                      <textarea
                        key={`escalation-${tier.level}`}
                        defaultValue={tier.escalationGuidance}
                        maxLength={600}
                        rows={3}
                        placeholder="哪些新发现需要升档？留空则由模型按任务判断。"
                        disabled={!!state.activeId}
                        onBlur={async (event) => {
                          const input = event.currentTarget;
                          const value = input.value;
                          const saved = await saveRouteText(
                            tier,
                            'escalationGuidance',
                            value,
                          );
                          if (!saved && input.value === value)
                            input.value = tier.escalationGuidance;
                        }}
                      />
                    </label>
                    <div className="routing-tier-actions">
                      <button
                        type="button"
                        className="danger"
                        aria-label={`删除${visibleLabel || tier.label}`}
                        disabled={
                          routingTiers.length <= 2 ||
                          !!state?.activeId ||
                          !!routingBusy
                        }
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
              disabled={
                routingTiers.length >= 12 || !!state?.activeId || !!routingBusy
              }
              onClick={addRoutingTier}
            >
              <Plus size={14} />
              添加档位
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
});
