import { startStdioServer } from './mcp/server.js';
import { resolveMcpContext, McpContextError } from './mcp/context.js';

/**
 * MCP stdio 入口：供 IDE Agent 以子进程方式拉起。
 * 契约：密钥无效（不存在/撤销/过期）时启动即失败，stderr 人话说明，绝不静默降权。
 */
async function main(): Promise<void> {
  // 启动前先解析上下文：无效密钥直接退出（不建立 stdio 通道）
  await resolveMcpContext();
  await startStdioServer();
}

main().catch((err) => {
  if (err instanceof McpContextError) {
    console.error(`[vibehub-mcp] MCP 启动失败: ${err.message}`);
    process.exit(1);
  }
  console.error('[vibehub-mcp] 启动失败:', err);
  process.exit(1);
});
