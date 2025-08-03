class FileTransferManager {
  constructor(webrtcManager) {
    this.webrtcManager = webrtcManager;
    this.chunkSize = 16384; // 16KB chunks (safe for most browsers)
    this.activeTransfers = new Map();
    this.receivingFiles = new Map();
    this.connectionType = 'p2p'; // 默认P2P模式
    
    // 设置 DataChannel 消息处理
    this.webrtcManager.onDataChannelMessage = (data) => {
      this.handleMessage(data);
    };
    
    // 事件回调
    this.onFileReceived = null;
    this.onTransferProgress = null;
    this.onTransferComplete = null;
    this.onTransferError = null;
  }
  
  // 发送文件
  async sendFile(file, uiItemId = null) {
    const transferId = this.generateTransferId();
    const fileInfo = {
      id: transferId,
      name: file.name,
      size: file.size,
      fileType: file.type,  // 改名为 fileType 避免冲突
      lastModified: file.lastModified
    };
    
    console.log('Starting file transfer:', fileInfo);
    
    // 如果提供了 UI 元素 ID，立即关联
    if (uiItemId) {
      const element = document.getElementById(uiItemId);
      if (element) {
        element.dataset.transferId = transferId;
        console.log('Associated transferId', transferId, 'with UI element', uiItemId);
      }
    }
    
    // 发送文件元数据
    const fileInfoMessage = {
      type: 'file-info',
      ...fileInfo
    };
    console.log('Sending file-info message:', fileInfoMessage);
    await this.sendMessage(fileInfoMessage);
    
    // 给接收端一些时间处理 file-info 消息
    await this.delay(10);
    
    // 读取文件并分块发送
    const arrayBuffer = await this.readFileAsArrayBuffer(file);
    const totalChunks = Math.ceil(arrayBuffer.byteLength / this.chunkSize);
    
    this.activeTransfers.set(transferId, {
      file: fileInfo,
      totalChunks: totalChunks,
      sentChunks: 0,
      startTime: Date.now()
    });
    
    // 发送文件块
    for (let i = 0; i < totalChunks; i++) {
      // 检查传输是否已被停止
      const transfer = this.activeTransfers.get(transferId);
      if (!transfer) {
        console.log('Transfer stopped, cancelling file send for:', transferId, 'at chunk:', i);
        return null;
      }
      
      const start = i * this.chunkSize;
      const end = Math.min(start + this.chunkSize, arrayBuffer.byteLength);
      const chunk = arrayBuffer.slice(start, end);
      
      const success = await this.sendMessage({
        type: 'file-chunk',
        transferId: transferId,
        chunkIndex: i,
        totalChunks: totalChunks,
        data: chunk
      });
      
      // 如果发送失败，停止传输
      if (!success) {
        console.log('Failed to send chunk', i, ', stopping transfer:', transferId);
        this.activeTransfers.delete(transferId);
        if (this.onTransferError) {
          this.onTransferError({
            transferId: transferId,
            fileName: fileInfo.name,
            error: '传输中断：无法发送数据',
            type: 'send'
          });
        }
        return null;
      }
      
      // 更新进度
      transfer.sentChunks = i + 1;
      
      if (this.onTransferProgress) {
        this.onTransferProgress({
          transferId: transferId,
          fileName: fileInfo.name,
          progress: (transfer.sentChunks / transfer.totalChunks) * 100,
          sent: transfer.sentChunks * this.chunkSize,
          total: fileInfo.size,
          type: 'send'
        });
      }
      
      // 小延迟避免阻塞浏览器
      if (i % 10 === 0) {
        await this.delay(1);
      }
    }
    
    // 检查传输是否已被停止（最终检查）
    const finalTransfer = this.activeTransfers.get(transferId);
    if (!finalTransfer) {
      console.log('Transfer was stopped before completion, not sending file-complete message');
      return null;
    }
    
    // 发送传输完成消息
    await this.sendMessage({
      type: 'file-complete',
      transferId: transferId,
      senderId: 'web-client' // 添加发送方标识
    });
    
    const duration = Date.now() - finalTransfer.startTime;
    
    // 中转模式需要等待接收方确认
    if (this.connectionType === 'cli') {
      if (this.onTransferProgress) {
        this.onTransferProgress({
          transferId: transferId,
          fileName: fileInfo.name,
          progress: 100,
          sent: fileInfo.size,
          total: fileInfo.size,
          type: 'send',
          status: 'waiting-confirmation' // 等待接收方确认
        });
      }
      
      // 在中转模式下，发送方需要等待接收方确认，不要立即触发完成事件
      console.log('[中转模式] 文件已发送完成，等待接收方确认...');
    } else {
      // P2P模式下可以立即完成
      if (this.onTransferComplete) {
        this.onTransferComplete({
          transferId: transferId,
          fileName: fileInfo.name,
          size: fileInfo.size,
          duration: duration,
          type: 'send'
        });
      }
    }
    
    this.activeTransfers.delete(transferId);
    return transferId; // 返回传输ID
  }
  
  // 处理接收到的消息
  handleMessage(data) {
    try {
      let message;
      
      // 处理二进制数据（文件块）
      if (data instanceof ArrayBuffer) {
        console.warn('Received raw ArrayBuffer, expecting JSON message');
        return;
      }
      
      // 处理 Blob 数据
      if (data instanceof Blob) {
        console.log('Received Blob data, converting to text');
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const message = JSON.parse(reader.result);
            this.handleParsedMessage(message);
          } catch (error) {
            console.error('Error parsing Blob message:', error);
          }
        };
        reader.readAsText(data);
        return;
      }
      
      // 处理文本消息
      if (typeof data === 'string') {
        message = JSON.parse(data);
        this.handleParsedMessage(message);
      } else if (typeof data === 'object' && data !== null) {
        // 处理已经解析的对象（来自CLI通过WebSocket）
        console.log('Received parsed object from CLI:', data);
        this.handleParsedMessage(data);
      } else {
        console.warn('Unknown data type:', typeof data, data);
        return;
      }
      
    } catch (error) {
      console.error('Error handling message:', error);
      if (this.onTransferError) {
        this.onTransferError({ error: error.message });
      }
    }
  }
  
  // 处理已解析的消息
  handleParsedMessage(message) {
    const messageId = message.transferId || message.id || 'no-id';
    console.log('Handling message:', message.type, 'id:', messageId);
    
    switch (message.type) {
      case 'file-info':
        console.log('Processing file-info message:', message);
        this.handleFileInfo(message);
        break;
      case 'file-chunk':
        this.handleFileChunk(message);
        break;
      case 'file-complete':
        this.handleFileComplete(message);
        break;
      case 'file-received-confirmation':
        console.log('Received confirmation message in browser:', message);
        this.handleFileReceivedConfirmation(message);
        break;
      default:
        console.warn('Unknown message type:', message.type);
    }
  }
  
  // 处理文件信息
  handleFileInfo(fileInfo) {
    console.log('Receiving file:', fileInfo.name, fileInfo.size, 'bytes', 'transferId:', fileInfo.id);
    
    // 检查是否已存在该传输（可能是临时创建的）
    const existingFile = this.receivingFiles.get(fileInfo.id);
    if (existingFile) {
      console.log('Updating existing transfer record with file info');
      // 更新现有记录的文件信息
      existingFile.info = fileInfo;
      existingFile.isTemporary = false;
      
      // 更新UI显示正确的文件名
      if (this.onTransferProgress) {
        this.onTransferProgress({
          transferId: fileInfo.id,
          fileName: fileInfo.name,
          progress: (existingFile.receivedChunks / (existingFile.info.size / this.chunkSize)) * 100,
          received: existingFile.receivedChunks * this.chunkSize,
          total: fileInfo.size,
          type: 'receive'
        });
      }
      return;
    }
    
    // 创建新的传输记录
    this.receivingFiles.set(fileInfo.id, {
      info: fileInfo,
      chunks: new Map(),
      receivedChunks: 0,
      startTime: Date.now(),
      isTemporary: false
    });
    
    console.log('Created receiving file record for transfer:', fileInfo.id);
    
    // 通知应用程序开始接收文件
    if (this.onTransferProgress) {
      this.onTransferProgress({
        transferId: fileInfo.id,
        fileName: fileInfo.name,
        progress: 0,
        received: 0,
        total: fileInfo.size,
        type: 'receive'
      });
    }
  }
  
  // 处理文件块
  handleFileChunk(message) {
    const { transferId, chunkIndex, totalChunks, data } = message;
    console.log('Handling file chunk:', chunkIndex, '/', totalChunks, 'for transfer:', transferId);
    
    let receivingFile = this.receivingFiles.get(transferId);
    
    if (!receivingFile) {
      console.error('Received chunk for unknown transfer:', transferId);
      console.log('Available transfers:', Array.from(this.receivingFiles.keys()));
      
      // 阻止无限循环：如果已经创建过临时记录就不要重复处理
      if (this.receivingFiles.has(transferId + '_temp')) {
        console.warn('Temporary record already exists, skipping chunk:', chunkIndex);
        return;
      }
      
      // 尝试创建一个临时的传输记录
      console.log('Creating temporary transfer record for:', transferId);
      receivingFile = {
        info: {
          id: transferId,
          name: 'Unknown File',
          size: totalChunks * this.chunkSize, // 估算大小
          fileType: 'application/octet-stream'
        },
        chunks: new Map(),
        receivedChunks: 0,
        startTime: Date.now(),
        isTemporary: true
      };
      this.receivingFiles.set(transferId, receivingFile);
      
      // 标记已创建临时记录
      this.receivingFiles.set(transferId + '_temp', true);
      
      // 通知应用创建UI项目
      if (this.onTransferProgress) {
        this.onTransferProgress({
          transferId: transferId,
          fileName: receivingFile.info.name,
          progress: 0,
          received: 0,
          total: receivingFile.info.size,
          type: 'receive'
        });
      }
    }
    
    // 检查是否已经处理过这个块
    if (receivingFile.chunks.has(chunkIndex)) {
      console.warn('Chunk already processed:', chunkIndex, 'for transfer:', transferId);
      return;
    }
    
    // 将 base64 数据转换为 ArrayBuffer
    const binaryData = this.base64ToArrayBuffer(data);
    receivingFile.chunks.set(chunkIndex, binaryData);
    receivingFile.receivedChunks++;
    
    // 更新进度
    if (this.onTransferProgress) {
      this.onTransferProgress({
        transferId: transferId,
        fileName: receivingFile.info.name,
        progress: (receivingFile.receivedChunks / totalChunks) * 100,
        received: receivingFile.receivedChunks * this.chunkSize,
        total: receivingFile.info.size,
        type: 'receive'
      });
    }
  }
  
  // 处理文件传输完成
  handleFileComplete(message) {
    const { transferId, senderId } = message;
    console.log('Handling file complete for transfer:', transferId, 'senderId:', senderId);
    
    const receivingFile = this.receivingFiles.get(transferId);
    
    if (!receivingFile) {
      console.error('Received completion for unknown transfer:', transferId);
      console.log('Available transfers:', Array.from(this.receivingFiles.keys()));
      return;
    }
    
    console.log('Reassembling file for transfer:', transferId);
    
    // 重组文件
    const fileBlob = this.reassembleFile(receivingFile);
    const duration = Date.now() - receivingFile.startTime;
    
    if (this.onFileReceived) {
      this.onFileReceived({
        transferId: transferId,
        file: fileBlob,
        fileName: receivingFile.info.name,
        fileType: receivingFile.info.fileType,
        fileSize: receivingFile.info.size,
        duration: duration
      });
    }
    
    if (this.onTransferComplete) {
      this.onTransferComplete({
        transferId: transferId,
        fileName: receivingFile.info.name,
        size: receivingFile.info.size,
        duration: duration,
        type: 'receive'
      });
    }
    
    // 如果是中转模式，发送确认消息给发送方
    if (this.connectionType === 'cli') {
      console.log('Sending file-received-confirmation in CLI mode:', receivingFile.info.name, transferId);
      this.sendMessage({
        type: 'file-received-confirmation',
        transferId: transferId,
        fileName: receivingFile.info.name,
        fileSize: receivingFile.info.size,
        duration: duration
      });
    } else {
      console.log('Not sending confirmation, connection type is:', this.connectionType);
    }
    
    this.receivingFiles.delete(transferId);
    console.log('File transfer completed and cleaned up:', transferId);
  }
  
  // 重组文件
  reassembleFile(receivingFile) {
    const sortedChunks = Array.from(receivingFile.chunks.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([index, data]) => data);
    
    const totalSize = sortedChunks.reduce((size, chunk) => size + chunk.byteLength, 0);
    const combinedBuffer = new Uint8Array(totalSize);
    
    let offset = 0;
    for (const chunk of sortedChunks) {
      combinedBuffer.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }
    
    return new Blob([combinedBuffer], { type: receivingFile.info.fileType });
  }
  
  // 设置连接类型
  setConnectionType(type) {
    this.connectionType = type;
    console.log('FileTransferManager connection type set to:', type);
  }
  
  // 发送消息（异步）
  async sendMessage(message) {
    const messageId = message.transferId || message.id || 'no-id';
    console.log('Sending message:', message.type, 'id:', messageId);
    
    // 对于文件块，需要特殊处理二进制数据
    if (message.type === 'file-chunk' && message.data instanceof ArrayBuffer) {
      // 将 ArrayBuffer 转换为 base64
      message.data = this.arrayBufferToBase64(message.data);
      console.log('Converted chunk to base64, length:', message.data.length);
    }
    
    const messageStr = JSON.stringify(message);
    console.log('Sending JSON message length:', messageStr.length);
    
    try {
      const success = await this.webrtcManager.sendData(messageStr);
      console.log('Message send result:', success, 'for message type:', message.type);
      return success;
    } catch (error) {
      console.error('Error sending message:', error);
      return false;
    }
  }
  
  // 工具方法
  generateTransferId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }
  
  readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }
  
  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  
  base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
  
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 处理接收方确认消息（中转模式专用）
  handleFileReceivedConfirmation(message) {
    const { transferId, fileName, fileSize, duration } = message;
    console.log('Received confirmation from receiver:', fileName, transferId);
    
    // 找到对应的传输记录
    const transferElement = document.querySelector(`[data-transfer-id="${transferId}"]`);
    if (transferElement) {
      const progressText = transferElement.querySelector('.progress-text');
      if (progressText) {
        progressText.textContent = `[==========] 100% (${this.formatFileSize(fileSize)} / ${this.formatFileSize(fileSize)}) 接收方已确认`;
      }
    }
    
    if (this.onTransferComplete) {
      this.onTransferComplete({
        transferId: transferId,
        fileName: fileName,
        size: fileSize,
        duration: duration,
        type: 'send'
      });
    }
    
    this.log('[中转模式] 接收方已确认收到文件，传输完成', 'success');
  }
  
  // 停止所有正在进行的传输
  stopAllTransfers() {
    console.log('Stopping all active transfers, current count:', this.activeTransfers.size);
    
    // 停止发送传输
    this.activeTransfers.forEach((transfer, transferId) => {
      console.log('Stopping send transfer:', transferId, transfer.file.name);
      if (this.onTransferError) {
        this.onTransferError({
          transferId: transferId,
          fileName: transfer.file.name,
          error: '传输被中断',
          type: 'send'
        });
      }
    });
    
    // 停止接收传输
    this.receivingFiles.forEach((transfer, transferId) => {
      console.log('Stopping receive transfer:', transferId, transfer.info.name);
      if (this.onTransferError) {
        this.onTransferError({
          transferId: transferId,
          fileName: transfer.info.name,
          error: '传输被中断',
          type: 'receive'
        });
      }
    });
    
    // 清空所有传输记录
    this.activeTransfers.clear();
    this.receivingFiles.clear();
    
    console.log('All transfers stopped, remaining counts - active:', this.activeTransfers.size, 'receiving:', this.receivingFiles.size);
  }
  
  // 获取传输统计
  getTransferStats() {
    return {
      activeTransfers: this.activeTransfers.size,
      receivingFiles: this.receivingFiles.size
    };
  }
}