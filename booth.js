'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const W = 1200, H = 1800;                 // 4x6 inch @ 300dpi
const FONT = '"Jua","Apple SD Gothic Neo","Malgun Gothic",sans-serif';
const CLIP_FPS = 10, CLIP_SEC = 3;        // 움직이는 네컷: 셔터 직전 3초

/* ---------- 설정 ---------- */
const DEFAULTS = {
  deviceId:'', mirror:true, countdown:10, shots:8, limit:60,
  scale:100, offX:0, offY:0, cutGuide:true,
  upload:'cloudinary', imgbbKey:'', imgbbExpire:86400, cloudName:'y8ws9zmi', cloudPreset:'fourcut',
  liveVideo:true, pageUrl:'', pin:''
};
let settings = {...DEFAULTS};
try { Object.assign(settings, JSON.parse(localStorage.getItem('fourcut-settings') || '{}')); } catch {}
// 예전 기본값(tmpfiles)은 웹페이지 업로드가 막혀 있어 Cloudinary로 옮김
if (settings.upload === 'tmpfiles') settings.upload = 'cloudinary';
if (!settings.cloudName) settings.cloudName = DEFAULTS.cloudName;
if (!settings.cloudPreset) settings.cloudPreset = DEFAULTS.cloudPreset;
function saveSettings(){ try { localStorage.setItem('fourcut-settings', JSON.stringify(settings)); } catch {} }

/* ---------- 상태 ---------- */
const state = {layout:'strip', copies:1, shots:[], selected:[], frame:'white', filter:'none', text:'우리의 순간', showDate:true, finalUrl:null};
let session = 0;
let printing = false;

/* ---------- 프레임 / 필터 정의 ---------- */
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

/* ---------- 레이아웃 (1200x1800 캔버스 좌표) ---------- */
function slots(layout){
  const s = [];
  if (layout === 'strip') {           // 2x6 스트립 두 줄
    for (let k = 0; k < 2; k++) for (let i = 0; i < 4; i++)
      s.push({x:k*600+28, y:36+i*376, w:544, h:360, i});
  } else {                            // 2x2 그리드
    for (let i = 0; i < 4; i++)
      s.push({x:44+(i%2)*568, y:44+Math.floor(i/2)*724, w:544, h:700, i});
  }
  return s;
}
const aspect = () => state.layout === 'strip' ? 544/360 : 544/700;
function captionAreas(layout){
  return layout === 'strip'
    ? [{cx:300, top:1524, bottom:1800, maxW:520, big:false}, {cx:900, top:1524, bottom:1800, maxW:520, big:false}]
    : [{cx:600, top:1468, bottom:1800, maxW:1000, big:true}];
}

/* ---------- 합성 렌더링 ---------- */
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
function dateStr(){ const d = new Date(); return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`; }

function render(ctx, {photos, forPrint=false}){
  const f = FRAMES.find(x => x.id === state.frame) || FRAMES[0];
  const flt = FILTERS.find(x => x.id === state.filter) || FILTERS[0];
  ctx.save(); ctx.clearRect(0,0,W,H);
  drawBackground(ctx, f, state.layout);
  for (const s of slots(state.layout)) {
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
  const title = state.text.trim();
  for (const a of captionAreas(state.layout)) {
    ctx.fillStyle = f.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const mid = (a.top + a.bottom) / 2;
    let size = a.big ? 92 : 62;
    ctx.font = `${size}px ${FONT}`;
    while (title && ctx.measureText(title).width > a.maxW && size > 24) { size -= 2; ctx.font = `${size}px ${FONT}`; }
    const dsize = a.big ? 36 : 28;
    if (title) ctx.fillText(title, a.cx, state.showDate ? mid - dsize*0.7 : mid);
    if (state.showDate) {
      ctx.globalAlpha = .7; ctx.font = `${dsize}px ${FONT}`;
      ctx.fillText(dateStr(), a.cx, title ? mid + size*0.55 : mid);
      ctx.globalAlpha = 1;
    }
  }
  if (forPrint && state.layout === 'strip' && settings.cutGuide) {
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
function clearTimer(){ clearInterval(timerId); timerId = null; $$('[data-timer]').forEach(t => { t.textContent=''; t.style.visibility='hidden'; t.classList.remove('warn'); }); }
function startTimer(sec, onDone){
  clearTimer();
  if (!sec) return;
  const el = $('.screen.active [data-timer]');
  let left = sec;
  const paint = () => { if (el) { el.style.visibility='visible'; el.textContent = left; el.classList.toggle('warn', left <= 10); } };
  paint();
  timerId = setInterval(() => { left--; paint(); if (left <= 0) { clearTimer(); onDone(); } }, 1000);
}
function goHome(){
  session++;
  printing = false;
  stopClip();
  stopCamera();
  state.shots = []; state.selected = []; state.finalUrl = null;
  $('#finalImg').removeAttribute('src');
  $('#printArea').innerHTML = '';
  resetQR();
  show('s-start');
}

/* ---------- 화면 꺼짐 방지 ---------- */
async function keepAwake(){ try { await navigator.wakeLock?.request('screen'); } catch {} }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });

/* ---------- 사운드 ---------- */
let actx;
function audio(){ try { actx = actx || new (window.AudioContext||window.webkitAudioContext)(); if (actx.state==='suspended') actx.resume(); return actx; } catch { return null; } }
function beep(freq, dur=.1, vol=.15){
  const a = audio(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  o.frequency.value = freq; g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(.001, a.currentTime+dur);
  o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime+dur);
}
function shutterSound(){
  const a = audio(); if (!a) return;
  const len = a.sampleRate*.15, buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random()*2-1) * Math.pow(1-i/len, 3);
  const src = a.createBufferSource(), g = a.createGain(); g.gain.value = .5;
  src.buffer = buf; src.connect(g).connect(a.destination); src.start();
}

/* ---------- 카메라 ---------- */
const video = $('#video');
let stream = null;
async function startCamera(){
  if (stream && stream.active) return;
  const c = {audio:false, video:{width:{ideal:1920}, height:{ideal:1080}}};
  if (settings.deviceId) c.video.deviceId = {exact: settings.deviceId};
  try { stream = await navigator.mediaDevices.getUserMedia(c); }
  catch (e) {
    if (settings.deviceId) { settings.deviceId = ''; return startCamera(); }
    throw e;
  }
  video.srcObject = stream;
  await video.play().catch(()=>{});
  if (!video.videoWidth) await new Promise(r => video.addEventListener('loadedmetadata', r, {once:true}));
}
function stopCamera(){ if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; video.srcObject = null; }

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

/* ---------- 움직이는 네컷: 셔터 직전 프레임 저장 ---------- */
let clipTimer = null, clipJobs = null;
const liveEnabled = () => settings.liveVideo && settings.upload !== 'off' && !!window.MediaRecorder;
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
  if (e.target.closest('#gear')) return;
  audio(); keepAwake();
  state.layout = $('.choice.on').dataset.layout;
  paintCopies();
  show('s-layout');
  startCamera().catch(()=>{});          // 미리 켜 두면 촬영 시작이 빨라짐
  startTimer(settings.limit ? 60 : 0, goHome);
});

/* ---------- 2. 프레임/매수 ---------- */
$$('.choice').forEach(b => b.addEventListener('click', () => {
  $$('.choice').forEach(x => x.classList.toggle('on', x === b));
  state.layout = b.dataset.layout;
  paintCopies();
}));
function paintCopies(){
  $('#copies').textContent = state.layout === 'strip' ? `${state.copies}장 (${state.copies*2}줄)` : `${state.copies}장`;
}
$('#minus').onclick = () => { state.copies = Math.max(1, state.copies-1); paintCopies(); };
$('#plus').onclick  = () => { state.copies = Math.min(5, state.copies+1); paintCopies(); };
$('#toShoot').onclick = runShoot;

/* ---------- 3. 촬영 ---------- */
async function runShoot(){
  const sid = ++session;
  state.shots = []; state.selected = [];
  document.documentElement.style.setProperty('--ar', aspect());
  video.classList.toggle('mirror', settings.mirror);
  $('#thumbs').innerHTML = Array.from({length:settings.shots}, () => '<div></div>').join('');
  $('#count').textContent = '';
  $('#shotCounter').textContent = `1 / ${settings.shots}`;
  $('#shootMsg').textContent = '카메라를 준비하고 있어요';
  show('s-shoot');
  try { await startCamera(); }
  catch (e) { alert('카메라를 사용할 수 없어요.\n카메라 연결과 권한을 확인해 주세요.\n\n' + e.message); goHome(); return; }
  if (sid !== session) return;
  $('#shootMsg').textContent = '화면을 보고 포즈를 취해 주세요';
  await sleep(1500);
  for (let n = 0; n < settings.shots; n++) {
    if (sid !== session) return;
    $('#shotCounter').textContent = `${n+1} / ${settings.shots}`;
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
    const shot = capture();
    shot.clipP = stopClip();
    state.shots.push(shot);
    shutterSound();
    const fl = $('#flash'); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');
    $('#thumbs').children[n].innerHTML = `<img src="${shot.url}" alt="">`;
    await sleep(800);
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
function goDeco(){
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
  paintDeco();
  show('s-deco');
  startTimer(settings.limit, doPrint);
}
function paintDeco(){ render($('#decoPreview').getContext('2d'), {photos: chosenPhotos()}); }

FRAMES.forEach(f => {
  const b = document.createElement('button');
  b.className = 'sw' + (state.frame === f.id ? ' on' : '');
  b.innerHTML = `<i style="background:${f.css || f.bg}"></i>${f.name}`;
  b.onclick = () => { state.frame = f.id; $$('.sw').forEach(x => x.classList.toggle('on', x === b)); paintDeco(); };
  $('#frames').appendChild(b);
});
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
async function preparePrint(url, copies){
  const pa = $('#printArea');
  pa.style.setProperty('--s', settings.scale / 100);
  pa.style.setProperty('--ox', settings.offX + 'mm');
  pa.style.setProperty('--oy', settings.offY + 'mm');
  pa.innerHTML = '';
  for (let i = 0; i < copies; i++) {
    const d = document.createElement('div'); d.className = 'sheet';
    const img = new Image(); img.src = url; d.appendChild(img); pa.appendChild(d);
  }
  await Promise.all([...pa.querySelectorAll('img')].map(i => i.decode().catch(()=>{})));
}
async function doPrint(){
  if (printing) return;
  printing = true;
  clearTimer();
  const sid = session;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  render(c.getContext('2d'), {photos: chosenPhotos(), forPrint: true});
  state.finalUrl = c.toDataURL('image/jpeg', .95);
  const photoBlob = await new Promise(r => c.toBlob(r, 'image/jpeg', .92));
  $('#finalImg').src = state.finalUrl;
  $('#printMsg').textContent = '사진을 인쇄하고 있어요';
  $('#printMsg').classList.add('dots');
  resetQR();
  show('s-print');
  await preparePrint(state.finalUrl, state.copies);
  await sleep(400);
  if (sid !== session) return;
  window.print();          // Chrome --kiosk-printing 모드에서는 대화상자 없이 기본 프린터로 바로 인쇄
  countdownHome(settings.upload === 'off' ? 40 : 90);
  setTimeout(() => { if (sid === session) { $('#printMsg').textContent = '프린터에서 사진을 가져가세요'; $('#printMsg').classList.remove('dots'); } }, 25000);
  shareFlow(sid, photoBlob);
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
  await preparePrint(state.finalUrl, 1); window.print(); countdownHome(60);
};
$('.home2').onclick = goHome;
$$('.home').forEach(b => b.onclick = () => { if (confirm('처음 화면으로 돌아갈까요?\n찍은 사진은 사라집니다.')) goHome(); });

/* ---------- QR 다운로드 ---------- */
function resetQR(){
  const box = $('#qrBox');
  box.className = 'qrbox' + (settings.upload === 'off' ? ' off' : '');
  $('#qrCap').style.display = settings.upload === 'off' ? 'none' : '';
  $('#qrCap').innerHTML = liveEnabled() && settings.upload !== 'imgbb'
    ? '휴대폰 카메라로 QR 코드를 찍으면<br><b>사진과 움직이는 네컷 영상</b>을 받을 수 있어요'
    : '휴대폰 카메라로 QR 코드를 찍으면<br><b>사진</b>을 받을 수 있어요';
  qrStatus('QR 코드를 만들고 있어요');
}
function qrStatus(text, isErr){
  const box = $('#qrBox');
  box.classList.toggle('err', !!isErr);
  $('#qrState').innerHTML = isErr ? '' : '<div><div class="spinner"></div></div>';
  const t = document.createElement('div'); t.textContent = text;
  if (isErr) $('#qrState').appendChild(t); else $('#qrState').firstChild.appendChild(t);
}
function drawQR(canvas, text){
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(), size = canvas.width, cell = Math.floor(size / n), off = Math.floor((size - cell*n) / 2);
  const x = canvas.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, size, size); x.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let col = 0; col < n; col++)
    if (q.isDark(r, col)) x.fillRect(off + col*cell, off + r*cell, cell, cell);
}

async function postForm(url, fd){
  const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 45000);
  try {
    const r = await fetch(url, {method:'POST', body:fd, signal:ac.signal, credentials:'omit', referrerPolicy:'no-referrer'});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && (j.error.message || j.error)) || `HTTP ${r.status}`);
    return j;
  } finally { clearTimeout(to); }
}
// 업로드 후 휴대폰에서 바로 열 수 있는 https 주소를 돌려줌
async function uploadFile(blob, name){
  const isVideo = blob.type.startsWith('video/');
  const fd = new FormData();
  if (settings.upload === 'tmpfiles') {
    fd.append('file', blob, name);
    const j = await postForm('https://tmpfiles.org/api/v1/upload', fd);
    const u = j && j.data && j.data.url;
    if (!u) throw new Error('tmpfiles 응답 오류');
    return u.replace(/^http:/, 'https:').replace('tmpfiles.org/', 'tmpfiles.org/dl/');
  }
  if (settings.upload === 'imgbb') {
    if (isVideo) return null;                              // ImgBB는 사진만 지원
    if (!settings.imgbbKey) throw new Error('ImgBB API 키가 없어요');
    fd.append('image', blob, name);
    const j = await postForm(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(settings.imgbbKey)}&expiration=${settings.imgbbExpire}`, fd);
    if (!j.data || !j.data.url) throw new Error('ImgBB 응답 오류');
    return j.data.url;
  }
  if (settings.upload === 'cloudinary') {
    if (!settings.cloudName || !settings.cloudPreset) throw new Error('Cloudinary 설정이 비어 있어요');
    fd.append('file', blob, name); fd.append('upload_preset', settings.cloudPreset);
    const j = await postForm(`https://api.cloudinary.com/v1_1/${encodeURIComponent(settings.cloudName)}/auto/upload`, fd);
    if (!j.secure_url) throw new Error('Cloudinary 응답 오류');
    return j.secure_url;
  }
  return null;
}
function expiresAt(){
  if (settings.upload === 'tmpfiles') return Date.now() + 60*60*1000;
  if (settings.upload === 'imgbb') return Date.now() + settings.imgbbExpire*1000;
  return 0;
}
function downloadPage(){
  let base = (settings.pageUrl || '').trim();
  if (!base && location.protocol === 'https:') base = location.href;
  if (!base) return '';
  try {
    const u = new URL(base);
    if (!/\.html?$/.test(u.pathname)) u.pathname = u.pathname.replace(/\/?$/, '/') + 'download.html';
    else u.pathname = u.pathname.replace(/[^/]*$/, 'download.html');
    u.search = ''; u.hash = '';
    return u.href;
  } catch { return ''; }
}
function shareLink(photoUrl, videoUrl){
  const page = downloadPage();
  if (!page) return photoUrl;                        // 로컬 실행: 사진 주소로 바로 연결
  const u = new URL(page);
  u.searchParams.set('p', photoUrl);
  if (videoUrl) u.searchParams.set('v', videoUrl);
  const e = expiresAt(); if (e) u.searchParams.set('e', Math.round(e/1000));
  return u.href;
}

// 움직이는 네컷 영상 (고른 4컷의 셔터 직전 3초를 프레임에 넣어 왕복 재생)
async function makeLiveVideo(){
  if (!liveEnabled() || settings.upload === 'imgbb') return null;
  const mime = ['video/mp4;codecs=avc1.42E01E','video/mp4','video/webm;codecs=vp9','video/webm']
    .find(m => MediaRecorder.isTypeSupported(m));
  if (!mime) return null;
  const clips = await Promise.all(state.selected.map(async i => {
    const blobs = await (state.shots[i].clipP || Promise.resolve([]));
    return Promise.all(blobs.map(b => createImageBitmap(b)));
  }));
  const len = Math.min(...clips.map(c => c.length));
  if (!(len >= 5)) { clips.flat().forEach(b => b.close()); return null; }
  const VW = 800, VH = 1200;
  const c = document.createElement('canvas'); c.width = VW; c.height = VH;
  const x = c.getContext('2d');
  const seq = [...Array(len).keys()];
  const order = [...seq, ...seq.slice(1, -1).reverse(), ...seq];
  const stream = c.captureStream(0), track = stream.getVideoTracks()[0];
  const rec = new MediaRecorder(stream, {mimeType: mime, videoBitsPerSecond: 3_000_000});
  const chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise(r => rec.onstop = r);
  const draw = k => {
    x.setTransform(VW/W, 0, 0, VH/H, 0, 0);
    render(x, {photos: clips.map(cl => cl[k])});
    track.requestFrame && track.requestFrame();
  };
  draw(0); rec.start();
  for (const k of order) { draw(k); await sleep(1000 / CLIP_FPS); }
  for (let i = 0; i < 10; i++) { draw(len - 1); await sleep(100); }   // 마지막 장면 1초 정지
  rec.stop(); await stopped;
  stream.getTracks().forEach(t => t.stop());
  clips.flat().forEach(b => b.close());
  return new Blob(chunks, {type: mime.split(';')[0]});
}

async function shareFlow(sid, photoBlob){
  if (settings.upload === 'off' || !photoBlob) return;
  const stamp = new Date().toISOString().slice(0,16).replace(/[-:T]/g, '');
  const rand = Math.random().toString(36).slice(2, 8);
  const name = `fourcut_${stamp}_${rand}`;
  try {
    qrStatus('사진을 올리고 있어요');
    const [photoUrl, videoBlob] = await Promise.all([
      uploadFile(photoBlob, name + '.jpg'),
      makeLiveVideo().catch(() => null),
    ]);
    if (sid !== session) return;
    let videoUrl = null;
    if (videoBlob) {
      qrStatus('영상을 올리고 있어요');
      videoUrl = await uploadFile(videoBlob, name + (videoBlob.type.includes('mp4') ? '.mp4' : '.webm')).catch(() => null);
      if (sid !== session) return;
    }
    drawQR($('#qr'), shareLink(photoUrl, videoUrl));
    $('#qrBox').classList.add('ready');
    if (!videoUrl) $('#qrCap').innerHTML = '휴대폰 카메라로 QR 코드를 찍으면<br><b>사진</b>을 받을 수 있어요';
    countdownHome(60);
  } catch (e) {
    console.warn('QR 업로드 실패', e);
    if (sid === session) qrStatus('QR 코드를 만들지 못했어요. 인터넷 연결을 확인해 주세요.', true);
  }
}

/* ---------- 관리자 설정 ---------- */
const FIELDS = {
  mirror:['#o-mirror','check'], countdown:['#o-countdown','num',1,30], shots:['#o-shots','int',4,12],
  limit:['#o-limit','int',0,600], scale:['#o-scale','num',80,110], offX:['#o-offx','num',-10,10],
  offY:['#o-offy','num',-10,10], cutGuide:['#o-cut','check'], upload:['#o-upload','text'],
  imgbbKey:['#o-imgbbKey','text'], imgbbExpire:['#o-imgbbExpire','int',60,15552000],
  cloudName:['#o-cloudName','text'], cloudPreset:['#o-cloudPreset','text'],
  liveVideo:['#o-live','check'], pageUrl:['#o-pageUrl','text'], pin:['#o-pin','text'], deviceId:['#o-device','text'],
};
function paintUploadFields(){
  const v = $('#o-upload').value;
  $$('[data-for]').forEach(f => f.style.display = f.dataset.for === v ? '' : 'none');
}
$('#o-upload').addEventListener('change', paintUploadFields);
async function openSettings(){
  if ($('#settings').classList.contains('open')) return;
  if (settings.pin && prompt('관리자 비밀번호를 입력하세요') !== settings.pin) return;
  for (const [k, [sel, type]] of Object.entries(FIELDS)) {
    if (type === 'check') $(sel).checked = settings[k]; else $(sel).value = settings[k];
  }
  paintUploadFields();
  $('#settings').classList.add('open');
  try {
    // 장치 이름을 보려면 한 번 권한이 필요
    if (!stream) { const s = await navigator.mediaDevices.getUserMedia({video:true}); s.getTracks().forEach(t=>t.stop()); }
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    const sel = $('#o-device');
    sel.innerHTML = '<option value="">기본 카메라</option>';
    devs.forEach((d, i) => { const o = document.createElement('option'); o.value = d.deviceId; o.textContent = d.label || `카메라 ${i+1}`; sel.appendChild(o); });
    sel.value = settings.deviceId;
  } catch {}
}
function closeSettings(){
  for (const [k, [sel, type, min, max]] of Object.entries(FIELDS)) {
    const el = $(sel);
    if (type === 'check') settings[k] = el.checked;
    else if (type === 'text') settings[k] = el.value.trim();
    else {
      let v = parseFloat(el.value);
      if (isNaN(v)) v = DEFAULTS[k];
      v = Math.min(max, Math.max(min, v));
      settings[k] = type === 'int' ? Math.round(v) : v;
    }
  }
  saveSettings();
  stopCamera();                       // 카메라 변경 반영
  $('#settings').classList.remove('open');
}
$('#gear').onclick = e => { e.stopPropagation(); openSettings(); };
$('#closeSet').onclick = closeSettings;
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || $('#qrTest').classList.contains('open')) return;
  if ((e.key === 's' || e.key === 'S') && $('#s-start').classList.contains('active')) openSettings();
  if ((e.key === 'Enter' || e.key === ' ') && $('#s-start').classList.contains('active') && !$('#settings').classList.contains('open')) $('#s-start').click();
});
$('#fullscreen').onclick = () => document.documentElement.requestFullscreen?.().catch(()=>{});
function qrTest(msg, isErr, link){
  $('#qrTest').classList.add('open');
  $('#qrTestBox').classList.toggle('hide', !link);
  if (link) drawQR($('#qrTestCanvas'), link);
  $('#qrTestMsg').textContent = msg;
  $('#qrTestMsg').classList.toggle('err', !!isErr);
}
$('#qrTestClose').onclick = () => $('#qrTest').classList.remove('open');
$('#testUpload').onclick = async () => {
  closeSettings();
  if (settings.upload === 'off') return qrTest('QR 다운로드가 "사용 안 함"으로 되어 있어요.', true);
  qrTest('테스트 사진을 올리고 있어요…');
  const c = document.createElement('canvas'); c.width = 600; c.height = 900;
  const x = c.getContext('2d'); x.fillStyle = '#ffc9d9'; x.fillRect(0,0,600,900);
  x.fillStyle = '#7a2a45'; x.font = `64px ${FONT}`; x.textAlign = 'center'; x.fillText('QR 테스트 성공!', 300, 450);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', .9));
  try {
    const url = await uploadFile(blob, 'fourcut_test.jpg');
    // 올린 사진을 실제로 다시 열 수 있는지 확인
    let check = '';
    try {
      const r = await fetch(url, {cache:'no-store', credentials:'omit'});
      if (!r.ok) check = `오류 코드 ${r.status}` + (r.headers.get('x-cld-error') ? ` (${r.headers.get('x-cld-error')})` : '');
    } catch (e) { check = '확인 불가: ' + e.message; }
    if (check && !check.startsWith('확인 불가'))
      return qrTest(`업로드는 됐지만 올린 사진을 열 수 없어요.\n${check}\n\n사진 주소:\n${url}`, true);
    qrTest('업로드 성공!\n휴대폰 카메라로 QR을 찍어서 분홍색 "QR 테스트 성공!" 사진이 보이면 끝이에요.', false, shareLink(url, null));
  } catch (e) {
    const why = /fetch|network|load failed/i.test(e.message)
      ? '이 저장소가 웹페이지에서 올리는 것을 막고 있거나 인터넷 연결이 끊겼어요.'
      : e.message;
    qrTest(`업로드 실패\n${why}\n\n관리자 설정에서 업로드 방식을 Cloudinary로 바꿔 보세요.\n(오류 내용: ${e.message})`, true);
  }
};
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
  x.fillText('4 × 6 inch', W/2, H/2-120);
  x.font = `40px ${FONT}`;
  x.fillText('빨간 선: 용지 가장자리', W/2, H/2+90);
  x.fillText('파란 점선: 안쪽 2.4mm (사진 테두리 위치)', W/2, H/2+150);
  x.fillText('빨간 선이 조금 잘리는 것은 정상입니다', W/2, H/2+210);
  x.fillText('파란 선이 잘리면 크기 보정을 줄이세요', W/2, H/2+270);
  for (let mm = 0; mm <= 100; mm += 5) {       // 상단 mm 눈금
    const px = mm * 300 / 25.4 + 1;
    x.fillRect(px, 40, 2, mm % 10 ? 20 : 40);
  }
  await preparePrint(c.toDataURL('image/png'), 1);
  window.print();
};

/* 웹폰트가 늦게 로드되면 미리보기 다시 그리기 */
document.fonts && document.fonts.load('40px Jua').then(() => {
  if ($('#s-select').classList.contains('active')) paintSelect();
  if ($('#s-deco').classList.contains('active')) paintDeco();
}).catch(()=>{});
document.addEventListener('contextmenu', e => e.preventDefault());
paintCopies();
