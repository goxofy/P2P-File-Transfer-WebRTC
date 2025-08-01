@echo off
REM Windows 构建脚本

echo 🚀 开始构建 P2P Transfer CLI 二进制文件...

REM 确保 dist 目录存在
if not exist "dist" mkdir dist

REM 构建所有目标平台
echo 📦 构建多平台二进制文件...

call pkg cli/index.js --targets node18-linux-x64,node18-linux-x86,node18-linux-arm64,node18-macos-x64,node18-macos-arm64,node18-win-x64,node18-win-x86 --out-path dist --compress GZip

REM 重命名文件
cd dist

if exist "index-linux" ren "index-linux" "p2p-transfer-linux-x64"
if exist "index-linux-x86" ren "index-linux-x86" "p2p-transfer-linux-x86"
if exist "index-linux-arm64" ren "index-linux-arm64" "p2p-transfer-linux-arm64"
if exist "index-macos" ren "index-macos" "p2p-transfer-macos-x64"
if exist "index-macos-arm64" ren "index-macos-arm64" "p2p-transfer-macos-arm64"
if exist "index-win.exe" ren "index-win.exe" "p2p-transfer-windows-x64.exe"
if exist "index-win-x86.exe" ren "index-win-x86.exe" "p2p-transfer-windows-x86.exe"

cd ..

echo.
echo 🎉 构建完成！二进制文件位于 dist/ 目录：
dir dist /b

echo.
echo 📋 使用方法（Windows）：
echo   .\p2p-transfer-windows-x64.exe send ^<file^> [room]  (64位系统)
echo   .\p2p-transfer-windows-x86.exe send ^<file^> [room]  (32位系统)
echo   .\p2p-transfer-windows-x64.exe receive [room]       (64位系统)
echo   .\p2p-transfer-windows-x86.exe receive [room]       (32位系统)

echo.
echo 🏗️ 支持的平台：
echo   • Linux x64 (Intel/AMD 64位)
echo   • Linux x86 (Intel/AMD 32位)
echo   • Linux ARM64 (ARM 服务器)
echo   • macOS x64 (Intel Mac)
echo   • macOS ARM64 (M1/M2 Mac)
echo   • Windows x64 (64位系统)
echo   • Windows x86 (32位系统)

pause