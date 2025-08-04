class WebRTCApp {
  constructor() {
    this.webrtcManager = new WebRTCManager();
    this.fileTransfer = new FileTransferManager(this.webrtcManager);
    this.isConnected = false;
    this.connectionType = 'none'; // 'none', 'webrtc', 'cli'
    this.transferItems = new Map(); // 存储传输项目，key: transferId, value: element
    
    this.initializeEventHandlers();
    this.setupWebRTCCallbacks();
    this.setupFileTransferCallbacks();
    this.setDefaultServerUrl();
  }
  
  setDefaultServerUrl() {
    // 自动检测当前页面URL并设置为默认信令服务器
    const currentUrl = window.location;
    let wsUrl;
    
    if (currentUrl.protocol === 'https:') {
      wsUrl = `wss://${currentUrl.host}`;
    } else if (currentUrl.protocol === 'http:') {
      wsUrl = `ws://${currentUrl.host}`;
    } else {
      // 如果是file://协议或其他，使用localhost
      wsUrl = 'ws://localhost:3000';
    }
    
    const serverUrlInput = document.getElementById('server-url');
    if (serverUrlInput && !serverUrlInput.value) {
      serverUrlInput.value = wsUrl;
      this.log(`自动设置信令服务器: ${wsUrl}`, 'info');
    }
  }
  
  initializeEventHandlers() {
    // 连接按钮
    document.getElementById('connect-btn').addEventListener('click', () => {
      this.connect();
    });
    
    document.getElementById('disconnect-btn').addEventListener('click', () => {
      this.disconnect();
    });
    
    // 生成房间ID
    document.getElementById('generate-room').addEventListener('click', () => {
      document.getElementById('room-id').value = this.generateRoomId();
    });
    
    // 文件选择
    document.getElementById('select-file-btn').addEventListener('click', (event) => {
      event.stopPropagation(); // 阻止事件冒泡到 dropZone
      document.getElementById('file-input').click();
    });
    
    document.getElementById('file-input').addEventListener('change', (event) => {
      const files = Array.from(event.target.files);
      this.handleFileSelection(files);
    });
    
    // 拖拽功能
    const dropZone = document.getElementById('file-drop-zone');
    
    dropZone.addEventListener('dragover', (event) => {
      event.preventDefault();
      dropZone.classList.add('dragover');
    });
    
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });
    
    dropZone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropZone.classList.remove('dragover');
      
      const files = Array.from(event.dataTransfer.files);
      this.handleFileSelection(files);
    });
    
    // 完全移除drop-zone的点击事件，只允许点击Select Files按钮触发
    
    // 清空日志
    document.getElementById('clear-log').addEventListener('click', () => {
      document.getElementById('log-container').innerHTML = '';
    });
  }
  
  setupWebRTCCallbacks() {
    this.webrtcManager.onConnectionStateChange = (state) => {
      this.updateConnectionStatus(state);
      
      if (state === 'connected-cli') {
        this.connectionType = 'cli';
        this.fileTransfer.setConnectionType('cli');
        
        this.log('[中转模式] 已连接到CLI客户端，通过信令服务器中转传输', 'info');
        this.showTransferSection();
      } else if (state === 'connected') {
        this.connectionType = 'webrtc';
        this.fileTransfer.setConnectionType('p2p');
        this.log('[P2P模式] WebRTC数据通道已建立，点对点直接传输', 'success');
      } else if (state === 'fallback-to-relay') {
        this.connectionType = 'cli';
        this.fileTransfer.setConnectionType('cli');
        
        this.log('[回退成功] P2P连接失败，已自动回退到中转模式', 'warning');
        
        this.showTransferSection();
      } else if (state === 'connecting') {
        this.connectionType = 'connecting';
        this.fileTransfer.setConnectionType('p2p');
        this.log('[连接中] 正在建立连接...', 'info');
        // 连接中显示传输区域但隐藏按钮
        this.showTransferSection();
      } else if (state === 'disconnected') {
        this.connectionType = 'none';
        this.fileTransfer.setConnectionType('p2p');
        this.log('[已断开] 连接已断开', 'info');
        // 停止所有正在进行的传输
        this.fileTransfer.stopAllTransfers();
        // 隐藏传输区域
        document.getElementById('transfer-section').style.display = 'none';
        // 更新UI显示等待状态
        this.updateUI();
      } else {
        this.connectionType = 'none';
        this.fileTransfer.setConnectionType('p2p');
        this.log(`[状态] ${state}`, 'info');
      }
      
    };
    
    this.webrtcManager.onDataChannelOpen = () => {
      this.connectionType = 'webrtc';
      this.fileTransfer.setConnectionType('p2p');
      this.log('[P2P模式] WebRTC数据通道已建立，点对点直接传输', 'success');
      this.showTransferSection();
    };
    
    this.webrtcManager.onError = (error) => {
      this.log(`${error.type}: ${error.message}`, 'error');
      
      // 根据错误类型采取不同处理
      if (error.type === '重连失败') {
        this.updateConnectionStatus('disconnected');
        this.isConnected = false;
        this.updateUI();
      } else if (error.type === '传输错误') {
        // 停止所有正在进行的传输
        this.fileTransfer.stopAllTransfers();
        this.updateConnectionStatus('disconnected');
        this.isConnected = false;
        this.updateUI();
      }
    };
  }
  
  setupFileTransferCallbacks() {
    // 设置文件传输日志回调
    this.fileTransfer.onLog = (message) => {
      this.log(message, 'info');
    };
    
    this.fileTransfer.onTransferProgress = (progress) => {
      // 如果是接收端且是新的传输，创建传输项目
      if (progress.type === 'receive' && progress.progress === 0) {
        const itemId = this.addTransferItem(progress.fileName, progress.total, 'receive');
        // 关联传输ID
        const element = document.getElementById(itemId);
        if (element) {
          element.dataset.transferId = progress.transferId;
        }
      }
      
      // 如果是接收端且文件名从 "Unknown File" 更新为真实文件名，更新UI
      if (progress.type === 'receive' && progress.fileName !== 'Unknown File') {
        const transferItems = document.querySelectorAll('.transfer-item');
        transferItems.forEach(item => {
          if (item.dataset.transferId === progress.transferId) {
            const titleElement = item.querySelector('h4');
            if (titleElement && titleElement.textContent.includes('Unknown File')) {
              titleElement.textContent = `${progress.fileName} (接收)`;
              console.log('Updated transfer item title to:', progress.fileName);
            }
          }
        });
      }
      
      this.updateTransferProgress(progress);
    };
    
    this.fileTransfer.onFileReceived = (fileData) => {
      this.handleReceivedFile(fileData);
      this.log(`接收文件: ${fileData.fileName} (${this.formatFileSize(fileData.fileSize)})`, 'success');
    };
    
    this.fileTransfer.onTransferComplete = (data) => {
      if (this.connectionType === 'cli') {
        this.log(`[中转模式] 接收方已确认收到: ${data.fileName} (${this.formatDuration(data.duration)})`, 'success');
      } else {
        this.log(`[P2P模式] 传输完成: ${data.fileName} (${this.formatDuration(data.duration)})`, 'success');
      }
    };
    
    this.fileTransfer.onTransferError = (error) => {
      this.log(`传输错误: ${error.error}`, 'error');
    };
  }
  
  async connect() {
    const serverUrl = document.getElementById('server-url').value.trim();
    const roomId = document.getElementById('room-id').value.trim();
    
    if (!serverUrl) {
      this.log('请输入信令服务器地址', 'error');
      return;
    }
    
    if (!roomId) {
      document.getElementById('room-id').value = this.generateRoomId();
    }
    
    try {
      this.updateConnectionStatus('connecting');
      this.log('[连接中] 正在连接到信令服务器...', 'info');
      
      await this.webrtcManager.connectToSignalingServer(serverUrl);
      this.webrtcManager.joinRoom(document.getElementById('room-id').value);
      
      this.isConnected = true;
      this.updateUI();
      this.log(`[已连接] 已连接到信令服务器，房间: ${document.getElementById('room-id').value}`, 'success');
    } catch (error) {
      this.log(`[连接失败] ${error.message}`, 'error');
      this.updateConnectionStatus('disconnected');
    }
  }
  
  disconnect() {
    // 停止所有正在进行的传输
    this.fileTransfer.stopAllTransfers();
    this.webrtcManager.disconnect();
    this.isConnected = false;
    this.connectionType = 'none';
    this.updateConnectionStatus('disconnected');
    this.updateUI();
    
    // 初始状态隐藏传输区域
    document.getElementById('transfer-section').style.display = 'none';
    this.log('[已断开] 连接已断开', 'info');
  }
  
  async handleFileSelection(files) {
    console.log('文件选择:', files);
    
    // 检查是否已连接到信令服务器
    if (!this.isConnected) {
      this.log('请先连接到信令服务器', 'error');
      alert('请先连接到信令服务器！');
      return;
    }
    
    // 检查连接状态 - 支持WebRTC和CLI模式
    const hasConnection = (this.webrtcManager.dataChannel && this.webrtcManager.dataChannel.readyState === 'open') ||
                         (this.connectionType === 'cli');
    
    if (!hasConnection) {
      this.log('没有可用的连接，无法发送文件。请确保另一个用户已连接到相同房间。', 'error');
      alert('没有可用的连接！请确保另一个用户已连接到相同房间。');
      return;
    }
    
    if (files.length === 0) {
      this.log('未选择任何文件', 'warning');
      return;
    }
    
    for (const file of files) {
      console.log('Processing file:', file.name);
      this.log(`开始发送: ${file.name} (${this.formatFileSize(file.size)})`, 'info');
      
      // 创建传输项目
      const itemId = this.addTransferItem(file.name, file.size, 'send');
      
      try {
        // 发送文件，传递 itemId 以便在内部关联
        await this.fileTransfer.sendFile(file, itemId);
      } catch (error) {
        this.log(`发送文件失败: ${error.message}`, 'error');
        console.error('File send error:', error);
      }
    }
    
    // 清空文件输入
    document.getElementById('file-input').value = '';
  }
  
  handleReceivedFile(fileData) {
    // 创建下载链接
    const url = URL.createObjectURL(fileData.file);
    
    // 添加到接收文件列表
    const receivedFiles = document.getElementById('received-files');
    const fileItem = document.createElement('div');
    fileItem.className = 'file-item';
    
    fileItem.innerHTML = `
      <div class="file-info">
        <h4>${fileData.fileName}</h4>
        <p>大小: ${this.formatFileSize(fileData.fileSize)} | 用时: ${this.formatDuration(fileData.duration)}</p>
      </div>
      <button class="download-btn">下载</button>
    `;
    
    // 绑定下载事件
    const downloadBtn = fileItem.querySelector('.download-btn');
    downloadBtn.addEventListener('click', () => {
      this.downloadFile(url, fileData.fileName);
    });
    
    receivedFiles.appendChild(fileItem);
  }
  
  downloadFile(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
  
  addTransferItem(fileName, fileSize, type) {
    const transferList = document.getElementById('transfer-list');
    const transferItem = document.createElement('div');
    transferItem.className = 'transfer-item';
    const itemId = `transfer-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    transferItem.id = itemId;
    
    transferItem.innerHTML = `
      <h4>${fileName} (${type === 'send' ? 'SEND' : 'RECV'})</h4>
      <div class="progress-bar">
        <span class="progress-text">[          ] 0% (0 / ${this.formatFileSize(fileSize)})</span>
      </div>
    `;
    
    transferList.appendChild(transferItem);
    console.log('Created transfer item:', itemId, 'for file:', fileName);
    return itemId;
  }
  
  updateTransferProgress(progress) {
    console.log('Update progress:', progress);
    
    // 通过 transferId 找到对应的传输项目
    const transferItems = document.querySelectorAll('.transfer-item');
    console.log('Looking for transferId:', progress.transferId);
    
    let found = false;
    transferItems.forEach(item => {
      console.log('Checking item transferId:', item.dataset.transferId);
      if (item.dataset.transferId === progress.transferId) {
        found = true;
        const progressText = item.querySelector('.progress-text');
        
        const percentage = Math.round(progress.progress);
        const current = progress.type === 'send' ? progress.sent : progress.received;
        
        // 创建ASCII进度条 (10个字符宽度)
        const barWidth = 10;
        const filledWidth = Math.round((percentage / 100) * barWidth);
        const emptyWidth = barWidth - filledWidth;
        const progressBar = '='.repeat(filledWidth) + ' '.repeat(emptyWidth);
        
        progressText.textContent = `[${progressBar}] ${percentage}% (${this.formatFileSize(current)} / ${this.formatFileSize(progress.total)})`;
        
        console.log(`Updated progress for ${progress.fileName}: ${percentage}%`);
        return;
      }
    });
    
    if (!found) {
      console.warn('Transfer item not found for transferId:', progress.transferId);
    }
  }
  
  updateConnectionStatus(status) {
    const statusElement = document.getElementById('connection-status');
    statusElement.className = `status ${status}`;
    
    switch (status) {
      case 'disconnected':
        statusElement.textContent = '未连接';
        break;
      case 'connecting':
        statusElement.textContent = '连接中...';
        break;
      case 'connected':
        statusElement.textContent = '已连接';
        break;
      case 'connected-cli':
        statusElement.textContent = '已连接(CLI)';
        statusElement.className = `status connected`; // 使用connected样式
        break;
      default:
        statusElement.textContent = status;
    }
  }


  // 移除定时器，改为事件驱动
  startRoomStatusCheck() {
    // 不再使用定时器，改为事件驱动更新
  }

  stopRoomStatusCheck() {
    // 清理不再使用
  }
  
  updateUI() {
    const connectBtn = document.getElementById('connect-btn');
    const disconnectBtn = document.getElementById('disconnect-btn');
    const transferSection = document.getElementById('transfer-section');
    const dropZone = document.getElementById('file-drop-zone');
    const selectFileBtn = document.getElementById('select-file-btn');
    
    if (this.isConnected) {
      connectBtn.style.display = 'none';
      disconnectBtn.style.display = 'inline-block';
      transferSection.style.display = 'block';
      
      // 所有模式都使用统一的P2P样式
      if (this.connectionType === 'cli') {
        // CLI模式
        const dropContent = dropZone.querySelector('.drop-content p');
        dropContent.textContent = '[中转模式] 已连接，可以开始文件传输';
        dropZone.style.borderColor = '#27ae60';
        dropZone.style.backgroundColor = '#f0fff4';
        selectFileBtn.style.display = 'inline-block';
      } else if (this.connectionType === 'connecting') {
        // 连接中状态 - 与"正在建立连接..."对应
        const dropContent = dropZone.querySelector('.drop-content p');
        dropContent.textContent = '[连接中] 正在尝试建立P2P连接...';
        dropZone.style.borderColor = '#27ae60';
        dropZone.style.backgroundColor = '#f0fff4';
        selectFileBtn.style.display = 'none'; // 隐藏Select Files按钮
      } else if (this.webrtcManager.dataChannel && this.webrtcManager.dataChannel.readyState === 'open') {
        // WebRTC模式 - 已建立连接
        const dropContent = dropZone.querySelector('.drop-content p');
        dropContent.textContent = '[P2P模式] WebRTC数据通道已建立，可以开始文件传输';
        dropZone.style.borderColor = '#27ae60';
        dropZone.style.backgroundColor = '#f0fff4';
        selectFileBtn.style.display = 'inline-block';
      } else {
        // WebRTC模式 - 等待连接
        const dropContent = dropZone.querySelector('.drop-content p');
        dropContent.textContent = '等待另一个用户连接以建立数据通道...';
        dropZone.style.borderColor = '#27ae60';
        dropZone.style.backgroundColor = '#f0fff4';
        selectFileBtn.style.display = 'none'; // 隐藏Select Files按钮
      }
    } else {
      connectBtn.style.display = 'inline-block';
      disconnectBtn.style.display = 'none';
      transferSection.style.display = 'none';
      
      // 重置文件区域样式
      const dropContent = dropZone.querySelector('.drop-content p');
      dropContent.textContent = '拖拽文件到这里或点击选择文件';
      dropZone.style.borderColor = '#3498db';
      dropZone.style.backgroundColor = '#f8f9fa';
    }
  }
  
  showTransferSection() {
    // 直接显示传输区域
    document.getElementById('transfer-section').style.display = 'block';
    this.updateUI();
  }
  
  generateRoomId() {
    return Math.random().toString(36).substr(2, 8).toUpperCase();
  }
  
  
  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) {
      return `${seconds}秒`;
    } else {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      return `${minutes}分${remainingSeconds}秒`;
    }
  }
  
  log(message, type = 'info') {
    const logContainer = document.getElementById('log-container');
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type}`;
    
    const timestamp = new Date().toLocaleTimeString();
    logEntry.textContent = `[${timestamp}] ${message}`;
    
    logContainer.appendChild(logEntry);
    logContainer.scrollTop = logContainer.scrollHeight;
  }
}

// 当页面加载完成时初始化应用
document.addEventListener('DOMContentLoaded', () => {
  window.app = new WebRTCApp();
  
  // 在页面关闭时清理连接
  window.addEventListener('beforeunload', () => {
    if (window.app) {
      window.app.disconnect();
    }
  });
});