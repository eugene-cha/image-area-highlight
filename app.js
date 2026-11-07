const dropzone = document.getElementById('dropzone');
const placeholder = document.getElementById('placeholder');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const fileInput = document.getElementById('fileInput');
const colorInput = document.getElementById('colorInput');
const colorHex = document.getElementById('colorHex');
const widthInput = document.getElementById('widthInput');
const widthLabel = document.getElementById('widthLabel');
const dimInput = document.getElementById('dimInput');
const dimLabel = document.getElementById('dimLabel');
const undoBtn = document.getElementById('undoBtn');
const clearBtn = document.getElementById('clearBtn');
const resetImgBtn = document.getElementById('resetImgBtn');
const downloadBtn = document.getElementById('downloadBtn');
const boxList = document.getElementById('boxList');
const emptyNote = document.getElementById('emptyNote');
const filenameInput = document.getElementById('filenameInput');
const noticeEl = document.getElementById('notice');
const labelToggle = document.getElementById('labelToggle');

// 이 거리(px) 이하로만 움직이고 마우스를 놓으면 드래그가 아닌 클릭으로 본다.
const CLICK_MAX_MOVE = 4;

let currentImage = null;
let detectionData = null;
let detectionFor = null;
let boxes = [];
let dragging = false;
let currentBox = null;
let redoStack = [];

function setControlsEnabled(enabled) {
  undoBtn.disabled = enabled ? boxes.length === 0 : true;
  clearBtn.disabled = enabled ? boxes.length === 0 : true;
  resetImgBtn.disabled = !enabled;
  downloadBtn.disabled = !enabled;
}

function activateImage(img, initialBoxes) {
  currentImage = img;
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  boxes = initialBoxes ? initialBoxes.slice() : [];
  currentBox = null;
  placeholder.style.display = 'none';
  canvas.style.display = 'block';
  redraw();
  renderBoxList();
  setControlsEnabled(true);
}

function loadImage(source) {
  const img = new Image();
  img.onload = function () {
    activateImage(img);
    redoStack = [];
    if (typeof source === 'string' && source.startsWith('blob:')) {
      URL.revokeObjectURL(source);
    }
  };
  img.src = source;
}

function loadImageFromFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const url = URL.createObjectURL(file);
  loadImage(url);
}

fileInput.addEventListener('change', function () {
  if (fileInput.files && fileInput.files[0]) {
    loadImageFromFile(fileInput.files[0]);
  }
  fileInput.value = '';
});

['dragenter', 'dragover'].forEach(evt => {
  dropzone.addEventListener(evt, function (e) {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  });
});
['dragleave', 'drop'].forEach(evt => {
  dropzone.addEventListener(evt, function (e) {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
  });
});
dropzone.addEventListener('drop', function (e) {
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) loadImageFromFile(file);
});

window.addEventListener('paste', function (e) {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.indexOf('image') === 0) {
      const file = item.getAsFile();
      loadImageFromFile(file);
      e.preventDefault();
      break;
    }
  }
});

function getCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  let x = (clientX - rect.left) * scaleX;
  let y = (clientY - rect.top) * scaleY;
  x = Math.max(0, Math.min(canvas.width, x));
  y = Math.max(0, Math.min(canvas.height, y));
  return { x, y };
}

function normalizeBox(b) {
  const x = Math.min(b.x0, b.x1);
  const y = Math.min(b.y0, b.y1);
  const w = Math.abs(b.x1 - b.x0);
  const h = Math.abs(b.y1 - b.y0);
  return { x, y, w, h, color: b.color, lineWidth: b.lineWidth, labeled: b.labeled };
}

function redraw() {
  if (!currentImage) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(currentImage, 0, 0, canvas.width, canvas.height);

  const dimOpacity = Number(dimInput.value) / 100;
  ctx.save();
  ctx.fillStyle = `rgba(0, 0, 0, ${dimOpacity})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  const previewBox = currentBox ? normalizeBox(currentBox) : null;
  boxes.forEach(revealRegion);
  if (previewBox) revealRegion(previewBox);

  boxes.forEach(b => drawBoxBorder(b));

  // 번호 라벨은 번호가 붙은 박스끼리만 생성 순서대로 1, 2, 3... 으로 매긴다.
  let labelNo = 0;
  boxes.forEach(b => {
    if (b.labeled) drawLabelBadge(b, ++labelNo);
  });

  if (previewBox) drawSelectionMarquee(previewBox);
}

// 박스 좌측 상단 모서리에 붙는 번호 마크
function drawLabelBadge(b, number) {
  // 이미지 크기에 비례하되, 박스가 작으면 박스보다 커지지 않도록 줄인다.
  let fontSize = Math.max(14, Math.min(40, Math.round(canvas.width / 50)));
  fontSize = Math.max(8, Math.min(fontSize, Math.floor(b.h * 0.5), Math.floor(b.w * 0.5)));

  ctx.save();
  ctx.font = `bold ${fontSize}px "Segoe UI", "Malgun Gothic", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const text = String(number);
  const padX = Math.round(fontSize * 0.4);
  const badgeH = Math.round(fontSize * 1.5);
  const badgeW = Math.max(badgeH, Math.ceil(ctx.measureText(text).width) + padX * 2);

  ctx.fillStyle = b.color;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(b.x, b.y, badgeW, badgeH, Math.round(fontSize * 0.25));
  else ctx.rect(b.x, b.y, badgeW, badgeH);
  ctx.fill();

  ctx.fillStyle = readableTextColor(b.color);
  ctx.fillText(text, b.x + badgeW / 2, b.y + badgeH / 2 + 1);
  ctx.restore();
}

// 배경색(#rrggbb) 위에서 잘 보이는 글자색(흰색/검정)
function readableTextColor(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return '#ffffff';
  const [r, g, b] = [m[1], m[2], m[3]].map(v => parseInt(v, 16));
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#000000' : '#ffffff';
}

function revealRegion(b) {
  if (b.w <= 0 || b.h <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(b.x, b.y, b.w, b.h);
  ctx.clip();
  ctx.drawImage(currentImage, 0, 0, canvas.width, canvas.height);
  ctx.restore();
}

function drawBoxBorder(b) {
  ctx.save();
  ctx.strokeStyle = b.color;
  ctx.lineWidth = b.lineWidth;
  ctx.strokeRect(
      b.x + b.lineWidth / 2,
      b.y + b.lineWidth / 2,
      Math.max(b.w - b.lineWidth, 0),
      Math.max(b.h - b.lineWidth, 0)
  );
  ctx.restore();
}

function drawSelectionMarquee(b) {
  ctx.save();
  ctx.fillStyle = 'rgba(166, 220, 124, 0.28)';
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.strokeStyle = 'rgba(104, 178, 58, 0.95)';
  ctx.lineWidth = 1;
  ctx.strokeRect(b.x + 0.5, b.y + 0.5, Math.max(b.w - 1, 0), Math.max(b.h - 1, 0));
  ctx.restore();
}

function startDrag(e) {
  if (!currentImage) return;
  const pos = getCanvasPos(e);
  dragging = true;
  currentBox = {
    x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y,
    color: colorInput.value,
    lineWidth: Number(widthInput.value),
    labeled: labelToggle.checked   // 박스를 만드는 시점의 설정값을 박스에 저장
  };
  e.preventDefault();
}

function moveDrag(e) {
  if (!dragging) return;
  const pos = getCanvasPos(e);
  currentBox.x1 = pos.x;
  currentBox.y1 = pos.y;
  redraw();
  e.preventDefault();
}

function endDrag() {
  if (!dragging) return;
  dragging = false;
  const start = { x: currentBox.x0, y: currentBox.y0 };
  const style = { color: currentBox.color, lineWidth: currentBox.lineWidth, labeled: currentBox.labeled };
  const finalized = normalizeBox(currentBox);
  currentBox = null;
  if (finalized.w <= CLICK_MAX_MOVE && finalized.h <= CLICK_MAX_MOVE) {
    // 드래그 없이 클릭만 한 경우: 클릭 지점을 감싸는 테두리 박스를 자동 감지
    autoHighlightAt(start.x, start.y, style);
    return;
  }
  if (finalized.w > 3 && finalized.h > 3) {
    addBox(finalized);
  }
  redraw();
}

function addBox(box) {
  boxes.push(box);
  redoStack = [];
  renderBoxList();
  setControlsEnabled(true);
}

// 원본 이미지의 픽셀 데이터 (이미지가 바뀔 때만 다시 만든다)
function getDetectionData() {
  if (detectionFor === currentImage) return detectionData;
  detectionFor = currentImage;
  detectionData = null;
  try {
    const off = document.createElement('canvas');
    off.width = currentImage.naturalWidth;
    off.height = currentImage.naturalHeight;
    const offCtx = off.getContext('2d', { willReadFrequently: true });
    offCtx.drawImage(currentImage, 0, 0);
    detectionData = offCtx.getImageData(0, 0, off.width, off.height);
  } catch (err) {
    detectionData = null;
  }
  return detectionData;
}

function autoHighlightAt(x, y, style) {
  redraw();
  const data = getDetectionData();
  if (!data) {
    showNotice('이미지 데이터를 읽을 수 없어 자동 감지를 할 수 없습니다.');
    return;
  }
  const found = AutoDetect.detectBoxAt(data, x, y);
  if (!found) {
    showNotice('클릭한 위치에서 테두리 박스를 찾지 못했습니다.');
    return;
  }
  addBox({
    x: found.x, y: found.y, w: found.w, h: found.h,
    color: style.color, lineWidth: style.lineWidth, labeled: style.labeled
  });
  redraw();
}

let noticeTimer = null;
function showNotice(message) {
  noticeEl.textContent = message;
  noticeEl.classList.add('show');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => noticeEl.classList.remove('show'), 2000);
}

canvas.addEventListener('mousedown', startDrag);
window.addEventListener('mousemove', moveDrag);
window.addEventListener('mouseup', endDrag);
canvas.addEventListener('touchstart', startDrag, { passive: false });
canvas.addEventListener('touchmove', moveDrag, { passive: false });
canvas.addEventListener('touchend', endDrag);

function renderBoxList() {
  boxList.innerHTML = '';
  emptyNote.style.display = boxes.length === 0 ? 'block' : 'none';
  let labelNo = 0;
  boxes.forEach((b, i) => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    const labelText = b.labeled ? `  · 번호 ${++labelNo}` : '';
    span.textContent = `#${i + 1}  ${Math.round(b.w)}×${Math.round(b.h)} px${labelText}`;
    const del = document.createElement('button');
    del.textContent = '삭제';
    del.addEventListener('click', () => {
      boxes.splice(i, 1);
      redoStack = [];
      renderBoxList();
      setControlsEnabled(true);
      redraw();
    });
    li.appendChild(span);
    li.appendChild(del);
    boxList.appendChild(li);
  });
  undoBtn.disabled = boxes.length === 0;
  clearBtn.disabled = boxes.length === 0;
}

function updateRangeFill(input) {
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  const pct = ((Number(input.value) - min) / (max - min)) * 100;
  input.style.setProperty('--val', pct + '%');
}

[widthInput, dimInput].forEach(updateRangeFill);

colorInput.addEventListener('input', () => {
  colorHex.textContent = colorInput.value.toUpperCase();
});

widthInput.addEventListener('input', () => {
  widthLabel.textContent = widthInput.value;
  updateRangeFill(widthInput);
});

dimInput.addEventListener('input', () => {
  dimLabel.textContent = dimInput.value;
  updateRangeFill(dimInput);
  redraw();
});

function resetImage() {
  currentImage = null;
  boxes = [];
  currentBox = null;
  canvas.style.display = 'none';
  placeholder.style.display = 'block';
  setControlsEnabled(false);
  renderBoxList();
}

function performUndo() {
  if (boxes.length > 0) {
    const box = boxes.pop();
    redoStack.push({ type: 'box', box });
    renderBoxList();
    redraw();
  } else if (currentImage) {
    redoStack.push({ type: 'image', image: currentImage, boxes: boxes.slice() });
    resetImage();
  }
}

function performRedo() {
  if (redoStack.length === 0) return;
  const action = redoStack.pop();
  if (action.type === 'box') {
    boxes.push(action.box);
    renderBoxList();
    redraw();
    setControlsEnabled(true);
  } else if (action.type === 'image') {
    activateImage(action.image, action.boxes);
  }
}

undoBtn.addEventListener('click', performUndo);

window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  if (e.key.toLowerCase() === 'z') {
    e.preventDefault();
    performUndo();
  } else if (e.key.toLowerCase() === 'y') {
    e.preventDefault();
    performRedo();
  }
});

clearBtn.addEventListener('click', () => {
  boxes = [];
  redoStack = [];
  renderBoxList();
  redraw();
});

resetImgBtn.addEventListener('click', () => {
  redoStack = [];
  resetImage();
});

function buildDownloadFilename() {
  const DEFAULT_NAME = 'image';
  const raw = filenameInput.value.trim().replace(/[\\/:*?"<>|]/g, '');
  const base = raw || DEFAULT_NAME;
  return /\.png$/i.test(base) ? base : `${base}.png`;
}

downloadBtn.addEventListener('click', () => {
  if (!currentImage) return;
  const link = document.createElement('a');
  link.download = buildDownloadFilename();
  link.href = canvas.toDataURL('image/png');
  link.click();
});

// ---- 사이드바: 위치(좌/우), 전체 접기, 구역(작업 패널/단축키 가이드) 펼침·접힘 ----
const appEl = document.getElementById('app');
const sidebarEl = document.getElementById('sidebar');
const sideButtons = document.querySelectorAll('.seg button[data-side]');
const collapseBtn = document.getElementById('sidebarCollapseBtn');
const accHeads = document.querySelectorAll('.acc-head');
const themeBtn = document.getElementById('themeBtn');

// 사용자 설정은 브라우저에 저장한다. (저장이 막힌 환경에서는 저장 없이 동작)
function readPref(key) {
  try { return localStorage.getItem(key); } catch (err) { return null; }
}
function writePref(key, value) {
  try { localStorage.setItem(key, value); } catch (err) { /* 무시 */ }
}

function setSidebarSide(side, persist) {
  if (side !== 'left' && side !== 'right') side = 'left';
  appEl.dataset.sidebar = side;
  sideButtons.forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.side === side)));
  updateCollapseArrow();
  if (persist) writePref('sidebarSide', side);
}

// 펼친 상태에서는 가까운 화면 가장자리 쪽(접히는 방향), 접힌 상태에서는 반대쪽(펼쳐지는 방향) 화살표
function updateCollapseArrow() {
  const edgeIsLeft = appEl.dataset.sidebar === 'left';
  const collapsed = sidebarEl.dataset.collapsed === 'true';
  collapseBtn.dataset.dir = (edgeIsLeft !== collapsed) ? 'left' : 'right';
}

function setSidebarCollapsed(collapsed, persist) {
  sidebarEl.dataset.collapsed = String(collapsed);
  const label = collapsed ? '사이드바 펼치기' : '사이드바 접기';
  collapseBtn.setAttribute('aria-expanded', String(!collapsed));
  collapseBtn.setAttribute('aria-label', label);
  collapseBtn.title = label;
  updateCollapseArrow();
  if (persist) writePref('sidebarCollapsed', collapsed ? '1' : '0');
}

function setAccordion(head, open, persist) {
  head.setAttribute('aria-expanded', String(open));
  document.getElementById(head.getAttribute('aria-controls')).hidden = !open;
  if (persist) writePref('acc:' + head.id, open ? '1' : '0');
}

// 테마(다크/라이트). 첫 페인트 전 적용은 index.html 의 head 스크립트가 담당한다.
function updateThemeButton() {
  const isDark = document.documentElement.dataset.theme === 'dark';
  const label = isDark ? '라이트 모드로 전환' : '다크 모드로 전환';
  themeBtn.setAttribute('aria-label', label);
  themeBtn.title = label;
}

function setTheme(theme, persist) {
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  updateThemeButton();
  if (persist) writePref('theme', document.documentElement.dataset.theme);
}

themeBtn.addEventListener('click', () => {
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true);
});

sideButtons.forEach(btn => btn.addEventListener('click', () => setSidebarSide(btn.dataset.side, true)));
collapseBtn.addEventListener('click', () => {
  setSidebarCollapsed(sidebarEl.dataset.collapsed !== 'true', true);
});
accHeads.forEach(head => {
  head.addEventListener('click', () => {
    setAccordion(head, head.getAttribute('aria-expanded') !== 'true', true);
  });
});

// 저장된 설정 복원 (없으면 다크, 좌측, 펼침, 모든 구역 열림)
updateThemeButton();
setSidebarSide(readPref('sidebarSide'), false);
setSidebarCollapsed(readPref('sidebarCollapsed') === '1', false);
accHeads.forEach(head => {
  const saved = readPref('acc:' + head.id);
  setAccordion(head, saved === null ? true : saved === '1', false);
});

setControlsEnabled(false);
