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

# 检测当前平台
OS=$(uname -s)
ARCH=$(uname -m)

case "$OS" in
  Darwin)
    if [[ "$ARCH" == "arm64" ]]; then
      TARGET="node18-macos-arm64"
      OUTPUT_NAME="p2p-transfer-macos-arm64"
    else
      TARGET="node18-macos-x64"  
      OUTPUT_NAME="p2p-transfer-macos-x64"
    fi
    ;;
  Linux)
    if [[ "$ARCH" == "aarch64" ]]; then
      TARGET="node18-linux-arm64"
      OUTPUT_NAME="p2p-transfer-linux-arm64"
    elif [[ "$ARCH" == "i386" || "$ARCH" == "i686" ]]; then
      TARGET="node18-linux-x86"
      OUTPUT_NAME="p2p-transfer-linux-x86"
    else
      TARGET="node18-linux-x64"
      OUTPUT_NAME="p2p-transfer-linux-x64"
    fi
    ;;
  *)
    echo "❌ 不支持的操作系统: $OS"
    exit 1
    ;;
esac

echo "🔍 检测到平台: $OS $ARCH"
echo "🎯 构建目标: $TARGET"

# 构建当前平台的二进制文件
echo "📦 构建二进制文件..."

pkg cli/index.js \
  --targets $TARGET \
  --out-path dist \
  --compress GZip

# 重命名文件为更友好的名称
cd dist

# 根据平台重命名
case "$OS" in
  Darwin)
    if [[ "$ARCH" == "arm64" ]]; then
      if [ -f "index-macos-arm64" ]; then
        mv index-macos-arm64 p2p-transfer-macos-arm64
        echo "✅ macOS ARM64: p2p-transfer-macos-arm64"
      fi
    else
      if [ -f "index-macos" ]; then
        mv index-macos p2p-transfer-macos-x64
        echo "✅ macOS x64: p2p-transfer-macos-x64"
      fi
    fi
    ;;
  Linux)
    if [[ "$ARCH" == "aarch64" ]]; then
      if [ -f "index-linux-arm64" ]; then
        mv index-linux-arm64 p2p-transfer-linux-arm64
        echo "✅ Linux ARM64: p2p-transfer-linux-arm64"
      fi
    elif [[ "$ARCH" == "i386" || "$ARCH" == "i686" ]]; then
      if [ -f "index-linux-x86" ]; then
        mv index-linux-x86 p2p-transfer-linux-x86
        echo "✅ Linux x86: p2p-transfer-linux-x86"
      fi
    else
      if [ -f "index-linux" ]; then
        mv index-linux p2p-transfer-linux-x64
        echo "✅ Linux x64: p2p-transfer-linux-x64"
      fi
    fi
    ;;
esac

cd ..

# 显示构建结果
echo ""
echo "🎉 构建完成！二进制文件位于 dist/ 目录："
ls -la dist/

echo ""
echo "📋 使用方法："
echo "  ./$(ls dist/) send <file> [room]"
echo "  ./$(ls dist/) receive [room]"

echo ""
echo "🏗️  当前构建平台："
echo "  • $OS $ARCH"