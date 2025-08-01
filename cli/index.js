#!/usr/bin/env node

const { program } = require('commander');
const P2PTransfer = require('./p2p-transfer');
const path = require('path');
const fs = require('fs');

// CLI version
const packageJson = require('../package.json');
program.version(packageJson.version);

// Global options
program
  .option('-s, --server <url>', '信令服务器地址', 'ws://localhost:3000')
  .option('-r, --room <id>', '房间ID')
  .option('-v, --verbose', '详细输出模式');

// Send command
program
  .command('send <file>')
  .description('发送文件到指定房间')
  .option('-r, --room <id>', '房间ID (必须)')
  .option('-s, --server <url>', '信令服务器地址')
  .action(async (filePath, options) => {
    try {
      // 检查文件是否存在
      if (!fs.existsSync(filePath)) {
        console.error(`❌ 文件不存在: ${filePath}`);
        process.exit(1);
      }
      
      // 检查房间ID
      const roomId = options.room || program.opts().room;
      if (!roomId) {
        console.error('❌ 请指定房间ID: --room <id>');
        process.exit(1);
      }
      
      const serverUrl = options.server || program.opts().server;
      const verbose = program.opts().verbose;
      
      console.log('📤 准备发送文件...');
      console.log(`📁 文件: ${path.resolve(filePath)}`);
      console.log(`🏠 房间: ${roomId}`);
      console.log(`🌐 服务器: ${serverUrl}`);
      console.log();
      
      const transfer = new P2PTransfer({
        serverUrl,
        roomId,
        verbose,
        mode: 'send'
      });
      
      await transfer.sendFile(filePath);
      
    } catch (error) {
      console.error(`❌ 发送失败: ${error.message}`);
      if (program.opts().verbose) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

// Receive command
program
  .command('receive')
  .description('在指定房间等待接收文件')
  .option('-r, --room <id>', '房间ID (必须)')
  .option('-s, --server <url>', '信令服务器地址')
  .option('-o, --output <dir>', '输出目录', './downloads')
  .action(async (options) => {
    try {
      // 检查房间ID
      const roomId = options.room || program.opts().room;
      if (!roomId) {
        console.error('❌ 请指定房间ID: --room <id>');
        process.exit(1);
      }
      
      const serverUrl = options.server || program.opts().server;
      const outputDir = options.output;
      const verbose = program.opts().verbose;
      
      // 确保输出目录存在
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      console.log('📥 等待接收文件...');
      console.log(`🏠 房间: ${roomId}`);
      console.log(`📂 输出目录: ${path.resolve(outputDir)}`);
      console.log(`🌐 服务器: ${serverUrl}`);
      console.log();
      
      const transfer = new P2PTransfer({
        serverUrl,
        roomId,
        outputDir,
        verbose,
        mode: 'receive'
      });
      
      await transfer.startReceiving();
      
    } catch (error) {
      console.error(`❌ 接收失败: ${error.message}`);
      if (program.opts().verbose) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

// Room command - generate random room ID
program
  .command('room')
  .description('生成随机房间ID')
  .action(() => {
    const roomId = Math.random().toString(36).substr(2, 8).toUpperCase();
    console.log(`🏠 随机房间ID: ${roomId}`);
    console.log();
    console.log('使用示例:');
    console.log(`  发送: p2p-transfer send myfile.txt --room ${roomId}`);
    console.log(`  接收: p2p-transfer receive --room ${roomId}`);
  });

// Parse command line arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}