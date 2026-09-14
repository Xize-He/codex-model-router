import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Model Router · 本地智能工作台', description: '自动选择模型，连接本地 Codex 与 MCP 服务。' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
