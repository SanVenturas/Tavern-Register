#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "[Tavern-Register] 检查 Node.js 与 npm..."
if ! command -v node >/dev/null 2>&1; then
  echo "错误：未检测到 node，可从 https://nodejs.org/ 下载并安装。" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "错误：未检测到 npm，请安装 Node.js（包含 npm）。" >&2
  exit 1
fi

# 安装依赖（检测 node_modules 目录）
if [ ! -d "node_modules" ]; then
  echo "[Tavern-Register] 未检测到依赖，正在安装..."
  npm install --no-audit --no-fund
else
  echo "[Tavern-Register] 已检测到 node_modules，跳过安装。如需强制安装请手动运行 'npm install'。"
fi

# 启动应用（前台运行，适合开发或 supervisor 管理）
echo "[Tavern-Register] 启动应用（npm run start）..."
exec npm run start
