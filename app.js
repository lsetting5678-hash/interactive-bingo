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
let studentLastReportedLines = -1;
let studentLastReportedBingo = false;

// Standard Word Pools & Themes
const WORD_POOLS = {
  numbers: [], // Will generate dynamically based on size
  patterns: [], // Will generate based on selected categories
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

const PATTERN_THEMES = {
  animals: ["🐶","🐱","🦁","🐯","🐼","🐨","🐻","🦊","🐰","🐵","🐔","🐧","🐦","🐤","🦆","🦅","🦉","🦇","🐺","🐗","🐴","🦄","🐝","🐛","🦋","🐙","🦑","🦞","🦀","🐠"],
  fruits: ["🍎","🍏","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🫐","🍈","🍒","🍑","🥭","🍍","🥥","🥝","🍅","🍆","🥑","🥦","🥬","🥒","🌶️","🌽","🥕","🥔","🍠","🥐","🍞"],
  weather: ["☀️","🌤️","⛅","🌥️","☁️","🌦️","🌧️","⛈️","🌩️","🌨️","❄️","💨","💧","⚡","🌈","🌊","🌀","☄️","🔥","🌟","🌙","🪐","🌍","✨","⚡","☔","☂️","🌫️","🌁","🌌"],
  vehicles: ["🚗","🚕","🚙","🚌","🚎","🏎️","🚓","🚑","🚒","🚐","🛻","🚚","🚛","🚜","🚲","🛵","🏍️","🛺","🚃","🚋","🚂","🚇","🚊","🚁","✈️","🚀","🛸","⛵","🚢","⚓"]
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
  const containers = {
    numbers: document.getElementById("numbers-input-container"),
    words: document.getElementById("words-input-container"),
    patterns: document.getElementById("patterns-input-container"),
    alphabet: document.getElementById("alphabet-input-container"),
    zhuyin: document.getElementById("zhuyin-input-container")
  };
  
  typeBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      typeBtns.forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      teacherContentType = btn.getAttribute("data-value");
      
      // Toggle visibility of each container
      Object.keys(containers).forEach(key => {
        if (containers[key]) {
          containers[key].style.display = (key === teacherContentType) ? "block" : "none";
        }
      });
    });
  });

  // Patterns checkbox theme preview logic
  function updatePatternPreview() {
    const previewEl = document.getElementById("patterns-preview-list");
    if (!previewEl) return;
    
    let selectedEmojis = [];
    if (document.getElementById("pattern-theme-animals").checked) {
      selectedEmojis = selectedEmojis.concat(PATTERN_THEMES.animals);
    }
    if (document.getElementById("pattern-theme-fruits").checked) {
      selectedEmojis = selectedEmojis.concat(PATTERN_THEMES.fruits);
    }
    if (document.getElementById("pattern-theme-weather").checked) {
      selectedEmojis = selectedEmojis.concat(PATTERN_THEMES.weather);
    }
    if (document.getElementById("pattern-theme-vehicles").checked) {
      selectedEmojis = selectedEmojis.concat(PATTERN_THEMES.vehicles);
    }
    
    if (selectedEmojis.length === 0) {
      previewEl.textContent = "（請選擇主題）";
    } else {
      previewEl.textContent = selectedEmojis.join(" ");
    }
  }

  // Hook event listeners to pattern checkboxes
  const patternCheckboxes = document.querySelectorAll(".pattern-theme-checkbox");
  patternCheckboxes.forEach(cb => {
    cb.addEventListener("change", updatePatternPreview);
  });
  
  // Initialize pattern preview
  updatePatternPreview();

  // Initialize zhuyin preview
  const zhuyinPreview = document.getElementById("zhuyin-preview-list");
  if (zhuyinPreview) {
    zhuyinPreview.textContent = WORD_POOLS.zhuyin.join(" ");
  }

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
    
    // Make the page extremely clean (only show seat number input and join button)
    document.getElementById("student-join-title").style.display = "none";
    document.getElementById("student-room-group").style.display = "none";
    document.getElementById("student-back-btn-container").style.display = "none";
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
    const minVal = parseInt(document.getElementById("setup-number-min").value);
    const maxVal = parseInt(document.getElementById("setup-number-max").value);
    if (isNaN(minVal) || isNaN(maxVal)) {
      alert("請輸入正確的數字範圍！");
      return;
    }
    if (minVal > maxVal) {
      alert("開始數字不能大於結束數字！");
      return;
    }
    const count = maxVal - minVal + 1;
    if (count < minNeeded) {
      alert(`數字範圍數量不足！${teacherGridSize}x${teacherGridSize} 網格至少需要 ${minNeeded} 個數字（目前範圍內只有 ${count} 個數字）。`);
      return;
    }
    teacherWordPool = Array.from({ length: count }, (_, i) => (minVal + i).toString());
  } 
  else if (teacherContentType === "patterns") {
    let selectedEmojis = [];
    if (document.getElementById("pattern-theme-animals").checked) {
      selectedEmojis = selectedEmojis.concat(PATTERN_THEMES.animals);
    }
    if (document.getElementById("pattern-theme-fruits").checked) {
      selectedEmojis = selectedEmojis.concat(PATTERN_THEMES.fruits);
    }
    if (document.getElementById("pattern-theme-weather").checked) {
      selectedEmojis = selectedEmojis.concat(PATTERN_THEMES.weather);
    }
    if (document.getElementById("pattern-theme-vehicles").checked) {
      selectedEmojis = selectedEmojis.concat(PATTERN_THEMES.vehicles);
    }
    
    if (selectedEmojis.length === 0) {
      alert("請至少選擇一個圖案主題！");
      return;
    }
    
    if (selectedEmojis.length < minNeeded) {
      alert(`圖案數量不足！目前選擇的主題總共只有 ${selectedEmojis.length} 個圖案，但 ${teacherGridSize}x${teacherGridSize} 網格需要至少 ${minNeeded} 個。`);
      return;
    }
    
    // Use unique emojis and shuffle them
    teacherWordPool = [...new Set(selectedEmojis)].sort(() => 0.5 - Math.random());
  }
  else if (teacherContentType === "alphabet") {
    const alphabetCase = document.getElementById("setup-alphabet-case").value;
    if (alphabetCase === "lowercase") {
      teacherWordPool = WORD_POOLS.alphabet.map(letter => letter.toLowerCase());
    } else {
      teacherWordPool = [...WORD_POOLS.alphabet];
    }
    
    if (teacherWordPool.length < minNeeded) {
      alert(`字母數量不足！英文字母只有 26 個，不夠填滿 ${teacherGridSize}x${teacherGridSize} 的賓果盤。`);
      return;
    }
  }
  else if (teacherContentType === "zhuyin") {
    teacherWordPool = [...WORD_POOLS.zhuyin];
    if (teacherWordPool.length < minNeeded) {
      alert(`注音符號數量不足！注音符號只有 37 個，不夠填滿 ${teacherGridSize}x${teacherGridSize} 的賓果盤。`);
      return;
    }
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

  updateRankingList();
  navigateTo("screen-teacher-game");
}

// Speak a word out loud using Web Speech API
function speakWord(word) {
  if ('speechSynthesis' in window) {
    // Cancel ongoing speech to prevent queue build-up
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = 'zh-TW';
    utterance.rate = 0.85; // Slightly slower for classroom clarity
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  }
}

// Draw a word
function drawWord(word) {
  if (teacherDrawnWords.includes(word)) return; // already drawn
  
  teacherDrawnWords.push(word);
  document.getElementById("last-drawn-word").textContent = word;

  // Speak drawn word
  speakWord(word);

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
  drawWord(randomWord);
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

  if (!roomInput || roomInput.length !== 4) {
    alert("找不到遊戲房號！請使用平板重新掃描老師畫面的二維條碼 (QR Code) 加入遊戲。");
    return;
  }
  if (!nameInput) {
    alert("請輸入您的座號！");
    return;
  }

  roomId = roomInput;
  username = nameInput + " 號"; // Auto append "號" to seat number

  document.getElementById("lobby-room-id-s").textContent = roomId;
  document.getElementById("student-name-badge").textContent = username;
  document.getElementById("game-student-name").textContent = username;

  // Reset student states
  studentMarkedIndices.clear();
  studentDrawnWords.clear();
  studentHasWon = false;
  studentLastReportedLines = -1;
  studentLastReportedBingo = false;

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

  // Only report status to teacher if lines count or bingo status has changed
  if (linesCount !== studentLastReportedLines || isBingo !== studentLastReportedBingo) {
    studentLastReportedLines = linesCount;
    studentLastReportedBingo = isBingo;
    
    publishMessage(`bingo/${roomId}/student_status`, {
      id: mqttClient.options.clientId,
      name: username,
      lines: linesCount,
      bingo: isBingo
    });
  }
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

// ==========================================
// 教科書生字範本與 OCR 影像辨識邏輯
// ==========================================

const PRESET_VOCABULARY = {
  math_terms: ["因數", "倍數", "公因數", "公倍數", "長方體", "正方體", "表面積", "體積", "百分率", "折線圖", "對稱軸", "對稱點", "線對稱", "質數", "合數", "互質", "最大公因數", "最小公倍數", "最簡分數", "等值分數", "擴分", "約分", "通分", "真分數", "假分數"],
  mandarin_l1: ["手", "足", "口", "耳", "目", "語", "言", "自", "由", "大", "家", "好", "開", "心", "上", "學", "讀", "書", "寫", "字", "畫", "圖", "朋", "友", "玩"],
  mandarin_l2: ["春", "夏", "秋", "冬", "花", "草", "山", "石", "田", "水", "天", "地", "人", "日", "月", "風", "雨", "雷", "電", "雲", "霧", "雪", "霜", "冰", "川"],
  english_fruits: ["Apple", "Banana", "Orange", "Watermelon", "Grape", "Cherry", "Strawberry", "Pineapple", "Mango", "Peach", "Pear", "Lemon", "Lime", "Coconut", "Kiwi", "Melon", "Papaya", "Plum", "Fig", "Guava", "Avocado", "Blueberry", "Raspberry", "Tomato", "Lychee"],
  english_animals: ["Lion", "Tiger", "Bear", "Rabbit", "Monkey", "Elephant", "Zebra", "Giraffe", "Hippopotamus", "Kangaroo", "Panda", "Koala", "Fox", "Wolf", "Deer", "Squirrel", "Dog", "Cat", "Mouse", "Sheep", "Cow", "Horse", "Pig", "Chicken", "Duck"],
  special_edu_cognitive: ["杯子", "牙刷", "衣服", "書包", "鞋子", "椅子", "桌子", "湯匙", "筷子", "碗", "盤子", "床", "枕頭", "棉被", "毛巾", "肥皂", "鏡子", "梳子", "電視", "電話", "冰箱", "電風扇", "時鐘", "門", "窗戶"]
};

function loadPresetWords(presetKey) {
  const textarea = document.getElementById("setup-custom-words");
  if (!textarea) return;
  if (!presetKey) {
    textarea.value = "";
    return;
  }
  const words = PRESET_VOCABULARY[presetKey];
  if (words) {
    textarea.value = words.join(", ");
  }
}

function triggerOcrUpload() {
  const fileInput = document.getElementById("ocr-file-input");
  if (fileInput) {
    fileInput.click();
  }
}

async function handleOcrFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const statusContainer = document.getElementById("ocr-status-container");
  const statusText = document.getElementById("ocr-status-text");
  const progressFill = document.getElementById("ocr-progress-fill");
  const percentageText = document.getElementById("ocr-percentage");
  const textarea = document.getElementById("setup-custom-words");

  if (statusContainer) statusContainer.style.display = "block";
  if (statusText) statusText.textContent = "載入辨識引擎中...";
  if (progressFill) progressFill.style.width = "0%";
  if (percentageText) percentageText.textContent = "0%";

  try {
    // Perform recognition using Tesseract.js
    const result = await Tesseract.recognize(
      file,
      'chi_tra+eng', // Traditional Chinese + English
      {
        logger: m => {
          console.log(m);
          if (m.status === 'recognizing text') {
            const percentage = Math.round(m.progress * 100);
            if (statusText) statusText.textContent = "正在辨識圖片生字中...";
            if (progressFill) progressFill.style.width = percentage + "%";
            if (percentageText) percentageText.textContent = percentage + "%";
          } else if (m.status === 'loading tesseract core' || m.status === 'initializing api') {
            if (statusText) statusText.textContent = "初始化繁中/英文辨識引擎...";
            if (progressFill) progressFill.style.width = "20%";
            if (percentageText) percentageText.textContent = "20%";
          }
        }
      }
    );

    const text = result.data.text;
    console.log("OCR Extracted Text:", text);

    // Filter and clean extracted text
    const regex = /[\s,，.。;；!！?？、()（）\-\[\]{}<>\"\'\\\/]+/g;
    const rawTokens = text.split(regex);
    
    // Filter tokens: keep Chinese characters (1-8 chars) and English words (2-12 chars)
    const cleanedWords = [];
    rawTokens.forEach(token => {
      const cleanToken = token.trim();
      if (!cleanToken) return;
      
      // If it is Chinese characters
      if (/^[\u4e00-\u9fa5]{1,8}$/.test(cleanToken)) {
        cleanedWords.push(cleanToken);
      }
      // If it is English words
      else if (/^[A-Za-z]{2,12}$/.test(cleanToken)) {
        cleanedWords.push(cleanToken);
      }
    });

    // Remove duplicates
    const uniqueWords = [...new Set(cleanedWords)];

    if (uniqueWords.length === 0) {
      alert("圖片中未偵測到足夠的生字，請重新拍攝清晰、正向的課本文字照片！");
      if (statusText) statusText.textContent = "辨識失敗。";
    } else {
      if (statusText) statusText.textContent = `成功辨識出 ${uniqueWords.length} 個生字！`;
      if (progressFill) progressFill.style.width = "100%";
      if (percentageText) percentageText.textContent = "100%";
      
      // Append values in textarea
      if (textarea) {
        if (textarea.value.trim()) {
          textarea.value += ", " + uniqueWords.join(", ");
        } else {
          textarea.value = uniqueWords.join(", ");
        }
      }
    }
  } catch (error) {
    console.error("OCR Error:", error);
    alert("生字辨識發生錯誤，請檢查網路是否通暢並重試！");
    if (statusText) statusText.textContent = "辨識發生錯誤。";
  } finally {
    // Reset file input value so same file can be uploaded again
    event.target.value = "";
  }
}
