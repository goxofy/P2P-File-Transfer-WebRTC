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

wss.on('connection', (ws) => {
  console.log('New client connected');
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Received:', data.type);
      
      switch (data.type) {
        case 'join':
          handleJoin(ws, data);
          break;
        case 'offer':
        case 'answer':
        case 'ice-candidate':
          handleSignaling(ws, data);
          break;
        case 'leave':
          handleLeave(ws);
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
  });
});

function handleJoin(ws, data) {
  const { roomId, clientId } = data;
  
  clients.set(ws, { clientId, roomId });
  
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
  }
  
  const room = rooms.get(roomId);
  room.add(ws);
  
  // 通知房间内其他客户端有新成员加入
  const roomMembers = Array.from(room).filter(client => client !== ws);
  roomMembers.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'peer-joined',
        clientId: clientId
      }));
    }
  });
  
  // 告诉新加入的客户端房间内已有的成员
  const existingMembers = roomMembers.map(client => clients.get(client)?.clientId).filter(Boolean);
  ws.send(JSON.stringify({
    type: 'room-joined',
    roomId: roomId,
    existingMembers: existingMembers
  }));
  
  console.log(`Client ${clientId} joined room ${roomId}`);
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
  
  if (room) {
    room.delete(ws);
    
    // 通知房间内其他客户端有成员离开
    room.forEach(otherWs => {
      if (otherWs.readyState === WebSocket.OPEN) {
        otherWs.send(JSON.stringify({
          type: 'peer-left',
          clientId: clientId
        }));
      }
    });
    
    // 如果房间为空，删除房间
    if (room.size === 0) {
      rooms.delete(roomId);
    }
  }
  
  clients.delete(ws);
  console.log(`Client ${clientId} left room ${roomId}`);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
  console.log(`Web interface available at http://localhost:${PORT}`);
});