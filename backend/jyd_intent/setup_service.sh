#!/bin/bash

# 设置JYD Intent服务开机自启动脚本

SERVICE_FILE="jyd_intent.service"
SERVICE_NAME="jyd_intent.service"
SYSTEMD_DIR="/etc/systemd/system"

echo "正在设置JYD Intent服务..."

# 1. 创建logs目录
echo "创建logs目录..."
mkdir -p /opt/jyd01/wangruihua/AI_Tutor/logs

# 2. 复制服务文件到systemd目录
echo "复制服务文件到 $SYSTEMD_DIR ..."
sudo cp $SERVICE_FILE $SYSTEMD_DIR/

# 3. 重新加载systemd配置
echo "重新加载systemd配置..."
sudo systemctl daemon-reload

# 4. 启用服务（开机自启动）
echo "启用服务开机自启动..."
sudo systemctl enable $SERVICE_NAME

# 5. 启动服务
echo "启动服务..."
sudo systemctl start $SERVICE_NAME

# 6. 检查服务状态
echo ""
echo "服务状态："
sudo systemctl status $SERVICE_NAME

echo ""
echo "=========================================="
echo "设置完成！"
echo "=========================================="
echo ""
echo "常用命令："
echo "  查看服务状态: sudo systemctl status $SERVICE_NAME"
echo "  启动服务:     sudo systemctl start $SERVICE_NAME"
echo "  停止服务:     sudo systemctl stop $SERVICE_NAME"
echo "  重启服务:     sudo systemctl restart $SERVICE_NAME"
echo "  查看日志:     tail -f /opt/jyd01/wangruihua/AI_Tutor/logs/8024.log"
echo "  禁用开机启动: sudo systemctl disable $SERVICE_NAME"
echo ""
