# WebRTC P2P 文件传输工具

基于 WebRTC 的点对点文件传输工具，支持浏览器端直接传输文件，无需中转服务器。

## 功能特性

- ✅ **点对点传输**: 基于 WebRTC DataChannel，文件直接在浏览器间传输
- ✅ **浏览器支持**: 支持现代浏览器，无需安装插件
- ✅ **实时进度**: 实时显示传输进度和速度
- ✅ **多文件支持**: 支持同时传输多个文件
- ✅ **拖拽上传**: 支持拖拽文件到浏览器窗口
- ✅ **自动重连**: 网络中断时自动尝试重连
- ✅ **错误处理**: 完善的错误处理和状态管理

## 快速开始

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

在浏览器中打开 `http://localhost:3000`，或者：

```bash
# 开发模式 - 同时启动服务器和静态文件服务
npm run dev:full
```

### 4. 使用步骤

1. **连接设置**
   - 默认信令服务器地址：`ws://localhost:3000`
   - 输入房间ID或点击"生成房间ID"
   - 点击"连接"

2. **建立P2P连接**
   - 将房间ID分享给另一个用户
   - 两个用户都连接到相同房间ID
   - 等待P2P连接建立（状态显示为"已连接"）

3. **传输文件**
   - 选择文件或拖拽文件到指定区域
   - 文件将自动开始传输
   - 查看实时传输进度
   - 接收方可下载收到的文件

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
├── cli/                    # CLI工具 (待实现)
└── package.json           # 项目配置
```

## 技术栈

- **前端**: HTML5, CSS3, JavaScript (原生)
- **后端**: Node.js, WebSocket (ws)
- **传输**: WebRTC DataChannel
- **信令**: WebSocket

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

## 安全注意事项

1. **HTTPS要求**: 在生产环境中，WebRTC需要HTTPS连接
2. **防火墙设置**: 确保ICE候选可以正常交换
3. **文件验证**: 接收文件前验证文件类型和大小

## 故障排除

### 连接问题

1. **无法连接到信令服务器**
   - 检查服务器是否运行
   - 确认服务器地址和端口正确
   - 检查防火墙设置

2. **P2P连接失败**
   - 检查网络环境（NAT类型）
   - 尝试使用TURN服务器
   - 确认浏览器支持WebRTC

3. **文件传输中断**
   - 检查网络稳定性
   - 重新建立连接
   - 尝试传输较小的文件

### 性能优化

1. **传输速度慢**
   - 调整文件块大小 (`chunkSize`)
   - 检查网络带宽
   - 减少并发传输数量

2. **内存占用高**
   - 及时清理已完成的传输
   - 限制同时传输的文件数量

## 开发脚本

```bash
# 启动服务器
npm start

# 开发模式 (自动重启)
npm run dev

# 启动静态文件服务
npm run serve

# 同时启动服务器和静态文件服务
npm run dev:full
```

## 贡献

欢迎提交问题和改进建议！

## 许可证

MIT License

## 更新日志

### v1.0.0
- 基本的P2P文件传输功能
- 浏览器端用户界面
- 错误处理和重连机制
- 传输进度显示