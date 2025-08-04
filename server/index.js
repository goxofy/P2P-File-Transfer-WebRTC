const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.static('client'));

const rooms = new Map();
const clients = new Map();
const activeTransfers = new Map(); // 跟踪活跃的传输

// 心跳配置
const HEARTBEAT_INTERVAL = 30000; // 30秒心跳间隔
const HEARTBEAT_TIMEOUT = 10000; // 10秒心跳超时
const TRANSFER_TIMEOUT = 600000; // 10分钟传输超时

// 心跳检测函数
function heartbeat() {
  this.isAlive = true;
}

// 定期心跳检测
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      console.log('心跳超时，强制断开连接');
      ws.terminate();
      handleLeave(ws);
      return;
    }
    
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL);

// 定期清理超时传输
const transferCleanupInterval = setInterval(() => {
  const now = Date.now();
  activeTransfers.forEach((transfer, transferId) => {
    if (now - transfer.startTime > TRANSFER_TIMEOUT) {
      console.log(`传输超时清理: ${transferId}`);
      activeTransfers.delete(transferId);
      
      // 通知相关客户端
      if (transfer.senderWs && transfer.senderWs.readyState === WebSocket.OPEN) {
        transfer.senderWs.send(JSON.stringify({
          type: 'transfer-timeout',
          transferId: transferId
        }));
      }
      if (transfer.receiverWs && transfer.receiverWs.readyState === WebSocket.OPEN) {
        transfer.receiverWs.send(JSON.stringify({
          type: 'transfer-timeout',
          transferId: transferId
        }));
      }
    }
  });
}, TRANSFER_TIMEOUT / 2);

wss.on('connection', (ws) => {
  console.log('New client connected');
  
  // 设置心跳相关属性
  ws.isAlive = true;
  ws.connectionTime = Date.now();
  ws.on('pong', heartbeat);
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Received:', data.type);
      
      switch (data.type) {
        case 'join':
          handleJoin(ws, data);
          break;
        case 'join-room':
          handleJoinRoom(ws, data);
          break;
        case 'offer':
        case 'answer':
        case 'ice-candidate':
          handleSignaling(ws, data);
          break;
        case 'data':
          handleDataRelay(ws, data);
          break;
        case 'leave':
          handleLeave(ws);
          break;
        case 'room-info':
          handleRoomInfo(ws, data);
          break;
        case 'ping': // 处理客户端心跳
          ws.isAlive = true;
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
      }
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  });
  
  ws.on('close', () => {
    console.log('Client disconnected');
    handleLeave(ws);
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    handleLeave(ws);
  });
  
  ws.on('pong', () => {
    ws.isAlive = true;
  });
});

// 清理定时器
process.on('SIGTERM', () => {
  clearInterval(heartbeatInterval);
  clearInterval(transferCleanupInterval);
});

wss.on('close', () => {
  clearInterval(heartbeatInterval);
  clearInterval(transferCleanupInterval);
});

function handleJoinRoom(ws, data) {
  const { roomId } = data;
  const clientId = generateClientId();
  
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
  }
  
  const room = rooms.get(roomId);
  
  // 检查房间人数限制
  if (room.size >= 2) {
    console.log(`Room ${roomId} is full (${room.size}/2), rejecting CLI client ${clientId}`);
    ws.send(JSON.stringify({
      type: 'room-full',
      roomId: roomId,
      message: '房间已满，最多只能容纳2人'
    }));
    return;
  }
  
  clients.set(ws, { clientId, roomId, mode: 'cli' });
  room.add(ws);
  
  console.log(`CLI client ${clientId} joined room ${roomId} (${room.size}/2)`);
  
  // 通知房间内其他客户端有新成员加入
  const roomMembers = Array.from(room).filter(client => client !== ws);
  roomMembers.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'peer-joined',
        clientId: clientId,
        clientType: 'cli'
      }));
    }
  });
  
  // 告诉新加入的CLI客户端已成功加入房间，并通知已有成员
  const existingMembers = roomMembers.map(client => {
    const clientInfo = clients.get(client);
    return clientInfo ? {
      clientId: clientInfo.clientId,
      clientType: clientInfo.mode || 'unknown'
    } : null;
  }).filter(Boolean);
  
  ws.send(JSON.stringify({
    type: 'room-joined',
    roomId: roomId,
    clientId: clientId,
    memberCount: room.size,
    existingMembers: existingMembers
  }));
}

function handleDataRelay(ws, data) {
  const client = clients.get(ws);
  if (!client) return;
  
  const { roomId } = client;
  const room = rooms.get(roomId);
  
  if (!room) return;
  
  // 检查是否是文件传输开始
  if (data.data && data.data.type === 'file-info') {
    const transferId = data.data.id;
    console.log(`Starting transfer tracking for ${transferId} in room ${roomId}`);
    activeTransfers.set(transferId, {
      senderId: client.clientId,
      senderWs: ws,
      roomId: roomId,
      startTime: Date.now()
    });
  }
  
  // 检查是否是文件传输完成
  if (data.data && data.data.type === 'file-complete') {
    const transferId = data.data.transferId;
    console.log(`Transfer completed: ${transferId}`);
    activeTransfers.delete(transferId);
  }
  
  // 找到房间内的其他活跃客户端
  const activeTargets = [];
  room.forEach(otherWs => {
    if (otherWs !== ws && otherWs.readyState === WebSocket.OPEN) {
      activeTargets.push(otherWs);
    }
  });
  
  // 如果没有活跃的接收端，通知发送端并停止该客户端的所有传输
  if (activeTargets.length === 0) {
    console.log(`No active targets for data relay in room ${roomId}, stopping transfers`);
    
    // 停止该发送端的所有活跃传输
    const transfersToStop = [];
    activeTransfers.forEach((transfer, transferId) => {
      if (transfer.senderWs === ws) {
        transfersToStop.push(transferId);
      }
    });
    
    transfersToStop.forEach(transferId => {
      console.log(`Force stopping transfer: ${transferId}`);
      activeTransfers.delete(transferId);
    });
    
    // 只发送一次错误通知
    if (transfersToStop.length > 0) {
      ws.send(JSON.stringify({
        type: 'transfer-error',
        error: 'No active receivers in room - transfers stopped'
      }));
    }
    return;
  }
  
  // 转发数据消息给房间内的其他客户端
  let successCount = 0;
  activeTargets.forEach(otherWs => {
    try {
      otherWs.send(JSON.stringify({
        type: 'data',
        data: data.data,
        from: client.clientId
      }));
      successCount++;
    } catch (error) {
      console.error(`Failed to relay data to client: ${error.message}`);
    }
  });
  
  // 如果转发失败，通知发送端并停止传输
  if (successCount === 0) {
    console.log(`Failed to relay data to any target in room ${roomId}`);
    
    // 停止该发送端的所有活跃传输
    const transfersToStop = [];
    activeTransfers.forEach((transfer, transferId) => {
      if (transfer.senderWs === ws) {
        transfersToStop.push(transferId);
      }
    });
    
    transfersToStop.forEach(transferId => {
      console.log(`Force stopping failed transfer: ${transferId}`);
      activeTransfers.delete(transferId);
    });
    
    ws.send(JSON.stringify({
      type: 'transfer-error',
      error: 'Failed to deliver data to receivers - transfers stopped'
    }));
  }
  
  if (data.data.type === 'file-info') {
    console.log(`File transfer started: ${data.data.name} in room ${roomId} (${successCount} receivers)`);
  }
}

function generateClientId() {
  return 'cli-' + Math.random().toString(36).substr(2, 8);
}

function handleJoin(ws, data) {
  const { roomId, clientId } = data;
  
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
  }
  
  const room = rooms.get(roomId);
  
  // 检查房间人数限制
  if (room.size >= 2) {
    console.log(`Room ${roomId} is full (${room.size}/2), rejecting Web client ${clientId}`);
    ws.send(JSON.stringify({
      type: 'room-full',
      roomId: roomId,
      message: '房间已满，最多只能容纳2人'
    }));
    return;
  }
  
  clients.set(ws, { clientId, roomId, mode: 'web' });
  room.add(ws);
  
  console.log(`Web client ${clientId} joined room ${roomId} (${room.size}/2)`);
  
  // 通知房间内其他客户端有新成员加入 (包括CLI客户端)
  const roomMembers = Array.from(room).filter(client => client !== ws);
  roomMembers.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'peer-joined',
        clientId: clientId,
        clientType: 'web'
      }));
    }
  });
  
  // 告诉新加入的客户端房间内已有的成员
  const existingMembers = roomMembers.map(client => {
    const clientInfo = clients.get(client);
    return clientInfo ? {
      clientId: clientInfo.clientId,
      clientType: clientInfo.mode || 'unknown'
    } : null;
  }).filter(Boolean);
  
  ws.send(JSON.stringify({
    type: 'room-joined',
    roomId: roomId,
    existingMembers: existingMembers
  }));
}

function handleSignaling(ws, data) {
  const client = clients.get(ws);
  if (!client) return;
  
  const { roomId } = client;
  const room = rooms.get(roomId);
  
  if (!room) return;
  
  // 转发信令消息给房间内的其他客户端
  room.forEach(otherWs => {
    if (otherWs !== ws && otherWs.readyState === WebSocket.OPEN) {
      otherWs.send(JSON.stringify({
        ...data,
        from: client.clientId
      }));
    }
  });
}

function handleLeave(ws) {
  const client = clients.get(ws);
  if (!client) return;
  
  const { clientId, roomId } = client;
  const room = rooms.get(roomId);
  
  // 强制停止该客户端相关的所有传输（作为发送端）
  const transfersToStopAsSender = [];
  activeTransfers.forEach((transfer, transferId) => {
    if (transfer.senderWs === ws) {
      transfersToStopAsSender.push(transferId);
    }
  });
  
  transfersToStopAsSender.forEach(transferId => {
    console.log(`Force stopping transfer due to sender disconnect: ${transferId}`);
    activeTransfers.delete(transferId);
  });
  
  // 查找该客户端作为接收端的传输，并通知发送端停止
  const transfersToStopAsReceiver = [];
  if (room) {
    activeTransfers.forEach((transfer, transferId) => {
      // 如果当前断开的客户端在同一房间，且不是发送端，说明它是接收端
      if (transfer.roomId === roomId && transfer.senderWs !== ws) {
        transfersToStopAsReceiver.push({transferId, transfer});
      }
    });
  }
  
  if (room) {
    room.delete(ws);
    
    // 通知房间内其他客户端有成员离开
    room.forEach(otherWs => {
      if (otherWs.readyState === WebSocket.OPEN) {
        otherWs.send(JSON.stringify({
          type: 'peer-left',
          clientId: clientId
        }));
        
        // 如果断开的是发送端，通知接收端传输被中断
        if (transfersToStopAsSender.length > 0) {
          otherWs.send(JSON.stringify({
            type: 'transfer-error',
            error: `传输中断：发送端 ${clientId} 已断开连接`
          }));
        }
        
        // 如果断开的是接收端，通知发送端停止传输
        transfersToStopAsReceiver.forEach(({transferId, transfer}) => {
          if (transfer.senderWs === otherWs) {
            console.log(`Notifying sender to stop transfer due to receiver disconnect: ${transferId}`);
            otherWs.send(JSON.stringify({
              type: 'transfer-error',
              error: `传输中断：接收端 ${clientId} 已断开连接`
            }));
          }
        });
      }
    });
    
    // 清理作为接收端的传输
    transfersToStopAsReceiver.forEach(({transferId}) => {
      console.log(`Force stopping transfer due to receiver disconnect: ${transferId}`);
      activeTransfers.delete(transferId);
    });
    
    // 如果房间为空，删除房间
    if (room.size === 0) {
      rooms.delete(roomId);
    }
  }
  
  clients.delete(ws);
  console.log(`Client ${clientId} left room ${roomId}, stopped ${transfersToStopAsSender.length} transfers as sender, ${transfersToStopAsReceiver.length} transfers as receiver`);
}

function handleRoomInfo(ws, data) {
  const { roomId } = data;
  const room = rooms.get(roomId);
  
  if (!room) {
    ws.send(JSON.stringify({
      type: 'room-info-response',
      roomId: roomId,
      members: []
    }));
    return;
  }
  
  // 获取房间内的成员信息
  const members = Array.from(room)
    .filter(client => client.readyState === WebSocket.OPEN)
    .map(client => {
      const clientInfo = clients.get(client);
      return clientInfo ? {
        clientId: clientInfo.clientId,
        clientType: clientInfo.mode || 'unknown'
      } : null;
    })
    .filter(Boolean);
  
  ws.send(JSON.stringify({
    type: 'room-info-response',
    roomId: roomId,
    members: members
  }));
}


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
  console.log(`Web interface available at http://localhost:${PORT}`);
});