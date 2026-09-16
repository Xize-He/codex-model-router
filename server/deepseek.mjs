export const DEEPSEEK_MODEL = 'deepseek-flash';
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
