# VIDEX · 视频提取

> 多平台短视频解析与下载工具，支持视频下载、音频提取、多清晰度选择。

## 功能

- **多平台支持**：抖音、快手分享链接自动识别解析
- **无水印视频下载**：优先获取无水印源，支持多清晰度选择
- **音频提取**：一键从视频中提取音频，支持 WAV / WebM / M4A / OGG 格式，纯前端转码零后端负载
- **互动数据**：播放量、点赞、评论、转发等数据一目了然
- **深色 / 浅色主题**：一键切换，二进制雨动画背景
- **Web Share API**：移动端支持系统级分享
- **实时日志**：下载记录 + IP 地理位置展示

## 目录

```
videx/
└── server/              # Web 应用与 Node.js 后端
    ├── src/
    │   ├── index.js     # Express 服务 + 路由 + 代理下载
    │   └── parser.js    # 多平台解析引擎（抖音 + 快手）
    ├── public/
    │   └── index.html   # 前端单页应用
    └── package.json
```

## 架构

```
用户浏览器                    VIDEX Server                 视频平台
┌──────────┐    POST /api/parse    ┌──────────┐   yt-dlp / HTTP   ┌──────────┐
│          │ ──────────────────▶  │          │ ───────────────▶ │ 抖音 CDN  │
│  单页应用  │                      │  Express  │                  │ 快手 CDN  │
│ index.html│ ◀────────────────── │  Server   │ ◀─────────────── │          │
│          │    JSON (视频元数据)    │          │   视频/HTML 流    └──────────┘
│          │                      │          │
│          │  GET /api/download   │  代理下载   │
│          │ ──────────────────▶  │          │
│          │ ◀──────────────────  │          │
└──────────┘    视频流 (pipe)      └──────────┘
```

核心设计：前端只与 VIDEX Server 通信，由服务端代理访问视频平台 CDN（绕过浏览器跨域/Referer限制）。

## 技术栈

| 层   | 技术                                            |
|-----|-------------------------------------------------|
| 前端 | 原生 HTML/CSS/JS，零框架，Web Audio API + MediaRecorder |
| 后端 | Node.js + Express + Axios                       |
| 解析 | yt-dlp（主路径）→ HTML 页面解析（降级路径）           |
| 音频 | 浏览器端 Web Audio API 解码 + MediaRecorder 编码    |

## 依赖

### 后端 (server/package.json)

| 包        | 用途           |
|-----------|--------------|
| express   | HTTP 服务 & 路由 |
| axios     | HTTP 请求 & 流代理 |
| cors      | 跨域支持       |
| dotenv    | 环境变量       |

### 系统依赖

- **Python 3 + yt-dlp**：`pip install yt-dlp`，用于解析抖音视频元数据和多清晰度获取

### 前端

零依赖，纯浏览器 API。

## 核心代码

### 解析引擎 (server/src/parser.js)

统一的 `parse(text)` 入口自动识别平台：

```js
async function parse(text) {
  const url = extractUrl(text || '');
  if (isKuaishouUrl(url)) return parseKuaishou(text);  // 快手
  return parseDouyin(text);                             // 抖音
}
```

**抖音解析流程**：
1. `parseWithYtDlp(url)` — 调用 yt-dlp 获取完整元数据（标题、作者、互动数据、多格式）
2. 降级 `resolveAwemeId → fetchItemInfoFromHtml` — 从 `_ROUTER_DATA` 提取视频信息

**快手解析流程**：
1. `parseWithYtDlp(url)` — yt-dlp 尝试（服务器 yt-dlp 版本较旧时可能不支持）
2. 降级 `parseKuaishouHtml(url)` — 解析短链重定向 → 提取 `window.INIT_STATE` 中的 photo 对象

### 安全代理下载

```js
const payload = verifyDownloadToken(req.query.token, tokenSecret);
assertAllowedMediaUrl(payload.url);
const upstream = await openMediaStream(payload.url, { range: req.headers.range });
```

解析接口将媒体 URL 替换为短期签名令牌。下载接口只接受令牌，并对媒体域名、每次重定向及 DNS 解析结果做校验，拒绝私网、环回、链路本地等地址。代理支持 Range 请求、下载大小限制、并发限制和客户端断开取消。

### 音频提取 (server/public/index.html)

纯前端实现，零后端负载：

- **WAV**：`AudioContext.decodeAudioData()` → 手动构造 PCM WAV 文件头 + 数据
- **WebM/M4A/OGG**：`AudioContext.createMediaElementSource()` → `MediaStreamDestination` → `MediaRecorder` 编码

格式根据 `MediaRecorder.isTypeSupported()` 动态检测，不可用的不显示。

## 部署

### 1. 服务器准备

```bash
# 安装 Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# 安装 Python 和固定版本的 yt-dlp
sudo apt install -y python3 python3-pip
python3 -m pip install -r server/requirements.txt
```

### 2. 部署服务

```bash
cd server
npm ci --omit=dev
cp .env.example .env
# 编辑 .env，至少设置 DOWNLOAD_TOKEN_SECRET

# 前台运行
npm start

# 后台运行
nohup node src/index.js > server.log 2>&1 &
```

默认监听 `8787` 端口，可通过 `.env` 中的 `PORT` 修改。

启动时会执行 `python3 -m yt_dlp --version`。Python 路径可通过 `PYTHON_BIN` 修改，缺少运行依赖时服务会直接退出并输出错误。

也可以从仓库根目录使用 Docker 构建：

```bash
docker build -t videx .
docker run --rm -p 8787:8787 --env-file server/.env videx
```

### 3. Nginx 反代

```nginx
server {
    listen 80;
    server_name dy.lukouzi.icu;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering off;
        proxy_read_timeout 120s;
    }
}
```

### 4. 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `8787` | 服务监听端口 |
| `PYTHON_BIN` | `python3` | Python 可执行文件 |
| `DOWNLOAD_TOKEN_SECRET` | 启动时随机生成 | 下载令牌签名密钥；生产环境必须固定配置，多实例必须相同 |
| `DOWNLOAD_TOKEN_TTL_MS` | `600000` | 下载令牌有效期（毫秒） |
| `MAX_DOWNLOAD_BYTES` | `524288000` | 单次下载最大字节数 |
| `MAX_PARSE_CONCURRENCY` | `2` | 最大并发解析数 |
| `MAX_DOWNLOAD_CONCURRENCY` | `4` | 最大并发下载数 |
| `RATE_LIMIT_WINDOW_MS` | `60000` | API 限流窗口（毫秒） |
| `RATE_LIMIT_MAX` | `60` | 每个 IP 在窗口内的最大请求数 |
| `MEDIA_HOST_ALLOWLIST` | 空 | 额外可信媒体 CDN 域名后缀，逗号分隔 |
| `CORS_ORIGIN` | 空 | 需要跨域调用时允许的来源 |

## 测试与 CI

```bash
cd server
npm ci
npm test
npm run check:runtime
```

单元测试使用脱敏 fixture 覆盖抖音 `_ROUTER_DATA`、快手 `INIT_STATE`、格式筛选、下载令牌和 SSRF 防护。GitHub Actions 会在 push 和 pull request 时运行完整测试。

计划任务 `Live platform check` 可用仓库 Secrets `DOUYIN_TEST_URL`、`KUAISHOU_TEST_URL` 提供真实测试链接；未配置的目标会跳过。

## API

### POST /api/parse

解析分享链接，返回视频元数据。

请求：`{ "text": "<分享文案或链接>" }`

响应：
```json
{
  "code": 0,
  "data": {
    "videoUrl": "<signed-download-token>",
    "cover": "https://...",
    "title": "xxxx",
    "author": "xxxx",
    "duration": 22,
    "durationFormatted": "0:22",
    "viewCount": 1048638,
    "likeCount": 6284,
    "commentCount": 1245,
    "width": 720,
    "height": 1280,
    "formats": [
      { "formatId": 1, "label": "720p", "height": 1280, "url": "<signed-download-token>", "filesize": 4566435 }
    ],
    "platform": "kuaishou"
  }
}
```

### GET /api/download?token=\<signedToken\>

使用解析接口返回的短期签名令牌代理下载视频流。服务端不会接受任意 URL。

### POST /api/log-download

记录一次下载事件（轻量，用于日志展示）。

### GET /api/logs

获取最近 20 条下载日志。

## License

MIT
