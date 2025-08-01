# P2P 文件传输工具 (WebRTC)

基于 WebRTC 的点对点文件传输工具，支持浏览器端直接传输文件，无需中转服务器。

## 功能特性

- ✅ **点对点传输**: 基于 WebRTC DataChannel，文件直接在浏览器间传输
- ✅ **浏览器支持**: 支持现代浏览器，无需安装插件
- ✅ **CLI 工具**: 支持命令行文件传输操作
- ✅ **二进制分发**: 支持单个二进制文件，无需安装 Node.js
- ✅ **多平台支持**: Linux x64/ARM64, macOS x64/ARM64, Windows x64
- ✅ **房间限制**: 每个房间最多2人，确保点对点传输
- ✅ **实时进度**: 实时显示传输进度和速度
- ✅ **多文件支持**: 支持同时传输多个文件
- ✅ **拖拽上传**: 支持拖拽文件到浏览器窗口
- ✅ **自动重连**: 网络中断时自动尝试重连
- ✅ **错误处理**: 完善的错误处理和状态管理
- ✅ **朴素UI**: 简洁的纯文本风格界面

## 下载二进制文件

从 [Releases](https://github.com/your-repo/releases) 页面下载对应平台的二进制文件：

- **Linux x64**: `p2p-transfer-linux-x64` (Intel/AMD 64位)
- **Linux x86**: `p2p-transfer-linux-x86` (Intel/AMD 32位)
- **Linux ARM64**: `p2p-transfer-linux-arm64` (ARM服务器，如树莓派)
- **macOS x64**: `p2p-transfer-macos-x64` (Intel Mac)
- **macOS ARM64**: `p2p-transfer-macos-arm64` (M1/M2 Mac)
- **Windows x64**: `p2p-transfer-windows-x64.exe` (64位系统)
- **Windows x86**: `p2p-transfer-windows-x86.exe` (32位系统)

### 使用二进制文件

```bash
# 发送文件
./p2p-transfer-linux-x64 send myfile.txt

# 接收文件
./p2p-transfer-linux-x64 receive

# 指定房间ID
./p2p-transfer-linux-x64 send myfile.txt room123
./p2p-transfer-linux-x64 receive room123

# 指定服务器地址
./p2p-transfer-linux-x64 send myfile.txt --server ws://yourserver.com
```

## 从源码构建

### 浏览器使用

### 1. 安装依赖

```bash
npm install
```

### 2. 启动信令服务器

```bash
npm start
```

服务器将在 `http://localhost:3000` 启动。

### 3. 访问 Web 界面

在浏览器中打开 `http://localhost:3000`

### 4. 使用步骤

1. **连接设置**
   - 默认信令服务器地址：`ws://localhost:3000`
   - 输入房间ID或点击"生成房间ID"
   - 点击"连接"

2. **建立P2P连接**
   - 将房间ID分享给另一个用户
   - 两个用户都连接到相同房间ID
   - 等待P2P连接建立（状态显示为"已连接"）

## 构建二进制文件

### 安装构建依赖

```bash
npm install
```

### 构建所有平台

```bash
# Linux/macOS
./build.sh

# Windows
build.bat

# 或使用 npm 脚本
npm run build:all
```

### 构建单个平台

```bash
# 只构建当前平台
npm run build

# 手动指定平台
pkg cli/index.js --targets node18-linux-x64 --out-path dist
```

### 支持的目标平台

- `node18-linux-x64` - Linux 64位 (Intel/AMD)
- `node18-linux-x86` - Linux 32位 (Intel/AMD)
- `node18-linux-arm64` - Linux ARM64 (ARM 服务器，如树莓派)
- `node18-macos-x64` - macOS 64位 (Intel Mac)
- `node18-macos-arm64` - macOS ARM64 (M1/M2 Mac)  
- `node18-win-x64` - Windows 64位
- `node18-win-x86` - Windows 32位

## 平台适用性

### Linux 用户
- **现代服务器/PC**: 使用 `p2p-transfer-linux-x64`
- **老旧32位系统**: 使用 `p2p-transfer-linux-x86`
- **ARM设备** (树莓派等): 使用 `p2p-transfer-linux-arm64`

### macOS 用户
- **Intel Mac**: 使用 `p2p-transfer-macos-x64`
- **M1/M2 Mac**: 使用 `p2p-transfer-macos-arm64`

### Windows 用户
- **64位系统** (推荐): 使用 `p2p-transfer-windows-x64.exe`
- **32位系统**: 使用 `p2p-transfer-windows-x86.exe`

### 架构检查

不确定你的系统架构？可以用以下命令检查：

```bash
# Linux/macOS
uname -m
# x86_64 = 64位 Intel/AMD
# i386, i686 = 32位 Intel/AMD  
# aarch64, arm64 = ARM64
# armv7l = ARM32

# Windows (PowerShell)
$env:PROCESSOR_ARCHITECTURE
# AMD64 = 64位
# x86 = 32位
```

3. **传输文件**
   - 选择文件或拖拽文件到指定区域
   - 文件将自动开始传输
   - 查看实时传输进度
   - 接收方可下载收到的文件

### CLI 使用

### 1. 安装 CLI 工具

```bash
npm install -g .
# 或者使用 npm link 进行本地开发安装
npm link
```

### 2. 启动信令服务器

```bash
npm start
```

### 3. CLI 命令

#### 生成房间ID
```bash
p2p-transfer room
```

#### 发送文件
```bash
p2p-transfer send <文件路径> --room <房间ID>

# 示例
p2p-transfer send ./test.txt --room ABC123
p2p-transfer send /path/to/file.zip --room ABC123 --verbose
```

#### 接收文件
```bash
p2p-transfer receive --room <房间ID>

# 示例
p2p-transfer receive --room ABC123
p2p-transfer receive --room ABC123 --output ./downloads --verbose
```

#### 完整使用示例

**终端1 (接收方):**
```bash
# 生成房间ID
p2p-transfer room
# 输出: 🏠 随机房间ID: L769UXMC

# 等待接收文件
p2p-transfer receive --room L769UXMC --output ./downloads
```

**终端2 (发送方):**
```bash
# 发送文件
p2p-transfer send ./myfile.txt --room L769UXMC
```

#### CLI 选项

- `--server <url>`: 指定信令服务器地址 (默认: ws://localhost:3000)
- `--room <id>`: 指定房间ID
- `--verbose`: 详细输出模式
- `--output <dir>`: 指定接收文件的输出目录 (默认: ./downloads)

## 项目结构

```
webrtc-transfer/
├── server/                 # 信令服务器
│   └── index.js           # 主服务器文件
├── client/                 # 浏览器端
│   ├── index.html         # 主页面
│   ├── style.css          # 样式文件
│   ├── webrtc-manager.js  # WebRTC连接管理
│   ├── file-transfer.js   # 文件传输逻辑
│   └── app.js             # 主应用逻辑
├── cli/                    # CLI工具
│   ├── index.js           # CLI入口文件
│   └── p2p-transfer.js    # CLI传输逻辑
└── package.json           # 项目配置
```

## 技术栈

- **前端**: HTML5, CSS3, JavaScript (原生)
- **后端**: Node.js, WebSocket (ws)
- **传输**: WebRTC DataChannel (浏览器) / WebSocket (CLI)
- **信令**: WebSocket
- **CLI**: Commander.js, Progress bars

## API 说明

### WebRTCManager

WebRTC连接管理器，负责建立和维护P2P连接。

```javascript
const manager = new WebRTCManager();

// 连接到信令服务器
await manager.connectToSignalingServer('ws://localhost:3000');

// 加入房间
manager.joinRoom('ROOM_ID');

// 事件监听
manager.onConnectionStateChange = (state) => console.log('连接状态:', state);
manager.onDataChannelOpen = () => console.log('数据通道已建立');
manager.onError = (error) => console.error('错误:', error);
```

### FileTransferManager

文件传输管理器，处理文件的发送和接收。

```javascript
const fileTransfer = new FileTransferManager(webrtcManager);

// 发送文件
fileTransfer.sendFile(file);

// 事件监听
fileTransfer.onTransferProgress = (progress) => console.log('进度:', progress);
fileTransfer.onFileReceived = (fileData) => console.log('收到文件:', fileData);
fileTransfer.onTransferComplete = (data) => console.log('传输完成:', data);
```

## 配置选项

### 环境变量

- `PORT`: 服务器端口 (默认: 3000)

### WebRTC 配置

可以在 `client/webrtc-manager.js` 中修改 ICE 服务器配置：

```javascript
this.iceServers = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];
```

## 浏览器兼容性

- Chrome 56+
- Firefox 52+
- Safari 11+
- Edge 79+

## 注意事项

1. **HTTPS要求**: 在生产环境中，WebRTC需要HTTPS连接
2. **防火墙设置**: 确保ICE候选可以正常交换
3. **文件验证**: 接收文件前验证文件类型和大小

## 贡献

欢迎提交问题和改进建议！

## 许可证

MIT License

## 更新日志

### v1.0.0
- 基本的P2P文件传输功能
- 浏览器端用户界面
- CLI命令行工具
- 错误处理和重连机制
- 传输进度显示