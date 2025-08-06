# P2P 文件传输工具 (WebRTC)

一个基于 WebRTC 的点对点文件传输工具，支持浏览器和命令行。文件直接在用户设备间传输，无需服务器中转，快速且私密。

## ✨ 主要功能

- **点对点传输**: 基于 WebRTC DataChannel，文件不经服务器中转。
- **跨平台使用**: 提供简洁的 Web 界面和功能强大的 CLI 命令行工具。
- **独立可执行**: 可打包成单个二进制文件，无需安装 Node.js 环境。
- **多文件与拖拽**: 支持同时传输多个文件和拖拽上传。
- **房间机制**: 通过简单的房间ID连接两端。

## 🚀 快速上手

### 1. 安装依赖

```bash
npm install
```

### 2. 启动服务

此命令会启动信令服务器，并托管 Web 界面。

```bash
npm start
```

服务器启动后，Web 界面默认在 `http://localhost:3000`。

### 3. 使用方法

#### 方式一：使用 Web 界面

1.  在两个不同的浏览器或标签页中打开 `http://localhost:3000`。
2.  在一个页面点击 **"生成房间ID"**，然后将这个ID复制到另一个页面。
3.  在两个页面都点击 **"连接"**。
4.  连接成功后，拖拽文件到窗口或点击按钮选择文件即可开始传输。

#### 方式二：使用命令行 (CLI)

你需要在两个终端窗口中进行操作。

1.  **(可选) 全局安装或链接 CLI:**
    ```bash
    # 全局安装
    npm install -g .
    # 或者，为本地开发创建链接
    npm link
    ```

2.  **接收方 (终端 1):**
    首先获取一个房间ID。
    ```bash
    p2p-transfer room
    # 🏠 随机房间ID: ABCDEFG
    ```
    然后使用此ID等待接收文件。
    ```bash
    p2p-transfer receive --room ABCDEFG
    ```

3.  **发送方 (终端 2):**
    使用相同的房间ID发送文件。
    ```bash
    p2p-transfer send ./path/to/your/file.txt --room ABCDEFG
    ```

## 🛠️ 为开发者：构建二进制文件

如果你想将 CLI 工具打包成一个独立的可执行文件，可以运行以下命令：

- **构建当前平台:**
  ```bash
  npm run build
  ```

- **构建所有支持的平台 (Linux, macOS, Windows):**
  ```bash
  npm run build:all
  ```

构建完成后，二进制文件会存放在 `dist/` 目录下。

## 📄 许可证

本项目基于 [MIT](LICENSE) 许可证。
