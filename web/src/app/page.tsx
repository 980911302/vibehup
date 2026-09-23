'use client';

import { useEffect } from 'react';

/**
 * 根路径 → /board。
 * 静态导出下 next/navigation 的 redirect() 会在预渲染期抛错，故用客户端重定向。
 */
export default function RootPage() {
  useEffect(() => {
    window.location.replace('/board');
  }, []);
  return (
    <meta httpEquiv="refresh" content="0; url=/board" />
  );
}
