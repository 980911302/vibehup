import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 静态导出：构建产物由 VibeHub Server (Fastify) 直接托管，实现单容器部署
  output: 'export',
  images: { unoptimized: true },
  // 关闭左下角 Next.js 开发指示标（用户要求隐藏浮动 N 图标；仅影响 dev 模式）
  devIndicators: false,
  // 开发环境下将 /api 代理到本地 Fastify 服务（3210）
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.VIBEHUB_API_URL ?? 'http://127.0.0.1:3210'}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
