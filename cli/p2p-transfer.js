const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const ProgressBar = require('progress');
const EventEmitter = require('events');

class P2PTransfer extends EventEmitter {
  constructor(options) {
    super();
    this.serverUrl = options.serverUrl;
    this.roomId = options.roomId;
    this.outputDir = options.outputDir || './downloads';
    this.verbose = options.verbose || false;
    this.mode = options.mode; // 'send' or 'receive'
    
    this.ws = null;
    this.connected = false;
    this.peerConnected = false;
    this.chunkSize = 16384; // 16KB chunks
    this.transfers = new Map();
    this.transferStopped = false; // 传输停止标志
  }
  
  log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = type === 'error' ? '❌' : type === 'success' ? '✅' : 'ℹ️';
    console.log(`[${timestamp}] ${prefix} ${message}`);
  }
  
  async connect() {
    return new Promise((resolve, reject) => {
      this.log(`连接到信令服务器: ${this.serverUrl}`);
      
      this.ws = new WebSocket(this.serverUrl);
      
      this.ws.on('open', () => {
        this.connected = true;
        this.log('已连接到信令服务器', 'success');
        
        // 加入房间
        this.sendMessage({
          type: 'join-room',
          roomId: this.roomId
        });
        
        resolve();
      });
      
      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(message);
        } catch (error) {
          this.log(`消息解析错误: ${error.message}`, 'error');
        }
      });
      
      this.ws.on('error', (error) => {
        this.log(`WebSocket错误: ${error.message}`, 'error');
        reject(error);
      });
      
      this.ws.on('close', () => {
        this.connected = false;
        this.peerConnected = false;
        this.log('连接已断开');
      });
    });
  }
  
  sendMessage(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      if (this.verbose) {
        this.log(`发送消息: ${message.type}`);
      }
    }
  }
  
  handleMessage(message) {
    if (this.verbose) {
      this.log(`收到消息: ${message.type}`);
    }
    
    switch (message.type) {
      case 'room-joined':
        this.log(`已加入房间: ${this.roomId}`, 'success');
        // 检查是否有已存在的客户端
        if (message.existingMembers && message.existingMembers.length > 0) {
          message.existingMembers.forEach(member => {
            const clientType = member.clientType === 'web' ? 'Web客户端' : 
                             member.clientType === 'cli' ? 'CLI客户端' : '未知客户端';
            this.log(`${clientType}已在房间中`, 'info');
          });
          this.peerConnected = true;
          this.log(`可以进行文件传输`, 'success');
        }
        break;
        
      case 'peer-joined':
        this.peerConnected = true;
        const clientType = message.clientType === 'cli' ? 'CLI客户端' : 'Web客户端';
        this.log(`${clientType}已连接，可以进行文件传输`, 'success');
        this.emit('peer-connected');
        break;
        
      case 'peer-left':
        this.peerConnected = false;
        this.transferStopped = true; // 设置传输停止标志
        this.log('对端已断开');
        this.emit('peer-disconnected');
        break;
        
      case 'transfer-error':
        this.transferStopped = true; // 设置传输停止标志
        this.log(`传输错误: ${message.error}`, 'error');
        this.emit('transfer-error', message.error);
        break;
        
      case 'room-full':
        this.log(`${message.message}`, 'error');
        this.emit('room-full', message.message);
        // 房间满时自动退出
        this.disconnect();
        process.exit(1);
        break;
        
      case 'data':
        this.handleDataMessage(message.data);
        break;
        
      default:
        if (this.verbose) {
          this.log(`未知消息类型: ${message.type}`);
        }
    }
  }
  
  handleDataMessage(data) {
    switch (data.type) {
      case 'file-info':
        this.handleFileInfo(data);
        break;
        
      case 'file-chunk':
        this.handleFileChunk(data);
        break;
        
      case 'file-complete':
        this.handleFileComplete(data);
        break;
        
      default:
        if (this.verbose) {
          this.log(`未知数据消息: ${data.type}`);
        }
    }
  }
  
  async sendFile(filePath) {
    try {
      // 设置信号处理
      this.setupSignalHandlers();
      
      // 检查文件是否存在
      const fullPath = path.resolve(filePath);
      if (!fs.existsSync(fullPath)) {
        this.log(`文件不存在: ${fullPath}`, 'error');
        process.exit(1);
      }
      
      const fileName = path.basename(fullPath);
      const stats = fs.statSync(fullPath);
      const fileSize = stats.size;
      
      // 设置超时退出机制（5分钟超时）
      const timeout = setTimeout(() => {
        this.log('传输超时，自动退出...', 'error');
        this.disconnect();
        process.exit(1);
      }, 5 * 60 * 1000); // 5分钟
      
      // 监听对端断开事件
      this.once('peer-disconnected', () => {
        this.log('接收端断开，自动退出...', 'error');
        clearTimeout(timeout);
        this.disconnect();
        process.exit(1);
      });
      
      await this.connect();
      
      this.transferStopped = false; // 重置传输停止标志
      
      // 如果已经有对等端连接，立即开始传输
      if (this.peerConnected) {
        this.log(`检测到已连接的接收端，开始发送文件: ${fileName}`);
      } else {
        // 等待对等端连接
        this.log('等待接收端连接...');
        await new Promise((resolve) => {
          this.once('peer-connected', resolve);
        });
      }
      
      const fullPath = path.resolve(filePath);
      const fileName = path.basename(fullPath);
      const stats = fs.statSync(fullPath);
      const fileSize = stats.size;
      
      this.log(`开始发送文件: ${fileName} (${this.formatFileSize(fileSize)})`);
      
      const transferId = this.generateTransferId();
      
      // 发送文件信息
      this.sendDataMessage({
        type: 'file-info',
        id: transferId,
        name: fileName,
        size: fileSize,
        fileType: 'application/octet-stream'
      });
      
      // 创建进度条
      const progressBar = new ProgressBar('发送进度 [:bar] :percent :current/:total :etas', {
        complete: '=',
        incomplete: ' ',
        width: 40,
        total: Math.ceil(fileSize / this.chunkSize)
      });
      
      // 读取并发送文件块
      const fileBuffer = fs.readFileSync(fullPath);
      const totalChunks = Math.ceil(fileSize / this.chunkSize);
      
      for (let i = 0; i < totalChunks; i++) {
        // 检查传输是否应该停止
        if (this.transferStopped) {
          this.log('传输被中断，停止发送', 'error');
          clearTimeout(timeout);
          this.disconnect();
          process.exit(1);
        }
        
        // 检查连接状态
        if (!this.connected || !this.peerConnected) {
          this.log('连接已断开，停止发送', 'error');
          clearTimeout(timeout);
          this.disconnect();
          process.exit(1);
        }
        
        const start = i * this.chunkSize;
        const end = Math.min(start + this.chunkSize, fileSize);
        const chunk = fileBuffer.slice(start, end);
        
        this.sendDataMessage({
          type: 'file-chunk',
          transferId: transferId,
          chunkIndex: i,
          totalChunks: totalChunks,
          data: chunk.toString('base64')
        });
        
        progressBar.tick();
        
        // 小延迟避免过快发送
        await this.delay(5);
      }
      
      // 发送完成消息
      this.sendDataMessage({
        type: 'file-complete',
        transferId: transferId
      });
      
      this.log(`文件发送完成: ${fileName}`, 'success');
      clearTimeout(timeout);
      
      // 保持连接一段时间让接收端有时间处理和下载文件
      this.log('保持连接中，等待接收端处理文件...', 'info');
      await this.delay(5000); // 等待5秒
      this.disconnect();
      
      // 传输完成，自动退出
      process.exit(0);
      
    } catch (error) {
      this.log(`发送文件失败: ${error.message}`, 'error');
      this.disconnect();
      process.exit(1);
    }
  }
  
  async startReceiving() {
    try {
      await this.connect();
      
      // 设置超时退出机制（10分钟超时）
      const timeout = setTimeout(() => {
        this.log('等待文件超时，自动退出...', 'error');
        this.disconnect();
        process.exit(1);
      }, 10 * 60 * 1000); // 10分钟
      
      this.log('等待文件传输...');
      
      // 保持连接，等待文件
      return new Promise((resolve, reject) => {
        this.on('file-received', (fileData) => {
          this.log(`文件接收完成: ${fileData.fileName}`, 'success');
          clearTimeout(timeout);
          this.disconnect();
          
          // 接收完成，自动退出
          process.exit(0);
        });
        
        this.ws.on('close', () => {
          clearTimeout(timeout);
          this.log('连接意外断开，自动退出...', 'error');
          this.disconnect();
          process.exit(1);
        });
        
        // 监听传输错误
        this.on('transfer-error', (error) => {
          clearTimeout(timeout);
          this.log(`传输错误: ${error}`, 'error');
          this.disconnect();
          process.exit(1);
        });
      });
      
    } catch (error) {
      this.log(`接收文件失败: ${error.message}`, 'error');
      this.disconnect();
      process.exit(1);
    }
  }
  
  handleFileInfo(fileInfo) {
    this.log(`开始接收文件: ${fileInfo.name} (${this.formatFileSize(fileInfo.size)})`);
    
    const transfer = {
      info: fileInfo,
      chunks: new Map(),
      receivedChunks: 0,
      progressBar: new ProgressBar('接收进度 [:bar] :percent :current/:total :etas', {
        complete: '=',
        incomplete: ' ',
        width: 40,
        total: Math.ceil(fileInfo.size / this.chunkSize)
      })
    };
    
    this.transfers.set(fileInfo.id, transfer);
  }
  
  handleFileChunk(chunkData) {
    const { transferId, chunkIndex, totalChunks, data } = chunkData;
    const transfer = this.transfers.get(transferId);
    
    if (!transfer) {
      this.log(`收到未知传输的块: ${transferId}`, 'error');
      return;
    }
    
    // 解码base64数据
    const chunkBuffer = Buffer.from(data, 'base64');
    transfer.chunks.set(chunkIndex, chunkBuffer);
    transfer.receivedChunks++;
    
    transfer.progressBar.tick();
  }
  
  handleFileComplete(completeData) {
    const { transferId } = completeData;
    const transfer = this.transfers.get(transferId);
    
    if (!transfer) {
      this.log(`收到未知传输的完成消息: ${transferId}`, 'error');
      return;
    }
    
    // 重组文件
    const sortedChunks = Array.from(transfer.chunks.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([index, data]) => data);
    
    const fileBuffer = Buffer.concat(sortedChunks);
    
    // 保存文件
    const outputPath = path.join(this.outputDir, transfer.info.name);
    fs.writeFileSync(outputPath, fileBuffer);
    
    this.emit('file-received', {
      transferId: transferId,
      fileName: transfer.info.name,
      filePath: outputPath,
      fileSize: transfer.info.size
    });
    
    this.transfers.delete(transferId);
  }
  
  sendDataMessage(data) {
    this.sendMessage({
      type: 'data',
      data: data,
      roomId: this.roomId
    });
  }
  
  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
  }
  
  generateTransferId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
  
  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  setupSignalHandlers() {
    // 处理Ctrl+C
    process.on('SIGINT', () => {
      this.log('接收到中断信号，正在关闭连接...', 'info');
      this.disconnect();
      process.exit(0);
    });
    
    // 处理其他终止信号
    process.on('SIGTERM', () => {
      this.log('接收到终止信号，正在关闭连接...', 'info');
      this.disconnect();
      process.exit(0);
    });
  }
}

module.exports = P2PTransfer;