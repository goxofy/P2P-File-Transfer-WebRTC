# 自建 STUN/TURN 服务器配置指南

## 概述

由于国内网络环境对国外免费 STUN/TURN 服务器的访问限制，建议自建 STUN/TURN 服务器以获得更好的连接质量和稳定性。

## 服务器选择

### 推荐方案：coturn

[coturn](https://github.com/coturn/coturn) 是目前最流行的开源 STUN/TURN 服务器，支持 STUN 和 TURN 功能。

## 安装步骤

### 1. Ubuntu/Debian 系统

```bash
# 更新系统
sudo apt update && sudo apt upgrade -y

# 安装 coturn
sudo apt install coturn -y
```

### 2. CentOS/RHEL 系统

```bash
# 安装 EPEL 仓库
sudo yum install epel-release -y

# 安装 coturn
sudo yum install coturn -y
```

### 3. Docker 方式（推荐）

```bash
# 创建配置文件目录
mkdir -p ~/coturn

# 创建配置文件
cat > ~/coturn/turnserver.conf << EOF
# 基本配置
listening-port=3478
listening-ip=0.0.0.0
relay-ip=0.0.0.0
external-ip=YOUR_SERVER_IP

# STUN 配置
fingerprint
lt-cred-mech
use-auth-secret
static-auth-secret=your-secret-key-here
realm=your-domain.com

# TURN 配置
total-quota=100
bps-capacity=0
stale-nonce

# 日志设置
log-file=/var/log/turn.log
simple-log
EOF

# 运行容器
docker run -d --name coturn \
  --network host \
  -v ~/coturn:/etc/coturn \
  coturn/coturn:latest \
  -c /etc/coturn/turnserver.conf
```

## 配置详解

### 配置文件位置

- Ubuntu/Debian: `/etc/turnserver.conf`
- CentOS/RHEL: `/etc/coturn/turnserver.conf`

### 基础配置

```ini
# 监听端口
listening-port=3478

# 监听IP地址（服务器内网IP）
listening-ip=0.0.0.0

# 中继IP（通常与监听IP相同）
relay-ip=0.0.0.0

# 公网IP地址
external-ip=YOUR_PUBLIC_IP

# 域名
realm=your-domain.com
```

### 认证配置

#### 方案1：静态密钥（推荐）

```ini
use-auth-secret
static-auth-secret=your-very-long-secret-key-here
```

#### 方案2：用户名密码

```ini
user=username:password
```

### 高级配置

```ini
# 启用指纹验证
fingerprint

# 启用长期认证机制
lt-cred-mech

# 设置配额限制
total-quota=100

# 禁用带宽限制
bps-capacity=0

# 启用过期nonce
stale-nonce

# 启用详细日志
log-file=/var/log/turnserver.log
simple-log
```

## 防火墙配置

确保开放以下端口：

```bash
# Ubuntu/Debian
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 5349/tcp
sudo ufw allow 5349/udp
sudo ufw allow 49152:65535/udp

# CentOS/RHEL
sudo firewall-cmd --permanent --add-port=3478/tcp
sudo firewall-cmd --permanent --add-port=3478/udp
sudo firewall-cmd --permanent --add-port=5349/tcp
sudo firewall-cmd --permanent --add-port=5349/udp
sudo firewall-cmd --permanent --add-port=49152-65535/udp
sudo firewall-cmd --reload
```

## 启动服务

### 手动启动

```bash
# 测试配置
sudo turnserver -c /etc/turnserver.conf --check-config

# 启动服务
sudo systemctl start coturn
sudo systemctl enable coturn
```

### 使用配置文件

```bash
# 创建 systemd 服务文件
sudo systemctl edit coturn --full

# 内容示例
[Unit]
Description=coturn TURN and STUN server
After=network.target

[Service]
Type=forking
ExecStart=/usr/bin/turnserver -c /etc/turnserver.conf
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

## 测试服务器

### 1. 在线测试

使用 [WebRTC 测试工具](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/)

### 2. 命令行测试

```bash
# 安装 stunclient
sudo apt install stun-client

# 测试 STUN
stunclient your-server-ip:3478

# 测试 TURN
turnutils_uclient -u username -w password -p 3478 your-server-ip
```

## 集成到项目

### 修改 WebRTC 配置

编辑 `client/webrtc-manager.js`，替换 STUN/TURN 服务器配置：

```javascript
// 替换原有的 iceServers 配置
this.iceServers = [
  // 自建 STUN 服务器
  { urls: 'stun:your-server-ip:3478' },
  
  // 自建 TURN 服务器
  {
    urls: 'turn:your-server-ip:3478',
    username: 'your-username',
    credential: 'your-password'
  },
  
  // 备用配置（HTTPS）
  {
    urls: 'turns:your-domain.com:5349',
    username: 'your-username',
    credential: 'your-password'
  }
];
```

### 使用环境变量

创建不同的配置文件：

```javascript
// 根据环境选择配置
const getIceServers = () => {
  const env = window.location.hostname;
  
  if (env === 'localhost' || env === '127.0.0.1') {
    return [
      { urls: 'stun:localhost:3478' },
      {
        urls: 'turn:localhost:3478',
        username: 'local',
        credential: 'local-secret'
      }
    ];
  } else {
    return [
      { urls: 'stun:your-domain.com:3478' },
      {
        urls: 'turn:your-domain.com:3478',
        username: 'production',
        credential: 'production-secret'
      }
    ];
  }
};

this.iceServers = getIceServers();
```

## 性能优化

### 1. 网络优化

- 选择靠近用户的服务器位置
- 使用 CDN 加速 DNS 解析
- 优化网络路由

### 2. 资源限制

```ini
# 限制并发连接数
max-allocate-lifetime=3600
channel-lifetime=600
permission-lifetime=300

# 内存限制
total-quota=200
bps-capacity=100000000
```

### 3. 监控配置

```ini
# 启用统计
cli-password=admin-password
cli-port=5766

# 日志级别
verbose
log-file=/var/log/turnserver.log
```

## 常见问题解决

### 1. 连接失败

- 检查防火墙端口是否开放
- 验证服务器公网IP是否正确
- 检查域名解析是否正常

### 2. 认证失败

- 确认用户名密码正确
- 检查时间同步（TURN对时间敏感）
- 验证密钥是否匹配

### 3. 性能问题

- 调整 `total-quota` 参数
- 监控服务器资源使用
- 考虑使用负载均衡

## 安全配置

### 1. HTTPS 支持

```bash
# 获取 SSL 证书
sudo certbot certonly --standalone -d your-domain.com

# 配置文件中添加
cert=/etc/letsencrypt/live/your-domain.com/fullchain.pem
pkey=/etc/letsencrypt/live/your-domain.com/privkey.pem
```

### 2. 访问控制

```ini
# 限制 IP 范围
allowed-peer-ip=0.0.0.0-255.255.255.255

# 禁止特定 IP
denied-peer-ip=10.0.0.0-10.255.255.255
```

## 监控和维护

### 1. 查看状态

```bash
# 查看服务状态
sudo systemctl status coturn

# 查看日志
sudo tail -f /var/log/turnserver.log
```

### 2. 性能监控

```bash
# 查看连接数
netstat -an | grep :3478 | wc -l

# 查看内存使用
top -p $(pgrep turnserver)
```

通过以上配置，您可以建立一个稳定可靠的 STUN/TURN 服务器，显著改善国内用户的连接体验。