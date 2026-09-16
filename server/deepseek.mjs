export const DEEPSEEK_MODEL = 'deepseek-flash';
export const DEEPSEEK_PROVIDER = 'router_deepseek';
export const deepseekModel = {
  model: DEEPSEEK_MODEL, displayName: 'DeepSeek V4.1 Flash',
  description: 'DeepSeek API · 独立计费', provider: DEEPSEEK_PROVIDER, manualOnly: true,
  defaultReasoningEffort: 'high', inputModalities: ['text', 'image'],
  supportedReasoningEfforts: ['low', 'high', 'max'].map(reasoningEffort => ({ reasoningEffort })),
};
export function deepseekSettings() {
  return {
    modelProvider: DEEPSEEK_PROVIDER,
    config: {
      [`model_providers.${DEEPSEEK_PROVIDER}`]: {
        name: 'DeepSeek', base_url: 'https://api.deepseek.com',
        env_key: 'DEEPSEEK_API_KEY', wire_api: 'responses', requires_openai_auth: false,
      },
      model_context_window: 1000000,
      model_auto_compact_token_limit: 900000,
      model_supports_reasoning_summaries: true,
      model_reasoning_summary: 'none',
      web_search: 'disabled',
    },
  };
}
export function sessionUsesDeepseek(session) {
  return session?.modelProvider === DEEPSEEK_PROVIDER || session?.model === DEEPSEEK_MODEL;
}
export async function checkDeepseekKey(key, fetcher = fetch) {
  if (!key) throw new Error('请先配置 DeepSeek API Key');
  const response = await fetcher('https://api.deepseek.com/models', {
    headers: { Authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  // Never echo a remote error body: it may contain credential details.
  if (!response.ok) throw new Error(`DeepSeek 连接检测失败（HTTP ${response.status}）`);
  const data = await response.json();
  if (!data.data?.some(item => item.id === DEEPSEEK_MODEL)) throw new Error('该 API Key 未返回 deepseek-flash 模型');
  return { ok: true };
}
