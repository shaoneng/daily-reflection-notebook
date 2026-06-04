# 每日记录及复盘笔记本

一个手机优先的网页版每日笔记本：一天可以多次输入，系统按设备时间写入当天 Markdown；点击“复盘”后，后端把当天 Markdown 交给 AI，生成辅助复盘，并把复盘结果追加回同一个 Markdown 文件。

## 已包含

- 手机浏览器可用的单页应用
- Cloudflare Workers 后端
- Workers Static Assets 托管前端
- Cloudflare KV 存储，每天一个 Markdown key
- Markdown 导出
- 标签提取和全文搜索
- 访问口令保护
- 近一周记录对照复盘，识别重复事项和相关联的事情
- 学习复盘模式，优先使用 DeepSeek 生成可执行的学习复盘
- DeepSeek `deepseek-v4-pro` 优先，Workers AI / OpenAI 作为可选备用

## 本地运行

```bash
npm install
npm run dev
```

默认本地地址通常是：

```text
http://localhost:8788
```

如果设置了 `APP_PASSWORD`，第一次打开页面后点右上角设置，输入同一个口令。

## Cloudflare Workers 配置

1. 在 Cloudflare 创建 KV namespace，例如 `daily_notes`。
2. 在 Workers 项目里绑定 KV：
   - Binding name: `NOTES_KV`
   - KV namespace: 选择刚创建的 namespace
3. 设置环境变量：
   - `APP_PASSWORD`: 访问口令
   - `DEEPSEEK_API_KEY`: DeepSeek API key
   - `DEEPSEEK_MODEL`: `deepseek-v4-pro`
   - `DEEPSEEK_BASE_URL`: 可选，默认 `https://api.deepseek.com`
   - 学习复盘模式必须配置 `DEEPSEEK_API_KEY`，日常复盘可继续使用 Workers AI / OpenAI 备用
4. 如果使用 Workers AI 作为备用，在 Worker 设置里添加 AI binding：
   - Binding name: `AI`
5. 如果使用 OpenAI 作为备用，也可以设置：
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL`

Cloudflare Workers Static Assets 会根据 `wrangler.toml` 里的 `[assets]` 配置上传 `public/` 目录，API 请求由 `src/worker.js` 处理。

DeepSeek 当前官方文档说明 `deepseek-v4-pro` 可通过 OpenAI 兼容格式调用，base URL 为 `https://api.deepseek.com`，接口为 `/chat/completions`。

## GitHub + Cloudflare Workers 部署

1. 把本目录提交到 GitHub 仓库。
2. Cloudflare Dashboard → Workers & Pages → Create → Worker → Connect to Git。
3. 选择仓库后保持默认 deploy command，或使用：
   - Deploy command: `npx wrangler deploy`
4. `wrangler.toml` 已经声明：
   - Worker entry: `src/worker.js`
   - Static assets: `public/`
5. 绑定 `NOTES_KV`、`AI`，并设置环境变量。
6. 重新部署一次，让绑定生效。

## Markdown 格式

每天一个 Markdown 文件，格式示例：

```markdown
# 2026-05-15

## 09:32（Asia/Shanghai）

做了一个每日记录产品的 MVP。#产品

---

## AI 复盘（2026-05-15T01:35:00.000Z）

### 1. 今天的事实摘要
- ...
```

## 目标审计结果

原目标里会空转的词主要是“每日记录”“复盘”“自己在干嘛”。现在它们已经替换为可检查的交付物：

> 做一个可在手机浏览器打开、部署到 Cloudflare Workers、源码在 GitHub、每天按系统时间把多次输入合并保存为同一个 Markdown 文件，并能点击按钮调用 AI 对当天 Markdown 生成辅助复盘的网页应用。

失败线：

- 没有保存为 Markdown，算没做到。
- 没有 AI 辅助复盘，算没做到。
