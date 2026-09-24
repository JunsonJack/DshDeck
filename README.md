# DshDeck

基于 DeepSeek Harness（`dsh --profile acp`）的薄壳桌面 Agent 工作台。

产品规划见仓库根目录 `DshDeck-产品规划.md`（v0.2）。W0 协议实测见 `docs/W0-调研笔记.md`。

## 快速开始（M1）

```powershell
cd DshDeck
npm install
npm run dev
# 浏览器打开 http://127.0.0.1:5177
```

可选：`node apps/dshdeck-host/server.mjs --cwd <工作区> --port 5177`

## 结构

| 路径 | 职责 |
|---|---|
| `packages/acp-client` | ACP JSON-RPC 桥（协议唯一入口） |
| `apps/dshdeck-host` | HTTP + WebSocket 宿主（M1；后续可换 Tauri） |
| `apps/dshdeck-ui` | 工作台界面（PIDeck 布局 + 热力图 + 快捷词） |
| `probe/` | W0 协议探针 |
| `docs/` | W0 调研与轨迹 |
| `src-tauri/` | （预留）Tauri 壳 |

## 红线

- 不手写 `~/.dsh` 下 dsh 自有文件
- 会话真值在 dsh；壳只读为主
- Agent 逻辑零复制，只走 ACP

<!-- diff-demo -->
