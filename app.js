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

let currentImage = null;
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
  return { x, y, w, h, color: b.color, lineWidth: b.lineWidth };
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
  if (previewBox) drawSelectionMarquee(previewBox);
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
  ctx.fillStyle = 'rgba(92, 173, 128, 0.20)';
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.strokeStyle = 'rgba(92, 173, 128, 0.9)';
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
    lineWidth: Number(widthInput.value)
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
  const finalized = normalizeBox(currentBox);
  currentBox = null;
  if (finalized.w > 3 && finalized.h > 3) {
    boxes.push(finalized);
    redoStack = [];
    renderBoxList();
    setControlsEnabled(true);
  }
  redraw();
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
  boxes.forEach((b, i) => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = `#${i + 1}  ${Math.round(b.w)}×${Math.round(b.h)} px`;
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

setControlsEnabled(false);
