class WebRTCManager {
  constructor() {
    this.ws = null;
    this.peerConnection = null;
    this.dataChannel = null;
    this.clientId = this.generateId();
    this.roomId = null;
    this.isInitiator = false;
    this.transferStopped = false; // 传输停止标志
    
    // ICE 服务器配置 (使用免费的 STUN 服务器)
    this.iceServers = [
      { urls: 'stun:stun.miwifi.com:3478' },
      { urls: 'stun:stun.cloudflare.com:3478' }
    ];
    
    // 事件回调
    this.onConnectionStateChange = null;
    this.onDataChannelOpen = null;
    this.onDataChannelMessage = null;
    this.onFileReceived = null;
    this.onTransferProgress = null;
    this.onError = null;
    
    // 连接状态和错误处理
    this.connectionTimeout = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
    this.reconnectDelay = 2000;
    this.heartbeatInterval = null;
    this.lastPingTime = 0;
  }
  
  generateId() {
    return Math.random().toString(36).substr(2, 9);
  }
  
  // 连接到信令服务器
  connectToSignalingServer(serverUrl = 'ws://localhost:3000') {
    return new Promise((resolve, reject) => {
      try {
        this.transferStopped = false; // 重置传输停止标志
        this.ws = new WebSocket(serverUrl);
        
        // 设置连接超时
        this.connectionTimeout = setTimeout(() => {
          if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
            this.ws.close();
            reject(new Error('连接超时'));
          }
        }, 10000); // 10秒超时
        
        this.ws.onopen = () => {
          console.log('Connected to signaling server');
          clearTimeout(this.connectionTimeout);
          this.reconnectAttempts = 0;
          
          // 启动心跳检测
          this.startHeartbeat();
          resolve();
        };
        
        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          clearTimeout(this.connectionTimeout);
          this.handleConnectionError(error);
          reject(new Error('WebSocket连接失败'));
        };
        
        this.ws.onmessage = (event) => {
          try {
            this.handleSignalingMessage(JSON.parse(event.data));
          } catch (error) {
            console.error('Error parsing signaling message:', error);
            this.handleError('信令消息解析错误', error);
          }
        };
        
        this.ws.onclose = (event) => {
          console.log('Disconnected from signaling server, code:', event.code);
          clearTimeout(this.connectionTimeout);
          
          // 如果不是主动断开连接，尝试重连
          if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.attemptReconnect(serverUrl);
          }
        };
      } catch (error) {
        clearTimeout(this.connectionTimeout);
        reject(new Error('无法创建WebSocket连接: ' + error.message));
      }
    });
  }
  
  // 加入房间
  joinRoom(roomId) {
    this.roomId = roomId;
    this.sendSignalingMessage({
      type: 'join',
      roomId: roomId,
      clientId: this.clientId
    });
  }
  
  // 处理信令消息
  async handleSignalingMessage(message) {
    console.log('Received signaling message:', message.type, 'isInitiator:', this.isInitiator);
    
    switch (message.type) {
      case 'room-joined':
        console.log('Joined room:', message.roomId, 'existing members:', message.existingMembers);
        if (message.existingMembers.length > 0) {
          // 检查是否有其他Web客户端
          const webClients = message.existingMembers.filter(member => member.clientType === 'web');
          const cliClients = message.existingMembers.filter(member => member.clientType === 'cli');
          
          console.log(`Found ${webClients.length} web clients and ${cliClients.length} CLI clients`);
          
          if (webClients.length > 0) {
            // 如果房间里已有其他Web客户端，作为发起方建立WebRTC连接
            console.log('Setting as WebRTC initiator (room has existing web clients)');
            this.isInitiator = true;
            await this.initializePeerConnection();
            await this.createOffer();
          } else if (cliClients.length > 0) {
            // 只有CLI客户端，标记为连接状态但不建立WebRTC
            console.log('Connected to CLI clients only, no WebRTC needed');
            if (this.onConnectionStateChange) {
              this.onConnectionStateChange('connected-cli');
            }
          }
        }
        break;
        
      case 'peer-joined':
        console.log('Peer joined:', message.clientId, 'type:', message.clientType, 'current isInitiator:', this.isInitiator);
        
        if (message.clientType === 'cli') {
          // CLI客户端加入，不需要建立WebRTC连接，但需要通知应用
          console.log('CLI client joined, no WebRTC connection needed');
          if (this.onConnectionStateChange) {
            this.onConnectionStateChange('connected-cli');
          }
        } else if (!this.isInitiator && !this.peerConnection) {
          // Web客户端加入，作为接收方初始化WebRTC连接
          console.log('Initializing WebRTC as receiver');
          await this.initializePeerConnection();
          this.startP2PTimeout();
        }
        break;
        
      case 'offer':
        console.log('Received offer');
        await this.handleOffer(message);
        break;
        
      case 'answer':
        console.log('Received answer');
        await this.handleAnswer(message);
        break;
        
      case 'ice-candidate':
        console.log('Received ICE candidate');
        await this.handleIceCandidate(message);
        break;
        
      case 'peer-left':
        console.log('Peer left:', message.clientId);
        // 不管是WebRTC还是CLI模式，都需要通知连接状态变化
        if (this.onConnectionStateChange) {
          this.onConnectionStateChange('disconnected');
        }
        this.closePeerConnection();
        break;
        
      case 'data':
        console.log('Received data message from CLI');
        if (this.onDataChannelMessage) {
          this.onDataChannelMessage(message.data);
        }
        break;
        
      case 'transfer-error':
        console.log('Received transfer error:', message.error);
        this.transferStopped = true; // 设置传输停止标志
        if (this.onError) {
          this.onError({
            type: '传输错误',
            message: message.error
          });
        }
        // 通知连接状态变化为断开
        if (this.onConnectionStateChange) {
          this.onConnectionStateChange('disconnected');
        }
        break;
        
      case 'room-full':
        console.log('Room is full:', message.message);
        if (this.onError) {
          this.onError({
            type: '房间已满',
            message: message.message
          });
        }
        break;
    }
  }
  
  // 初始化 RTCPeerConnection
  async initializePeerConnection() {
    console.log('Initializing PeerConnection, isInitiator:', this.isInitiator);
    
    this.peerConnection = new RTCPeerConnection({
      iceServers: this.iceServers
    });
    
    // ICE 候选事件
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('Sending ICE candidate');
        this.sendSignalingMessage({
          type: 'ice-candidate',
          candidate: event.candidate
        });
      }
    };
    
    // 连接状态变化
    this.peerConnection.onconnectionstatechange = () => {
      console.log('Connection state:', this.peerConnection.connectionState);
      
      // 处理P2P连接失败，尝试回退到中转模式
      if (this.peerConnection.connectionState === 'failed' || 
          this.peerConnection.connectionState === 'disconnected' ||
          this.peerConnection.connectionState === 'closed') {
        
        console.log('P2P连接失败，检查是否可以回退到中转模式');
        this.p2pFailed = true;
        
        // 清除P2P连接超时
        if (this.p2pConnectionTimeout) {
          clearTimeout(this.p2pConnectionTimeout);
        }
        
        // 检查是否有CLI客户端，回退到中转模式
        this.checkFallbackToRelay();
      }
      
      if (this.onConnectionStateChange) {
        this.onConnectionStateChange(this.peerConnection.connectionState);
      }
    };
    
    // 接收到 DataChannel
    this.peerConnection.ondatachannel = (event) => {
      console.log('Received DataChannel from peer:', event.channel.label);
      this.setupDataChannel(event.channel);
    };
    
    // 如果是发起方，创建 DataChannel
    if (this.isInitiator) {
      console.log('Creating DataChannel as initiator');
      this.dataChannel = this.peerConnection.createDataChannel('fileTransfer', {
        ordered: true
      });
      this.setupDataChannel(this.dataChannel);
      this.startP2PTimeout();
    } else {
      console.log('Waiting for DataChannel as receiver');
    }
  }
  
  // 设置 DataChannel
  setupDataChannel(channel) {
    console.log('Setting up DataChannel:', channel.label, 'readyState:', channel.readyState);
    this.dataChannel = channel;
    
    this.dataChannel.onopen = () => {
      console.log('DataChannel opened, label:', this.dataChannel.label);
      if (this.onDataChannelOpen) {
        this.onDataChannelOpen();
      }
    };
    
    this.dataChannel.onmessage = (event) => {
      console.log('DataChannel message received');
      this.handleDataChannelMessage(event.data);
    };
    
    this.dataChannel.onerror = (error) => {
      console.error('DataChannel error:', error);
    };
    
    this.dataChannel.onclose = () => {
      console.log('DataChannel closed');
    };
  }
  
  // 创建 Offer
  async createOffer() {
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    
    this.sendSignalingMessage({
      type: 'offer',
      offer: offer
    });
  }
  
  // 处理 Offer
  async handleOffer(message) {
    await this.peerConnection.setRemoteDescription(message.offer);
    
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    
    this.sendSignalingMessage({
      type: 'answer',
      answer: answer
    });
  }
  
  // 处理 Answer
  async handleAnswer(message) {
    await this.peerConnection.setRemoteDescription(message.answer);
  }
  
  // 处理 ICE 候选
  async handleIceCandidate(message) {
    await this.peerConnection.addIceCandidate(message.candidate);
  }
  
  // 发送信令消息
  sendSignalingMessage(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }
  
  // 处理 DataChannel 消息
  handleDataChannelMessage(data) {
    console.log('DataChannel received message, type:', typeof data, 'data:', data instanceof Blob ? 'Blob' : data instanceof ArrayBuffer ? 'ArrayBuffer' : 'other');
    
    if (this.onDataChannelMessage) {
      this.onDataChannelMessage(data);
    } else {
      console.warn('No DataChannel message handler set');
    }
  }
  
  // 发送数据通过 DataChannel
  // 发送数据 (支持WebRTC和CLI模式)，带队列控制和重试机制
  async sendData(data) {
    console.log('Attempting to send data, length:', data.length, 'DataChannel state:', this.dataChannel?.readyState, 'WebSocket state:', this.ws?.readyState);
    
    // 如果有WebRTC连接，优先使用WebRTC
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      try {
        // 检查缓冲区状态，避免队列溢出
        if (this.dataChannel.bufferedAmount > 0) {
          console.log('DataChannel buffer not empty, waiting... bufferedAmount:', this.dataChannel.bufferedAmount);
          await this.waitForBufferToClear();
        }
        
        this.dataChannel.send(data);
        console.log('Data sent via WebRTC DataChannel');
        return true;
      } catch (error) {
        console.error('Error sending data via WebRTC:', error);
        // 如果是缓冲区满的错误，等待后重试
        if (error.name === 'OperationError' && error.message.includes('send queue is full')) {
          console.log('Buffer full, waiting and retrying...');
          // 根据缓冲区大小动态调整等待时间
          const waitTime = Math.min(50 + this.dataChannel.bufferedAmount / 1000, 200); // 动态等待50-200ms
          await this.delay(waitTime);
          try {
            this.dataChannel.send(data);
            return true;
          } catch (retryError) {
            console.error('Retry failed:', retryError);
            return false;
          }
        }
        return false;
      }
    } 
    // 否则通过WebSocket发送给CLI
    else if (this.ws && this.ws.readyState === WebSocket.OPEN && !this.transferStopped) {
      try {
        this.sendSignalingMessage({
          type: 'data',
          data: JSON.parse(data), // data应该是JSON字符串
          roomId: this.roomId
        });
        console.log('Data sent via WebSocket to CLI');
        return true;
      } catch (error) {
        console.error('Error sending data via WebSocket:', error);
        // 如果是传输错误，停止继续发送
        if (this.onError) {
          this.onError({
            type: '传输错误',
            message: '无法发送数据到CLI端'
          });
        }
        return false;
      }
    } else {
      console.warn('No available connection for sending data (transferStopped:', this.transferStopped, ')');
      return false;
    }
  }

  // 等待DataChannel缓冲区清空（优化性能）
  waitForBufferToClear() {
    return new Promise((resolve) => {
      // 只有当缓冲区接近上限时才等待
      const bufferThreshold = 256 * 1024; // 256KB阈值，放宽限制
      
      if (this.dataChannel.bufferedAmount < bufferThreshold) {
        resolve();
        return;
      }
      
      const checkBuffer = () => {
        if (this.dataChannel.bufferedAmount < bufferThreshold) {
          resolve();
        } else {
          setTimeout(checkBuffer, 10); // 减少检查间隔到10ms
        }
      };
      
      checkBuffer();
    });
  }
  
  // 关闭连接
  closePeerConnection() {
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
  }
  
  // 断开连接
  disconnect() {
    clearTimeout(this.connectionTimeout);
    this.closePeerConnection();
    
    if (this.ws) {
      this.sendSignalingMessage({ type: 'leave' });
      this.ws.close(1000); // 主动关闭
      this.ws = null;
    }
  }
  
  // 错误处理方法
  handleConnectionError(error) {
    console.error('Connection error:', error);
    this.handleError('连接错误', error);
  }
  
  handleError(type, error) {
    if (this.onError) {
      this.onError({
        type: type,
        message: error.message || error,
        timestamp: new Date()
      });
    }
  }
  
  // 重连尝试
  attemptReconnect(serverUrl) {
    this.reconnectAttempts++;
    console.log(`尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(() => {
      this.connectToSignalingServer(serverUrl)
        .then(() => {
          if (this.roomId) {
            this.joinRoom(this.roomId);
          }
        })
        .catch((error) => {
          console.error('重连失败:', error);
          if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.handleError('重连失败', new Error('已达到最大重连次数'));
          }
        });
    }, this.reconnectDelay);
  }
  
  // 获取连接状态
  getConnectionState() {
    return {
      signaling: this.ws ? this.ws.readyState : WebSocket.CLOSED,
      peer: this.peerConnection ? this.peerConnection.connectionState : 'closed',
      dataChannel: this.dataChannel ? this.dataChannel.readyState : 'closed'
    };
  }

  // 启动心跳检测
  startHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    // 每30秒发送一次心跳
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.sendSignalingMessage({ type: 'ping' });
        this.lastPingTime = Date.now();
      }
    }, 30000);
  }
  
  // 停止心跳检测
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
  
  // 完全断开连接
  disconnect() {
    this.stopHeartbeat();
    
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000, 'Normal closure');
    }
    
    this.ws = null;
    this.roomId = null;
    this.isInitiator = false;
  }

  // P2P连接超时处理
  startP2PTimeout() {
    if (this.p2pConnectionTimeout) {
      clearTimeout(this.p2pConnectionTimeout);
    }
    
    // 设置P2P连接超时（30秒）
    this.p2pConnectionTimeout = setTimeout(() => {
      if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
        console.log('P2P连接超时，准备回退到中转模式');
        this.p2pFailed = true;
        this.checkFallbackToRelay();
      }
    }, 30000); // 30秒超时
  }
  
  // 检查并回退到中转模式
  checkFallbackToRelay() {
    console.log('正在尝试回退到中转模式...');
    
    // 关闭失败的P2P连接
    this.closePeerConnection();
    
    // 通知应用回退到中转模式
    if (this.onConnectionStateChange) {
      this.onConnectionStateChange('fallback-to-relay');
    }
    
    // 使用WebSocket中转模式
    if (this.onConnectionStateChange) {
      this.onConnectionStateChange('connected-cli');
    }
    
    console.log('已回退到中转模式');
  }
  
  // 关闭P2P连接但保持WebSocket连接
  closePeerConnection() {
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    
    this.isInitiator = false;
  }
  
  // 延迟工具方法
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
