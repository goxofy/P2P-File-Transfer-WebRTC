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

// 增强的心跳检测，立即清理失效连接
const heartbeatInterval = setInterval(() => {
  const now = Date.now();
  const staleClients = [];
  
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      staleClients.push(ws);
    } else if (now - (ws.lastActivity || now) > HEARTBEAT_TIMEOUT) {
      // 长时间无活动的客户端也视为失效
      staleClients.push(ws);
    }
    
    ws.isAlive = false;
    try {
      ws.ping();
    } catch (error) {
      // 如果ping失败，立即标记为失效
      staleClients.push(ws);
    }
  });
  
  // 批量处理失效连接
  staleClients.forEach(ws => {
    try {
      ws.terminate();
      handleLeave(ws);
    } catch (error) {
      // 忽略已经关闭的连接
    }
  });
}, HEARTBEAT_INTERVAL / 2); // 更频繁的检查

// 定期清理超时传输
const transferCleanupInterval = setInterval(() => {
  const now = Date.now();
  activeTransfers.forEach((transfer, transferId) => {
    if (now - transfer.startTime > TRANSFER_TIMEOUT) {
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
  
  // 设置心跳相关属性
  ws.isAlive = true;
  ws.connectionTime = Date.now();
  ws.on('pong', heartbeat);
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
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
      // 静默处理解析错误
    }
  });
  
  ws.on('close', () => {
    handleLeave(ws);
  });
  
  ws.on('error', (error) => {
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
  
  // 清理失效客户端
  const validClients = [];
  room.forEach(clientWs => {
    if (clientWs.readyState === WebSocket.OPEN) {
      validClients.push(clientWs);
    } else {
      room.delete(clientWs);
    }
  });
  
  // 基于有效客户端检查房间人数
  if (validClients.length >= 2) {
    ws.send(JSON.stringify({
      type: 'room-full',
      roomId: roomId,
      message: '房间已满，最多只能容纳2人'
    }));
    return;
  }
  
  clients.set(ws, { clientId, roomId, mode: 'cli' });
  room.add(ws);
  
  
  // 通知房间内其他客户端有新成员加入
  const roomMembers = Array.from(room).filter(client => client !== ws);
  roomMembers.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'peer-joined',
        clientId: clientId,
        clientType: 'cli'
      }));
      
      // 同时发送房间人数更新给现有成员
      const members = Array.from(room)
        .filter(c => c.readyState === WebSocket.OPEN && c !== client)
        .map(c => {
          const clientInfo = clients.get(c);
          return clientInfo ? {
            clientId: clientInfo.clientId,
            clientType: clientInfo.mode || 'unknown'
          } : null;
        })
        .filter(Boolean);
        
      client.send(JSON.stringify({
        type: 'room-info-response',
        roomId: roomId,
        members: members,
        memberCount: members.length + 1
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
  
  // 同时发送房间人数更新给新CLI成员
  const allMembers = Array.from(room)
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
    members: allMembers,
    memberCount: allMembers.length
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
    
    // 停止该发送端的所有活跃传输
    const transfersToStop = [];
    activeTransfers.forEach((transfer, transferId) => {
      if (transfer.senderWs === ws) {
        transfersToStop.push(transferId);
      }
    });
    
    transfersToStop.forEach(transferId => {
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
    }
  });
  
  // 如果转发失败，通知发送端并停止传输
  if (successCount === 0) {
    
    // 停止该发送端的所有活跃传输
    const transfersToStop = [];
    activeTransfers.forEach((transfer, transferId) => {
      if (transfer.senderWs === ws) {
        transfersToStop.push(transferId);
      }
    });
    
    transfersToStop.forEach(transferId => {
      activeTransfers.delete(transferId);
    });
    
    ws.send(JSON.stringify({
      type: 'transfer-error',
      error: 'Failed to deliver data to receivers - transfers stopped'
    }));
  }
  
  if (data.data.type === 'file-info') {
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
  
  // 清理失效客户端
  const validClients = [];
  room.forEach(clientWs => {
    if (clientWs.readyState === WebSocket.OPEN) {
      validClients.push(clientWs);
    } else {
      room.delete(clientWs);
    }
  });
  
  // 基于有效客户端检查房间人数
  if (validClients.length >= 2) {
    ws.send(JSON.stringify({
      type: 'room-full',
      roomId: roomId,
      message: '房间已满，最多只能容纳2人'
    }));
    return;
  }
  
  clients.set(ws, { clientId, roomId, mode: 'web' });
  room.add(ws);
  
  
  // 通知房间内其他客户端有新成员加入 (包括CLI客户端)
  const roomMembers = Array.from(room).filter(client => client !== ws);
  roomMembers.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'peer-joined',
        clientId: clientId,
        clientType: 'web'
      }));
      
      // 同时发送房间人数更新给现有成员
      const members = Array.from(room)
        .filter(c => c.readyState === WebSocket.OPEN && c !== client)
        .map(c => {
          const clientInfo = clients.get(c);
          return clientInfo ? {
            clientId: clientInfo.clientId,
            clientType: clientInfo.mode || 'unknown'
          } : null;
        })
        .filter(Boolean);
        
      client.send(JSON.stringify({
        type: 'room-info-response',
        roomId: roomId,
        members: members,
        memberCount: members.length + 1 // 包括新成员
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
  
  // 同时发送房间人数更新给新成员
  const allMembers = Array.from(room)
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
    members: allMembers,
    memberCount: allMembers.length
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
  
  if (!room) return;
  
  // 立即停止所有相关传输
  const transfersToStop = [];
  activeTransfers.forEach((transfer, transferId) => {
    if (transfer.senderWs === ws || transfer.roomId === roomId) {
      transfersToStop.push({transferId, transfer});
    }
  });
  
  // 清理所有传输
  transfersToStop.forEach(({transferId}) => {
    activeTransfers.delete(transferId);
  });
  
  // 检查是否有活跃传输
  if (transfersToStop.length > 0) {
    // 有活跃传输时，通知传输中断
    room.forEach(otherWs => {
      if (otherWs.readyState === WebSocket.OPEN) {
        otherWs.send(JSON.stringify({
          type: 'transfer-interrupted',
          message: '传输已中断，请重新连接',
          reason: 'peer-disconnected'
        }));
      }
    });
    
    // 延迟1秒后清理房间（给客户端时间处理消息）
    setTimeout(() => {
      room.forEach(otherWs => {
        if (otherWs.readyState === WebSocket.OPEN) {
          otherWs.close(1000, 'Transfer interrupted');
        }
      });
      
      // 清理房间
      room.forEach(roomClient => {
        clients.delete(roomClient);
      });
      rooms.delete(roomId);
    }, 1000);
  } else {
    // 无活跃传输时，使用正常清理
    room.delete(ws);
    
    // 通知其他客户端有人离开
    room.forEach(otherWs => {
      if (otherWs.readyState === WebSocket.OPEN) {
        otherWs.send(JSON.stringify({
          type: 'peer-left',
          clientId: clientId
        }));
        
        // 同时发送房间人数更新
        const members = Array.from(room)
          .filter(client => client.readyState === WebSocket.OPEN && client !== ws)
          .map(client => {
            const clientInfo = clients.get(client);
            return clientInfo ? {
              clientId: clientInfo.clientId,
              clientType: clientInfo.mode || 'unknown'
            } : null;
          })
          .filter(Boolean);
          
        otherWs.send(JSON.stringify({
          type: 'room-info-response',
          roomId: roomId,
          members: members,
          memberCount: members.length
        }));
      }
    });
    
    // 清理空房间
    if (room.size === 0) {
      rooms.delete(roomId);
    }
  }
  
  // 清理当前客户端
  clients.delete(ws);
}

function handleRoomInfo(ws, data) {
  const { roomId } = data;
  const room = rooms.get(roomId);
  
  if (!room) {
    ws.send(JSON.stringify({
      type: 'room-info-response',
      roomId: roomId,
      members: [],
      memberCount: 0
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
    members: members,
    memberCount: members.length
  }));
}


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
  console.log(`Web interface available at http://localhost:${PORT}`);
});