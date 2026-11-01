'use strict';
/* 네컷 사진 받기 – QR 코드를 찍으면 휴대폰에서 열리는 페이지 */
const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FOLDER = 'fourcut';                  // booth.js의 CLOUD_FOLDER와 같아야 함
// 이 저장소 주소만 열어요 (다른 주소를 끼워 넣은 가짜 링크 차단)
const ALLOWED = [
  {host:'res.cloudinary.com', path:/^\/[\w-]+\/(image|video)\/upload\/[\w./-]+$/},
  {host:'i.ibb.co',           path:/^\/[\w-]+\/[\w.-]+$/},
];
const ua = navigator.userAgent;
const isIOS = /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(ua);
const isKakao = /KAKAOTALK/i.test(ua);
const inApp = isKakao || /NAVER\(inapp|Instagram|FBAN|FBAV|Line\/|DaumApps|everytimeApp|BAND\/|; wv\)/i.test(ua);

function safeUrl(raw, kind){
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    const rule = ALLOWED.find(a => a.host === u.hostname);
    if (!rule || !rule.path.test(u.pathname)) return null;
    const ext = (u.pathname.split('.').pop() || '').toLowerCase();
    if (kind === 'photo' && !['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return null;
    if (kind === 'video' && !['mp4', 'webm', 'mov'].includes(ext)) return null;
    return u.href;
  } catch { return null; }
}
function dateFromId(s){
  const m = /^(\d{2})(\d{2})(\d{2})/.exec(s || '');
  if (!m) return null;
  const d = new Date(2000 + +m[1], +m[2] - 1, +m[3]);
  return isNaN(d) ? null : d;
}
// 주소 해석: #c=클라우드&i=사진번호 (Cloudinary) 또는 #p=사진주소 (그 밖의 저장소)
function parse(){
  const q = new URLSearchParams(location.hash.length > 1 ? location.hash.slice(1) : location.search.slice(1));
  const keep = parseInt(q.get('k'), 10) || 0;
  const c = q.get('c'), i = q.get('i');
  if (c || i) {
    if (!/^[a-z0-9_-]{2,60}$/i.test(c || '') || !/^[a-z0-9]{8,40}$/.test(i || '')) return null;
    const base = `https://res.cloudinary.com/${c}`;
    return {
      photo: v => `${base}/image/upload/v${v}/${FOLDER}/${i}.jpg`,
      video: q.get('v') === '1' ? (v => `${base}/video/upload/v${v}/${FOLDER}/${i}.mp4`) : null,
      created: dateFromId(i), keep, poll: true,
    };
  }
  const p = safeUrl(q.get('p'), 'photo');
  if (!p) return null;
  const m = safeUrl(q.get('m'), 'video');
  return {photo: () => p, video: m ? () => m : null, created: dateFromId(q.get('d')), keep, poll: false};
}

function toast(text, ms = 3500){
  const t = $('#toast'); t.textContent = text; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms);
}
function fail(title, text, diag, canRetry){
  $('#loading').hidden = true; $('#content').hidden = true; $('#error').hidden = false;
  $('#errTitle').textContent = title;
  $('#errText').textContent = text || '';
  $('#diag').textContent = diag || '';
  $('#retry').hidden = !canRetry;
}

// 사진이 아직 올라가는 중이면 404가 나오므로 잠시 간격을 두고 다시 확인
async function fetchBlob(makeUrl, {maxMs, poll, onTick}){
  const t0 = Date.now();
  let n = 0, last = '';
  for (;;) {
    n++;
    try {
      // 버전 번호를 매번 바꿔서 중간 캐시를 피함 (Cloudinary는 버전 번호를 무시하고 최신 파일을 줌)
      const r = await fetch(makeUrl(Math.floor(Date.now() / 1000) + n), {cache:'no-store', credentials:'omit', referrerPolicy:'no-referrer'});
      if (r.ok) { const b = await r.blob(); if (b.size > 0) return b; last = 'empty'; }
      else {
        last = `HTTP ${r.status}`;
        if ([401, 403].includes(r.status) && n >= 3) break;   // 권한 문제는 기다려도 안 풀림
      }
    } catch (e) { last = 'network'; }
    if (!poll || Date.now() - t0 > maxMs) break;
    if (onTick) onTick(Math.round((Date.now() - t0) / 1000));
    await sleep(Math.min(1000 + n * 300, 3000));
  }
  const e = new Error(last); e.code = last; throw e;
}

const info = parse();
let photoBlob = null, videoBlob = null, photoDirect = null;

function showInApp(){
  $('#inapp').hidden = false;
  const btn = $('#openExternal');
  if (isKakao) {
    btn.onclick = () => { location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(location.href); };
  } else if (isAndroid) {
    // 안드로이드: 크롬으로 열기 (# 대신 ? 로 넘김)
    btn.onclick = () => {
      const u = location.host + location.pathname + (location.hash ? '?' + location.hash.slice(1) : location.search);
      location.href = `intent://${u}#Intent;scheme=https;package=com.android.chrome;end`;
    };
  } else {
    btn.hidden = true;
    $('#inappText').textContent = '저장이 안 되면 화면의 ··· 메뉴에서 “Safari로 열기”를 눌러 주세요.';
  }
}

function showExpiry(){
  if (!info.created || !(info.keep > 0)) return true;
  const end = new Date(info.created.getFullYear(), info.created.getMonth(), info.created.getDate() + info.keep, 23, 59, 59);
  if (Date.now() > end.getTime()) {
    fail('보관 기간이 끝났어요', '사진은 개인정보 보호를 위해 정해진 기간 동안만 받을 수 있어요.');
    return false;
  }
  const el = $('#expire'); el.textContent = '';
  const b = document.createElement('b'); b.textContent = `${end.getMonth() + 1}월 ${end.getDate()}일`;
  el.append('이 사진은 ', b, '까지 받을 수 있어요. 지금 저장해 두세요!');
  return true;
}

async function main(){
  $('#error').hidden = true; $('#content').hidden = true; $('#loading').hidden = false;
  $('#loadingText').textContent = '잠시만 기다려 주세요';
  if (!info) return fail('잘못된 주소예요', '사진관 화면의 QR 코드를 다시 찍어 주세요.');
  if (!showExpiry()) return;
  try {
    photoBlob = await fetchBlob(info.photo, {maxMs: 150000, poll: info.poll, onTick: s => {
      if (s >= 6) $('#loadingText').textContent = `사진관에서 사진을 올리는 중이에요 (${s}초)`;
    }});
    showPhoto(URL.createObjectURL(photoBlob));
  } catch (e) {
    if (!info.poll) {                       // CORS를 막는 저장소: 그림만 직접 띄우기
      photoDirect = info.photo();
      const img = $('#photo');
      img.onload = () => showPhoto(null);
      img.onerror = () => fail('사진을 불러오지 못했어요', '보관 기간이 지나 삭제되었거나 인터넷 연결이 불안정해요.', e.code, true);
      img.src = photoDirect;
      return;
    }
    if (/HTTP 40[13]/.test(e.code)) return fail('사진을 열 수 없어요', '사진 저장소의 공개 설정을 확인해야 해요. 사진관 운영자에게 알려 주세요.', e.code, true);
    return fail('사진이 아직 준비되지 않았어요', '사진관의 인터넷이 느리면 조금 걸릴 수 있어요. 잠시 후 다시 시도해 주세요.', e.code, true);
  }
  if (info.video) loadVideo();
}
function showPhoto(objectUrl){
  if (objectUrl) $('#photo').src = objectUrl;
  $('#loading').hidden = true; $('#content').hidden = false;
  $('#tip').textContent = isIOS
    ? '“사진 저장하기”를 누르고 “이미지 저장”을 고르세요. 사진을 길게 눌러도 저장돼요.'
    : '저장한 사진은 갤러리의 “Download(다운로드)” 앨범에 있어요. 사진을 길게 눌러도 저장돼요.';
}
async function loadVideo(){
  $('#videoWait').hidden = false;
  try {
    videoBlob = await fetchBlob(info.video, {maxMs: 240000, poll: info.poll});
    const v = $('#video');
    v.onerror = () => { $('#tabs').hidden = true; selectTab('photo'); };
    v.src = URL.createObjectURL(videoBlob);
    $('#tabs').hidden = false;
  } catch {} finally { $('#videoWait').hidden = true; }
}
function selectTab(name){
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x.dataset.tab === name));
  $('#photoCard').hidden = name !== 'photo';
  $('#videoCard').hidden = name !== 'video';
  if (name === 'video') $('#video').play().catch(() => {});
}
document.querySelectorAll('.tab').forEach(t => t.onclick = () => selectTab(t.dataset.tab));

async function save(blob, filename, btn){
  if (!blob) { if (photoDirect) window.open(photoDirect, '_blank', 'noopener'); return; }
  const type = blob.type || (filename.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg');
  const file = new File([blob], filename, {type});
  // 아이폰은 공유 창의 “이미지 저장”으로 사진 앱에 바로 저장
  if ((isIOS || inApp) && navigator.canShare && navigator.canShare({files:[file]})) {
    try { await navigator.share({files:[file]}); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  toast(isIOS ? '저장 창이 뜨면 “저장”을 눌러 주세요' : '저장했어요! 갤러리나 다운로드 폴더를 확인해 주세요');
}
const stamp = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`; };
$('#savePhoto').onclick = () => save(photoBlob, `네컷사진_${stamp()}.jpg`, $('#savePhoto'));
$('#saveVideo').onclick = () => save(videoBlob, `움직이는네컷_${stamp()}.${videoBlob && /webm/.test(videoBlob.type) ? 'webm' : 'mp4'}`, $('#saveVideo'));
$('#retry').onclick = () => main();

window.addEventListener('hashchange', () => location.reload());   // 다른 QR 주소로 바뀌면 새로 열기
if (inApp) showInApp();
main();
