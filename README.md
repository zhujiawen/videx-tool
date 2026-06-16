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
├── server/              # Node.js 后端
│   ├── src/
│   │   ├── index.js     # Express 服务 + 路由 + 代理下载
│   │   └── parser.js    # 多平台解析引擎（抖音 + 快手）
│   ├── public/
│   │   └── index.html   # 前端单页应用
│   └── package.json
└── miniprogram/         # 微信小程序（旧版）
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
3. HEAD 请求并行获取各格式文件大小

### 代理下载 (server/src/index.js)

```js
app.get('/api/download', async (req, res) => {
  const upstream = await axios.get(url, {
    responseType: 'stream',
    headers: { 'User-Agent': IPHONE_UA, 'Referer': 'https://www.douyin.com/' },
  });
  upstream.data.pipe(res);
});
```

浏览器无法直接访问视频平台 CDN（Referer/UA 限制），通过服务端代理 pipe 视频流。

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

# 安装 Python + yt-dlp
sudo apt install -y python3 python3-pip
pip3 install yt-dlp
```

### 2. 部署服务

```bash
cd server
npm install --production

# 前台运行
npm start

# 后台运行
nohup node src/index.js > server.log 2>&1 &
```

默认监听 `8787` 端口，可通过 `.env` 中的 `PORT` 修改。

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

| 变量   | 默认值  | 说明      |
|--------|---------|----------|
| PORT   | 8787    | 服务监听端口 |

## API

### POST /api/parse

解析分享链接，返回视频元数据。

请求：`{ "text": "<分享文案或链接>" }`

响应：
```json
{
  "code": 0,
  "data": {
    "videoUrl": "https://...",
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
      { "formatId": 1, "label": "720p", "height": 1280, "url": "https://...", "filesize": 4566435 }
    ],
    "platform": "kuaishou"
  }
}
```

### GET /api/download?url=\<encodedUrl\>

代理下载视频流。

### POST /api/log-download

记录一次下载事件（轻量，用于日志展示）。

### GET /api/logs

获取最近 20 条下载日志。

## License

MIT
