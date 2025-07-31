class WebRTCManager {
  constructor() {
    this.ws = null;
    this.peerConnection = null;
    this.dataChannel = null;
    this.clientId = this.generateId();
    this.roomId = null;
    this.isInitiator = false;
    
    // ICE 服务器配置 (使用免费的 STUN 服务器)
    this.iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
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
        console.log('Joined room:', message.roomId, 'existing members:', message.existingMembers.length);
        if (message.existingMembers.length > 0) {
          // 如果房间里已有其他成员，作为发起方建立连接
          console.log('Setting as initiator (room has existing members)');
          this.isInitiator = true;
          await this.initializePeerConnection();
          await this.createOffer();
        }
        break;
        
      case 'peer-joined':
        console.log('Peer joined:', message.clientId, 'current isInitiator:', this.isInitiator);
        if (!this.isInitiator && !this.peerConnection) {
          // 作为接收方初始化连接
          console.log('Initializing as receiver');
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
        this.closePeerConnection();
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
  sendData(data) {
    console.log('Attempting to send data via DataChannel, length:', data.length, 'readyState:', this.dataChannel?.readyState);
    
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      try {
        this.dataChannel.send(data);
        console.log('Data sent successfully');
        return true;
      } catch (error) {
        console.error('Error sending data:', error);
        return false;
      }
    } else {
      console.warn('DataChannel not available or not open');
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