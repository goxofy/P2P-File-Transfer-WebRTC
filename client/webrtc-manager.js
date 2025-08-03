class WebRTCManager {
  constructor() {
    this.ws = null;
    this.peerConnection = null;
    this.dataChannel = null;
    this.clientId = this.generateId();
    this.roomId = null;
    this.isInitiator = false;
    this.transferStopped = false; // 传输停止标志
    
    // ICE 服务器配置 (使用免费的 STUN 和 TURN 服务器)
    this.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      // 使用免费的 TURN 服务器 (有限配额)
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject', 
        credential: 'openrelayproject'
      }
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
      const state = this.peerConnection.connectionState;
      console.log(`[WebRTC] 连接状态变更: ${state}`);
      
      // 详细状态说明
      switch(state) {
        case 'connecting':
          console.log('[WebRTC] 正在尝试建立P2P连接...');
          break;
        case 'connected':
          console.log('[WebRTC] ✅ P2P连接建立成功！数据将直接传输');
          break;
        case 'disconnected':
          console.log('[WebRTC] ⚠️ P2P连接断开，可能会重连');
          break;
        case 'failed':
          console.log('[WebRTC] ❌ P2P连接失败，将使用服务器中继传输');
          console.log('[WebRTC] 提示：这通常是由于NAT/防火墙导致的，文件仍可正常传输');
          break;
        case 'closed':
          console.log('[WebRTC] P2P连接已关闭');
          break;
      }
      
      if (this.onConnectionStateChange) {
        this.onConnectionStateChange(state);
      }
    };
    
    // ICE连接状态变化 (更底层的连接状态)
    this.peerConnection.oniceconnectionstatechange = () => {
      const iceState = this.peerConnection.iceConnectionState;
      console.log(`[ICE] 连接状态: ${iceState}`);
      
      switch(iceState) {
        case 'checking':
          console.log('[ICE] 正在检查连接路径...');
          break;
        case 'connected':
          console.log('[ICE] ✅ ICE连接成功');
          break;
        case 'completed':
          console.log('[ICE] ✅ ICE连接完成，找到最佳路径');
          break;
        case 'failed':
          console.log('[ICE] ❌ ICE连接失败，NAT穿透不成功');
          break;
        case 'disconnected':
          console.log('[ICE] ⚠️ ICE连接断开');
          break;
        case 'closed':
          console.log('[ICE] ICE连接已关闭');
          break;
      }
    };
    
    // ICE候选者收集
    this.peerConnection.onicegatheringstatechange = () => {
      const gatheringState = this.peerConnection.iceGatheringState;
      console.log(`[ICE] 候选者收集状态: ${gatheringState}`);
      
      if (gatheringState === 'complete') {
        console.log('[ICE] ICE候选者收集完成');
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
  // 发送数据 (支持WebRTC和CLI模式)
  sendData(data) {
    console.log('Attempting to send data, length:', data.length, 'DataChannel state:', this.dataChannel?.readyState, 'WebSocket state:', this.ws?.readyState);
    
    // 如果有WebRTC连接，优先使用WebRTC
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      try {
        this.dataChannel.send(data);
        console.log('Data sent via WebRTC DataChannel');
        return true;
      } catch (error) {
        console.error('Error sending data via WebRTC:', error);
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
}