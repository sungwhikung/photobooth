'use strict';
// 업로드에 쓰는 저장소 주소만 허용 (다른 주소를 넣은 링크는 열지 않음)
const ALLOWED = [
  {host:'tmpfiles.org', path:/^\/dl\/\d+\/[\w.-]+$/},
  {host:'i.ibb.co',     path:/^\/[\w-]+\/[\w.-]+$/},
  {host:'res.cloudinary.com', path:/^\/[\w-]+\/(image|video)\/upload\/[\w./-]+$/},
];
const $ = s => document.querySelector(s);

function safeUrl(raw, kind){
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    const rule = ALLOWED.find(a => a.host === u.hostname);
    if (!rule || !rule.path.test(u.pathname)) return null;
    const ext = (u.pathname.split('.').pop() || '').toLowerCase();
    if (kind === 'photo' && !['jpg','jpeg','png','webp'].includes(ext)) return null;
    if (kind === 'video' && !['mp4','webm','mov'].includes(ext)) return null;
    return u.href;
  } catch { return null; }
}
function fail(title, text){
  $('#content').hidden = true;
  $('#error').hidden = false;
  if (title) $('#errTitle').textContent = title;
  if (text) $('#errText').textContent = text;
}

const q = new URLSearchParams(location.search);
const photo = safeUrl(q.get('p'), 'photo');
const video = safeUrl(q.get('v'), 'video');
const exp = parseInt(q.get('e'), 10);

if (!photo) {
  fail('잘못된 주소예요', '사진관 화면의 QR 코드를 다시 찍어 주세요.');
} else if (exp && Date.now() > exp * 1000) {
  fail('보관 기간이 끝났어요', '사진은 개인정보 보호를 위해 일정 시간 후 자동으로 삭제돼요.');
} else {
  $('#content').hidden = false;
  const img = $('#photo');
  img.onerror = async () => {
    fail('사진을 불러오지 못했어요', '보관 기간이 지나 삭제되었거나 인터넷 연결이 불안정해요.');
    // 원인 확인용 정보 표시
    let code = '';
    try {
      const r = await fetch(photo, {cache:'no-store', credentials:'omit'});
      code = `오류 코드 ${r.status}` + (r.headers.get('x-cld-error') ? ` · ${r.headers.get('x-cld-error')}` : '');
    } catch (e) { code = '연결 실패 · ' + e.message; }
    const p = document.createElement('p'); p.className = 'diag'; p.textContent = code;
    const a = document.createElement('a'); a.href = photo; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.className = 'diag'; a.textContent = '원본 주소 직접 열어 보기';
    $('#error').append(p, a);
  };
  img.src = photo;
  if (exp) {
    const d = new Date(exp * 1000);
    $('#expire').innerHTML = '';
    $('#expire').append('이 사진은 ');
    const b = document.createElement('b');
    b.textContent = `${d.getMonth()+1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    $('#expire').append(b, '까지만 받을 수 있어요');
  }
  if (video) {
    $('#tabs').hidden = false;
    const v = $('#video');
    v.src = video;
    v.onerror = () => { $('#tabs').hidden = true; $('#videoCard').hidden = true; $('#photoCard').hidden = false; };
    document.querySelectorAll('.tab').forEach(t => t.onclick = () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === t));
      $('#photoCard').hidden = t.dataset.tab !== 'photo';
      $('#videoCard').hidden = t.dataset.tab !== 'video';
      if (t.dataset.tab === 'video') v.play().catch(()=>{});
    });
  }
}

const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
async function save(url, base, btn){
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = '준비 중…';
  try {
    const r = await fetch(url, {credentials:'omit', referrerPolicy:'no-referrer'});
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const blob = await r.blob();
    const ext = (url.split('.').pop() || 'jpg').toLowerCase();
    const file = new File([blob], `${base}.${ext}`, {type: blob.type || (ext === 'mp4' ? 'video/mp4' : 'image/jpeg')});
    if (isIOS && navigator.canShare && navigator.canShare({files:[file]})) {
      await navigator.share({files:[file]});
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(file); a.download = file.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;     // 사용자가 공유 창을 닫음
    window.open(url, '_blank', 'noopener');         // 저장소가 직접 받기를 막으면 원본을 새 창으로
  } finally {
    btn.disabled = false; btn.textContent = label;
  }
}
const stamp = new Date().toISOString().slice(0,10).replace(/-/g,'');
$('#savePhoto').onclick = e => save(photo, `네컷사진_${stamp}`, e.currentTarget);
$('#saveVideo').onclick = e => save(video, `움직이는네컷_${stamp}`, e.currentTarget);
