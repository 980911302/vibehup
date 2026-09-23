#!/usr/bin/env bash
# VibeHub 容器入口：进程全部交由 supervisord 管理（postgres pri 10 + vibehub pri 20）。
#
# 历史（R53 修复）：原入口在此执行「等 PG→建扩展→迁移」五步序列后才 exec supervisord，
# 但 PG 恰由 supervisord 管理——顺序倒置导致 PG 永远不起、60s 超时后建扩展失败退出。
# 现就绪等待与迁移下沉到 /app/dist/bootstrap.js（supervisord 的 vibehub 程序命令）。
#
# R54 补充：运行时组装 DATABASE_URL（Dockerfile ENV 在构建期展开，拿不到 -e 注入的密码），
# supervisord 子进程继承本环境；prisma migrate 与应用共用此连接串（127.0.0.1:5432，库内本地）。
# 注意：POSTGRES_PASSWORD 含 URL 特殊字符（@ : / 等）时需自行转义或避开。
set -euo pipefail

export DATABASE_URL="postgresql://${POSTGRES_USER:-vibehub}:${POSTGRES_PASSWORD:-vibehub}@127.0.0.1:5432/${POSTGRES_DB:-vibehub}"

exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf -n
