#!/data/data/com.termux/files/usr/bin/bash
# DineQueue Termux 一键安装/启动脚本
# 用法：在 Termux 中执行：bash termux-setup.sh

echo "========================================"
echo " DineQueue 餐厅预约叫号系统"
echo " Termux 一键安装/启动"
echo "========================================"
echo ""

# 颜色
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 1. 更新源并安装必要软件
echo -e "${YELLOW}[1/5] 检查并安装依赖...${NC}"
pkg update -y
pkg install -y nodejs git python make clang

# 2. 克隆仓库（如不存在）
REPO_DIR="$HOME/DineQueue"
if [ ! -d "$REPO_DIR" ]; then
    echo -e "${YELLOW}[2/5] 克隆仓库...${NC}"
    git clone https://github.com/gccmc/DineQueue.git "$REPO_DIR"
else
    echo -e "${YELLOW}[2/5] 仓库已存在，跳过克隆${NC}"
fi

cd "$REPO_DIR" || exit 1

# 3. 安装 npm 依赖
echo -e "${YELLOW}[3/5] 安装 npm 依赖...${NC}"
if [ ! -d "node_modules" ]; then
    npm install
else
    echo "node_modules 已存在，跳过 npm install"
fi

# 4. 获取局域网 IP
echo -e "${YELLOW}[4/5] 获取访问地址...${NC}"
IP=$(ifconfig 2>/dev/null | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $2}' | head -n 1)
if [ -z "$IP" ]; then
    IP=$(ip addr show 2>/dev/null | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $2}' | cut -d/ -f1 | head -n 1)
fi
if [ -z "$IP" ]; then
    IP="<请手动查看本机IP>"
fi

# 5. 启动服务
echo ""
echo -e "${GREEN}[5/5] 启动服务...${NC}"
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
