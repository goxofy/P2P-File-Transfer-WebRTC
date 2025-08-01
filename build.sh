#!/bin/bash

# 构建 P2P Transfer CLI 工具的二进制文件
# 支持多个平台架构

echo "🚀 开始构建 P2P Transfer CLI 二进制文件..."

# 确保 dist 目录存在
mkdir -p dist

# 检查是否安装了 pkg
if ! command -v pkg &> /dev/null; then
    echo "❌ pkg 未安装，正在安装..."
    npm install -g pkg
fi

# 构建所有目标平台
echo "📦 构建多平台二进制文件..."

pkg cli/index.js \
  --targets node18-linux-x64,node18-linux-x86,node18-linux-arm64,node18-macos-x64,node18-macos-arm64,node18-win-x64,node18-win-x86 \
  --out-path dist \
  --compress GZip

# 重命名文件为更友好的名称
cd dist

# Linux x64
if [ -f "index-linux" ]; then
  mv index-linux p2p-transfer-linux-x64
  echo "✅ Linux x64: p2p-transfer-linux-x64"
fi

# Linux x86 (32位)
if [ -f "index-linux-x86" ]; then
  mv index-linux-x86 p2p-transfer-linux-x86
  echo "✅ Linux x86: p2p-transfer-linux-x86"
fi

# Linux ARM64  
if [ -f "index-linux-arm64" ]; then
  mv index-linux-arm64 p2p-transfer-linux-arm64
  echo "✅ Linux ARM64: p2p-transfer-linux-arm64"
fi

# macOS x64
if [ -f "index-macos" ]; then
  mv index-macos p2p-transfer-macos-x64
  echo "✅ macOS x64: p2p-transfer-macos-x64"
fi

# macOS ARM64 (M1/M2)
if [ -f "index-macos-arm64" ]; then
  mv index-macos-arm64 p2p-transfer-macos-arm64
  echo "✅ macOS ARM64: p2p-transfer-macos-arm64"
fi

# Windows x64
if [ -f "index-win.exe" ]; then
  mv index-win.exe p2p-transfer-windows-x64.exe
  echo "✅ Windows x64: p2p-transfer-windows-x64.exe"
fi

# Windows x86 (32位)
if [ -f "index-win-x86.exe" ]; then
  mv index-win-x86.exe p2p-transfer-windows-x86.exe
  echo "✅ Windows x86: p2p-transfer-windows-x86.exe"
fi

cd ..

# 显示构建结果
echo ""
echo "🎉 构建完成！二进制文件位于 dist/ 目录："
ls -la dist/

echo ""
echo "📋 使用方法："
echo "  Linux/macOS: ./p2p-transfer-<platform> send <file> [room]"
echo "  Linux/macOS: ./p2p-transfer-<platform> receive [room]"
echo "  Windows:     .\\p2p-transfer-windows-<arch>.exe send <file> [room]"
echo "  Windows:     .\\p2p-transfer-windows-<arch>.exe receive [room]"

echo ""
echo "🏗️  支持的平台："
echo "  • Linux x64 (Intel/AMD 64位)"
echo "  • Linux x86 (Intel/AMD 32位)"
echo "  • Linux ARM64 (ARM 服务器)"  
echo "  • macOS x64 (Intel Mac)"
echo "  • macOS ARM64 (M1/M2 Mac)"
echo "  • Windows x64 (64位系统)"
echo "  • Windows x86 (32位系统)"