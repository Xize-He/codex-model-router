# Model Router · 本地智能工作台

一个运行在本机的网页入口：自动判断任务难度，选择 Codex 模型，读取原生会话历史，显示上下文与账户用量，并连接一个或多个标准 Streamable HTTP MCP 服务。

## 首次安装

需要 Windows、Node.js 22+，以及已经安装并可登录的 Codex CLI。克隆源码后运行：

```powershell
git clone https://github.com/Xize-He/codex-model-router.git
cd codex-model-router
corepack pnpm install
corepack pnpm build
```

## 使用

1. 在资源管理器中双击 `启动工作台.cmd`。它不需要更改 PowerShell 执行策略。
2. 浏览器打开 `http://127.0.0.1:7341`。首次使用时在“状态”面板登录 Codex；已登录的本机 Codex 账户会自动复用。
3. 输入问题，默认自动分流；下拉框可选择账号当前返回的全部模型和推理强度。左侧“联网搜索”可随时选择非实时搜索、实时搜索或关闭搜索，当前对话从下一条消息开始使用新设置。Enter 发送，Shift + Enter 换行。
4. 模型可调用当前已连接的 MCP 工具。标注 `readOnlyHint` 的只读工具可直接执行，其他工具会展示参数并等待你批准。命令和文件操作遵循 Codex 的审批请求。
5. “停止当前任务”中断当前分类或执行。关闭网页不会停止后台任务。要关闭服务，双击 `停止工作台.cmd`。

`out/` 是本机构建产物，不提交到 Git。完成上述安装与构建后，日常使用只需运行启动脚本。启动脚本会查找系统 PATH 和本机 Codex 自带的 Node / Codex 程序。

如需让工作台独立于 Codex 桌面版运行，可以执行 `register-independent-service.ps1`，注册按需启动的 Windows 任务 `Model Router Local Service`。它没有开机或定时触发器；启动和停止仍由项目中的两个 `.cmd` 脚本控制。

MCP 服务由使用者自行启动，和网页分别管理。关闭浏览器或 Codex 桌面窗口不会主动停止网页或 MCP 服务；Windows 注销或关机仍会结束当前用户的服务进程。

## 默认连接与路由

- MCP：公开配置默认不连接任何服务。复制 `router.config.local.example.json` 为 `router.config.local.json`，在 `mcpServers` 中配置任意数量的服务。该本机文件已被 Git 忽略。
- MCP 认证：每个服务可指定自己的 `tokenEnv`。启动脚本也支持当前 Windows 用户加密的多服务认证缓存，不在网页或源码中保存明文密钥。
- 判断难度：`gpt-5.6-sol`，medium。该模型使用 Codex 主额度，适合判断模糊、多步骤及需要权衡的任务。
- L0 · 机械任务：`gpt-5.6-luna` / low。
- L1 · 常规工程：`gpt-5.6-terra` / medium。
- L2 · 复杂工程：`gpt-5.6-sol` / medium。
- L3 · 系统推理：`gpt-6-astra` / high。
- L4 · 关键任务：`gpt-6-astra` / xhigh。

L0–L4 是默认的五档策略，不是模型数量限制。可以在左侧“模型路由配置”窗口中把档位数量调整为 2～12 档，编辑每档名称和判断描述、拖拽排序，并选择执行模型与推理强度；结果写入 Git 忽略的 `router.config.local.json`，重启后继续生效。也可以直接修改 `router.config.json` 的公开默认值。本地已保存的自定义档位仍优先于公开默认值。档位应按能力从低到高排列，绑定模型的能力顺序由配置者决定。手动模式通过 Codex `model/list` 实时读取账号里的全部可见模型及其推理强度；指定模型不存在或强度不受支持时会明确报错。

联网搜索直接使用 Codex 原生 Web Search，不依赖 MCP，也不启用浏览器自动化。“非实时搜索”对应 Codex 的 `cached` 默认模式，由模型按任务决定是否检索 OpenAI 维护的搜索索引；“实时搜索”对应 `live`，允许检索最新外部网页；“关闭搜索”对应 `disabled`，从对话中移除搜索工具。选择会保存在当前浏览器中作为工作台默认值；已经开始的对话会在下一条消息前通过 Codex 原生恢复接口重新应用设置，历史和对话 ID 保持不变。搜索行为和可用性仍受当前账号及管理员策略限制。

分类与模型映射分开：分类器只接收档位 ID、顺序、名称、描述，以及最近四轮的截断上下文、当前问题和附件元信息，不接收绑定的模型名称、强度或模型目录。`routeLabels` / `routeGuidance` 定义档位含义，`routes` 定义执行模型映射；换模型只需修改映射。分类结果包含 `level`、`reason`、`confidence`、`taskType` 和 `escalation`（更高目标档位及可观察的触发条件，或 `null`）。信心值是模型估计，不是校准后的准确率。自动分类会产生额外模型用量，不保证每次都比手动选择节省。

新建会话在 Auto 模式下支持执行中升级：模型发现新增复杂度后，可以调用内部工具 `request_model_escalation`，提交目标档位、原因、证据和交接摘要。后端检查目标是否向上、绑定是否可用、图片兼容性以及每个用户任务最多一次的限制；语义上的复杂度证据由执行模型判断，并非独立验证。权限、网络、额度或普通编译失败本身不应触发升档，执行错误也不会自动重试。当前轮成功结束后才在同一个 Codex 原生会话启动更高档模型，保留原来的审批方式、工作目录、消息、计时与文件修改；中断或失败不启动接续。路由详情可展开查看初始判断、升级条件和实际升级记录。手动模型模式不启用升级。

此能力使用 App Server 的实验性动态工具接口。当前本机协议仅允许在 `thread/start` 注册动态工具，旧会话无法补挂载，因此旧会话继续支持初始分类，新建会话才支持执行中升档。服务重启后，本工具创建的会话会恢复升级工具和路由记录。升级是两轮协作，不是在正在生成的轮次内热切换模型；交接要求核对已完成操作，避免重复副作用。

点击左侧“新对话”下方的“模型路由配置”，在独立窗口中展开任意档位，可以单独编辑“升级判断规则”，移开焦点即保存。规则通过 `routeEscalationGuidance` 保存在本地配置，同时提供给分类器和执行模型；分类器结合当前任务生成具体升级条件，执行模型按规则评估新证据。留空表示由模型按任务复杂度判断，不表示禁用升级。修改只影响后续任务，运行中暂不可编辑；每次任务最多一次、只能向上以及手动模式不升级等约束仍由程序执行。

“状态”面板使用 Codex App Server 的原生账户接口，支持 ChatGPT 浏览器登录、ChatGPT 设备码登录、API Key 登录、账户刷新和退出。通过 ChatGPT 账号运行时使用对应 Codex 用量；通过 API Key 运行时按 OpenAI Platform API 用量计费。API Key 只由本机接口转交给 Codex App Server，不写入浏览器存储、项目配置或日志。当前机器的模型连接需要系统代理，因此子进程启用了 Codex 的 `respect_system_proxy`（当前为实验性功能），不会修改 Windows 代理或全局 Codex 配置。

## 文件与会话

- `workspace/`：模型默认工作的文件目录。
- `data/history.json`：本工具新建对话的索引、执行状态和结果，明文保存在本机。
- `router.config.local.json`：本机 MCP 与其他私有覆盖配置，Git 默认忽略。
- `data/mcp-credentials.json`：可选的 Windows DPAPI 加密认证，仅当前 Windows 用户可解密，并绑定对应 MCP 地址。打包文件不包含认证缓存或历史记录。若已有令牌在当前终端环境中，可以运行 `保存本机认证.ps1` 建立缓存。
- `data/server.log`、`data/server-error.log`：通过启动脚本运行时的服务日志，不记录密钥。
- 侧栏通过 Codex App Server 读取桌面版、IDE、CLI 和本工作台的原生会话列表。打开旧会话时按需读取完整内容，避免启动时加载全部长对话。
- 上下文区域使用 Codex 的实时 token usage 事件显示当前上下文占用；旧会话需要继续一次对话后才会拿到实时占用。
- 自动压缩状态由 Codex 的 contextCompaction 事件更新；输入框旁的上下文圆环在悬停时显示具体占用。压缩会改变模型继续对话时看到的上下文摘要，不会删除网页里已经显示的历史消息。
- 右侧“状态”栏中的剩余用量来自 Codex 账号的原生 rate limits 接口，支持多个用量窗口、重置时间和手动刷新。
- 本工具不会自动通过 MCP 持久化任务历史。
- MCP 通过 `initialize` 和 `tools/list` 实时发现服务名称与工具。多个服务的工具在传给 Codex 时加入服务命名空间，允许不同 MCP 使用相同工具名。
- MCP 工具在新对话创建时绑定；新增服务或恢复连接后请新建对话使用工具。

服务只监听 `127.0.0.1`，检查 Host / Origin 并保护修改请求。MCP 令牌只用于各自配置的服务器，禁止自动跳转到其他地址。连接单个 MCP 失败不会阻止其他 MCP 或普通对话。第一版只支持一个正在运行的任务；未知的交互类型会拒绝，不会自动批准。

## 开发与验证

```powershell
pnpm install
pnpm build
pnpm test
pnpm start
```

开发界面：另开终端运行 `pnpm dev`，访问 `http://127.0.0.1:7340`，请求代理到本机 7341 服务。

技术实现：React + TypeScript + Vite，沿用 Sites 模板中的组件；本地 Node 服务通过 stdio JSON-RPC 连接 Codex App Server，通过 Streamable HTTP JSON/SSE 连接 MCP。为了在 Windows 本地稳定构建，本版本使用静态客户端构建，没有运行云端 Worker。

官方接口说明：https://learn.chatgpt.com/docs/app-server

## 常见问题

- **MCP 401**：启动进程没有拿到该服务 `tokenEnv` 指定的环境变量。配置用户环境变量或运行 `保存本机认证.ps1`；不要把密钥写进任何 JSON 配置。
- **Codex 未登录**：打开右上角“状态”，使用 ChatGPT、设备码或 API Key 登录；登录完成后模型、用量和原生历史会自动刷新。
- **Codex 未连接**：确认本机 Codex CLI 已安装且能启动。若桌面版更新导致程序路径变化，重启启动脚本会重新查找。
- **模型请求超时**：检查 Windows 现有代理是否正在运行；也可用下拉框手动选模型重试。
- **停止后的写入**：中断不会撤销已完成的操作；工具调用超时后请先核实状态，避免重复写入。
- **端口占用**：先运行停止脚本；或修改 `router.config.json` 的 port。开发预览固定代理到 7341，改端口时也需同步修改 `vite.config.ts`。

当前版本不包含跨设备访问以及原记忆服务网页的实时状态同步。导入的原生会话可以查看和继续，但如果它正在另一个 Codex 客户端执行，工作台会阻止并发续聊。

## 隐私与本机数据

下面的内容只保存在本机，并已由 `.gitignore` 排除：

- `router.config.local.json`：私人 MCP 地址、环境变量名称和本机路由覆盖。
- `data/`：会话索引、占用状态、日志和 Windows DPAPI 加密认证缓存。
- `workspace/`、`work/`：模型工作文件与本地测试文件。
- `.env*`、`*.local.cmd`：本机环境和私有启动命令。

不要使用 `git add -f` 强制提交这些文件，也不要把整个工作目录压缩后上传。公开问题和日志中不要粘贴访问令牌、内部地址或私人会话内容。

## License

[MIT](LICENSE)
