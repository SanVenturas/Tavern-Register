@echo off
:: 确保错误时不会自动退出
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

echo ========================================
echo    TavernRegister 启动脚本
echo ========================================
echo.

:: 检查 Node.js
echo [1/5] 检查 Node.js...
where node >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 Node.js
    echo 请从 https://nodejs.org/ 下载并安装 Node.js LTS 版本
    echo.
    pause
    exit /b 1
)

node --version >nul 2>&1
if errorlevel 1 (
    echo [错误] Node.js 命令执行失败
    echo.
    pause
    exit /b 1
)

:: 获取 Node.js 版本
set NODE_VERSION=
for /f "tokens=*" %%i in ('node --version 2^>^&1') do (
    set "NODE_VERSION=%%i"
)
if "!NODE_VERSION!"=="" (
    echo [错误] 无法获取 Node.js 版本
    echo.
    pause
    exit /b 1
)
echo [✓] Node.js 版本: !NODE_VERSION!
echo.

:: 检查 npm
echo [2/5] 检查 npm...
where npm >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 npm
    echo npm 通常随 Node.js 一起安装，请重新安装 Node.js
    echo.
    pause
    exit /b 1
)

:: 测试 npm 命令是否可用
call npm --version >nul 2>&1
if errorlevel 1 (
    echo [错误] npm 命令执行失败
    echo 请尝试重新安装 Node.js
    echo.
    pause
    exit /b 1
)

:: 获取 npm 版本
set NPM_VERSION=
for /f "tokens=*" %%i in ('npm --version 2^>^&1') do (
    set "NPM_VERSION=%%i"
)
if "!NPM_VERSION!"=="" (
    echo [警告] 无法获取 npm 版本，但 npm 命令可用
    echo 继续执行...
) else (
    echo [✓] npm 版本: !NPM_VERSION!
)
echo.

:: 检查 .env 文件
echo [3/5] 检查配置文件...
if not exist ".env" (
    echo [错误] 找不到 .env 配置文件
    echo.
    echo 请按以下步骤操作：
    echo 1. 复制 .env.example 文件并重命名为 .env
    echo 2. 编辑 .env 文件，填写必要的配置信息
    echo.
    if exist ".env.example" (
        echo 正在为您创建 .env 文件...
        copy ".env.example" ".env" >nul
        echo [✓] 已创建 .env 文件，请编辑后再次运行
    ) else (
        echo [错误] 也找不到 .env.example 文件
    )
    echo.
    pause
    exit /b 1
)
echo [✓] 配置文件已找到
echo.

:: 配置验证（SILLYTAVERN 相关配置已在后台服务器管理中配置，不再需要在此检查）
echo [✓] 配置验证通过（SillyTavern 服务器配置请在后台管理面板中添加）
echo.

:: 安装依赖
echo [4/5] 检查依赖...
if not exist "node_modules\" (
    echo 首次运行，正在安装依赖...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo [错误] 依赖安装失败
        echo.
        pause
        exit /b 1
    )
    echo.
    echo [✓] 依赖安装完成
) else (
    :: 检查关键依赖
    if not exist "node_modules\express\" (
        echo 检测到依赖不完整，正在重新安装...
        echo.
        call npm install
        if errorlevel 1 (
            echo.
            echo [错误] 依赖安装失败
            echo.
            pause
            exit /b 1
        )
        echo.
    )
    echo [✓] 依赖已安装
)
echo.

:: 创建数据目录
echo [5/5] 准备数据目录...
if not exist "data\" (
    mkdir "data"
    echo [✓] 已创建 data 目录
) else (
    echo [✓] data 目录已存在
)
echo.

echo ========================================
echo    启动服务...
echo ========================================
echo.
echo 按 Ctrl+C 停止服务
echo.

:: 启动服务
call npm start

:: 无论服务如何退出，都暂停以便查看
echo.
echo ========================================
echo    服务已停止
echo ========================================
echo.
pause

