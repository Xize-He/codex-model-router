export const sessionKindLabels = {
  'gpt-codex': 'GPT · Codex',
  'deepseek-harness': 'DeepSeek · Harness',
};
export function validSessionKind(kind) {
  return typeof kind === 'string' && Object.hasOwn(sessionKindLabels, kind);
}
/** Infer older sessions without modifying their titles or native identifiers. */
export function sessionKind(session) {
  if (!session) return 'gpt-codex';
  if (session.engine === 'harness' || session.harnessSessionId || session.model === 'deepseek-harness/flash') return 'deepseek-harness';
  // Recognize retired records so they cannot be imported or resumed as GPT sessions.
  if (session.kind === 'deepseek-codex' || session.modelProvider === 'router_deepseek' || session.model === 'deepseek-flash') return 'deepseek-codex';
  if (validSessionKind(session.kind)) return session.kind;
  const model = session.tasks?.find(task => task.route?.model || task.mode)?.route?.model || session.tasks?.find(task => task.mode)?.mode;
  if (model === 'deepseek-harness/flash') return 'deepseek-harness';
  if (model === 'deepseek-flash') return 'deepseek-codex';
  return 'gpt-codex';
}
export function defaultSessionModel(kind) {
  return { 'deepseek-harness': 'deepseek-harness/flash' }[kind] || 'auto';
}
export function sessionAllowsModel(kind, model) {
  if (!validSessionKind(kind)) return false;
  return kind === 'gpt-codex'
    ? model !== 'deepseek-flash' && model !== 'deepseek-harness/flash'
    : model === defaultSessionModel(kind);
}
