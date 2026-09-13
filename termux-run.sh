#!/data/data/com.termux/files/usr/bin/bash
# DineQueue Termux 日常启动脚本（已安装过，直接启动）
# 用法：在 Termux 中执行：bash termux-run.sh

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

REPO_DIR="$HOME/DineQueue"
if [ ! -d "$REPO_DIR" ]; then
    echo "错误：未找到 $REPO_DIR"
    echo "请先运行 bash termux-setup.sh 完成首次安装"
    exit 1
fi

cd "$REPO_DIR" || exit 1

echo -e "${YELLOW}获取访问地址...${NC}"
IP=$(ifconfig 2>/dev/null | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $2}' | head -n 1)
if [ -z "$IP" ]; then
    IP=$(ip addr show 2>/dev/null | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $2}' | cut -d/ -f1 | head -n 1)
fi
if [ -z "$IP" ]; then
    IP="<请手动查看本机IP>"
fi

echo ""
echo -e "${GREEN}启动服务...${NC}"
echo ""
echo "========================================"
echo " 服务已启动！访问地址："
echo ""
echo " 预约平台    : http://${IP}:3000/"
echo " 后台管理    : http://${IP}:3000/admin.html"
echo " 自助取号机  : http://${IP}:3000/kiosk.html"
echo " 叫号大屏    : http://${IP}:3000/display.html"
echo " 到店确认台  : http://${IP}:3000/confirm.html"
echo ""
echo " 按 Ctrl+C 停止服务"
echo "========================================"
echo ""

node server.js
