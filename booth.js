'use strict';
/* 네컷 사진관 – 촬영 · 합성 · 4×6 인쇄 · QR 다운로드 */
const APP_VERSION = '2026.11.01';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pad2 = n => String(n).padStart(2, '0');
const W = 1200, H = 1800;                 // 합성 이미지 (2:3 비율, 4×6 인치 @300dpi)
const FONT = '"Jua","Apple SD Gothic Neo","Malgun Gothic",sans-serif';
const CLIP_FPS = 10, CLIP_SEC = 3;        // 움직이는 네컷: 셔터 직전 3초
const CLOUD_FOLDER = 'fourcut';           // Cloudinary 안의 사진 폴더 (download.js와 같아야 함)

/* ---------- 설정 ---------- */
const PAPERS = {
  selphy: {w:100,   h:148},              // 캐논 SELPHY 4×6(엽서) 용지 실제 크기
  inch:   {w:101.6, h:152.4},            // 정확한 4×6 인치
};
const DEFAULTS = {
  deviceId:'', mirror:true, countdown:10, shots:8, limit:60, voice:true,
  paper:'selphy', scale:100, offX:0, offY:0, cutGuide:true, printQR:true, eventName:'', paperLeft:null,
  upload:'cloudinary', cloudName:'y8ws9zmi', cloudPreset:'fourcut', imgbbKey:'', imgbbExpire:604800,
  keepDays:7, liveVideo:true, pageUrl:'', captionOnCustom:false, pin:'',
};
let settings = {...DEFAULTS};
try { Object.assign(settings, JSON.parse(localStorage.getItem('fourcut-settings') || '{}')); } catch {}
if (!['cloudinary', 'imgbb', 'off'].includes(settings.upload)) settings.upload = 'cloudinary';   // 예전 tmpfiles 설정 정리
if (!settings.cloudName) settings.cloudName = DEFAULTS.cloudName;
if (!settings.cloudPreset) settings.cloudPreset = DEFAULTS.cloudPreset;
if (!PAPERS[settings.paper]) settings.paper = DEFAULTS.paper;
function saveSettings(){ try { localStorage.setItem('fourcut-settings', JSON.stringify(settings)); } catch {} }

let stats = {day:'', sessions:0, prints:0, total:0};
try { Object.assign(stats, JSON.parse(localStorage.getItem('fourcut-stats') || '{}')); } catch {}
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; };
function bump(kind, n = 1){
  if (stats.day !== todayStr()) Object.assign(stats, {day: todayStr(), sessions: 0, prints: 0});
  stats[kind] += n;
  if (kind === 'prints') stats.total += n;
  try { localStorage.setItem('fourcut-stats', JSON.stringify(stats)); } catch {}
}

/* ---------- 상태 ---------- */
const state = {layout:'strip', copies:1, shots:[], selected:[], frame:'white', filter:'none', text:'우리의 순간', showDate:true, finalUrl:null};
let session = 0;
let printing = false;

/* ---------- 프레임 / 필터 ---------- */
const FRAMES = [
  {id:'white',    name:'화이트', bg:'#ffffff', ink:'#222222'},
  {id:'black',    name:'블랙',   bg:'#111111', ink:'#ffffff'},
  {id:'pink',     name:'핑크',   bg:'#ffc9d9', ink:'#7a2a45'},
  {id:'sky',      name:'스카이', bg:'#bfe0ff', ink:'#1f4a7a'},
  {id:'lavender', name:'라벤더', bg:'#dccdfc', ink:'#4a2f86'},
  {id:'mint',     name:'민트',   bg:'#c8f0de', ink:'#1e5e47'},
  {id:'butter',   name:'버터',   bg:'#fff0a8', ink:'#6b5400'},
  {id:'checker',  name:'체크',   type:'checker', c1:'#ffd6e2', c2:'#ffffff', ink:'#7a2a45',
    css:'repeating-conic-gradient(#ffd6e2 0 25%,#fff 0 50%) 0 0/20px 20px'},
  {id:'dots',     name:'도트',   type:'dots', bg:'#fffaf2', ink:'#444444',
    css:'radial-gradient(#ff9ab8 22%,transparent 26%) 0 0/14px 14px,radial-gradient(#8ccaff 22%,transparent 26%) 7px 7px/14px 14px,#fffaf2'},
  {id:'aurora',   name:'오로라', type:'gradient', stops:['#ffc3d8','#d9c6ff','#bde3ff'], ink:'#3d2f6b',
    css:'linear-gradient(#ffc3d8,#d9c6ff,#bde3ff)'},
  {id:'film',     name:'필름',   type:'film', bg:'#141414', ink:'#f2f2f2',
    css:'repeating-linear-gradient(#141414 0 6px,#eee 6px 10px) left/8px 100% no-repeat,repeating-linear-gradient(#141414 0 6px,#eee 6px 10px) right/8px 100% no-repeat,#141414'},
];
const FILTERS = [
  {id:'none',   name:'원본',   css:'none'},
  {id:'bright', name:'뽀샤시', css:'brightness(1.12) contrast(0.92) saturate(1.08)'},
  {id:'bw',     name:'흑백',   css:'grayscale(1) contrast(1.12) brightness(1.04)'},
  {id:'warm',   name:'따뜻한', css:'sepia(0.3) saturate(1.25) brightness(1.04)'},
  {id:'cool',   name:'시원한', css:'saturate(0.9) hue-rotate(-12deg) brightness(1.06)'},
  {id:'film',   name:'필름',   css:'contrast(1.15) saturate(0.75) sepia(0.15)'},
];
const PRESETS = ['우리의 순간','HAPPY DAY','BEST FRIENDS','♥ LOVE ♥','오늘도 맑음','(문구 없음)'];
let customFrames = [];                    // 관리자가 올린 학교·행사 프레임

const framesFor = layout => [...customFrames.filter(f => f.layout === layout), ...FRAMES];
const frameById = (id, layout) => framesFor(layout).find(f => f.id === id) || FRAMES[0];
const defaultFrame = layout => (customFrames.find(f => f.layout === layout) || FRAMES[0]).id;
const currentLook = () => ({layout:state.layout, frame:frameById(state.frame, state.layout), filter:state.filter, text:state.text, showDate:state.showDate});

/* ---------- 레이아웃 (1200×1800 좌표) ---------- */
function slots(layout){
  const s = [];
  if (layout === 'strip') {               // 2×6 스트립 두 줄
    for (let k = 0; k < 2; k++) for (let i = 0; i < 4; i++)
      s.push({x:k*600+28, y:36+i*376, w:544, h:360, i});
  } else {                                // 2×2 그리드
    for (let i = 0; i < 4; i++)
      s.push({x:44+(i%2)*568, y:44+Math.floor(i/2)*724, w:544, h:700, i});
  }
  return s;
}
const aspect = () => state.layout === 'strip' ? 544/360 : 544/700;
// 아래 문구 영역 (qs = 인쇄할 QR 크기, 0이면 QR 없음)
function captionAreas(layout, qs){
  if (layout === 'strip') return [0, 600].map(ox => {
    if (!qs) return {cx:ox+300, top:1524, bottom:1800, maxW:520, big:false};
    const qx = ox + 572 - qs, qy = Math.round(1524 + (276 - qs) / 2), left = ox + 28, right = qx - 18;
    return {cx:(left+right)/2, top:1524, bottom:1800, maxW:right-left-8, big:false, qr:{x:qx, y:qy}};
  });
  if (!qs) return [{cx:600, top:1468, bottom:1800, maxW:1000, big:true}];
  const qx = 1156 - qs, qy = Math.round(1468 + (332 - qs) / 2), left = 44, right = qx - 28;
  return [{cx:(left+right)/2, top:1468, bottom:1800, maxW:right-left-10, big:true, qr:{x:qx, y:qy}}];
}

/* ---------- QR ---------- */
const qrCache = new Map();
function qrMatrix(text, ecc){
  const key = ecc + '|' + text;
  let m = qrCache.get(key);
  if (!m) {
    const q = qrcode(0, ecc); q.addData(text); q.make();
    const n = q.getModuleCount(), bits = new Uint8Array(n * n);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) bits[r*n+c] = q.isDark(r, c) ? 1 : 0;
    m = {n, bits};
    if (qrCache.size > 30) qrCache.clear();
    qrCache.set(key, m);
  }
  return m;
}
// 인쇄용 QR 크기: 모듈 한 칸이 0.3mm 이상이 되도록
function qrPrintSize(layout, text){
  const n = qrMatrix(text, 'L').n, max = layout === 'strip' ? 180 : 236;
  const cell = Math.max(2, Math.min(layout === 'strip' ? 4 : 5, Math.floor(max / (n + 4))));
  return cell * (n + 4);
}
function drawQRBlock(ctx, text, x, y, size, ecc = 'L'){
  const {n, bits} = qrMatrix(text, ecc);
  const cell = Math.floor(size / (n + 4)), off = Math.floor((size - cell * n) / 2);
  ctx.save();
  ctx.filter = 'none'; ctx.globalAlpha = 1;
  ctx.fillStyle = '#fff'; roundRect(ctx, x, y, size, size, Math.round(size * .07));
  ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++)
    if (bits[r*n+c]) ctx.fillRect(x + off + c*cell, y + off + r*cell, cell, cell);
  ctx.restore();
}
function drawQRCanvas(canvas, text){
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawQRBlock(ctx, text, 0, 0, canvas.width, 'M');
}

/* ---------- 합성 ---------- */
function drawBackground(ctx, f, layout){
  if (f.type === 'checker') {
    ctx.fillStyle = f.c2; ctx.fillRect(0,0,W,H); ctx.fillStyle = f.c1;
    const q = 50;
    for (let y = 0; y < H; y += q) for (let x = 0; x < W; x += q)
      if (((x+y)/q) % 2 === 0) ctx.fillRect(x,y,q,q);
  } else if (f.type === 'dots') {
    ctx.fillStyle = f.bg; ctx.fillRect(0,0,W,H);
    const pal = ['#ff9ab8','#8ccaff','#ffd36e','#9be3c4','#c6a8ff'];
    let n = 0;
    for (let y = 20; y < H; y += 44) for (let x = (y/44)%2 ? 42 : 20; x < W; x += 44) {
      ctx.fillStyle = pal[n++ % pal.length];
      ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI*2); ctx.fill();
    }
  } else if (f.type === 'gradient') {
    const g = ctx.createLinearGradient(0,0,W*0.3,H);
    f.stops.forEach((c,i) => g.addColorStop(i/(f.stops.length-1), c));
    ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
  } else {
    ctx.fillStyle = f.bg; ctx.fillRect(0,0,W,H);
  }
  if (f.type === 'film') {
    ctx.fillStyle = '#efefef';
    const cols = layout === 'strip' ? [[0,600],[600,600]] : [[0,1200]];
    for (const [ox,cw] of cols) for (let y = 14; y < H-20; y += 34) {
      roundRect(ctx, ox+7, y, 12, 18, 3); roundRect(ctx, ox+cw-19, y, 12, 18, 3);
    }
  }
}
function roundRect(ctx,x,y,w,h,r){ ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x,y,w,h,r) : ctx.rect(x,y,w,h); ctx.fill(); }
function drawCover(ctx, img, x, y, w, h){
  const iw = img.width, ih = img.height, s = Math.max(w/iw, h/ih);
  const sw = w/s, sh = h/s;
  ctx.drawImage(img, (iw-sw)/2, (ih-sh)/2, sw, sh, x, y, w, h);
}
function drawFrameImage(ctx, f){ try { ctx.drawImage(f.img, 0, 0, W, H); } catch {} }
const dateStr = () => { const d = new Date(); return `${d.getFullYear()}.${pad2(d.getMonth()+1)}.${pad2(d.getDate())}`; };
function fitFont(ctx, text, size, maxW, min = 20){
  ctx.font = `${size}px ${FONT}`;
  while (ctx.measureText(text).width > maxW && size > min) { size -= 2; ctx.font = `${size}px ${FONT}`; }
  return size;
}
function drawCaption(ctx, a, ink, look){
  const lines = [], title = (look.text || '').trim(), ev = (settings.eventName || '').trim();
  if (title) lines.push({t:title, s:fitFont(ctx, title, a.big ? 92 : 62, a.maxW), al:1});
  if (look.showDate) lines.push({t:dateStr(), s:a.big ? 36 : 28, al:.72});
  if (ev) lines.push({t:ev, s:fitFont(ctx, ev, a.big ? 32 : 24, a.maxW, 14), al:.6});
  if (!lines.length) return;
  const gap = a.big ? 16 : 10;
  let y = (a.top + a.bottom) / 2 - (lines.reduce((s, l) => s + l.s, 0) + gap * (lines.length - 1)) / 2;
  ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const l of lines) {
    ctx.globalAlpha = l.al; ctx.font = `${l.s}px ${FONT}`;
    ctx.fillText(l.t, a.cx, y + l.s / 2);
    y += l.s + gap;
  }
  ctx.globalAlpha = 1;
}

function render(ctx, {photos, forPrint = false, qrText = null, look = currentLook()}){
  const f = look.frame, flt = FILTERS.find(x => x.id === look.filter) || FILTERS[0];
  ctx.save(); ctx.clearRect(0,0,W,H);
  if (f.type === 'custom') {
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,W,H);
    if (!f.overlay) drawFrameImage(ctx, f);
  } else drawBackground(ctx, f, look.layout);
  for (const s of slots(look.layout)) {
    const img = photos[s.i];
    if (img) {
      ctx.filter = flt.css; drawCover(ctx, img, s.x, s.y, s.w, s.h); ctx.filter = 'none';
    } else {
      ctx.fillStyle = 'rgba(128,128,128,.25)'; ctx.fillRect(s.x, s.y, s.w, s.h);
      ctx.fillStyle = 'rgba(80,80,80,.6)'; ctx.font = `90px ${FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(s.i+1), s.x+s.w/2, s.y+s.h/2);
    }
  }
  if (f.type === 'custom' && f.overlay) drawFrameImage(ctx, f);
  const qs = qrText ? qrPrintSize(look.layout, qrText) : 0;
  const areas = captionAreas(look.layout, qs);
  if (f.type !== 'custom' || settings.captionOnCustom) for (const a of areas) drawCaption(ctx, a, f.ink, look);
  if (qs) for (const a of areas) drawQRBlock(ctx, qrText, a.qr.x, a.qr.y, qs);
  if (forPrint && look.layout === 'strip' && settings.cutGuide) {
    ctx.strokeStyle = 'rgba(128,128,128,.7)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(600,0); ctx.lineTo(600,22); ctx.moveTo(600,H-22); ctx.lineTo(600,H); ctx.stroke();
  }
  ctx.restore();
}
const chosenPhotos = () => [0,1,2,3].map(i => state.shots[state.selected[i]] || null);

/* ---------- 화면 전환 / 타이머 ---------- */
let timerId = null;
function show(id){
  clearTimer();
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === id));
}
function clearTimer(){
  clearInterval(timerId); timerId = null;
  $$('[data-timer]').forEach(t => { t.textContent = ''; t.style.visibility = 'hidden'; t.classList.remove('warn'); });
}
function startTimer(sec, onDone){
  clearTimer();
  if (!sec) return;
  const el = $('.screen.active [data-timer]');
  let left = sec;
  const paint = () => { if (el) { el.style.visibility = 'visible'; el.textContent = left; el.classList.toggle('warn', left <= 10); } };
  paint();
  timerId = setInterval(() => { left--; paint(); if (left <= 0) { clearTimer(); onDone(); } }, 1000);
}
function goHome(){
  session++;
  printing = false;
  clearSessionWatch();
  stopClip();
  stopCamera();
  try { speechSynthesis.cancel(); } catch {}
  state.shots = []; state.selected = []; state.finalUrl = null;
  $('#finalImg').removeAttribute('src');
  $('#printArea').innerHTML = '';
  show('s-start');
  paintStatus();
}
function toast(text, ms = 3000){
  const t = $('#toast'); t.textContent = text; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms);
}

/* ---------- 화면 꺼짐 방지 · 마우스 커서 숨김 ---------- */
async function keepAwake(){ try { await navigator.wakeLock?.request('screen'); } catch {} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });
let cursorTimer = null;
document.addEventListener('mousemove', () => {
  document.body.classList.remove('nocursor');
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => document.body.classList.add('nocursor'), 3000);
}, {passive:true});

/* ---------- 소리 · 음성 안내 ---------- */
let actx;
function audio(){ try { actx = actx || new (window.AudioContext||window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); return actx; } catch { return null; } }
function beep(freq, dur = .1, vol = .15){
  const a = audio(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  o.frequency.value = freq; g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(.001, a.currentTime + dur);
  o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + dur);
}
function shutterSound(){
  const a = audio(); if (!a) return;
  const len = a.sampleRate * .15, buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random()*2-1) * Math.pow(1-i/len, 3);
  const src = a.createBufferSource(), g = a.createGain(); g.gain.value = .5;
  src.buffer = buf; src.connect(g).connect(a.destination); src.start();
}
let koVoices = [];
function loadVoices(){ try { koVoices = speechSynthesis.getVoices().filter(v => /^ko/i.test(v.lang)); } catch {} }
if ('speechSynthesis' in window) { loadVoices(); speechSynthesis.addEventListener?.('voiceschanged', loadVoices); }
function say(text){
  if (!settings.voice || !koVoices.length) return;
  try {
    // 인터넷이 되면 자연스러운 Google 음성, 아니면 PC에 설치된 음성
    const v = (navigator.onLine && koVoices.find(x => /Google/i.test(x.name))) || koVoices.find(x => x.localService) || koVoices[0];
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = v; u.lang = v.lang; u.rate = 1.05;
    speechSynthesis.speak(u);
  } catch {}
}

/* ---------- 카메라 ---------- */
const video = $('#video');
let stream = null;
async function startCamera(){
  if (!(stream && stream.active)) {
    const base = {audio:false, video:{width:{ideal:1920}, height:{ideal:1080}}};
    let s;
    if (settings.deviceId) {
      try { s = await navigator.mediaDevices.getUserMedia({audio:false, video:{...base.video, deviceId:{exact:settings.deviceId}}}); }
      catch {}                            // 고른 카메라가 없으면 기본 카메라로
    }
    if (!s) s = await navigator.mediaDevices.getUserMedia(base);
    stream = s;
    s.getVideoTracks().forEach(t => t.addEventListener('ended', () => { if (stream === s) stopCamera(); }));
    video.srcObject = s;
  }
  if (video.paused) await video.play().catch(() => {});
  if (!video.videoWidth) await Promise.race([new Promise(r => video.addEventListener('loadedmetadata', r, {once:true})), sleep(4000)]);
}
function stopCamera(){ if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; video.srcObject = null; }
const cameraReady = () => !!(stream && stream.active && video.videoWidth);
async function ensureCamera(sid){
  for (let i = 0; i < 12; i++) {
    if (sid !== session) return false;
    if (cameraReady()) return true;
    if (stream && !stream.active) stopCamera();
    try { await startCamera(); if (cameraReady()) return true; } catch {}
    $('#shootMsg').textContent = '카메라 연결을 기다리고 있어요…';
    await sleep(1500);
  }
  return false;
}
// 영상 프레임을 원하는 비율로 가운데 잘라서 그림 (거울 모드 반영)
function drawCrop(x, outW, outH){
  const vw = video.videoWidth, vh = video.videoHeight, a = outW / outH;
  let sw = vw, sh = vw / a;
  if (sh > vh) { sh = vh; sw = vh * a; }
  x.save();
  if (settings.mirror) { x.translate(outW, 0); x.scale(-1, 1); }
  x.drawImage(video, (vw-sw)/2, (vh-sh)/2, sw, sh, 0, 0, outW, outH);
  x.restore();
}
function capture(){
  const a = aspect();
  const srcW = Math.min(video.videoWidth, video.videoHeight * a);
  const outW = Math.min(1400, Math.round(srcW)), outH = Math.round(outW / a);
  const c = document.createElement('canvas'); c.width = outW; c.height = outH;
  drawCrop(c.getContext('2d'), outW, outH);
  c.url = c.toDataURL('image/jpeg', .9);
  return c;
}

/* ---------- 움직이는 네컷: 셔터 직전 프레임 모으기 ---------- */
let clipTimer = null, clipJobs = null;
const liveEnabled = () => settings.liveVideo && settings.upload === 'cloudinary' && !!window.MediaRecorder && !!HTMLCanvasElement.prototype.captureStream;
function startClip(){
  stopClip();
  if (!liveEnabled()) return;
  clipJobs = [];
  const cw = 400, ch = Math.round(cw / aspect());
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const x = c.getContext('2d');
  const grab = () => {
    if (!video.videoWidth || !clipJobs) return;
    drawCrop(x, cw, ch);
    clipJobs.push(new Promise(r => c.toBlob(r, 'image/jpeg', .8)));
  };
  grab();
  clipTimer = setInterval(grab, 1000 / CLIP_FPS);
}
function stopClip(){
  clearInterval(clipTimer); clipTimer = null;
  const jobs = clipJobs || []; clipJobs = null;
  return Promise.all(jobs).then(b => b.filter(Boolean).slice(-CLIP_FPS * CLIP_SEC));
}

/* ---------- 1. 시작 ---------- */
$('#s-start').addEventListener('click', e => {
  if (e.target.closest('#gear') || e.target.closest('#statusbar')) return;
  if ($('#settings').classList.contains('open')) return;
  audio(); keepAwake();
  Object.assign(state, {copies:1, filter:'none', text:'우리의 순간', showDate:true});
  state.layout = $('.choice.on').dataset.layout;
  state.frame = defaultFrame(state.layout);
  paintCopies();
  show('s-layout');
  startCamera().catch(() => {});        // 미리 켜 두면 촬영이 바로 시작됨
  startTimer(settings.limit ? 60 : 0, goHome);
});

/* ---------- 2. 프레임/매수 ---------- */
$$('.choice').forEach(b => b.addEventListener('click', () => {
  $$('.choice').forEach(x => x.classList.toggle('on', x === b));
  state.layout = b.dataset.layout;
  if (!framesFor(state.layout).some(f => f.id === state.frame)) state.frame = defaultFrame(state.layout);
  paintCopies();
}));
function paintCopies(){
  $('#copies').textContent = state.layout === 'strip' ? `${state.copies}장 (${state.copies*2}줄)` : `${state.copies}장`;
}
$('#minus').onclick = () => { state.copies = Math.max(1, state.copies-1); paintCopies(); };
$('#plus').onclick  = () => {
  state.copies = Math.min(5, state.copies+1);
  if (settings.paperLeft != null && state.copies > settings.paperLeft) toast(`남은 용지가 ${settings.paperLeft}장이에요`);
  paintCopies();
};
$('#toShoot').onclick = runShoot;

/* ---------- 3. 촬영 ---------- */
function freeze(url){
  const f = $('#freeze'); f.src = url; f.classList.add('show');
  setTimeout(() => f.classList.remove('show'), 900);
}
async function runShoot(){
  const sid = ++session;
  clearTimer();
  state.shots = []; state.selected = [];
  document.documentElement.style.setProperty('--ar', aspect());
  video.classList.toggle('mirror', settings.mirror);
  $('#thumbs').innerHTML = Array.from({length:settings.shots}, () => '<div></div>').join('');
  $('#count').textContent = '';
  $('#shotCounter').textContent = `1 / ${settings.shots}`;
  $('#shootMsg').textContent = '카메라를 준비하고 있어요';
  show('s-shoot');
  const fail = () => { if (sid === session) { alert('카메라를 사용할 수 없어요.\n카메라 연결과 권한을 확인해 주세요.'); goHome(); } };
  if (!await ensureCamera(sid)) return fail();
  bump('sessions');
  $('#shootMsg').textContent = '화면을 보고 포즈를 취해 주세요';
  say('카메라를 보면서 포즈를 취해 주세요');
  await sleep(1800);
  for (let n = 0; n < settings.shots; n++) {
    if (sid !== session) return;
    if (!cameraReady()) { if (!await ensureCamera(sid)) return fail(); $('#shootMsg').textContent = '화면을 보고 포즈를 취해 주세요'; }
    $('#shotCounter').textContent = `${n+1} / ${settings.shots}`;
    if (n === settings.shots - 1 && n > 0) say('마지막 사진이에요');
    for (let t = settings.countdown; t > 0; t--) {
      if (sid !== session) return;
      if (t === Math.min(CLIP_SEC, settings.countdown)) startClip();
      const el = $('#count'); el.textContent = t;
      el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
      if (t <= 3) beep(t === 1 ? 1046 : 880, .12);
      await sleep(1000);
    }
    if (sid !== session) return;
    $('#count').textContent = '';
    if (!cameraReady()) { stopClip(); n--; continue; }     // 카메라가 끊겼으면 이 컷을 다시 찍음
    const shot = capture();
    shot.clipP = stopClip();
    state.shots.push(shot);
    shutterSound();
    const fl = $('#flash'); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
    freeze(shot.url);
    $('#thumbs').children[n].innerHTML = `<img src="${shot.url}" alt="">`;
    await sleep(900);
  }
  if (sid !== session) return;
  stopCamera();
  goSelect();
}

/* ---------- 4. 사진 고르기 ---------- */
function goSelect(){
  const box = $('#shots');
  box.style.setProperty('--cols', state.layout === 'strip' ? (state.shots.length > 6 ? 4 : 3) : (state.shots.length > 8 ? 5 : 4));
  box.innerHTML = '';
  state.shots.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'shot';
    b.innerHTML = `<img src="${c.url}" alt=""><span class="badge"></span>`;
    b.onclick = () => toggleShot(i);
    box.appendChild(b);
  });
  paintSelect();
  show('s-select');
  say('마음에 드는 사진 네 장을 골라 주세요');
  startTimer(settings.limit, () => {
    for (let i = 0; state.selected.length < 4 && i < state.shots.length; i++)
      if (!state.selected.includes(i)) state.selected.push(i);
    goDeco();
  });
}
function toggleShot(i){
  const k = state.selected.indexOf(i);
  if (k >= 0) state.selected.splice(k, 1);
  else if (state.selected.length < 4) state.selected.push(i);
  else return;
  beep(660, .05, .08);
  paintSelect();
}
function paintSelect(){
  $$('#shots .shot').forEach((b, i) => {
    const k = state.selected.indexOf(i);
    b.classList.toggle('on', k >= 0);
    b.querySelector('.badge').textContent = k >= 0 ? k+1 : '';
  });
  $('#selInfo').textContent = `${state.selected.length} / 4 선택`;
  $('#toDeco').disabled = state.selected.length < 4;
  render($('#selPreview').getContext('2d'), {photos: chosenPhotos()});
}
$('#toDeco').onclick = goDeco;

/* ---------- 5. 꾸미기 ---------- */
function buildFrameSwatches(){
  const box = $('#frames'); box.innerHTML = '';
  for (const f of framesFor(state.layout)) {
    const b = document.createElement('button');
    b.className = 'sw' + (f.type === 'custom' ? ' custom' : '') + (state.frame === f.id ? ' on' : '');
    const i = document.createElement('i');
    i.style.background = f.type === 'custom' ? `#fff url("${f.thumb}") center/cover no-repeat` : (f.css || f.bg);
    b.append(i, document.createTextNode(f.name));
    b.onclick = () => {
      state.frame = f.id;
      $$('#frames .sw').forEach(x => x.classList.toggle('on', x === b));
      paintCaptionControls(); paintDeco();
    };
    box.appendChild(b);
  }
}
function paintCaptionControls(){
  $('#captionGroup').hidden = frameById(state.frame, state.layout).type === 'custom' && !settings.captionOnCustom;
}
function goDeco(){
  if (!framesFor(state.layout).some(f => f.id === state.frame)) state.frame = defaultFrame(state.layout);
  buildFrameSwatches();
  const first = state.shots[state.selected[0]];
  $('#filters').innerHTML = '';
  FILTERS.forEach(fl => {
    const b = document.createElement('button');
    b.className = 'flt' + (state.filter === fl.id ? ' on' : '');
    b.innerHTML = `<img src="${first.url}" style="filter:${fl.css}" alt=""><span>${fl.name}</span>`;
    b.onclick = () => { state.filter = fl.id; $$('.flt').forEach(x => x.classList.toggle('on', x === b)); paintDeco(); };
    $('#filters').appendChild(b);
  });
  $('#caption').value = state.text;
  $('#dateChip').classList.toggle('on', state.showDate);
  paintCaptionControls();
  paintDeco();
  show('s-deco');
  say('테두리와 필터를 골라 주세요');
  startTimer(settings.limit, doPrint);
}
// 미리보기에는 실제 인쇄와 같은 길이의 예시 QR을 그림
const previewQR = () => canPrintQR() ? shareLinkFor('261101abcdefghjk', liveEnabled()) : null;
function paintDeco(){ render($('#decoPreview').getContext('2d'), {photos: chosenPhotos(), qrText: previewQR()}); }

PRESETS.forEach(p => {
  const b = document.createElement('button');
  b.className = 'chip'; b.textContent = p;
  b.onclick = () => { state.text = p === '(문구 없음)' ? '' : p; $('#caption').value = state.text; paintDeco(); };
  $('#presets').appendChild(b);
});
$('#caption').addEventListener('input', e => { state.text = e.target.value.slice(0, 20); paintDeco(); });
$('#dateChip').onclick = () => { state.showDate = !state.showDate; $('#dateChip').classList.toggle('on', state.showDate); paintDeco(); };
$('#backSel').onclick = () => { show('s-select'); startTimer(settings.limit, goDeco); };
$('#printBtn').onclick = doPrint;

/* ---------- 6. 인쇄 ---------- */
function applyPaper(){
  const p = PAPERS[settings.paper] || PAPERS.selphy;
  $('#pageStyle').textContent = `@page{size:${p.w}mm ${p.h}mm;margin:0}`;
  const iw = Math.max(p.w, p.h * 2 / 3) * settings.scale / 100;        // 2:3 그림이 용지를 꽉 채우도록
  const pa = $('#printArea');
  pa.style.setProperty('--pw', p.w + 'mm');
  pa.style.setProperty('--ph', p.h + 'mm');
  pa.style.setProperty('--iw', iw.toFixed(2) + 'mm');
  pa.style.setProperty('--ih', (iw * 1.5).toFixed(2) + 'mm');
  pa.style.setProperty('--ox', settings.offX + 'mm');
  pa.style.setProperty('--oy', settings.offY + 'mm');
}
async function preparePrint(url, copies){
  applyPaper();
  const pa = $('#printArea');
  pa.innerHTML = '';
  for (let i = 0; i < copies; i++) {
    const d = document.createElement('div'); d.className = 'sheet';
    const img = new Image(); img.src = url; d.appendChild(img); pa.appendChild(d);
  }
  await Promise.all([...pa.querySelectorAll('img')].map(i => i.decode().catch(() => {})));
}
function setPrintMsg(text, busy){ const h = $('#printMsg'); h.textContent = text; h.classList.toggle('dots', !!busy); }
function qrUI(mode, text){
  const box = $('#qrBox');
  box.className = 'qrbox' + (mode === 'off' ? ' off' : mode === 'ready' ? ' ready' : mode === 'err' ? ' err' : '');
  const st = $('#qrState'); st.innerHTML = '';
  if (mode === 'wait') { const w = document.createElement('div'); w.innerHTML = '<div class="spinner"></div>'; w.append(text || ''); st.appendChild(w); }
  else if (mode === 'err') st.textContent = text || '';
}
function qrNote(text, cls){ const n = $('#qrNote'); n.textContent = text || ''; n.className = 'qrnote' + (cls ? ' ' + cls : ''); }
function showQR(link, withVideo){
  drawQRCanvas($('#qr'), link);
  qrUI('ready');
  $('#qrCap').innerHTML = withVideo
    ? '휴대폰 카메라로 QR 코드를 찍으면<br><b>사진과 움직이는 네컷 영상</b>을 받을 수 있어요'
    : '휴대폰 카메라로 QR 코드를 찍으면<br><b>사진</b>을 받을 수 있어요';
}
async function doPrint(){
  if (printing) return;
  printing = true;
  clearTimer();
  const sid = session;
  const look = currentLook();
  const photos = chosenPhotos();
  const id = newSessionId();
  const qrOn = settings.upload !== 'off' && health.upload !== 'error';
  const predict = qrOn && settings.upload === 'cloudinary' && settings.predictOK !== false;
  const withVideo = predict && liveEnabled() && !!downloadPage();
  const link = predict ? shareLinkFor(id, withVideo) : null;
  const printLink = predict && settings.printQR ? link : null;

  const c = document.createElement('canvas'); c.width = W; c.height = H;
  render(c.getContext('2d'), {photos, forPrint:true, qrText:printLink, look});
  state.finalUrl = c.toDataURL('image/jpeg', .95);
  const photoBlob = await new Promise(r => c.toBlob(r, 'image/jpeg', .92));
  $('#finalImg').src = state.finalUrl;
  setPrintMsg('사진을 인쇄하고 있어요', true);
  $('#qrCap').textContent = '';
  qrNote('');
  qrUI(qrOn ? 'wait' : 'off', 'QR 코드를 만들고 있어요');
  if (!qrOn && settings.upload !== 'off') qrNote('이번 사진은 QR 없이 인쇄돼요 (관리자 설정 확인 필요)', 'warn');
  show('s-print');
  await preparePrint(state.finalUrl, state.copies);
  await sleep(300);
  if (sid !== session) return;
  window.print();          // Chrome --kiosk-printing 모드에서는 대화상자 없이 기본 프린터로 바로 인쇄
  bump('prints', state.copies);
  if (settings.paperLeft != null) { settings.paperLeft = Math.max(0, settings.paperLeft - state.copies); saveSettings(); }
  countdownHome(qrOn ? 90 : 40);
  setTimeout(() => { if (sid === session) setPrintMsg('프린터에서 사진을 가져가세요', false); }, 25000);
  say(qrOn ? '사진을 인쇄하고 있어요. 큐알 코드를 찍으면 사진을 받을 수 있어요' : '사진을 인쇄하고 있어요');

  if (predict) {
    const clipsP = state.selected.map(i => state.shots[i] && state.shots[i].clipP);
    await enqueueSession(id, photoBlob, withVideo);
    watchSession(sid, id, link, withVideo);
    if (withVideo) makeLiveVideo({look, clipsP}).catch(() => null).then(v => attachVideo(id, v));
  } else if (qrOn) {
    directShare(sid, photoBlob, id);
  }
}
function countdownHome(sec){
  const sid = session;
  let left = sec;
  clearInterval(timerId);
  $('#homeCount').textContent = `(${left})`;
  timerId = setInterval(() => {
    if (sid !== session) return clearInterval(timerId);
    left--; $('#homeCount').textContent = `(${left})`;
    if (left <= 0) { clearInterval(timerId); goHome(); }
  }, 1000);
}
$('#reprint').onclick = async () => {
  if (!state.finalUrl) return;
  await preparePrint(state.finalUrl, 1);
  window.print();
  bump('prints', 1);
  if (settings.paperLeft != null) { settings.paperLeft = Math.max(0, settings.paperLeft - 1); saveSettings(); }
  countdownHome(60);
};
$('.home2').onclick = goHome;
$$('.home').forEach(b => b.onclick = () => { if (confirm('처음 화면으로 돌아갈까요?\n찍은 사진은 사라집니다.')) goHome(); });

/* ---------- QR 링크 ---------- */
function newSessionId(){
  const d = new Date(), abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  const r = crypto.getRandomValues(new Uint8Array(10));
  return String(d.getFullYear()).slice(2) + pad2(d.getMonth()+1) + pad2(d.getDate()) + [...r].map(b => abc[b & 31]).join('');
}
const cloudPhotoUrl = (id, cloud = settings.cloudName) => `https://res.cloudinary.com/${cloud}/image/upload/v1/${CLOUD_FOLDER}/${id}.jpg`;
function downloadPage(){
  let base = (settings.pageUrl || '').trim();
  if (!base && location.protocol === 'https:') base = location.href;
  if (!base) return '';
  try {
    const u = new URL(base);
    if (u.protocol !== 'https:' && u.hostname !== 'localhost') return '';
    if (!/\.html?$/.test(u.pathname)) u.pathname = u.pathname.replace(/\/?$/, '/') + 'download.html';
    else u.pathname = u.pathname.replace(/[^/]*$/, 'download.html');
    u.search = ''; u.hash = '';
    return u.href;
  } catch { return ''; }
}
const keepDaysNow = () => settings.upload === 'imgbb' ? Math.round(settings.imgbbExpire / 86400) : settings.keepDays;
// Cloudinary: 업로드 전에 주소를 미리 알 수 있어서 QR을 바로 띄우고 사진에도 인쇄할 수 있음
function shareLinkFor(id, withVideo){
  const page = downloadPage();
  if (!page) return cloudPhotoUrl(id);
  let h = `#c=${encodeURIComponent(settings.cloudName)}&i=${id}`;
  if (withVideo) h += '&v=1';
  if (keepDaysNow() > 0) h += `&k=${keepDaysNow()}`;
  return page + h;
}
function shareLinkForUrl(photoUrl, id){
  const page = downloadPage();
  if (!page) return photoUrl;
  let h = `#p=${encodeURIComponent(photoUrl)}&d=${id.slice(0, 6)}`;
  if (keepDaysNow() > 0) h += `&k=${keepDaysNow()}`;
  return page + h;
}
const canPrintQR = () => settings.printQR && settings.upload === 'cloudinary' && settings.predictOK !== false && health.upload !== 'error';

/* ---------- 업로드 ---------- */
const CONFIG_ERRORS = [
  [/Upload preset not found/i, () => `Cloudinary에 '${settings.cloudPreset}' 업로드 프리셋이 없어요.`],
  [/must be whitelisted for unsigned/i, () => `'${settings.cloudPreset}' 프리셋이 Signed 방식이에요. Unsigned로 바꿔야 해요.`],
  [/Upload preset must be specified/i, () => '업로드 프리셋 이름이 비어 있어요.'],
  [/Unknown API key|Invalid cloud_name|cloud_name is disabled|Invalid cloud name/i, () => `Cloud name '${settings.cloudName}'을(를) 찾을 수 없어요.`],
  [/Invalid API (v1 )?key|key.*invalid/i, () => 'ImgBB API 키가 올바르지 않아요.'],
];
async function postForm(url, fd, timeoutMs = 60000){
  const ac = new AbortController(), to = setTimeout(() => ac.abort(), timeoutMs);
  try {
    let r;
    try { r = await fetch(url, {method:'POST', body:fd, signal:ac.signal, credentials:'omit', referrerPolicy:'no-referrer'}); }
    catch { const e = new Error('인터넷 연결이 불안정해요.'); e.network = true; throw e; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) {
      const raw = String((j.error && (j.error.message || j.error)) || `HTTP ${r.status}`);
      const hit = CONFIG_ERRORS.find(([re]) => re.test(raw));
      const e = new Error(hit ? hit[1]() : raw);
      e.raw = raw; e.status = r.status; e.config = !!hit; e.network = r.status >= 500;
      throw e;
    }
    return j;
  } finally { clearTimeout(to); }
}
async function cloudUpload(kind, blob, id, cloud = settings.cloudName){
  if (!cloud || !settings.cloudPreset) { const e = new Error('Cloudinary 설정(Cloud name, 프리셋)이 비어 있어요.'); e.config = true; throw e; }
  const fd = new FormData();
  fd.append('file', blob, id + (kind === 'video' ? (blob.type.includes('webm') ? '.webm' : '.mp4') : '.jpg'));
  fd.append('upload_preset', settings.cloudPreset);
  fd.append('public_id', `${CLOUD_FOLDER}/${id}`);
  const j = await postForm(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/${kind}/upload`, fd, kind === 'video' ? 180000 : 90000);
  if (!j.secure_url) throw new Error('Cloudinary 응답이 이상해요.');
  // 프리셋에 폴더/접두사 설정이 있으면 미리 만든 QR 주소와 달라짐 → 다음부터는 업로드 후에 QR 표시
  const match = j.public_id === `${CLOUD_FOLDER}/${id}`;
  if (match !== (settings.predictOK !== false)) { settings.predictOK = match; saveSettings(); }
  return {url: j.secure_url, match};
}
async function imgbbUpload(blob, name){
  if (!settings.imgbbKey) { const e = new Error('ImgBB API 키가 비어 있어요.'); e.config = true; throw e; }
  const fd = new FormData(); fd.append('image', blob, name);
  const j = await postForm(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(settings.imgbbKey)}&expiration=${settings.imgbbExpire}`, fd);
  if (!j.data || !j.data.url) throw new Error('ImgBB 응답이 이상해요.');
  return j.data.url;
}

/* ---------- 업로드 대기열 (인터넷이 끊겨도 나중에 자동으로 올림) ---------- */
const store = {
  db:null, mem:null, initP:null,
  ready(){ return this.initP || (this.initP = this.init()); },
  async init(){
    try {
      this.db = await new Promise((res, rej) => {
        const r = indexedDB.open('fourcut-booth', 1);
        r.onupgradeneeded = () => { for (const n of ['queue', 'frames']) if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n, {keyPath:'id'}); };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('blocked'));
      });
    } catch { this.mem = {queue:new Map(), frames:new Map()}; }
  },
  tx(name, mode, fn){
    return new Promise((res, rej) => {
      const t = this.db.transaction(name, mode); let out;
      fn(t.objectStore(name), v => { out = v; });
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('abort'));
    });
  },
  async put(n, v){ await this.ready(); if (this.mem) { this.mem[n].set(v.id, v); return; } return this.tx(n, 'readwrite', st => { st.put(v); }); },
  async all(n){ await this.ready(); if (this.mem) return [...this.mem[n].values()]; return this.tx(n, 'readonly', (st, set) => { const r = st.getAll(); r.onsuccess = () => set(r.result); }); },
  async del(n, k){ await this.ready(); if (this.mem) { this.mem[n].delete(k); return; } return this.tx(n, 'readwrite', st => { st.delete(k); }); },
  async patch(n, k, p){
    await this.ready();
    if (this.mem) { const v = this.mem[n].get(k); if (v) Object.assign(v, p); return; }
    return this.tx(n, 'readwrite', st => { const g = st.get(k); g.onsuccess = () => { if (g.result) st.put(Object.assign(g.result, p)); }; });
  },
};
const qListeners = new Set();
let qBusy = false, qTimer = null, qDelay = 5000, qError = '', qCount = 0;
function qEmit(id, what, info){ qListeners.forEach(fn => { try { fn(id, what, info); } catch {} }); }
async function enqueueSession(id, photo, withVideo){
  try {
    await store.put('queue', {id, created:Date.now(), cloud:settings.cloudName, photo, photoDone:false,
      videoState: withVideo ? 'pending' : 'none', video:null, videoDone:false});
  } catch (e) { console.warn('대기열 저장 실패', e); }
  processQueue();
}
async function attachVideo(id, blob){
  try { await store.patch('queue', id, blob ? {video:blob, videoState:'ready'} : {videoState:'none'}); } catch {}
  processQueue();
}
async function processQueue(){
  if (qBusy) return;
  qBusy = true; clearTimeout(qTimer);
  let failed = false;
  try {
    for (;;) {
      const items = (await store.all('queue')).sort((a, b) => a.created - b.created);
      for (const x of items) if (x.photoDone && x.videoState !== 'pending' && (x.videoState === 'none' || x.videoDone)) await store.del('queue', x.id);
      const left = items.filter(x => !(x.photoDone && x.videoState !== 'pending' && (x.videoState === 'none' || x.videoDone)));
      qCount = left.length;
      const it = left.find(x => !x.photoDone) || left.find(x => x.videoState === 'ready' && !x.videoDone);
      if (!it) break;
      const kind = it.photoDone ? 'video' : 'image';
      try {
        const r = await cloudUpload(kind, kind === 'image' ? it.photo : it.video, it.id, it.cloud);
        await store.patch('queue', it.id, kind === 'image' ? {photoDone:true, photo:null, photoUrl:r.url} : {videoDone:true, video:null});
        qEmit(it.id, kind === 'image' ? 'photo' : 'video', r);
        qError = ''; qDelay = 5000;
      } catch (e) {
        if (kind === 'video' && !e.network) {               // 영상만 실패하면 영상은 포기하고 사진은 살림
          await store.patch('queue', it.id, {videoState:'none', video:null});
          qEmit(it.id, 'video-fail', e);
          continue;
        }
        qError = e.message; failed = true;
        qEmit(it.id, 'error', e);
        break;
      }
    }
  } catch (e) { qError = e.message; failed = true; }
  finally {
    qBusy = false;
    paintStatus();
    if (failed) { qTimer = setTimeout(processQueue, qDelay); qDelay = Math.min(qDelay * 2, 60000); }
  }
}
window.addEventListener('online', () => { qDelay = 5000; processQueue(); checkHealth(); });
setInterval(processQueue, 60000);

// 인쇄 화면: 이번 손님 사진의 업로드 상황 표시
let sessionWatch = null;
function clearSessionWatch(){ if (sessionWatch) { qListeners.delete(sessionWatch); sessionWatch = null; } }
function watchSession(sid, id, link, withVideo){
  clearSessionWatch();
  const instant = !!downloadPage();      // 다운로드 페이지가 있으면 업로드 전에도 QR을 바로 보여줌
  if (instant) { showQR(link, withVideo); qrNote('사진을 올리고 있어요…'); }
  else qrUI('wait', '사진을 올리고 있어요');
  sessionWatch = (qid, what, info) => {
    if (qid !== id) return;
    if (sid !== session) return clearSessionWatch();
    if (what === 'photo') {
      if (!info.match) showQR(shareLinkForUrl(info.url, id), false);   // 프리셋 폴더 설정 때문에 주소가 바뀐 경우
      else if (!instant) showQR(link, false);
      qrNote(withVideo && info.match ? '✅ 사진 준비 완료! 영상도 곧 올라가요' : '✅ 사진 준비 완료!', 'ok');
      countdownHome(60);
    } else if (what === 'video') {
      qrNote('✅ 사진과 영상 준비 완료!', 'ok');
    } else if (what === 'error') {
      if (info.network) qrNote('인터넷 연결을 기다리는 중… 연결되면 자동으로 올라가요', 'warn');
      else qrNote('⚠ ' + info.message, 'warn');
      if (!instant) qrUI('err', 'QR 코드를 만들지 못했어요');
    }
  };
  qListeners.add(sessionWatch);
}
// ImgBB 등 주소를 미리 알 수 없는 방식: 올린 뒤에 QR 표시
async function directShare(sid, photoBlob, id){
  try {
    qrUI('wait', '사진을 올리고 있어요');
    let url;
    for (let i = 0; ; i++) {
      try {
        url = settings.upload === 'imgbb' ? await imgbbUpload(photoBlob, `fourcut_${id}.jpg`) : (await cloudUpload('image', photoBlob, id)).url;
        break;
      } catch (e) { if (i >= 2 || !e.network) throw e; await sleep(3000); }
    }
    if (sid !== session) return;
    showQR(shareLinkForUrl(url, id), false);
    qrNote('✅ 사진 준비 완료!', 'ok');
    countdownHome(60);
  } catch (e) {
    if (sid === session) { qrUI('err', 'QR 코드를 만들지 못했어요'); qrNote(e.message, 'warn'); }
  }
}

/* ---------- 움직이는 네컷 영상 ---------- */
async function makeLiveVideo({look, clipsP}){
  const mime = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m));
  if (!mime) return null;
  const clips = await Promise.all(clipsP.map(async p => {
    const blobs = await (p || Promise.resolve([]));
    return Promise.all(blobs.map(b => createImageBitmap(b)));
  }));
  const len = Math.min(...clips.map(c => c.length));
  if (!(len >= 5)) { clips.flat().forEach(b => b.close()); return null; }
  const VW = 800, VH = 1200;
  const c = document.createElement('canvas'); c.width = VW; c.height = VH;
  const x = c.getContext('2d');
  const seq = [...Array(len).keys()];
  const order = [...seq, ...seq.slice(1, -1).reverse(), ...seq];      // 앞으로-뒤로-앞으로
  const cs = c.captureStream(0), track = cs.getVideoTracks()[0];
  const rec = new MediaRecorder(cs, {mimeType: mime, videoBitsPerSecond: 2_500_000});
  const chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise(r => rec.onstop = r);
  const draw = k => {
    x.setTransform(VW/W, 0, 0, VH/H, 0, 0);
    render(x, {photos: clips.map(cl => cl[k]), look});
    track.requestFrame && track.requestFrame();
  };
  draw(0); rec.start();
  for (const k of order) { draw(k); await sleep(1000 / CLIP_FPS); }
  for (let i = 0; i < 10; i++) { draw(len - 1); await sleep(100); }   // 마지막 장면 1초 멈춤
  rec.stop(); await stopped;
  cs.getTracks().forEach(t => t.stop());
  clips.flat().forEach(b => b.close());
  return new Blob(chunks, {type: mime.split(';')[0]});
}

/* ---------- 상태 점검 ---------- */
const health = {upload:'unknown', uploadMsg:'확인 중…', camera:'unknown', cameraMsg:'확인 중…'};
async function checkHealth(){
  try {
    const n = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput').length;
    health.camera = n ? 'ok' : 'error'; health.cameraMsg = n ? `카메라 ${n}대 연결됨` : '카메라가 연결되어 있지 않아요';
  } catch { health.camera = 'unknown'; health.cameraMsg = '카메라 상태를 알 수 없어요'; }
  if (settings.upload === 'off') { health.upload = 'off'; health.uploadMsg = 'QR 다운로드를 쓰지 않아요'; }
  else if (settings.upload === 'imgbb') {
    health.upload = settings.imgbbKey ? 'ok' : 'error';
    health.uploadMsg = settings.imgbbKey ? 'ImgBB 사용 (사진만, QR은 업로드 후 표시)' : 'ImgBB API 키가 비어 있어요';
  } else {
    if (!navigator.onLine) health.upload = 'offline';
    else try {
      // 파일 없이 보내서 프리셋만 확인 (아무것도 업로드되지 않음)
      const fd = new FormData(); fd.append('upload_preset', settings.cloudPreset);
      await postForm(`https://api.cloudinary.com/v1_1/${encodeURIComponent(settings.cloudName)}/image/upload`, fd, 15000);
      health.upload = 'ok';
    } catch (e) {
      health.upload = e.network ? 'offline' : e.config ? 'error' : 'ok';
      health.uploadMsg = e.message;
    }
    if (health.upload === 'ok') health.uploadMsg = `Cloudinary 연결 정상 (${settings.cloudName} / ${settings.cloudPreset})`;
    if (health.upload === 'offline') health.uploadMsg = '인터넷에 연결되어 있지 않아요. 사진은 연결되면 자동으로 올라가요.';
  }
  paintStatus();
}
const PRESET_GUIDE = () => `해결 방법 (1분):
1. console.cloudinary.com 로그인
2. 왼쪽 아래 톱니바퀴(Settings) → Upload → Upload Presets
3. Add Upload Preset → Upload preset name: ${settings.cloudPreset}
4. Signing mode: Unsigned → Save
5. 이 창에서 “다시 점검”`;
function paintStatus(){
  // 시작 화면 아래 작은 상태 표시
  const bar = $('#statusbar'); bar.innerHTML = '';
  const chip = (text, cls) => { const s = document.createElement('span'); s.textContent = text; if (cls) s.className = cls; bar.appendChild(s); };
  if (settings.upload !== 'off') {
    if (health.upload === 'ok') chip('QR ✓', 'ok');
    else if (health.upload === 'error') chip('⚠ QR 설정 필요 (S키)', 'bad');
    else if (health.upload === 'offline') chip('⚠ 인터넷 끊김', 'warn');
  }
  if (health.camera === 'error') chip('⚠ 카메라 없음', 'bad');
  if (qCount > 0) chip(`업로드 대기 ${qCount}`, 'warn');
  if (settings.paperLeft != null) chip(`용지 ${settings.paperLeft}장`, settings.paperLeft <= 5 ? 'bad' : '');
  // 관리자 설정의 점검 목록
  if (!$('#settings').classList.contains('open')) return;
  const list = $('#healthList'); list.innerHTML = '';
  const item = (cls, title, guide) => {
    const d = document.createElement('div'); d.className = 'item ' + cls;
    const ic = document.createElement('span'); ic.className = 'icon'; ic.textContent = cls === 'ok' ? '✔' : cls === 'bad' ? '✖' : cls === 'warn' ? '!' : '·';
    const tx = document.createElement('div'); tx.textContent = title;
    if (guide) { const g = document.createElement('span'); g.className = 'guide'; g.textContent = guide; tx.appendChild(g); }
    d.append(ic, tx); list.appendChild(d);
  };
  item(health.camera === 'ok' ? 'ok' : health.camera === 'error' ? 'bad' : '', '카메라: ' + health.cameraMsg);
  const up = health.upload;
  item(up === 'ok' ? 'ok' : up === 'error' ? 'bad' : up === 'offline' ? 'warn' : '', 'QR 업로드: ' + health.uploadMsg,
    up === 'error' && settings.upload === 'cloudinary' && /프리셋|Signed/.test(health.uploadMsg) ? PRESET_GUIDE() : '');
  if (settings.upload === 'cloudinary' && settings.predictOK === false)
    item('warn', '프리셋에 폴더·접두사 설정이 있어서 사진에 QR 인쇄를 쓸 수 없어요', '프리셋 설정에서 Public ID 접두사(prefix)·폴더를 비우고 “QR 업로드 테스트”를 다시 해 보세요.');
  const page = downloadPage();
  item(page ? 'ok' : 'warn', page ? '사진 받기 페이지: ' + page : '사진 받기 페이지: 없음 (컴퓨터 파일로 실행 중)',
    page ? '' : 'GitHub 사이트 주소로 실행하면 QR을 찍었을 때 예쁜 사진 받기 화면이 열려요.');
  item(qCount ? 'warn' : 'ok', qCount ? `업로드 대기 ${qCount}건` + (qError ? ` · 마지막 오류: ${qError}` : '') : '업로드 대기 없음');
  item('', '인쇄: 이 PC의 “기본 프린터”로 나가요', 'Canon SELPHY를 기본 프린터로 지정하고 start_booth_windows.bat으로 실행하면 인쇄 창 없이 바로 인쇄돼요.');
  item('', `오늘 촬영 ${stats.day === todayStr() ? stats.sessions : 0}회 · 인쇄 ${stats.day === todayStr() ? stats.prints : 0}장 · 누적 인쇄 ${stats.total}장`);
}

/* ---------- 관리자 설정 ---------- */
const FIELDS = {
  deviceId:['#o-device','text'], mirror:['#o-mirror','check'], countdown:['#o-countdown','num',1,30], shots:['#o-shots','int',4,12],
  limit:['#o-limit','int',0,600], voice:['#o-voice','check'],
  paper:['#o-paper','text'], scale:['#o-scale','num',80,110], offX:['#o-offx','num',-10,10], offY:['#o-offy','num',-10,10],
  printQR:['#o-printQR','check'], cutGuide:['#o-cut','check'], eventName:['#o-eventName','text'], paperLeft:['#o-paperLeft','optint',0,9999],
  upload:['#o-upload','text'], cloudName:['#o-cloudName','text'], cloudPreset:['#o-cloudPreset','text'],
  imgbbKey:['#o-imgbbKey','text'], imgbbExpire:['#o-imgbbExpire','int',86400,2592000], keepDays:['#o-keepDays','int',0,365],
  liveVideo:['#o-live','check'], pageUrl:['#o-pageUrl','text'], captionOnCustom:['#o-captionOnCustom','check'], pin:['#o-pin','text'],
};
function paintUploadFields(){
  const v = $('#o-upload').value;
  $$('[data-for]').forEach(f => f.hidden = f.dataset.for !== v);
}
$('#o-upload').addEventListener('change', paintUploadFields);
async function openSettings(){
  if ($('#settings').classList.contains('open')) return;
  if (settings.pin && prompt('관리자 비밀번호를 입력하세요') !== settings.pin) return;
  for (const [k, [sel, type]] of Object.entries(FIELDS)) {
    const el = $(sel);
    if (type === 'check') el.checked = !!settings[k];
    else el.value = settings[k] == null ? '' : settings[k];
  }
  paintUploadFields();
  paintCfList();
  $('#appVer').textContent = 'v' + APP_VERSION;
  $('#settings').classList.add('open');
  paintStatus();
  checkHealth();
  try {
    // 카메라 이름을 보려면 권한이 한 번 필요
    if (!stream) { const s = await navigator.mediaDevices.getUserMedia({video:true}); s.getTracks().forEach(t => t.stop()); }
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    const sel = $('#o-device');
    sel.innerHTML = '<option value="">기본 카메라</option>';
    devs.forEach((d, i) => { const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || `카메라 ${i+1}`; sel.appendChild(o); });
    sel.value = settings.deviceId;
  } catch {}
}
function readSettings(){
  const before = {cloudName:settings.cloudName, cloudPreset:settings.cloudPreset, deviceId:settings.deviceId};
  for (const [k, [sel, type, min, max]] of Object.entries(FIELDS)) {
    const el = $(sel);
    if (k === 'deviceId' && el.options.length <= 1) continue;          // 카메라 목록을 못 불러왔으면 기존 선택 유지
    if (type === 'check') settings[k] = el.checked;
    else if (type === 'text') settings[k] = el.value.trim();
    else if (type === 'optint' && el.value.trim() === '') settings[k] = null;
    else {
      let v = parseFloat(el.value);
      if (isNaN(v)) v = DEFAULTS[k] == null ? min : DEFAULTS[k];
      v = Math.min(max, Math.max(min, v));
      settings[k] = type === 'num' ? v : Math.round(v);
    }
  }
  if (!settings.cloudName) settings.cloudName = DEFAULTS.cloudName;
  if (!settings.cloudPreset) settings.cloudPreset = DEFAULTS.cloudPreset;
  if (!PAPERS[settings.paper]) settings.paper = DEFAULTS.paper;
  if (before.cloudName !== settings.cloudName || before.cloudPreset !== settings.cloudPreset) delete settings.predictOK;
  if (before.deviceId !== settings.deviceId) stopCamera();
  saveSettings();
}
function closeSettings(){
  if (!$('#settings').classList.contains('open')) return;
  readSettings();
  $('#settings').classList.remove('open');
  applyPaper(); paintTitle(); paintStatus();
  checkHealth(); processQueue();
}
$('#gear').onclick = e => { e.stopPropagation(); openSettings(); };
$('#statusbar').onclick = e => { e.stopPropagation(); if ($('#statusbar').children.length) openSettings(); };
$('#closeSet').onclick = closeSettings;
$('#recheck').onclick = () => { readSettings(); health.upload = 'unknown'; health.uploadMsg = '확인 중…'; paintStatus(); checkHealth(); };
$('#retryQueue').onclick = () => { qDelay = 5000; processQueue(); toast('대기 중인 사진을 다시 올리고 있어요'); };
$('#fullscreen').onclick = () => document.documentElement.requestFullscreen?.().catch(() => {});
$('#reload').onclick = () => { readSettings(); location.reload(); };
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if ($('#qrTest').classList.contains('open')) $('#qrTest').classList.remove('open'); else closeSettings(); return; }
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || $('#qrTest').classList.contains('open') || $('#settings').classList.contains('open')) return;
  if ((e.key === 's' || e.key === 'S' || e.key === 'ㄴ') && $('#s-start').classList.contains('active')) openSettings();
  if ((e.key === 'Enter' || e.key === ' ') && $('#s-start').classList.contains('active')) $('#s-start').click();
});
function paintTitle(){ $('#startTitle').textContent = (settings.eventName || '').trim() || '네컷 사진관'; }

/* ---------- 테스트 인쇄 / QR 업로드 테스트 ---------- */
$('#testPrint').onclick = async () => {
  closeSettings();
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0,0,W,H);
  x.strokeStyle = '#e8336d'; x.lineWidth = 6; x.strokeRect(3,3,W-6,H-6);
  x.strokeStyle = '#3a7bd5'; x.lineWidth = 3; x.setLineDash([16,10]); x.strokeRect(28,28,W-56,H-56); x.setLineDash([]);
  x.strokeStyle = '#999'; x.lineWidth = 2;
  x.beginPath(); x.moveTo(W/2,0); x.lineTo(W/2,H); x.moveTo(0,H/2); x.lineTo(W,H/2); x.stroke();
  x.fillStyle = '#222'; x.textAlign = 'center'; x.font = `80px ${FONT}`;
  x.fillText('4 × 6 테스트', W/2, H/2-120);
  x.font = `36px ${FONT}`;
  const p = PAPERS[settings.paper] || PAPERS.selphy;
  x.fillText(`용지 설정: ${p.w}×${p.h}mm · 크기 ${settings.scale}%`, W/2, H/2+70);
  x.fillText('빨간 선: 그림 가장자리 (조금 잘리는 건 정상)', W/2, H/2+130);
  x.fillText('파란 점선: 안쪽 2.4mm (사진 테두리 위치)', W/2, H/2+185);
  x.fillText('파란 선이 잘리면 크기 보정을 97~98로', W/2, H/2+240);
  x.fillStyle = '#222';
  for (let mm = 0; mm <= 100; mm += 5) { const px = mm * 300 / 25.4 + 1; x.fillRect(px, 40, 2, mm % 10 ? 20 : 40); }
  await preparePrint(c.toDataURL('image/png'), 1);
  window.print();
};
function qrTest(msg, isErr, link){
  $('#qrTest').classList.add('open');
  $('#qrTestBox').classList.toggle('hide', !link);
  if (link) drawQRCanvas($('#qrTestCanvas'), link);
  $('#qrTestMsg').textContent = msg;
  $('#qrTestMsg').classList.toggle('err', !!isErr);
}
$('#qrTestClose').onclick = () => $('#qrTest').classList.remove('open');
$('#testUpload').onclick = async () => {
  closeSettings();
  if (settings.upload === 'off') return qrTest('QR 다운로드가 “사용 안 함”으로 되어 있어요.', true);
  qrTest('테스트 사진을 올리고 있어요…');
  const c = document.createElement('canvas'); c.width = 600; c.height = 900;
  const x = c.getContext('2d');
  x.fillStyle = '#ffc9d9'; x.fillRect(0,0,600,900);
  x.fillStyle = '#7a2a45'; x.textAlign = 'center'; x.font = `64px ${FONT}`;
  x.fillText('QR 테스트 성공!', 300, 420);
  x.font = `30px ${FONT}`; x.fillText(new Date().toLocaleString('ko-KR'), 300, 490);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', .9));
  const id = newSessionId();
  try {
    let url, link, note = '';
    if (settings.upload === 'cloudinary') {
      const r = await cloudUpload('image', blob, id);
      url = r.url;
      link = r.match ? shareLinkFor(id, false) : shareLinkForUrl(url, id);
      if (!r.match) note = '\n\n⚠ 프리셋에 폴더·접두사 설정이 있어서 사진에 QR 인쇄는 꺼져요.';
    } else {
      url = await imgbbUpload(blob, `fourcut_test_${id}.jpg`);
      link = shareLinkForUrl(url, id);
    }
    // 올린 사진을 실제로 다시 열 수 있는지 확인
    let check = '';
    try { const r = await fetch(url, {cache:'no-store', credentials:'omit'}); if (!r.ok) check = `오류 코드 ${r.status}`; }
    catch {}
    if (check) return qrTest(`업로드는 됐지만 올린 사진을 열 수 없어요.\n${check}\n\n사진 주소:\n${url}`, true);
    health.upload = 'ok'; health.uploadMsg = `Cloudinary 연결 정상 (${settings.cloudName} / ${settings.cloudPreset})`;
    if (settings.upload === 'imgbb') health.uploadMsg = 'ImgBB 사용 (사진만, QR은 업로드 후 표시)';
    paintStatus();
    qrTest('업로드 성공!\n휴대폰 카메라로 QR을 찍어서 분홍색 “QR 테스트 성공!” 사진이 보이면 끝이에요.' + note, false, link);
  } catch (e) {
    const guide = /프리셋|Signed/.test(e.message) ? '\n\n' + PRESET_GUIDE() : e.network ? '\n\n인터넷 연결을 확인해 주세요.' : '';
    qrTest(`업로드 실패\n${e.message}${guide}`, true);
  }
};

/* ---------- 커스텀 프레임 ---------- */
function frameTemplate(layout){
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0,0,W,H);
  x.strokeStyle = '#eee'; x.lineWidth = 1;
  for (let i = 0; i <= W; i += 50) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, H); x.stroke(); }
  for (let i = 0; i <= H; i += 50) { x.beginPath(); x.moveTo(0, i); x.lineTo(W, i); x.stroke(); }
  x.textAlign = 'center'; x.textBaseline = 'middle';
  for (const s of slots(layout)) {
    x.fillStyle = '#c9c9c9'; x.fillRect(s.x, s.y, s.w, s.h);
    x.fillStyle = '#6b6b6b'; x.font = 'bold 34px sans-serif'; x.fillText(`사진 ${s.i+1}`, s.x+s.w/2, s.y+s.h/2-20);
    x.font = '22px sans-serif'; x.fillText(`${s.w}×${s.h}px (x${s.x}, y${s.y})`, s.x+s.w/2, s.y+s.h/2+20);
  }
  const qs = layout === 'strip' ? 164 : 225;
  for (const a of captionAreas(layout, qs)) {
    x.setLineDash([12, 8]); x.lineWidth = 3;
    x.strokeStyle = '#3a7bd5'; x.strokeRect(a.cx - a.maxW/2, a.top + 16, a.maxW, a.bottom - a.top - 32);
    x.strokeStyle = '#e8336d'; x.strokeRect(a.qr.x, a.qr.y, qs, qs);
    x.setLineDash([]);
    x.fillStyle = '#3a7bd5'; x.font = '22px sans-serif'; x.fillText('문구·날짜 자리', a.cx, (a.top + a.bottom) / 2);
    x.fillStyle = '#e8336d'; x.fillText('QR 자리', a.qr.x + qs/2, a.qr.y + qs/2);
  }
  x.fillStyle = '#888'; x.font = '18px sans-serif';
  x.fillText('네컷 프레임 템플릿 · 1200×1800px · 회색 칸에 사진이 들어가요', W/2, 16);
  const a = document.createElement('a');
  a.href = c.toDataURL('image/png'); a.download = `frame_template_${layout}.png`;
  document.body.appendChild(a); a.click(); a.remove();
}
$('#tplStrip').onclick = () => frameTemplate('strip');
$('#tplGrid').onclick = () => frameTemplate('grid');
$('#cfAdd').onclick = () => $('#cfFile').click();
$('#cfFile').onchange = async e => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) return alert('그림 파일이 너무 커요 (20MB 이하).');
  try {
    const img = await createImageBitmap(file);
    if (Math.abs(img.width / img.height - 2/3) > 0.03) toast('세로 2:3 비율이 아니라서 가운데 기준으로 맞췄어요');
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    drawCover(c.getContext('2d'), img, 0, 0, W, H); img.close();
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const name = (file.name.replace(/\.[^.]+$/, '') || '커스텀').slice(0, 10);
    await store.put('frames', {id:'cf' + Date.now().toString(36), name, layout:$('#cfLayout').value, blob, created:Date.now()});
    await loadCustomFrames();
    paintCfList();
    toast('프레임을 추가했어요');
  } catch (err) { alert('그림을 읽지 못했어요: ' + err.message); }
};
async function loadCustomFrames(){
  const recs = (await store.all('frames').catch(() => [])).sort((a, b) => a.created - b.created);
  const next = [];
  for (const r of recs) {
    try {
      const img = await createImageBitmap(r.blob);
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d', {willReadFrequently:true});
      x.drawImage(img, 0, 0, W, H);
      // 사진 칸 가운데가 투명하면 장식을 사진 위에 올리는 방식
      const overlay = slots(r.layout).slice(0, 4).every(s => x.getImageData(Math.round(s.x + s.w/2), Math.round(s.y + s.h/2), 1, 1).data[3] < 128);
      // 문구 영역의 밝기에 따라 글자색 결정
      const a = captionAreas(r.layout, 0)[0];
      const d = x.getImageData(Math.round(a.cx - 150), a.top + 40, 300, a.bottom - a.top - 80).data;
      let sum = 0, cnt = 0;
      for (let i = 0; i < d.length; i += 16) { const al = d[i+3] / 255; sum += (0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2]) * al + 255 * (1 - al); cnt++; }
      const t = document.createElement('canvas'); t.width = 80; t.height = 120;
      const tx = t.getContext('2d'); tx.fillStyle = '#fff'; tx.fillRect(0, 0, 80, 120); tx.drawImage(img, 0, 0, 80, 120);
      next.push({id:r.id, name:r.name, type:'custom', layout:r.layout, img, overlay, ink: sum / cnt > 140 ? '#222222' : '#ffffff', thumb:t.toDataURL('image/png')});
    } catch {}
  }
  const old = customFrames;
  customFrames = next;
  old.forEach(f => { try { f.img.close(); } catch {} });
}
function paintCfList(){
  const box = $('#cfList'); box.innerHTML = '';
  if (!customFrames.length) { const p = document.createElement('div'); p.className = 'hint'; p.textContent = '추가한 프레임이 없어요.'; box.appendChild(p); return; }
  for (const f of customFrames) {
    const d = document.createElement('div'); d.className = 'cfitem';
    const im = document.createElement('img'); im.src = f.thumb; im.alt = '';
    const nm = document.createElement('span'); nm.textContent = `${f.name} · ${f.layout === 'strip' ? '스트립' : '그리드'}`;
    const del = document.createElement('button'); del.textContent = '삭제';
    del.onclick = async () => {
      if (!confirm(`'${f.name}' 프레임을 삭제할까요?`)) return;
      await store.del('frames', f.id); await loadCustomFrames(); paintCfList();
    };
    d.append(im, nm, del); box.appendChild(d);
  }
}

/* ---------- 시작 ---------- */
document.addEventListener('contextmenu', e => e.preventDefault());
document.fonts && document.fonts.load('40px Jua').then(() => {
  if ($('#s-select').classList.contains('active')) paintSelect();
  if ($('#s-deco').classList.contains('active')) paintDeco();
}).catch(() => {});
(async function init(){
  applyPaper(); paintTitle(); paintCopies(); paintStatus();
  await store.ready();
  await loadCustomFrames().catch(() => {});
  try {
    // 영상 만들던 중에 꺼졌으면 영상은 포기하고 사진만 올림
    for (const x of await store.all('queue')) if (x.videoState === 'pending') await store.patch('queue', x.id, {videoState:'none'});
  } catch {}
  checkHealth();
  processQueue();
  setInterval(checkHealth, 10 * 60 * 1000);
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost'))
    navigator.serviceWorker.register('sw.js').catch(() => {});
})();
