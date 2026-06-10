/* app.js */

// Global State
let mqttClient = null;
let currentRole = null; // 'teacher' or 'student'
let roomId = null;
let username = null;

// Teacher State
let teacherGridSize = 4; // Default to 4 in new mockup
let teacherTargetLines = 2;
let teacherWordPool = [];
let teacherDrawnWords = [];
let teacherStudents = {}; // id -> { name, lines, bingo }
let teacherContentType = "words"; // default to words
let teacherHasFreeSpace = false;
let teacherExpectedStudents = 28;

// Student State
let studentGridSize = 4;
let studentTargetLines = 2;
let studentBoardWords = []; // flat array of words on student's board
let studentMarkedIndices = new Set(); // indices of cells clicked by student
let studentDrawnWords = new Set(); // words drawn by teacher
let studentHasWon = false;
let studentHasFreeSpace = false;

// Standard Word Pools
const WORD_POOLS = {
  numbers: [], // Will generate dynamically based on size
  patterns: [
    "🚗", "🍎", "🐶", "⚽", "🍕", "🐱", "🚀", "🎸", "🎈", "🍔", 
    "🍦", "🦁", "🐼", "🦄", "🍓", "🍩", "⏰", "🧸", "🎨", "🧩", 
    "🎲", "🎧", "📷", "💡", "✈️", "🚢", "🌈", "🍉", "🍒", "🥕", 
    "🥑", "🧁", "🍿", "🍪", "🍩", "🍭"
  ],
  alphabet: [
    "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", 
    "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"
  ],
  zhuyin: [
    "ㄅ", "ㄆ", "ㄇ", "ㄈ", "ㄉ", "ㄊ", "ㄋ", "ㄌ", "ㄍ", "ㄎ", "ㄏ", 
    "ㄐ", "ㄑ", "ㄒ", "ㄓ", "ㄔ", "ㄕ", "ㄖ", "ㄗ", "ㄘ", "ㄙ", "ㄚ", 
    "ㄛ", "ㄜ", "ㄝ", "ㄞ", "ㄟ", "ㄠ", "ㄡ", "ㄢ", "ㄣ", "ㄤ", "ㄥ", "ㄦ",
    "ㄧ", "ㄨ", "ㄩ"
  ]
};

// MQTT Configurations
const MQTT_BROKER = "wss://broker.hivemq.com:8884/mqtt";

// Initialize UI events on load
document.addEventListener("DOMContentLoaded", () => {
  setupUIEvents();
  checkUrlParams();
});

// Navigate between screens
function navigateTo(screenId) {
  document.querySelectorAll(".screen").forEach(screen => {
    screen.classList.remove("active");
  });
  const targetScreen = document.getElementById(screenId);
  if (targetScreen) {
    targetScreen.classList.add("active");
  }
}

// Set up UI Event listeners
function setupUIEvents() {
  // 1. Content Type Selector
  const typeBtns = document.querySelectorAll("#setup-content-type .selector-btn");
  const wordsContainer = document.getElementById("words-input-container");
  
  typeBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      typeBtns.forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      teacherContentType = btn.getAttribute("data-value");
      
      if (teacherContentType === "words") {
        wordsContainer.style.display = "block";
      } else {
        wordsContainer.style.display = "none";
      }
    });
  });

  // 2. Grid Size Selector (3x3, 4x4, 5x5)
  const sizeBtns = document.querySelectorAll("#setup-grid-size-new .selector-btn");
  const freeCheckbox = document.getElementById("setup-free-space");
  const warningText = document.getElementById("free-space-warning");

  sizeBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      sizeBtns.forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      teacherGridSize = parseInt(btn.getAttribute("data-value"));

      if (teacherGridSize === 4) {
        // Disable free space checkbox and uncheck it
        freeCheckbox.disabled = true;
        freeCheckbox.checked = false;
        teacherHasFreeSpace = false;
        warningText.style.display = "block";
      } else {
        // Enable free space checkbox
        freeCheckbox.disabled = false;
        warningText.style.display = "none";
      }
    });
  });
}

// Helper to handle Free Space checkbox click via container click (mockup compatibility)
function toggleFreeSpaceCheckbox(event) {
  const checkbox = document.getElementById("setup-free-space");
  if (checkbox.disabled) return;
  
  // If clicked directly on checkbox, let it propagate normally.
  // Otherwise, if clicked on container, toggle the checkbox manually.
  if (event.target !== checkbox) {
    checkbox.checked = !checkbox.checked;
  }
  teacherHasFreeSpace = checkbox.checked;
}

// Check if room ID is passed in URL (for students scanning QR code)
function checkUrlParams() {
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get("room");
  if (roomParam) {
    navigateTo("screen-student-join");
    document.getElementById("student-room-input").value = roomParam;
  }
}

// ==========================================
// TEACHER LOGIC
// ==========================================

// Create Room & Connect MQTT
function createRoom() {
  currentRole = "teacher";
  
  // 1. Get room parameters
  const winLinesSelect = document.getElementById("setup-win-lines");
  teacherTargetLines = parseInt(winLinesSelect.value);
  
  const studentCountInput = document.getElementById("setup-student-count-input");
  teacherExpectedStudents = parseInt(studentCountInput.value) || 28;
  
  const freeCheckbox = document.getElementById("setup-free-space");
  teacherHasFreeSpace = freeCheckbox.checked;

  const minNeeded = teacherGridSize * teacherGridSize;

  // Generate word pool based on Content Type
  if (teacherContentType === "words") {
    const rawWords = document.getElementById("setup-custom-words").value.trim();
    if (!rawWords) {
      alert("請輸入您的語詞清單！");
      return;
    }
    teacherWordPool = rawWords.split(/[,，\n]+/).map(w => w.trim()).filter(w => w.length > 0);
    if (teacherWordPool.length < minNeeded) {
      alert(`語詞數量不足！${teacherGridSize}x${teacherGridSize} 網格至少需要 ${minNeeded} 個語詞（目前只有 ${teacherWordPool.length} 個）。`);
      return;
    }
  } 
  else if (teacherContentType === "numbers") {
    // Generate numbers from 1 to GridSize * GridSize + 10 for more randomization
    const maxNum = minNeeded + 10;
    teacherWordPool = Array.from({ length: maxNum }, (_, i) => (i + 1).toString());
  } 
  else {
    // Standard pool (patterns, alphabet, zhuyin)
    const pool = [...WORD_POOLS[teacherContentType]];
    if (pool.length < minNeeded) {
      // Fallback or pad if needed (though our predefines have enough)
      alert(`詞庫池數量不足（目前只有 ${pool.length} 個）。`);
      return;
    }
    teacherWordPool = pool;
  }

  // 2. Generate random 4-digit room ID
  roomId = Math.floor(1000 + Math.random() * 9000).toString();
  document.getElementById("lobby-room-id").textContent = roomId;
  document.getElementById("game-room-id-t").textContent = roomId;

  // 3. Generate QR Code URL
  const baseJoinUrl = window.location.origin + window.location.pathname + "?room=" + roomId;
  document.getElementById("lobby-join-url").textContent = baseJoinUrl;
  
  const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(baseJoinUrl)}`;
  document.getElementById("lobby-qr").src = qrImgUrl;

  // Reset lobby states
  teacherStudents = {};
  teacherDrawnWords = [];
  updateStudentListLobby();
  document.getElementById("btn-start-game").disabled = true;

  // 4. Connect to MQTT Broker
  connectMQTT(() => {
    // Subscribe to student join requests and status updates
    mqttClient.subscribe(`bingo/${roomId}/student_join`, (err) => {
      if (err) console.error("Subscribe join error", err);
    });
    mqttClient.subscribe(`bingo/${roomId}/student_status`, (err) => {
      if (err) console.error("Subscribe status error", err);
    });
    
    // Broadcast initial room heartbeat
    publishMessage(`bingo/${roomId}/room_heartbeat`, { type: "lobby" });
    
    navigateTo("screen-teacher-lobby");
  });
}

// Update the list of joined students on Teacher Lobby screen
function updateStudentListLobby() {
  const list = document.getElementById("lobby-student-list");
  const countBadge = document.getElementById("lobby-student-count");
  const placeholder = document.getElementById("no-students-placeholder");
  
  const studentIds = Object.keys(teacherStudents);
  countBadge.textContent = `${studentIds.length} 人`;

  if (studentIds.length === 0) {
    list.innerHTML = "";
    list.appendChild(placeholder);
    document.getElementById("btn-start-game").disabled = true;
    return;
  }

  if (placeholder && placeholder.parentNode === list) {
    list.innerHTML = "";
  } else {
    list.innerHTML = "";
  }

  studentIds.forEach(id => {
    const badge = document.createElement("span");
    badge.className = "student-badge";
    badge.textContent = teacherStudents[id].name;
    list.appendChild(badge);
  });

  // Enable start game button if there's at least 1 student
  document.getElementById("btn-start-game").disabled = studentIds.length === 0;
}

// Start Game (Teacher action)
function startBingoGame() {
  // Publish game config to all students
  const config = {
    type: "start",
    size: teacherGridSize,
    target: teacherTargetLines,
    wordPool: teacherWordPool,
    freeSpace: teacherHasFreeSpace
  };
  publishMessage(`bingo/${roomId}/teacher_events`, config);

  // Initialize teacher game UI
  document.getElementById("game-student-count-t").textContent = `學生人數: ${Object.keys(teacherStudents).length}人`;
  document.getElementById("last-drawn-word").textContent = "---";
  
  // Render word pool grid for manual select
  const grid = document.getElementById("teacher-word-pool-grid");
  grid.innerHTML = "";
  teacherWordPool.forEach(word => {
    const item = document.createElement("div");
    item.className = "word-pool-item";
    item.textContent = word;
    item.onclick = () => drawWordManual(word, item);
    grid.appendChild(item);
  });

  updateRankingList();
  navigateTo("screen-teacher-game");
}

// Draw a word manually (by clicking on it in pool list)
function drawWordManual(word, element) {
  if (teacherDrawnWords.includes(word)) return; // already drawn
  
  teacherDrawnWords.push(word);
  element.classList.add("drawn");
  document.getElementById("last-drawn-word").textContent = word;

  // Broadcast drawn word
  publishMessage(`bingo/${roomId}/teacher_events`, {
    type: "draw",
    word: word
  });
}

// Draw a word randomly from pool
function drawWordRandomly() {
  const undrawn = teacherWordPool.filter(w => !teacherDrawnWords.includes(w));
  if (undrawn.length === 0) {
    alert("所有單詞都已經抽完囉！");
    return;
  }
  const randomWord = undrawn[Math.floor(Math.random() * undrawn.length)];
  
  // Find element and call draw manual
  const items = document.querySelectorAll(".word-pool-item");
  let targetEl = null;
  items.forEach(el => {
    if (el.textContent === randomWord) targetEl = el;
  });

  if (targetEl) {
    drawWordManual(randomWord, targetEl);
  }
}

// Update the live score ranking board for the teacher
function updateRankingList() {
  const list = document.getElementById("ranking-list");
  list.innerHTML = "";

  // Convert students dict to array and sort by lines count descending
  const sorted = Object.keys(teacherStudents).map(id => ({
    id: id,
    name: teacherStudents[id].name,
    lines: teacherStudents[id].lines || 0,
    bingo: teacherStudents[id].bingo || false
  })).sort((a, b) => b.lines - a.lines);

  if (sorted.length === 0) {
    list.innerHTML = '<p style="color:#a0aec0;text-align:center;font-size:0.9rem;">無學生數據</p>';
    return;
  }

  sorted.forEach(s => {
    const item = document.createElement("div");
    item.className = "ranking-item" + (s.bingo ? " winner" : "");
    
    const nameSpan = document.createElement("span");
    nameSpan.textContent = s.name + (s.bingo ? " 👑 (BINGO!)" : "");
    
    const scoreSpan = document.createElement("span");
    scoreSpan.textContent = `${s.lines} 條線`;

    item.appendChild(nameSpan);
    item.appendChild(scoreSpan);
    list.appendChild(item);
  });
}

// Close Room and Disconnect
function closeRoomAndExit() {
  if (confirm("您確定要關閉房間並結束遊戲嗎？這將會中斷所有學生的連線。")) {
    if (mqttClient) {
      // Broadcast close event
      publishMessage(`bingo/${roomId}/teacher_events`, { type: "close" });
      disconnectMQTT();
    }
    navigateTo("screen-welcome");
  }
}

// ==========================================
// STUDENT LOGIC
// ==========================================

// Join Room Lobby
function joinRoom() {
  currentRole = "student";
  
  const roomInput = document.getElementById("student-room-input").value.trim();
  const nameInput = document.getElementById("student-name-input").value.trim();

  if (roomInput.length !== 4) {
    alert("請輸入正確的 4 位數房號！");
    return;
  }
  if (!nameInput) {
    alert("請輸入您的名字！");
    return;
  }

  roomId = roomInput;
  username = nameInput;

  document.getElementById("lobby-room-id-s").textContent = roomId;
  document.getElementById("student-name-badge").textContent = username;
  document.getElementById("game-student-name").textContent = username;

  // Reset student states
  studentMarkedIndices.clear();
  studentDrawnWords.clear();
  studentHasWon = false;

  // Connect to MQTT Broker
  connectMQTT(() => {
    // Subscribe to teacher events
    mqttClient.subscribe(`bingo/${roomId}/teacher_events`, (err) => {
      if (err) console.error("Subscribe teacher events error", err);
    });

    // Alert teacher about joining
    publishMessage(`bingo/${roomId}/student_join`, {
      id: mqttClient.options.clientId,
      name: username
    });

    navigateTo("screen-student-lobby");
  });
}

// Setup Student Grid Board once started by teacher
function setupStudentBoard(size, pool, freeSpace) {
  studentGridSize = size;
  studentHasFreeSpace = freeSpace;
  
  // Shuffle pool copy and take size*size elements
  let shuffledPool = [...pool].sort(() => 0.5 - Math.random());
  studentBoardWords = shuffledPool.slice(0, size * size);

  // Place FREE space if enabled
  if (freeSpace) {
    if (size === 5) {
      studentBoardWords[12] = "✨ FREE ✨";
      studentMarkedIndices.add(12); // Auto marked
    } else if (size === 3) {
      studentBoardWords[4] = "✨ FREE ✨";
      studentMarkedIndices.add(4); // Auto marked
    }
  }

  // Draw board in UI
  const grid = document.getElementById("bingo-board-grid");
  grid.innerHTML = "";
  grid.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
  grid.style.gridTemplateRows = `repeat(${size}, 1fr)`;

  studentBoardWords.forEach((word, index) => {
    const cell = document.createElement("div");
    cell.className = "bingo-cell";
    if (word === "✨ FREE ✨") {
      cell.classList.add("center-free", "marked");
    }
    cell.textContent = word;
    
    cell.onclick = () => onCellClicked(index, cell);
    grid.appendChild(cell);
  });

  document.getElementById("game-target-lines").textContent = studentTargetLines;
  document.getElementById("game-current-lines").textContent = "0";
  document.getElementById("student-last-drawn").textContent = "(等待老師抽詞)";

  navigateTo("screen-student-game");
}

// Handle Student Click on cell
function onCellClicked(index, element) {
  // If center free, do nothing
  if (studentBoardWords[index] === "✨ FREE ✨") return;

  const word = studentBoardWords[index];

  // Toggle cell marked status (only allow marking if drawn by teacher to prevent early clicking)
  if (studentMarkedIndices.has(index)) {
    studentMarkedIndices.delete(index);
    element.classList.remove("marked");
  } else {
    // Allow student to click, but we visually highlight if it's drawn
    studentMarkedIndices.add(index);
    element.classList.add("marked");
    if (studentDrawnWords.has(word)) {
      element.classList.add("marked", "caller-drawn");
    }
  }

  calculateLinesAndReport();
}

// Calculate Bingo lines and publish report to teacher
function calculateLinesAndReport() {
  const size = studentGridSize;
  let linesCount = 0;

  // Helper to check if a cell at (row, col) is valid
  // A cell is valid if it is FREE or (marked by student AND drawn by teacher)
  function isValidCell(row, col) {
    const idx = row * size + col;
    const word = studentBoardWords[idx];
    
    if (word === "✨ FREE ✨") return true;
    return studentMarkedIndices.has(idx) && studentDrawnWords.has(word);
  }

  // 1. Check rows
  for (let r = 0; r < size; r++) {
    let rowComplete = true;
    for (let c = 0; c < size; c++) {
      if (!isValidCell(r, c)) {
        rowComplete = false;
        break;
      }
    }
    if (rowComplete) linesCount++;
  }

  // 2. Check columns
  for (let c = 0; c < size; c++) {
    let colComplete = true;
    for (let r = 0; r < size; r++) {
      if (!isValidCell(r, c)) {
        colComplete = false;
        break;
      }
    }
    if (colComplete) linesCount++;
  }

  // 3. Check diagonal (top-left to bottom-right)
  let diag1Complete = true;
  for (let i = 0; i < size; i++) {
    if (!isValidCell(i, i)) {
      diag1Complete = false;
      break;
    }
  }
  if (diag1Complete) linesCount++;

  // 4. Check anti-diagonal (top-right to bottom-left)
  let diag2Complete = true;
  for (let i = 0; i < size; i++) {
    if (!isValidCell(i, size - 1 - i)) {
      diag2Complete = false;
      break;
    }
  }
  if (diag2Complete) linesCount++;

  // Update UI counter
  document.getElementById("game-current-lines").textContent = linesCount;

  // Check win condition
  let isBingo = linesCount >= studentTargetLines;
  if (isBingo && !studentHasWon) {
    studentHasWon = true;
    triggerConfetti();
    document.getElementById("bingo-modal").classList.add("active");
  }

  // Report status to teacher
  publishMessage(`bingo/${roomId}/student_status`, {
    id: mqttClient.options.clientId,
    name: username,
    lines: linesCount,
    bingo: isBingo
  });
}

function closeBingoModal() {
  document.getElementById("bingo-modal").classList.remove("active");
}

// Disconnect and exit lobby
function exitLobbyAndDisconnect() {
  if (confirm("您確定要退出房間嗎？")) {
    disconnectMQTT();
    navigateTo("screen-welcome");
  }
}

// ==========================================
// MQTT COMMON LAYER
// ==========================================

function connectMQTT(onSuccessCallback) {
  // Generate random client ID
  const clientId = "bingo_client_" + Math.random().toString(16).substr(2, 8);
  
  console.log("Connecting to MQTT broker...");
  
  mqttClient = mqtt.connect(MQTT_BROKER, {
    clientId: clientId,
    clean: true,
    connectTimeout: 4000
  });

  mqttClient.on("connect", () => {
    console.log("MQTT connected successfully!");
    if (onSuccessCallback) onSuccessCallback();
  });

  mqttClient.on("message", (topic, message) => {
    try {
      const payload = JSON.parse(message.toString());
      handleIncomingMessage(topic, payload);
    } catch (e) {
      console.error("Error parsing message payload", e);
    }
  });

  mqttClient.on("error", (err) => {
    console.error("MQTT client connection error", err);
    alert("無法建立即時連線，請檢查網路狀態！");
    disconnectMQTT();
    navigateTo("screen-welcome");
  });
}

function disconnectMQTT() {
  if (mqttClient) {
    mqttClient.end();
    mqttClient = null;
  }
}

function publishMessage(topic, payload) {
  if (mqttClient && mqttClient.connected) {
    mqttClient.publish(topic, JSON.stringify(payload));
  } else {
    console.warn("MQTT client not connected, message not published:", topic);
  }
}

// Handle Incoming MQTT Messages
function handleIncomingMessage(topic, payload) {
  if (currentRole === "teacher") {
    // 1. Student joins lobby
    if (topic === `bingo/${roomId}/student_join`) {
      teacherStudents[payload.id] = {
        name: payload.name,
        lines: 0,
        bingo: false
      };
      updateStudentListLobby();
      
      // Send handshake acknowledgment so student knows lobby size etc
      publishMessage(`bingo/${roomId}/teacher_events`, {
        type: "handshake",
        joinedStudents: Object.keys(teacherStudents).length
      });
    }
    // 2. Student reports lines/bingo status
    else if (topic === `bingo/${roomId}/student_status`) {
      if (teacherStudents[payload.id]) {
        teacherStudents[payload.id].lines = payload.lines;
        teacherStudents[payload.id].bingo = payload.bingo;
        updateRankingList();
        
        // If a student got a new Bingo, teacher trigger confetti too!
        if (payload.bingo && !teacherStudents[payload.id].hasWonAlerted) {
          teacherStudents[payload.id].hasWonAlerted = true;
          triggerConfetti();
        }
      }
    }
  } 
  else if (currentRole === "student") {
    // 1. Setup events from teacher
    if (topic === `bingo/${roomId}/teacher_events`) {
      if (payload.type === "start") {
        studentGridSize = payload.size;
        studentTargetLines = payload.target;
        setupStudentBoard(payload.size, payload.wordPool, payload.freeSpace);
      }
      else if (payload.type === "draw") {
        studentDrawnWords.add(payload.word);
        document.getElementById("student-last-drawn").textContent = payload.word;
        
        // Match draw visually on student's board
        const cells = document.querySelectorAll(".bingo-cell");
        cells.forEach((cell, idx) => {
          if (studentBoardWords[idx] === payload.word) {
            cell.classList.add("caller-drawn");
            if (studentMarkedIndices.has(idx)) {
              cell.classList.add("marked", "caller-drawn");
            }
          }
        });

        // Recalculate if it triggers lines
        calculateLinesAndReport();
      }
      else if (payload.type === "close") {
        alert("老師已關閉房間，遊戲結束。");
        disconnectMQTT();
        navigateTo("screen-welcome");
      }
    }
  }
}

// ==========================================
// CANVAS CONFETTI EFFECT
// ==========================================

const canvas = document.getElementById("confetti-canvas");
const ctx = canvas.getContext("2d");
let particles = [];
let animationFrameId = null;

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

class ConfettiParticle {
  constructor() {
    this.x = Math.random() * canvas.width;
    this.y = Math.random() * -canvas.height - 20;
    this.size = Math.random() * 8 + 6;
    this.color = `hsl(${Math.random() * 360}, 90%, 60%)`;
    this.speed = Math.random() * 3 + 2;
    this.angle = Math.random() * Math.PI * 2;
    this.angleSpeed = Math.random() * 0.1 - 0.05;
    this.opacity = 1;
    this.isCircle = Math.random() > 0.5;
  }

  update() {
    this.y += this.speed;
    this.x += Math.sin(this.angle) * 0.5;
    this.angle += this.angleSpeed;
    if (this.y > canvas.height) {
      this.y = -20;
      this.x = Math.random() * canvas.width;
    }
  }

  draw() {
    ctx.save();
    ctx.globalAlpha = this.opacity;
    ctx.fillStyle = this.color;
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.beginPath();
    if (this.isCircle) {
      ctx.arc(0, 0, this.size / 2, 0, Math.PI * 2);
    } else {
      ctx.rect(-this.size / 2, -this.size / 2, this.size, this.size);
    }
    ctx.fill();
    ctx.restore();
  }
}

function triggerConfetti() {
  particles = Array.from({ length: 120 }, () => new ConfettiParticle());
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  animateConfetti();
  
  // Stop after 6 seconds to save CPU
  setTimeout(() => {
    cancelAnimationFrame(animationFrameId);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles = [];
  }, 6000);
}

function animateConfetti() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  particles.forEach(p => {
    p.update();
    p.draw();
  });
  animationFrameId = requestAnimationFrame(animateConfetti);
}
