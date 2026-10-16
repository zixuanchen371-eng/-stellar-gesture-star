import * as THREE from "three";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

/* 所有可调参数集中于此；修改后刷新页面生效。 */
const CONFIG = {
  // 粒子数：桌面 30000；移动端 12000
  DESKTOP_PARTICLES: 30000,
  MOBILE_PARTICLES: 12000,
  MOBILE_WIDTH: 768,

  // 恒星基础半径，以及初始半径的随机抖动比例
  STAR_RADIUS: 1.0,
  INITIAL_JITTER: 0.06,

  // 粒子由核心到外层的颜色
  COLOR_CORE: "#fff6d8",
  COLOR_MIDDLE: "#7fd4ff",
  COLOR_OUTER: "#6b4bff",

  // 基础旋转、无手势时的自动旋转速度
  BASE_SPIN: 0.42,
  IDLE_SPIN: 0.32,

  // 握拳/张掌对应的缩放范围
  MIN_SCALE: 0.25,
  MAX_SCALE: 2.3,

  // 张开度归一化区间，经验初值，可按个人手型调整
  OPENNESS_MIN: 1.5,
  OPENNESS_MAX: 3.2,

  // 缩放响应平滑系数；实际系数会乘以灵敏度
  SMOOTHING: 0.12,

  // 握拳时浮动幅度较大，张掌时明显减小
  FLOAT_CLOSED: 0.055,
  FLOAT_OPEN: 0.012,

  // 粒子尺寸范围
  PARTICLE_SIZE_MIN: 1.1,
  PARTICLE_SIZE_MAX: 4.2,

  // 摄像头请求的理想分辨率和帧率
  CAMERA_WIDTH: 640,
  CAMERA_HEIGHT: 480,
  CAMERA_FRAME_RATE: 30,

  // MediaPipe 模型和 WASM 资源
  MODEL_URL: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
  VISION_WASM_URL: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",

  // 手部位置映射范围、跟随速度、手消失后回中速度
  HAND_POSITION_RANGE: 1.2,
  FOLLOW_SPEED: 0.10,
  RETURN_SPEED: 0.025,

  // 相机视差幅度必须小于 0.15；相机位置平滑系数
  CAMERA_PARALLAX: 0.12,
  CAMERA_SMOOTHING: 0.04,

  // 推理最小间隔（毫秒）；0 表示视频有新帧就可推理
  INFERENCE_INTERVAL: 0,

  // 每多少动画帧更新一次 UI 文本
  UI_UPDATE_INTERVAL: 8,

  // 设备像素比上限，控制高分辨率屏幕的渲染开销
  MAX_PIXEL_RATIO: 2,

  // 相机视野和初始距离
  CAMERA_FOV: 50,
  CAMERA_Z: 5.8,

  // 背景颜色
  BACKGROUND: "#050713"
};

const $ = (selector) => document.querySelector(selector);
const canvas = $("#star-canvas");
const video = $("#camera-video");
const cameraFrame = $("#camera-frame");
const cameraButton = $("#camera-button");
const cameraStatus = $("#camera-status");
const statusDot = $("#status-dot");
const notice = $("#notice");
const stateTitle = $("#state-title");
const stateDescription = $("#state-description");
const gestureValue = $("#gesture-value");
const opennessValue = $("#openness-value");
const particleCount = $("#particle-count");
const sensitivityInput = $("#sensitivity");
const sensitivityValue = $("#sensitivity-value");

let renderer, scene, camera, star, geometry, material;
let handLandmarker = null;
let cameraStream = null;
let isTracking = false;
let isInitializingCamera = false;
let disposed = false;
let lastVideoTime = -1;
let lastInferenceTime = 0;
let frameCount = 0;
let lastUIFrame = 0;
let sensitivity = 1.0;
let currentScale = 1.0;
let currentOpenness = 0.5;
let targetScale = 1.0;
let targetSpin = CONFIG.IDLE_SPIN;
let currentSpin = CONFIG.IDLE_SPIN;
let currentFloatAmp = CONFIG.FLOAT_CLOSED;
let lastGesture = "idle";

const handTarget = new THREE.Vector3();
const handCurrent = new THREE.Vector3();
const cameraTarget = new THREE.Vector3(0, 0, CONFIG.CAMERA_Z);
const cameraCurrent = new THREE.Vector3(0, 0, CONFIG.CAMERA_Z);
const clock = new THREE.Clock();
const tempColor = new THREE.Color();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function mix(a, b, t) {
  return a + (b - a) * t;
}
function smoothFactor(base, deltaTime) {
  return 1 - Math.pow(1 - clamp(base, 0, 0.999), deltaTime * 60);
}
function setNotice(message, type = "info") {
  notice.textContent = message;
  notice.dataset.type = type;
  notice.classList.add("visible");
}
function hideNotice() {
  notice.classList.remove("visible");
}
function setCameraStatus(message, mode = "idle") {
  cameraStatus.textContent = message;
  statusDot.dataset.state = mode;
}
function setGesture(gesture, openness) {
  lastGesture = gesture;
  if (gesture === "fist") {
    gestureValue.textContent = "握拳 · 收缩";
    stateTitle.textContent = "星核收缩";
    stateDescription.textContent = "能量汇聚，星核向中心凝聚。";
  } else if (gesture === "open") {
    gestureValue.textContent = "张掌 · 扩散";
    stateTitle.textContent = "星云扩散";
    stateDescription.textContent = "张开手掌，让星辰向外扩散。";
  } else if (gesture === "hand") {
    gestureValue.textContent = "手势调整中";
    stateTitle.textContent = "星核响应";
    stateDescription.textContent = "改变手掌张开程度，调整星核大小。";
  } else {
    gestureValue.textContent = "自动演示";
    stateTitle.textContent = "星核待命";
    stateDescription.textContent = "移动手掌，或者启用摄像头开始互动。";
  }
  opennessValue.textContent = openness == null ? "—" : `${Math.round(openness * 100)}%`;
}
function getParticleCount() {
  const mobile = window.screen.width < CONFIG.MOBILE_WIDTH ||
    window.innerWidth < CONFIG.MOBILE_WIDTH ||
    window.devicePixelRatio > 1.5;
  return mobile ? CONFIG.MOBILE_PARTICLES : CONFIG.DESKTOP_PARTICLES;
}

function initRenderer() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(CONFIG.BACKGROUND);
  camera = new THREE.PerspectiveCamera(
    CONFIG.CAMERA_FOV, window.innerWidth / window.innerHeight, 0.1, 100
  );
  camera.position.set(0, 0, CONFIG.CAMERA_Z);
  cameraTarget.copy(camera.position);
  cameraCurrent.copy(camera.position);

  renderer = new THREE.WebGLRenderer({
    canvas, antialias: false, alpha: true, powerPreference: "high-performance"
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.MAX_PIXEL_RATIO));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  createStar();
  window.addEventListener("resize", onResize, { passive: true });
}

function createStar() {
  const count = getParticleCount();
  const R = CONFIG.STAR_RADIUS;
  geometry = new THREE.BufferGeometry();

  const positions = new Float32Array(count * 3);
  const randoms = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  const coreColor = new THREE.Color(CONFIG.COLOR_CORE);
  const middleColor = new THREE.Color(CONFIG.COLOR_MIDDLE);
  const outerColor = new THREE.Color(CONFIG.COLOR_OUTER);

  for (let i = 0; i < count; i++) {
    const z = Math.random() * 2 - 1;
    const theta = Math.random() * Math.PI * 2;
    const horizontal = Math.sqrt(Math.max(0, 1 - z * z));
    const dx = horizontal * Math.cos(theta);
    const dy = horizontal * Math.sin(theta);
    const dz = z;

    // 球体内部体积均匀分布，并叠加 ±0.06R 径向抖动
    let radius = R * Math.cbrt(Math.random());
    radius += (Math.random() * 2 - 1) * R * CONFIG.INITIAL_JITTER;
    radius = Math.max(0.001, radius);

    const idx = i * 3;
    positions[idx] = dx * radius;
    positions[idx + 1] = dy * radius;
    positions[idx + 2] = dz * radius;

    randoms[idx] = Math.random();
    randoms[idx + 1] = Math.random();
    randoms[idx + 2] = Math.random();

    sizes[i] = mix(
      CONFIG.PARTICLE_SIZE_MIN,
      CONFIG.PARTICLE_SIZE_MAX,
      Math.pow(Math.random(), 1.7)
    );

    const radial = clamp(radius / R, 0, 1);
    if (radial < 0.55) {
      tempColor.copy(coreColor).lerp(middleColor, radial / 0.55);
    } else {
      tempColor.copy(middleColor).lerp(outerColor, (radial - 0.55) / 0.45);
    }
    colors[idx] = tempColor.r;
    colors[idx + 1] = tempColor.g;
    colors[idx + 2] = tempColor.b;
  }

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aRandom", new THREE.BufferAttribute(randoms, 3));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));

  material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSpin: { value: CONFIG.IDLE_SPIN },
      uFloatAmp: { value: CONFIG.FLOAT_CLOSED },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, CONFIG.MAX_PIXEL_RATIO) },
      uScale: { value: 1.0 }
    },
    vertexShader: `
      uniform float uTime;
      uniform float uSpin;
      uniform float uFloatAmp;
      uniform float uPixelRatio;
      uniform float uScale;
      attribute vec3 aRandom;
      attribute float aSize;
      attribute vec3 aColor;
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec3 p = position;
        float r = max(length(p), 0.001);
        float angle = uTime * uSpin / (r + 0.5);
        float c = cos(angle);
        float s = sin(angle);
        p.xz = mat2(c, -s, s, c) * p.xz;

        vec3 normal = normalize(p + vec3(0.0001));
        float breath = sin(uTime * 1.6 + aRandom.x * 6.28318530718) * uFloatAmp;
        p += normal * breath;
        p *= uScale;

        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = aSize * uPixelRatio * (300.0 / max(1.0, -mvPosition.z));
        vColor = aColor;
        vAlpha = clamp(5.0 / max(5.0, -mvPosition.z), 0.45, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 uv = gl_PointCoord - vec2(0.5);
        float d = length(uv);
        float alpha = 1.0 - smoothstep(0.08, 0.5, d);
        alpha *= vAlpha;
        if (alpha < 0.02) discard;
        gl_FragColor = vec4(vColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  star = new THREE.Points(geometry, material);
  star.frustumCulled = false;
  scene.add(star);
  particleCount.textContent = count.toLocaleString("en-US");
}

function calculateOpenness(landmarks) {
  if (!landmarks || landmarks.length < 21) return null;
  const wrist = landmarks[0];
  const middleMcp = landmarks[9];
  const palmSize = Math.hypot(wrist.x - middleMcp.x, wrist.y - middleMcp.y);
  if (!Number.isFinite(palmSize) || palmSize < 0.001) return null;

  const tips = [4, 8, 12, 16, 20];
  let totalDistance = 0;
  for (const index of tips) {
    const tip = landmarks[index];
    totalDistance += Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
  }
  const raw = (totalDistance / tips.length) / palmSize;
  return clamp(
    (raw - CONFIG.OPENNESS_MIN) / (CONFIG.OPENNESS_MAX - CONFIG.OPENNESS_MIN),
    0, 1
  );
}

function applyHandLandmarks(landmarks) {
  const openness = calculateOpenness(landmarks);
  if (openness == null) return;

  currentOpenness = openness;
  targetScale = mix(CONFIG.MIN_SCALE, CONFIG.MAX_SCALE, openness);
  targetSpin = CONFIG.BASE_SPIN * sensitivity * mix(1.8, 1.0, openness);
  currentFloatAmp = mix(CONFIG.FLOAT_CLOSED, CONFIG.FLOAT_OPEN, openness);

  // 视频预览是镜像的，因此对掌心 x 坐标做镜像映射
  const palm = landmarks[9];
  const mirroredX = 1 - palm.x;
  handTarget.set(
    (mirroredX - 0.5) * 2 * CONFIG.HAND_POSITION_RANGE,
    (0.5 - palm.y) * 2 * CONFIG.HAND_POSITION_RANGE,
    0
  );

  let gesture = "hand";
  if (openness < 0.22) gesture = "fist";
  else if (openness > 0.65) gesture = "open";
  setGesture(gesture, openness);
}

async function createHandLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(CONFIG.VISION_WASM_URL);
  const options = {
    baseOptions: { modelAssetPath: CONFIG.MODEL_URL, delegate: "GPU" },
    runningMode: "VIDEO",
    numHands: 1
  };
  try {
    return await HandLandmarker.createFromOptions(vision, options);
  } catch (gpuError) {
    console.warn("MediaPipe GPU 初始化失败，尝试 CPU。", gpuError);
    options.baseOptions.delegate = "CPU";
    return await HandLandmarker.createFromOptions(vision, options);
  }
}

function isLocalhost() {
  return location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    location.hostname === "[::1]";
}

async function startCamera() {
  if (isInitializingCamera || isTracking) return;
  isInitializingCamera = true;
  cameraButton.disabled = true;
  cameraButton.textContent = "正在启动……";

  try {
    if (!window.isSecureContext && !isLocalhost()) {
      throw new Error("当前页面不是安全上下文。请使用 HTTPS 或 localhost 访问。");
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("当前浏览器不支持摄像头 API，请尝试更新浏览器。");
    }

    setCameraStatus("正在请求摄像头权限", "loading");
    setNotice("请允许浏览器使用前置摄像头。");

    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: CONFIG.CAMERA_WIDTH },
        height: { ideal: CONFIG.CAMERA_HEIGHT },
        frameRate: { ideal: CONFIG.CAMERA_FRAME_RATE }
      }
    });

    video.srcObject = cameraStream;
    await video.play();
    cameraFrame.classList.add("active");

    setCameraStatus("正在加载手势模型", "loading");
    if (!handLandmarker) handLandmarker = await createHandLandmarker();

    isTracking = true;
    cameraButton.textContent = "关闭摄像头";
    cameraButton.disabled = false;
    cameraButton.dataset.active = "true";
    setCameraStatus("手势识别已启动", "active");
    setNotice("识别已启动：握拳收缩，张掌扩散。", "success");

    window.setTimeout(() => {
      if (isTracking) hideNotice();
    }, 2500);
  } catch (error) {
    console.error("摄像头或手势模型初始化失败：", error);
    stopCamera();
    const message = error?.message || "未知错误";
    setCameraStatus("自动动画模式", "error");
    cameraButton.textContent = "重试启用摄像头";
    cameraButton.disabled = false;
    cameraButton.dataset.active = "false";
    setNotice(`摄像头不可用，已切换自动动画。${message}`, "error");
    setGesture("idle", null);
  } finally {
    isInitializingCamera = false;
    cameraButton.disabled = false;
  }
}

function stopCamera() {
  isTracking = false;
  if (cameraStream) {
    for (const track of cameraStream.getTracks()) track.stop();
    cameraStream = null;
  }
  video.pause();
  video.srcObject = null;
  cameraFrame.classList.remove("active");
  cameraButton.textContent = "启用摄像头";
  cameraButton.dataset.active = "false";
  setCameraStatus("自动动画模式", "idle");
  setGesture("idle", null);
  handTarget.set(0, 0, 0);
  targetScale = 1.0;
  targetSpin = CONFIG.IDLE_SPIN;
}

cameraButton.addEventListener("click", () => {
  if (isTracking) {
    stopCamera();
    hideNotice();
  } else {
    startCamera();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) lastVideoTime = -1;
});

function animate() {
  if (disposed) return;
  requestAnimationFrame(animate);

  const deltaTime = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;

  // 仅在视频时间戳变化时调用 detectForVideo
  if (
    isTracking &&
    !document.hidden &&
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    video.videoWidth > 0 &&
    video.currentTime !== lastVideoTime
  ) {
    const now = performance.now();
    if (now - lastInferenceTime >= CONFIG.INFERENCE_INTERVAL) {
      lastVideoTime = video.currentTime;
      lastInferenceTime = now;
      try {
        const results = handLandmarker.detectForVideo(video, now);
        if (results.landmarks?.length) {
          applyHandLandmarks(results.landmarks[0]);
        } else {
          handTarget.set(0, 0, 0);
          targetScale = 1.0;
          targetSpin = CONFIG.IDLE_SPIN;
          currentFloatAmp = CONFIG.FLOAT_CLOSED;
          setGesture("idle", null);
        }
      } catch (error) {
        console.warn("本帧手势识别失败：", error);
      }
    }
  }

  if (material && star) {
    const scaleAlpha = clamp(CONFIG.SMOOTHING * sensitivity, 0.01, 0.9);
    currentScale += (targetScale - currentScale) * scaleAlpha;
    const spinAlpha = smoothFactor(0.07, deltaTime);
    currentSpin += (targetSpin - currentSpin) * spinAlpha;

    material.uniforms.uTime.value = elapsed;
    material.uniforms.uSpin.value = currentSpin;
    material.uniforms.uFloatAmp.value = currentFloatAmp;
    material.uniforms.uScale.value = currentScale;

    const followAlpha = smoothFactor(
      isTracking && lastGesture !== "idle" ? CONFIG.FOLLOW_SPEED : CONFIG.RETURN_SPEED,
      deltaTime
    );
    handCurrent.lerp(handTarget, followAlpha);
    star.position.copy(handCurrent);

    cameraTarget.set(
      clamp(handCurrent.x * CONFIG.CAMERA_PARALLAX, -0.149, 0.149),
      clamp(handCurrent.y * CONFIG.CAMERA_PARALLAX, -0.149, 0.149),
      CONFIG.CAMERA_Z
    );
    cameraCurrent.lerp(
      cameraTarget,
      smoothFactor(CONFIG.CAMERA_SMOOTHING, deltaTime)
    );
    camera.position.copy(cameraCurrent);
    camera.lookAt(0, 0, 0);

    if (!isTracking) targetSpin = CONFIG.IDLE_SPIN;
  }

  frameCount++;
  if (frameCount - lastUIFrame >= CONFIG.UI_UPDATE_INTERVAL) {
    lastUIFrame = frameCount;
    sensitivityValue.textContent = `${sensitivity.toFixed(1)}×`;
    opennessValue.textContent = lastGesture === "idle"
      ? "—"
      : `${Math.round(currentOpenness * 100)}%`;
  }

  renderer.render(scene, camera);
}

sensitivityInput.addEventListener("input", () => {
  sensitivity = Number(sensitivityInput.value);
  sensitivityValue.textContent = `${sensitivity.toFixed(1)}×`;
  if (lastGesture === "idle") {
    targetSpin = CONFIG.IDLE_SPIN;
  } else {
    targetSpin = CONFIG.BASE_SPIN * sensitivity * mix(1.8, 1.0, currentOpenness);
  }
});

$("#panel-toggle").addEventListener("click", () => {
  const panel = $("#control-panel");
  const collapsed = panel.classList.toggle("collapsed");
  $("#panel-toggle").setAttribute("aria-expanded", String(!collapsed));
  $("#panel-chevron").textContent = collapsed ? "+" : "−";
});

$("#reset-button").addEventListener("click", () => {
  handTarget.set(0, 0, 0);
  targetScale = 1.0;
  currentScale = 1.0;
  targetSpin = CONFIG.IDLE_SPIN;
  currentSpin = CONFIG.IDLE_SPIN;
  currentOpenness = 0.5;
  currentFloatAmp = CONFIG.FLOAT_CLOSED;
  sensitivityInput.value = "1.0";
  sensitivity = 1.0;
  sensitivityValue.textContent = "1.0×";
  setGesture("idle", null);
});

function onResize() {
  if (!renderer || !camera) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.MAX_PIXEL_RATIO));
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (material) {
    material.uniforms.uPixelRatio.value =
      Math.min(window.devicePixelRatio || 1, CONFIG.MAX_PIXEL_RATIO);
  }
}

function cleanup() {
  disposed = true;
  stopCamera();
  window.removeEventListener("resize", onResize);
  if (handLandmarker) {
    handLandmarker.close();
    handLandmarker = null;
  }
  if (geometry) geometry.dispose();
  if (material) material.dispose();
  if (renderer) renderer.dispose();
}
window.addEventListener("pagehide", cleanup, { once: true });

try {
  initRenderer();
  setGesture("idle", null);
  setCameraStatus("等待摄像头启动", "idle");
  setNotice("星核已就绪。点击“启用摄像头”开始互动。");
  animate();
} catch (error) {
  console.error("粒子系统初始化失败：", error);
  setNotice("粒子系统初始化失败，请检查浏览器 WebGL 支持和控制台错误。", "error");
}
