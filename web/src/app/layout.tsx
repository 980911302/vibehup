import type { Metadata, Viewport } from 'next';
import { AuthProvider } from '@/lib/auth';
import { ThemeProvider } from '@/lib/theme';
import { ToastProvider } from '@/lib/toast';
import './globals.css';

export const metadata: Metadata = {
  title: 'VibeHub — AI Native 研发上下文总线',
  description: '面向 AI Native 研发团队的双端同步研发上下文总线：Web 看板 + MCP 服务',
};

export const viewport: Viewport = {
  themeColor: '#0b1020',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="dark" data-theme="midnight">
      <body className="overflow-hidden">
        <ThemeProvider>
          <ToastProvider>
            <AuthProvider>{children}</AuthProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
