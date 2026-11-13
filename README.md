# 长江雨课堂 AI 学习助手

适配长江雨课堂的 Manifest V3 浏览器扩展，目标浏览器为 Microsoft Edge 和 Google Chrome。

- GitHub 仓库：https://github.com/ghenczz/rainclassroom-ai
- 问题反馈：https://github.com/ghenczz/rainclassroom-ai/issues

> **第一次使用？** 先看 [使用说明](使用说明.md)，里面有安装、API 配置、常见问题和分享方法。

> **非官方开源项目。** 本项目与长江雨课堂、学堂在线、DeepSeek 及其关联公司没有隶属、授权或合作关系。
> 仅用于个人学习辅助和题目解析，**不得用于作弊、代替考试、自动提交或绕过平台访问控制**。
> 使用前请自行确认符合所在课程和平台的服务条款。

> **当前状态：第五阶段代码已完成（v0.5.2）。**
> 已实现课程/任务识别、视频识别、作业题目动态解码、结构化 DeepSeek 分析接口和侧边栏题目分析界面。
> 配置 API 后，侧边栏打开时检测到新题目会自动分析，不再需要逐题点击按钮。
> 单选题和判断题已在真实作业页面验证；多选题解析逻辑已实现但尚未真实验证；填空题尚未支持。

## 已完成功能

### 第一阶段

- Manifest V3 扩展清单
- TypeScript 严格模式工程
- esbuild 构建流程
- MV3 Service Worker
- 扩展生命周期记录
- 工具栏状态徽标
- 自动化构建测试

### 第二阶段

- 右侧 Side Panel
- 现代化中文界面，支持浅色和深色模式
- 七个功能入口：当前课程、视频学习、AI 问答、题目分析、错题记录、学习历史、API 设置
- 点击工具栏图标打开侧边栏
- 本地 API 配置与密钥隐藏/清除

### 第三阶段

- 识别长江雨课堂课程、班级、当前任务
- 识别视频页、作业页和其他页面
- 监听 DOM 与单页应用路由变化
- 使用页面指纹去重并按标签页隔离状态
- 未匹配页面不会猜测页面类型

### 第四阶段

- 检测 HTML5 视频并读取标题
- 显示与保存播放进度
- 读取 HTML5 `textTracks` 中已加载的字幕
- 明确显示“无可访问字幕”，不生成虚构内容
- 每 5 秒、暂停、跳转和结束保存本机进度

### 第五阶段

- 从作业 iframe 的真实 DOM 中读取当前题目
- 修复题号方块与真实题目共用 `.subject-item` 导致的选择错误
- 识别题型、题号、题干和选项
- 自动发现页面 `@font-face` 中的题目字体 URL
- **运行时动态解码字体混淆文本**，不依赖固定字体 hash
- 使用字形轮廓结构匹配参考字体，生成当前字体的明文字符映射
- 缓存字体映射并限制字体下载域名
- DeepSeek API 服务：
  - OpenAI 兼容 `chat/completions` 请求
  - 45 秒超时
  - 自动重试不支持 `response_format` 的接口
  - 严格 JSON 解析与 TypeScript 运行时校验
  - 非法选项 key 自动标记不确定
- 侧边栏题目分析界面：
  - 显示题干与选项
  - 显示候选答案、解析、置信度
  - 不确定结果醒目标记
  - API 未配置时引导到设置
- 判断题选项识别（v0.5.2）：
  - 判断题的“正确/错误”选项在真实页面中只有 SVG 图标，没有文字
  - 通过 `input.value` 的 `true/false` 和图标引用还原为“正确/错误”
  - 已用真实判断题验证识别和分析
- 自动分析（v0.5.1）：
  - 侧边栏打开时，检测到新题目后约 0.9 秒自动请求分析
  - 无需逐题点击“分析”按钮
  - 同一道题在本次侧边栏会话内复用结果，避免重复计费
  - 可在 API 设置中关闭自动分析
  - 保存设置时一并申请 API 域名权限，之后自动调用不再弹授权窗口
- 不自动选择选项、不自动填写、不自动提交

## 题目字体解码说明

雨课堂作业 iframe 的题目文本使用动态生成的字体混淆：

- 每次加载可能生成不同的 `exam_font_{hash}.ttf`
- DOM 中的 `textContent` 不是实际显示的题目文字
- 固定硬编码映射无法长期工作

本扩展采用运行时解码：

```text
读取 iframe 中当前 @font-face
        ↓
后台下载并解析当前字体
        ↓
提取每个字形的轮廓结构签名
        ↓
与内置的参考字形索引比对
        ↓
得到“密文字符 → 明文字符”映射
        ↓
仅对加密 span 解码，其他文本保持原样
```

参考索引位于：

```text
src/services/font-reference-index.json
```

参考索引由 Noto Sans SC Regular 字形轮廓生成，不包含第三方字体文件本身。Noto Sans SC 使用 SIL Open Font License。

重新生成参考索引：

```powershell
node scripts/build-font-reference.mjs <NotoSansSC-Regular.ttf> src/services/font-reference-index.json
```

## 真实页面验证

已在真实作业页面验证：

- 页面内存在 5 个题号方块和 1 个真实题目容器，二者都使用 `.subject-item`
- 当前选择器只选择同时包含 `.item-type` 和 `.problem-body` 的容器
- 字体 hash 在页面重新加载后发生变化
- 动态字体解码成功还原题干和全部选项
- 从第 1 题切换到第 3 题时，侧边栏自动更新题目内容并自动分析
- 判断题的选项在 DOM 中只有 `icon--tiankongtizhengque` / `icon--tiankongticuowu` 图标，没有文字
- 判断题已正确显示为“A 正确 / B 错误”，并返回候选答案
- 单选题“PDCA 循环分为几个阶段”返回 C，与页面正确答案一致
- 判断题“PDCA 循环含义”返回 A（正确），解析与题干一致
- 没有把字体乱码发送给 AI
- 页面没有配置 API Key 时，分析按钮引导到 API 设置

## DeepSeek 接入状态

代码路径：

```text
Side Panel 打开 + 检测到新题目
   ↓ 等待题目稳定（约 0.9 秒）
检查自动分析开关、API 设置与域名权限
   ↓
Service Worker
   ↓ 读取本地 API 设置
DeepSeek chat/completions
   ↓
JSON 解析 + 类型校验
   ↓
分析结果返回 Side Panel，并缓存在本次会话中
```

手动点击“使用 DeepSeek 分析”仍然可用，用于立即分析或强制重新分析。

已通过模拟响应的自动化测试验证：

- URL 补全
- 请求头与结构化输出解析
- `response_format` 不支持时重试
- 非法 JSON 拒绝
- 非法选项 key 标记为不确定

**真实 API 已验证：** 在本机使用 `deepseek-flash` 模型完成单选题和判断题的自动分析。第 1 题和第 3 题与页面答案一致。

真实测试也发现了错误：第 2 题“PDCA 有几大特点”页面正确答案为 3 个，模型按通用知识回答 4 个，置信度 70%。这说明**模型只依据题干和通用知识作答，并不了解课程教材中的特定表述**。扩展无法在不读取课程材料的情况下保证这类题目的正确性。

因此增加了两层保护：

- 置信度低于 **75%** 时自动标记为不确定，并显示警告；
- 分析结果明确提示“AI 未读取课程教材”。

如果发现答案准确率偏低，优先把模型 ID 从 `deepseek-flash` 改为服务商提供的更强模型（例如 `deepseek-chat`，以服务商文档为准）。Flash 模型速度更快、成本更低，但判断能力通常弱于标准模型。修改模型 ID 后保存即可，不需要改代码。

**注意：** 保存设置时浏览器会请求 API 域名权限；之后侧边栏打开时，检测到新题目会自动分析。若关闭“自动分析新题目”，仍可手动点击按钮。

API Key：

- 只保存在本机 `chrome.storage.local`
- 只由 Service Worker 读取
- 不会写入日志或页面内容
- 不会发送到 DeepSeek 以外的地方
- 可随时在设置中清除

## 权限

```json
"permissions": ["storage", "sidePanel"],
"host_permissions": [
  "https://changjiang.yuketang.cn/*",
  "https://fe-static-yuketang.yuketang.cn/*"
],
"optional_host_permissions": [
  "https://*/*",
  "http://localhost/*",
  "http://127.0.0.1/*"
]
```

- 长江雨课堂主域用于内容脚本。
- 雨课堂静态资源域只用于下载当前题目字体。
- API 域名权限在用户保存 API 设置时按实际 API 域名动态申请。
- 没有申请 Cookie、WebRequest、Tabs 或全站访问权限。

## 尚未实现或尚未真实验证

- 填空题结构尚未在真实页面验证，当前会明确拒绝分析，不会猜测答案
- 多选题使用 Element UI `label.el-checkbox` 解析，并增加了 `.el-checkbox__label` 文本回退，但尚未在真实多选题上验收
- 尚未实现练习题辅助填写
- 尚未实现错题本、学习历史数据库
- 判断题已用真实页面和真实 DeepSeek API 验证

## 环境要求

- Windows 10/11
- Microsoft Edge 116 或更高版本（本机使用 Edge 157.0.4341.42 验证）
- Node.js 20.11 或更高版本（本机使用 Node.js 24.21.0）
- npm 10 或更高版本

## 安装、构建与测试

```powershell
cd path\to\rainclassroom-ai
npm install
npm test
```

`npm test` 会执行类型检查、构建，以及：

1. manifest、Side Panel 和构建产物校验；
2. 视频字幕选择、去重和进度存储测试；
3. DeepSeek URL、结构化 JSON、重试和异常测试；
4. 字体资源域名白名单与参考索引完整性测试；
5. 自动分析入口、授权状态与设置项校验；
6. 判断题 true/false 与 SVG 图标选项映射校验；
7. 低置信度结果自动标记不确定。

当前基线：**28 项测试全部通过**。

## 获取已构建版本

推荐从 [Releases](https://github.com/ghenczz/rainclassroom-ai/releases) 下载 `rainclassroom-ai-v0.5.2-dist.zip`。解压后会得到一个 `rainclassroom-ai-0.5.2/` 目录，加载里面的 `dist/` 子目录。

本地构建并打包：

```powershell
npm install
npm run package
```

会生成：

- `release/rainclassroom-ai-v0.5.2-dist.zip`：扩展 + 使用说明 + 许可证
- `release/rainclassroom-ai-v0.5.2-source.zip`：完整源码

只构建不打包时运行 `npm run build`，产物在 `dist/`。不要把项目根目录加载为扩展。

仓库同时提供 `docs/github-actions-ci.yml`。如果你的 GitHub 授权包含 `workflow` 权限，可以把它复制到 `.github/workflows/ci.yml`，启用自动测试和构建产物上传。

运行 Edge 冒烟测试：

```powershell
npm run smoke:edge
```

## 在 Edge 中加载或更新

扩展必须加载 `dist` 目录，不能加载项目根目录。

1. 打开 `edge://extensions/`。
2. 开启“开发人员模式”。
3. 选择“加载解压缩的扩展”，目录：
   ```text
   path\to\rainclassroom-ai\dist
   ```
4. 更新代码后，重新运行 `npm run build`，点击扩展卡片上的“重新加载”。
5. **刷新已经打开的雨课堂页面**，让新的内容脚本注入。
6. 关闭并重新打开 Side Panel。

## 使用题目分析

1. 打开包含题目的雨课堂作业页。
2. 点击工具栏扩展图标打开 Side Panel。
3. 首次使用先进入“API 设置”，填写：
   - API 地址（默认 `https://api.deepseek.com`）
   - 模型 ID
   - API Key
   - 保持勾选“自动分析新题目”
4. 点击“保存设置”。浏览器如弹出 API 域名访问权限提示，请确认授权。
5. 进入“题目分析”。检测到新题目后会自动分析，无需点击按钮。
6. 如需要立即重新分析当前题目，可点击“重新分析”。

自动分析只在 Side Panel 打开时运行；关闭侧边栏不会在后台调用 API。扩展只显示分析结果，不会自动选择、填写或提交答案。

## 当前项目结构

```text
rainclassroom-ai/
├── manifest.json
├── package.json
├── package-lock.json
├── tsconfig.json
├── .gitignore
├── LICENSE
├── README.md
├── CHANGELOG.md
├── CONTRIBUTING.md
├── SECURITY.md
├── THIRD_PARTY_NOTICES.md
├── 使用说明.md
├── 使用说明.txt
├── docs/
│   └── github-actions-ci.yml
├── scripts/
│   ├── build.mjs
│   ├── build-font-reference.mjs
│   ├── clean.mjs
│   ├── package-release.ps1
│   └── smoke-edge.mjs
├── src/
│   ├── background/
│   │   └── service-worker.ts
│   ├── content/
│   │   ├── detector.ts
│   │   ├── observer.ts
│   │   ├── question.ts
│   │   └── video.ts
│   ├── services/
│   │   ├── deepseek.ts
│   │   ├── font-decoder.ts
│   │   ├── font-reference-index.json
│   │   ├── storage.ts
│   │   └── video-progress.ts
│   ├── sidepanel/
│   │   ├── index.html
│   │   ├── index.ts
│   │   └── style.css
│   ├── types/
│   │   └── index.ts
│   └── utils/
│       └── helpers.ts
├── tests/
│   ├── build.test.mjs
│   ├── deepseek.test.mjs
│   ├── font-decoder.test.mjs
│   ├── manifest.test.mjs
│   ├── question.test.mjs
│   └── video.test.mjs
└── dist/（构建产物，未提交）
```

## 安全与隐私

- 不读取用户密码。
- 不读取或导出认证 Cookie。
- 不绕过验证码或访问控制。
- 不硬编码 API Key。
- 不使用远程托管代码。
- 题目文本会做 HTML 转义后再显示。
- 关闭自动分析时，只有用户点击分析才发送题目内容到 DeepSeek。
- 开启自动分析时，仅在 Side Panel 打开、API 已配置且检测到新题目后发送；可随时在设置中关闭。
- 同一道题在本次侧边栏会话内复用结果，避免重复请求和重复计费。
- 不自动将答案写回页面或提交。
- 字体下载限定为雨课堂官方静态资源域名。
- 字体解析失败时拒绝猜测题目内容。

## 分享给朋友

直接发送 `rainclassroom-ai-v0.5.2-dist.zip` 和 `使用说明.md` / `使用说明.txt` 即可。

朋友需要：

- 自己安装解压后的 `dist` 目录
- 自己申请并填写 API Key

**不要把自己的 API Key 一起发出去。**

## 开源协议

- 本项目原创代码使用 **MIT License**，见 [LICENSE](LICENSE)。
- 第三方组件、Noto Sans SC 字形参考索引和商标说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- Noto Sans SC 使用 SIL Open Font License 1.1；本仓库不包含字体文件本身。

## 参与贡献

欢迎提交 Issue 和 Pull Request。开始前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [SECURITY.md](SECURITY.md)。

- 不要提交 API Key、Cookie、学号或私有题目。
- 修改页面选择器前，先在真实页面确认 DOM。
- 不添加自动提交、绕过验证码或绕过平台访问控制的功能。

## 免责声明

本项目按“现状”提供，不保证题目识别或 AI 分析结果正确。课程特定答案请以教材、老师和平台为准。

使用者应自行确认使用方式符合课程要求和平台服务条款。因使用本项目产生的任何后果由使用者自行承担。

## 下一阶段

下一阶段可进入第六阶段：

- 针对明确允许自动化的练习环境识别已答状态
- 用户确认后辅助填写单选、多选和填空
- 提取并保存题目历史与错题记录

正式计分考核仍只提供分析，不实现自动填写或提交。
