/* Reels Klip Düzenleyici — tamamen tarayıcıda çalışan 9:16 klip düzenleme aracı.
 * Oyun + kamera modu: seçilen kamera bölgesi üstte, oyun bölgesi altta (vstack).
 * Sadece kamera modu: seçilen bölge 9:16 olarak ekranı doldurur.
 * Video işleme: ffmpeg.wasm (vendor/ffmpeg altında, tamamen yerel; hiçbir şey yüklenmez).
 */
'use strict';

const OUT_W = 1080, OUT_H = 1920, FPS = 30;
const PROFILE_KEY = 'reelsmaker.profile.v1';

// ---------------------------------------------------------------- durum
const state = {
  files: [],        // {id, file, name, url, meta:{w,h,dur}|null, settings|null, status, outUrl, outName, outSize}
  currentId: null,
  rendering: false,
};
let nextId = 1;

const engine = { ffmpeg: null, mt: false, loaded: false, loading: null, logs: [] };
let renderingItem = null;      // ilerleme olayının bağlanacağı kuyruk öğesi
let renderExpectedDur = 0;

// ---------------------------------------------------------------- DOM
const $ = (id) => document.getElementById(id);
const els = {
  engineStatus: $('engineStatus'),
  dropZone: $('dropZone'), fileInput: $('fileInput'),
  queue: $('queue'), batchBar: $('batchBar'),
  applyAllBtn: $('applyAllBtn'), renderAllBtn: $('renderAllBtn'),
  editorSection: $('editorSection'), editName: $('editName'),
  stage: $('stage'), video: $('video'),
  camBox: $('camBox'), gameBox: $('gameBox'),
  playBtn: $('playBtn'), seek: $('seek'), timeLabel: $('timeLabel'),
  preview: $('preview'),
  ratioCtl: $('ratioCtl'), camRatio: $('camRatio'), ratioVal: $('ratioVal'),
  trimStart: $('trimStart'), trimEnd: $('trimEnd'),
  setStartBtn: $('setStartBtn'), setEndBtn: $('setEndBtn'),
  loudnorm: $('loudnorm'), res: $('res'), speed: $('speed'),
  renderBtn: $('renderBtn'),
  resultSection: $('resultSection'), results: $('results'),
};

// ---------------------------------------------------------------- yardımcılar
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const even = (v) => Math.max(2, 2 * Math.round(v / 2));

function fmtTime(sec) {
  if (!isFinite(sec)) return '0:00';
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function parseTime(str) {
  if (!str) return null;
  str = String(str).trim().replace(',', '.');
  if (!str) return null;
  const parts = str.split(':').map(Number);
  if (parts.some((p) => isNaN(p) || p < 0)) return null;
  let s = 0;
  for (const p of parts) s = s * 60 + p;
  return s;
}

function fmtSize(bytes) {
  return bytes > 1024 * 1024
    ? (bytes / 1024 / 1024).toFixed(1) + ' MB'
    : Math.round(bytes / 1024) + ' KB';
}

// ---------------------------------------------------------------- ayarlar / profil
// Kutu dikdörtgenleri kaynak videoya göre 0..1 oranlarında saklanır,
// böylece aynı düzen farklı çözünürlükteki kliplere de uygulanabilir.

function defaultSettings() {
  return {
    mode: 'gamecam',
    camRatio: 0.35,                                    // dikey çıktının ne kadarı kamera
    cam:     { x: 0.02, y: 0.55, w: 0.28, h: 0.28 },   // tipik sol-alt facecam
    game:    { x: 0,    y: 0,    w: 1,    h: 1    },
    camOnly: { x: 0.36, y: 0,    w: 0.28, h: 1    },
    trimStart: '', trimEnd: '',
    loudnorm: true, res: '1080', speed: 'fast',
  };
}

function loadProfile() {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY));
    if (p && p.cam && p.game && p.camOnly) return { ...defaultSettings(), ...p, trimStart: '', trimEnd: '' };
  } catch { /* bozuk profil yok sayılır */ }
  return null;
}

function saveProfile(s) {
  const { trimStart, trimEnd, ...rest } = s;
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(rest)); } catch { /* dolu olabilir */ }
}

function newSettings() {
  const cur = currentFile();
  if (cur && cur.settings) return JSON.parse(JSON.stringify({ ...cur.settings, trimStart: '', trimEnd: '' }));
  return loadProfile() || defaultSettings();
}

// Çıktıdaki yuvaların en-boy oranları (genişlik/yükseklik)
function slotAspect(s, which) {
  if (which === 'camOnly') return OUT_W / OUT_H;
  const camH = s.camRatio * OUT_H;
  return which === 'cam' ? OUT_W / camH : OUT_W / (OUT_H - camH);
}

// Dikdörtgeni verilen en-boy oranına kilitle ve kare içinde tut (oransal koordinatlarda).
function lockRect(r, aspect, meta) {
  const { w: vw, h: vh } = meta;
  let wPx = clamp(r.w * vw, 16, vw);
  let hPx = wPx / aspect;
  if (hPx > vh) { hPx = vh; wPx = hPx * aspect; }
  r.w = wPx / vw; r.h = hPx / vh;
  r.x = clamp(r.x, 0, 1 - r.w);
  r.y = clamp(r.y, 0, 1 - r.h);
  return r;
}

function currentFile() {
  return state.files.find((f) => f.id === state.currentId) || null;
}

// ---------------------------------------------------------------- dosya kuyruğu
function addFiles(fileList) {
  for (const file of fileList) {
    if (!file.type.startsWith('video/') && !/\.(mp4|mov|mkv|webm|m4v|avi)$/i.test(file.name)) continue;
    state.files.push({
      id: nextId++,
      file,
      name: file.name,
      url: URL.createObjectURL(file),
      meta: null,
      settings: newSettings(),
      status: 'ready',   // ready | rendering | done | error
      progress: 0,
      error: null,
      outUrl: null, outName: null, outSize: 0,
    });
  }
  renderQueue();
  if (!state.currentId && state.files.length) selectFile(state.files[0].id);
}

function removeFile(id) {
  const i = state.files.findIndex((f) => f.id === id);
  if (i < 0) return;
  const f = state.files[i];
  URL.revokeObjectURL(f.url);
  if (f.outUrl) URL.revokeObjectURL(f.outUrl);
  state.files.splice(i, 1);
  if (state.currentId === id) {
    state.currentId = null;
    if (state.files.length) selectFile(state.files[0].id);
    else els.editorSection.classList.add('hidden');
  }
  renderQueue(); renderResults();
}

function statusText(f) {
  switch (f.status) {
    case 'rendering': return `⚙️ %${Math.round(f.progress * 100)}`;
    case 'done': return '✅ hazır';
    case 'error': return '❌ hata';
    default: return f.settings ? '• bekliyor' : '';
  }
}

function renderQueue() {
  els.queue.innerHTML = '';
  for (const f of state.files) {
    const li = document.createElement('li');
    li.className = f.id === state.currentId ? 'active' : '';
    li.dataset.id = f.id;

    const name = document.createElement('span');
    name.className = 'qname'; name.textContent = f.name;

    const meta = document.createElement('span');
    meta.className = 'qmeta';
    meta.textContent = f.meta ? `${f.meta.w}×${f.meta.h} · ${fmtTime(f.meta.dur)}` : '';

    const status = document.createElement('span');
    status.className = 'qstatus' + (f.status === 'done' ? ' done' : f.status === 'error' ? ' err' : '');
    status.textContent = statusText(f);

    li.append(name, meta);
    if (f.status === 'rendering') {
      const bar = document.createElement('span'); bar.className = 'qbar';
      const fill = document.createElement('i'); fill.style.width = `${f.progress * 100}%`;
      bar.append(fill); li.append(bar);
    }
    li.append(status);

    const del = document.createElement('button');
    del.className = 'qdel'; del.textContent = '✕'; del.title = 'Listeden çıkar';
    del.addEventListener('click', (e) => { e.stopPropagation(); removeFile(f.id); });
    li.append(del);

    li.addEventListener('click', () => selectFile(f.id));
    els.queue.append(li);
  }
  els.batchBar.classList.toggle('hidden', state.files.length === 0);
  els.renderAllBtn.textContent = `🚀 Tümünü hazırla (${state.files.filter((f) => f.status !== 'done').length})`;
  els.renderAllBtn.disabled = state.rendering || state.files.every((f) => f.status === 'done');
  els.applyAllBtn.disabled = state.rendering || state.files.length < 2;
}

function updateQueueItem(f) {
  const li = els.queue.querySelector(`li[data-id="${f.id}"]`);
  if (!li) { renderQueue(); return; }
  renderQueue(); // basit tutmak için tamamen yeniden çiz (liste küçük)
}

// ---------------------------------------------------------------- editör
function selectFile(id) {
  const f = state.files.find((x) => x.id === id);
  if (!f) return;
  state.currentId = id;
  els.editorSection.classList.remove('hidden');
  els.editName.textContent = f.name;
  els.video.src = f.url;
  els.video.pause();
  els.playBtn.textContent = '▶';
  renderQueue();
  // meta yüklendiğinde applyMeta çağrılır (video 'loadedmetadata' dinleyicisi)
}

function applySettingsToUI(f) {
  const s = f.settings;
  document.querySelectorAll('input[name=mode]').forEach((r) => { r.checked = r.value === s.mode; });
  els.camRatio.value = Math.round(s.camRatio * 100);
  els.ratioVal.textContent = `${Math.round(s.camRatio * 100)}%`;
  els.trimStart.value = s.trimStart || '';
  els.trimEnd.value = s.trimEnd || '';
  els.loudnorm.checked = s.loudnorm;
  els.res.value = s.res;
  els.speed.value = s.speed;
  syncModeUI(f);
  layoutBoxes(f);
}

function syncModeUI(f) {
  const s = f.settings;
  els.ratioCtl.classList.toggle('hidden', s.mode !== 'gamecam');
  els.gameBox.classList.toggle('hidden', s.mode !== 'gamecam');
}

// Saklanan oransal dikdörtgenleri ekrandaki kutu konumlarına dönüştür.
function layoutBoxes(f) {
  if (!f || !f.meta) return;
  const s = f.settings;
  const rect = els.video.getBoundingClientRect();
  const dw = rect.width, dh = rect.height;
  if (dw < 4) return;

  const place = (box, r, aspect) => {
    lockRect(r, aspect, f.meta);
    box.style.left = `${r.x * dw}px`;
    box.style.top = `${r.y * dh}px`;
    box.style.width = `${r.w * dw}px`;
    box.style.height = `${r.h * dh}px`;
  };

  if (s.mode === 'gamecam') {
    place(els.camBox, s.cam, slotAspect(s, 'cam'));
    place(els.gameBox, s.game, slotAspect(s, 'game'));
  } else {
    place(els.camBox, s.camOnly, slotAspect(s, 'camOnly'));
  }
}

function settingsChanged(save = true) {
  const f = currentFile();
  if (!f) return;
  layoutBoxes(f);
  if (save) saveProfile(f.settings);
  renderQueue();
}

// ---- kutu sürükleme / boyutlandırma ----
function setupBox(box, rectName) {
  let drag = null;

  const onDown = (e, resize) => {
    const f = currentFile();
    if (!f || !f.meta) return;
    e.preventDefault(); e.stopPropagation();
    const s = f.settings;
    const r = rectName === 'auto' ? (s.mode === 'gamecam' ? s.cam : s.camOnly) : s[rectName];
    drag = { r, resize, startX: e.clientX, startY: e.clientY, orig: { ...r } };
    box.setPointerCapture(e.pointerId);
  };

  box.addEventListener('pointerdown', (e) => {
    onDown(e, e.target.classList.contains('handle'));
  });

  box.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const f = currentFile();
    if (!f || !f.meta) return;
    const s = f.settings;
    const rect = els.video.getBoundingClientRect();
    const dx = (e.clientX - drag.startX) / rect.width;
    const dy = (e.clientY - drag.startY) / rect.height;
    const r = drag.r;
    const which = r === s.cam ? 'cam' : r === s.game ? 'game' : 'camOnly';
    const aspect = slotAspect(s, which);

    if (drag.resize) {
      r.w = clamp(drag.orig.w + dx, 0.03, 1);
      lockRect(r, aspect, f.meta);
    } else {
      r.x = clamp(drag.orig.x + dx, 0, 1 - r.w);
      r.y = clamp(drag.orig.y + dy, 0, 1 - r.h);
    }
    layoutBoxes(f);
  });

  const end = () => { if (drag) { drag = null; settingsChanged(); } };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
}

// ---------------------------------------------------------------- önizleme
function drawPreview() {
  const f = currentFile();
  const ctx = els.preview.getContext('2d');
  const W = els.preview.width, H = els.preview.height;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  if (f && f.meta && els.video.readyState >= 2) {
    const s = f.settings;
    const { w: vw, h: vh } = f.meta;
    const src = (r) => [r.x * vw, r.y * vh, r.w * vw, r.h * vh];
    try {
      if (s.mode === 'gamecam') {
        const camH = Math.round(H * s.camRatio);
        ctx.drawImage(els.video, ...src(s.cam), 0, 0, W, camH);
        ctx.drawImage(els.video, ...src(s.game), 0, camH, W, H - camH);
      } else {
        ctx.drawImage(els.video, ...src(s.camOnly), 0, 0, W, H);
      }
    } catch { /* kare henüz çizilemiyor */ }
  }
  requestAnimationFrame(drawPreview);
}

// ---------------------------------------------------------------- ffmpeg motoru
function setEngineStatus(text, cls = '') {
  els.engineStatus.textContent = text;
  els.engineStatus.className = 'engine ' + cls;
}

async function loadEngine() {
  const forceSt = new URLSearchParams(location.search).has('st'); // hata ayıklama: tek çekirdeğe zorla
  const mt = !forceSt && window.crossOriginIsolated === true && typeof SharedArrayBuffer !== 'undefined';
  const ffmpeg = new FFmpegWASM.FFmpeg();
  ffmpeg.on('log', ({ message }) => {
    engine.logs.push(message);
    if (engine.logs.length > 400) engine.logs.shift();
  });
  ffmpeg.on('progress', ({ time }) => {
    if (!renderingItem || !renderExpectedDur) return;
    renderingItem.progress = clamp((time / 1e6) / renderExpectedDur, 0, 1);
    updateQueueItem(renderingItem);
  });
  const base = new URL(`vendor/ffmpeg/${mt ? 'core-mt' : 'core-st'}/`, location.href).href;
  setEngineStatus('⏳ Video motoru yükleniyor (~31 MB, yalnızca ilk sefer)…');
  await ffmpeg.load({
    coreURL: base + 'ffmpeg-core.js',
    wasmURL: base + 'ffmpeg-core.wasm',
    ...(mt ? { workerURL: base + 'ffmpeg-core.worker.js' } : {}),
  });
  engine.ffmpeg = ffmpeg;
  engine.mt = mt;
  engine.loaded = true;
  setEngineStatus(
    mt ? `✅ Motor hazır — ⚡ çok çekirdekli (${navigator.hardwareConcurrency || '?'} çekirdek)`
       : '✅ Motor hazır — 🐢 tek çekirdek (yine de çalışır, sadece yavaştır)',
    'ok'
  );
}

function ensureEngine() {
  if (!engine.loading) {
    engine.loading = loadEngine().catch((err) => {
      engine.loading = null;
      setEngineStatus('❌ Video motoru yüklenemedi: ' + err.message, 'err');
      throw err;
    });
  }
  return engine.loading;
}

// ---------------------------------------------------------------- ffmpeg argümanları
function cropArgs(r, meta) {
  const { w: vw, h: vh } = meta;
  let cw = even(r.w * vw), ch = even(r.h * vh);
  let cx = even(r.x * vw) , cy = even(r.y * vh);
  cw = Math.min(cw, even(vw)); ch = Math.min(ch, even(vh));
  cx = clamp(cx, 0, vw - cw); cy = clamp(cy, 0, vh - ch);
  return `crop=${cw}:${ch}:${cx}:${cy}`;
}

function buildArgs(f, inName, outName, hasAudio) {
  const s = f.settings, meta = f.meta;
  const outW = s.res === '720' ? 720 : 1080;
  const outH = outW / 9 * 16;

  const args = ['-hide_banner', '-y'];
  const ts = parseTime(s.trimStart) || 0;
  let te = parseTime(s.trimEnd);
  if (te != null && te <= ts) te = null;
  if (ts > 0) args.push('-ss', ts.toFixed(3));
  args.push('-i', inName);
  if (te != null) args.push('-t', (te - ts).toFixed(3));

  let filter;
  if (s.mode === 'gamecam') {
    const camH = even(outH * s.camRatio);
    const gameH = outH - camH;
    lockRect(s.cam, slotAspect(s, 'cam'), meta);
    lockRect(s.game, slotAspect(s, 'game'), meta);
    filter =
      `[0:v]${cropArgs(s.cam, meta)},scale=${outW}:${camH},setsar=1[cam];` +
      `[0:v]${cropArgs(s.game, meta)},scale=${outW}:${gameH},setsar=1[game];` +
      `[cam][game]vstack=inputs=2,fps=${FPS},format=yuv420p[v]`;
  } else {
    lockRect(s.camOnly, slotAspect(s, 'camOnly'), meta);
    filter = `[0:v]${cropArgs(s.camOnly, meta)},scale=${outW}:${outH},setsar=1,fps=${FPS},format=yuv420p[v]`;
  }

  args.push('-filter_complex', filter, '-map', '[v]');
  if (hasAudio) {
    args.push('-map', '0:a:0');
    if (s.loudnorm) args.push('-af', 'loudnorm=I=-16:TP=-1.5:LRA=11');
    args.push('-c:a', 'aac', '-b:a', '160k', '-ar', '48000');
  } else {
    args.push('-an');
  }
  const fast = s.speed === 'fast';
  args.push(
    '-c:v', 'libx264',
    '-preset', fast ? 'ultrafast' : 'veryfast',
    '-crf', fast ? '23' : '21',
    '-movflags', '+faststart',
    outName
  );
  return { args, dur: (te != null ? te : meta.dur) - ts };
}

// ---------------------------------------------------------------- işleme
async function renderFile(f) {
  await ensureEngine();
  const ff = engine.ffmpeg;
  const ext = (f.name.match(/\.(\w+)$/) || [, 'mp4'])[1];
  const inName = `in_${f.id}.${ext}`;
  const outName = `out_${f.id}.mp4`;

  f.status = 'rendering'; f.progress = 0; f.error = null;
  renderingItem = f;
  updateQueueItem(f);

  try {
    await ff.writeFile(inName, new Uint8Array(await f.file.arrayBuffer()));

    // Akışları incele (yalnızca metadata okur, hızlıdır): ses var mı,
    // ve tarayıcı videoyu oynatamadıysa çözünürlük/süre bilgisini buradan al.
    engine.logs.length = 0;
    await ff.exec(['-hide_banner', '-i', inName]).catch(() => {});
    const probeLog = engine.logs.join('\n');
    const hasAudio = /Stream #0:\d+.*Audio/.test(probeLog);
    if (!f.meta) {
      const vm = probeLog.match(/Video:.*?\s(\d{2,5})x(\d{2,5})/);
      const dm = probeLog.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
      if (!vm) throw new Error('Videoda görüntü akışı bulunamadı');
      f.meta = {
        w: Number(vm[1]), h: Number(vm[2]),
        dur: dm ? Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3]) : 0,
      };
    }

    const { args, dur } = buildArgs(f, inName, outName, hasAudio);
    renderExpectedDur = dur;
    engine.logs.length = 0;
    const code = await ff.exec(args);
    if (code !== 0) {
      throw new Error('ffmpeg hata kodu ' + code + ' — ' + engine.logs.slice(-6).join(' | '));
    }

    const data = await ff.readFile(outName);
    const blob = new Blob([data.buffer], { type: 'video/mp4' });
    if (f.outUrl) URL.revokeObjectURL(f.outUrl);
    f.outUrl = URL.createObjectURL(blob);
    f.outName = f.name.replace(/\.\w+$/, '') + '_reels.mp4';
    f.outSize = blob.size;
    f.status = 'done'; f.progress = 1;
  } catch (err) {
    f.status = 'error';
    f.error = err.message || String(err);
    console.error('Render hatası:', err);
  } finally {
    renderingItem = null;
    await ff.deleteFile(inName).catch(() => {});
    await ff.deleteFile(outName).catch(() => {});
    updateQueueItem(f);
    renderResults();
  }
}

async function renderMany(files) {
  if (state.rendering) return;
  state.rendering = true;
  els.renderBtn.disabled = true;
  renderQueue();
  try {
    for (const f of files) {
      if (f.status === 'rendering') continue;
      await renderFile(f);
    }
  } finally {
    state.rendering = false;
    els.renderBtn.disabled = false;
    renderQueue();
  }
}

function renderResults() {
  const done = state.files.filter((f) => f.status === 'done' || f.status === 'error');
  els.resultSection.classList.toggle('hidden', done.length === 0);
  els.results.innerHTML = '';
  for (const f of done) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'rname';
    name.textContent = f.status === 'done' ? f.outName : f.name;
    li.append(name);
    if (f.status === 'done') {
      const size = document.createElement('span');
      size.className = 'rsize';
      size.textContent = `${fmtSize(f.outSize)} · 9:16`;
      const a = document.createElement('a');
      a.className = 'btn primary'; a.textContent = '⬇️ İndir';
      a.href = f.outUrl; a.download = f.outName;
      li.append(size, a);
    } else {
      const err = document.createElement('span');
      err.className = 'rsize'; err.style.color = 'var(--err)';
      err.textContent = f.error;
      li.append(err);
    }
    els.results.append(li);
  }
}

// ---------------------------------------------------------------- olay bağlama
function bindEvents() {
  // dosya seçimi
  els.dropZone.addEventListener('click', () => els.fileInput.click());
  els.dropZone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') els.fileInput.click(); });
  els.fileInput.addEventListener('change', () => { addFiles(els.fileInput.files); els.fileInput.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) =>
    els.dropZone.addEventListener(ev, (e) => { e.preventDefault(); els.dropZone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    els.dropZone.addEventListener(ev, (e) => { e.preventDefault(); els.dropZone.classList.remove('drag'); }));
  els.dropZone.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

  // video meta + oynatma
  els.video.addEventListener('loadedmetadata', () => {
    const f = currentFile();
    if (!f) return;
    f.meta = { w: els.video.videoWidth, h: els.video.videoHeight, dur: els.video.duration };
    els.seek.max = f.meta.dur;
    els.video.currentTime = Math.min(1, f.meta.dur / 2);
    applySettingsToUI(f);
    renderQueue();
  });
  els.video.addEventListener('error', () => {
    const f = currentFile();
    if (f && !f.meta) {
      document.querySelector('.stage-hint').textContent =
        '⚠️ Bu video tarayıcıda önizlenemiyor (codec desteği yok); yine de “Hazırla” ile işlenebilir — bölge seçimi için kayıtlı düzen kullanılır.';
    }
  });
  els.video.addEventListener('timeupdate', () => {
    els.seek.value = els.video.currentTime;
    els.timeLabel.textContent = fmtTime(els.video.currentTime);
  });
  els.playBtn.addEventListener('click', () => {
    if (els.video.paused) { els.video.play(); els.playBtn.textContent = '⏸'; }
    else { els.video.pause(); els.playBtn.textContent = '▶'; }
  });
  els.seek.addEventListener('input', () => { els.video.currentTime = Number(els.seek.value); });

  // mod
  document.querySelectorAll('input[name=mode]').forEach((r) =>
    r.addEventListener('change', () => {
      const f = currentFile();
      if (!f) return;
      f.settings.mode = r.value;
      syncModeUI(f);
      settingsChanged();
    }));

  // kamera alanı oranı
  els.camRatio.addEventListener('input', () => {
    const f = currentFile();
    if (!f) return;
    f.settings.camRatio = Number(els.camRatio.value) / 100;
    els.ratioVal.textContent = `${els.camRatio.value}%`;
    settingsChanged();
  });

  // kırpma
  const trimChanged = () => {
    const f = currentFile();
    if (!f) return;
    f.settings.trimStart = els.trimStart.value.trim();
    f.settings.trimEnd = els.trimEnd.value.trim();
  };
  els.trimStart.addEventListener('change', trimChanged);
  els.trimEnd.addEventListener('change', trimChanged);
  els.setStartBtn.addEventListener('click', () => { els.trimStart.value = fmtTime(els.video.currentTime); trimChanged(); });
  els.setEndBtn.addEventListener('click', () => { els.trimEnd.value = fmtTime(els.video.currentTime); trimChanged(); });

  // diğer ayarlar
  els.loudnorm.addEventListener('change', () => { const f = currentFile(); if (f) { f.settings.loudnorm = els.loudnorm.checked; saveProfile(f.settings); } });
  els.res.addEventListener('change', () => { const f = currentFile(); if (f) { f.settings.res = els.res.value; saveProfile(f.settings); } });
  els.speed.addEventListener('change', () => { const f = currentFile(); if (f) { f.settings.speed = els.speed.value; saveProfile(f.settings); } });

  // düzeni tümüne uygula
  els.applyAllBtn.addEventListener('click', () => {
    const cur = currentFile();
    if (!cur || !cur.settings) return;
    for (const f of state.files) {
      if (f.id === cur.id) continue;
      const { trimStart, trimEnd } = f.settings || {};
      f.settings = JSON.parse(JSON.stringify(cur.settings));
      f.settings.trimStart = trimStart || '';
      f.settings.trimEnd = trimEnd || '';
    }
    renderQueue();
    els.applyAllBtn.textContent = '✅ Uygulandı';
    setTimeout(() => { els.applyAllBtn.textContent = '📋 Bu düzeni tüm kliplere uygula'; }, 1500);
  });

  // işle
  els.renderBtn.addEventListener('click', () => {
    const f = currentFile();
    if (f) renderMany([f]);
  });
  els.renderAllBtn.addEventListener('click', () => {
    renderMany(state.files.filter((f) => f.status !== 'done'));
  });

  // pencere boyutu değişince kutuları yeniden konumlandır
  new ResizeObserver(() => layoutBoxes(currentFile())).observe(els.stage);

  setupBox(els.camBox, 'auto');
  setupBox(els.gameBox, 'game');
}

// ---------------------------------------------------------------- başlat
bindEvents();
requestAnimationFrame(drawPreview);
ensureEngine().catch(() => { /* durum çubuğunda gösterildi */ });

// otomatik testler için küçük bir kanca (normal kullanımı etkilemez)
window.__reels = { state, engine, currentFile, applySettingsToUI, renderMany };
