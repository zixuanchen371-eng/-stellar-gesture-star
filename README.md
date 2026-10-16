# 星核 STELLAR — 手势控制粒子恒星

纯静态网页项目：Three.js 自定义 GPU 粒子 + MediaPipe Tasks Vision 手势识别。

## 功能

- 握拳：恒星收缩。
- 张开手掌：恒星扩散，粒子浮动减小。
- 手掌移动：恒星跟随移动。
- 灵敏度滑杆实时调整响应。
- 摄像头不可用时保留自动旋转动画。
- 桌面 30000 粒子，移动端 12000 粒子。

## 文件

    index.html
    main.js
    style.css
    README.md

无 npm、Vite、打包工具或构建步骤。

## 本地启动

在项目文件夹内运行：

    python3 -m http.server 8080

Windows 也可运行：

    py -m http.server 8080

然后在电脑浏览器访问：

    http://localhost:8080

请勿直接双击 index.html 使用 file:// 打开。

## 手机真机访问

摄像头通常只允许在 HTTPS 或 localhost 安全上下文中使用。
手机访问电脑的局域网 HTTP 地址（例如 http://192.168.1.10:8080）
通常会被浏览器拦截，因为该地址不是手机自身的 localhost。

### 方案 A：HTTPS 隧道

先在电脑运行本地服务器：

    python3 -m http.server 8080

再打开另一个终端，运行：

    cloudflared tunnel --url http://localhost:8080

用终端输出的 HTTPS 地址在手机浏览器打开。cloudflared 需提前安装，
安装方法请参考官方文档。

### 方案 B：GitHub Pages

把四个文件上传到 GitHub 仓库，在 Settings → Pages 启用部署，
然后用生成的 HTTPS 地址访问。无需构建。

首次启动需要联网下载 Three.js、MediaPipe WASM 和模型。

## 使用方法

1. 打开网页，等待粒子系统初始化。
2. 点击“启用摄像头”，允许摄像头权限。
3. 把完整手掌放在摄像头前。
4. 握拳观察收缩，张掌观察扩散，移动手掌控制位置。
5. 拖动灵敏度滑杆。
6. 点击“重置星核”恢复默认参数。

建议在光线充足的环境中测试，保持手掌完整可见。

## CONFIG 参数说明

所有可调参数集中在 `main.js` 顶部的 `CONFIG` 对象，修改后刷新页面生效。

### 粒子与分布

- `DESKTOP_PARTICLES`：桌面粒子数，默认 30000。
- `MOBILE_PARTICLES`：移动端粒子数，默认 12000。
- `MOBILE_WIDTH`：移动端宽度阈值，默认 768。
- `STAR_RADIUS`：粒子初始球体分布的基础半径。
- `INITIAL_JITTER`：径向随机抖动比例，默认 ±0.06R。

### 颜色与粒子尺寸

- `COLOR_CORE`：核心颜色，默认 `#fff6d8`。
- `COLOR_MIDDLE`：中层颜色，默认 `#7fd4ff`。
- `COLOR_OUTER`：外层颜色，默认 `#6b4bff`。
- `PARTICLE_SIZE_MIN` / `PARTICLE_SIZE_MAX`：粒子尺寸范围。

颜色按粒子半径由核心向外层插值。改颜色后刷新页面。

### 旋转与浮动

- `BASE_SPIN`：识别到手势时的基础旋转速度。
- `IDLE_SPIN`：自动演示时的旋转速度，保证无手势时动画仍持续。
- `FLOAT_CLOSED`：握拳时浮动幅度，默认 0.055。
- `FLOAT_OPEN`：张掌时浮动幅度，默认 0.012。

### 缩放与张开度

- `MIN_SCALE`：握拳时缩放目标，默认 0.25。
- `MAX_SCALE`：张掌时缩放目标，默认 2.3。
- `OPENNESS_MIN`：张开度归一化下限，默认 1.5。
- `OPENNESS_MAX`：张开度归一化上限，默认 3.2。
- `SMOOTHING`：缩放平滑系数，默认 0.12；增大响应更快但可能更突兀。

张开度区间是经验初值，因手型、摄像头角度不同，必要时可微调。

### 摄像头与模型

- `CAMERA_WIDTH` / `CAMERA_HEIGHT`：摄像头理想分辨率，默认 640×480。
- `CAMERA_FRAME_RATE`：摄像头理想帧率，默认 30。
- `MODEL_URL`：固定的 MediaPipe 手势模型地址。
- `VISION_WASM_URL`：固定版本 MediaPipe WASM 资源目录。
- `INFERENCE_INTERVAL`：推理最小间隔（毫秒）；0 表示新视频帧即可推理。

### 跟随与视差

- `HAND_POSITION_RANGE`：手部位置映射范围，默认 ±1.2。
- `FOLLOW_SPEED`：恒星跟随速度，增大更紧跟手掌。
- `RETURN_SPEED`：手消失后回中心的速度。
- `CAMERA_PARALLAX`：相机视差幅度，默认 0.12，必须小于 0.15。
- `CAMERA_SMOOTHING`：相机视差平滑系数。

### 性能与画面

- `UI_UPDATE_INTERVAL`：DOM 数值更新帧间隔。
- `MAX_PIXEL_RATIO`：设备像素比上限，默认 2。
- `CAMERA_FOV`：相机视野角度，默认 50。
- `CAMERA_Z`：相机初始距离，默认 5.8。
- `BACKGROUND`：背景颜色。

## 故障排查

- **黑屏：** 检查浏览器控制台、WebGL 和 Three.js CDN 加载。
- **摄像头无法启动：** 检查 HTTPS/localhost、权限和摄像头占用。
- **没有手势响应：** 检查模型与 WASM 网络请求、控制台报错及光线。
- **手机卡顿：** 可减少 `MOBILE_PARTICLES`，降低粒子尺寸或增加 `INFERENCE_INTERVAL`。
- **收缩/扩散不明显：** 可微调 `OPENNESS_MIN`、`OPENNESS_MAX`。

## 实现与验证说明

- 使用原生 ES Module 和 importmap。
- Three.js 版本固定为 0.160.0。
- MediaPipe Tasks Vision 版本固定为 0.10.14。
- 粒子由 `THREE.Points` 和自定义 `ShaderMaterial` 绘制。
- 初始半径使用 `R * Math.cbrt(Math.random())`，再叠加径向抖动。
- 顶点着色器实现差速旋转、径向呼吸和距离尺寸衰减。
- 片元着色器实现圆形软粒子与低 alpha 丢弃。
- 摄像头错误会显示提示，并尝试回到自动动画模式。

此项目文件已生成，但尚未在所有桌面和移动浏览器上完成实机验证。
