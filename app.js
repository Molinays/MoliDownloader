const API = 'http://127.0.0.1:7979';
let currentTab = 'video';
let logJobId = null;
let logInterval = null;
const finishedJobs = new Set();

// Init
fetch(API + '/api/defaults').then(r => r.json()).then(d => {
  document.getElementById('outputDir').value = d.output_dir || '';
  document.getElementById('outputDirAudio').value = d.output_dir || '';
  document.getElementById('exeStatus').textContent = d.exe_found ? 'Trovato' : 'Mancante!';
  if (!d.exe_found) document.getElementById('exeStatus').style.color = 'var(--red)';
  document.getElementById('statusDot').title = 'Server OK';
}).catch(() => {
  document.getElementById('statusDot').className = 'status-dot error';
  document.getElementById('statusDot').title = 'Server non raggiungibile';
});

function setTab(tab) {
  currentTab = tab;
  document.getElementById('tabVideo').className = tab === 'video' ? 'tab active' : 'tab';
  document.getElementById('tabAudio').className = tab === 'audio' ? 'tab active' : 'tab';
  document.getElementById('videoSettings').style.display = tab === 'video' ? '' : 'none';
  document.getElementById('audioSettings').style.display = tab === 'audio' ? '' : 'none';
}

async function pickFolder(which) {
  const id = which === 'audio' ? 'outputDirAudio' : 'outputDir';
  try {
    // Native OS folder picker (Chrome/Edge)
    const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
    document.getElementById(id).value = dir.name;
    // Store full handle in dataset for later use if needed
    document.getElementById(id)._dirHandle = dir;
  } catch (e) {
    if (e.name !== 'AbortError') {
      // Fallback: manual input
      const cur = document.getElementById(id).value;
      const val = prompt('Percorso cartella output:', cur);
      if (val !== null) document.getElementById(id).value = val.trim();
    }
  }
}

function toast(msg, type = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = (type === 'ok' ? 'Partito' : 'Errore') + msg;
  el.className = 'toast show ' + type;
  setTimeout(() => el.className = 'toast', 3000);
}

async function startDownload() {
  const url = document.getElementById('urlInput').value.trim();
  if (!url) { toast('Inserisci un URL', 'err'); return; }

  const btn = document.getElementById('dlBtn');
  btn.disabled = true;
  btn.textContent = 'Avvio...';

  const outputDir = currentTab === 'audio'
    ? document.getElementById('outputDirAudio').value
    : document.getElementById('outputDir').value;

  const payload = {
    url,
    format: currentTab,
    quality: document.getElementById('quality').value,
    audio_format: document.getElementById('audioFormat').value,
    audio_quality: document.getElementById('audioQuality').value,
    output_dir: outputDir,
    output_template: document.getElementById('outputTmpl').value || '%(title)s.%(ext)s',
    subtitles: document.getElementById('subtitles').checked,
    sub_langs: document.getElementById('subLangs').value || 'en',
    embed_subs: document.getElementById('embedSubs').checked,
    embed_thumb: document.getElementById('embedThumb').checked,
    playlist: document.getElementById('playlist').checked,
    metadata: document.getElementById('metadata').checked,
    sponsorblock: document.getElementById('sponsorblock').checked,
    geo_bypass: document.getElementById('geoBypass').checked,
    rate_limit: document.getElementById('rateLimit').value,
    retries: parseInt(document.getElementById('retries').value) || 10,
    concurrent_fragments: parseInt(document.getElementById('concurrentFragments').value) || 4,
    cookies_from: document.getElementById('cookiesFrom').value,
    proxy: document.getElementById('proxy').value,
  };

  try {
    const res = await fetch(API + '/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
      toast('Download avviato: ' + data.job_id);
      document.getElementById('urlInput').value = '';
    } else {
      toast(data.error || 'Errore', 'err');
    }
  } catch (e) {
    toast('Server non raggiungibile', 'err');
  }

  btn.disabled = false;
  btn.textContent = '⬇ Download';
}

async function refreshJobs() {
  try {
    const res = await fetch(API + '/api/jobs');
    const jobs = await res.json();
    renderJobs(jobs.reverse());
  } catch { }
}

function renderJobs(jobs) {
  const el = document.getElementById('jobsList');
  if (!jobs.length) {
    el.innerHTML = '<div class="empty-state"><span class="empty-icon">📭</span>Nessun download ancora</div>';
    return;
  }
  el.innerHTML = jobs.map(j => jobHTML(j)).join('');
}

function jobHTML(j) {
  const pct = Math.min(100, j.progress || 0);
  const urlShort = (j.url || '').replace(/^https?:\/\/(www\.)?/, '').substring(0, 60);
  const meta = [
    j.speed ? `${j.speed}` : '',
    j.eta ? `${j.eta}` : '',
    `${pct}%`
  ].filter(Boolean).join(' · ');

  const canCancel = ['queued', 'running'].includes(j.status);

  return `<div class="job-card ${j.status}" id="job-${j.id}">
    <div class="job-header">
      <span class="job-url" title="${j.url}">${urlShort}</span>
      <span class="job-status ${j.status}">${j.status}</span>
    </div>
    <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
    <div class="job-meta">${meta}</div>
    <div class="job-actions">
      ${canCancel ? `<button class="btn-sm btn-cancel" onclick="cancelJob('${j.id}')">✕ Annulla</button>` : ''}
      <button class="btn-sm btn-log" onclick="openLog('${j.id}')">Log</button>
    </div>
  </div>`;
}

async function cancelJob(id) {
  if (!confirm('Annullare il download?')) return;
  await fetch(API + '/api/jobs/' + id + '/cancel', { method: 'POST' });
  toast('Annullato');
  refreshJobs();
}

function clearDone() {
  finishedJobs.clear();
  fetch(API + '/api/jobs').then(r => r.json()).then(jobs => {
    const active = jobs.filter(j => !['done', 'error', 'cancelled'].includes(j.status));
    renderJobs(active.reverse());
  });
}

async function openLog(id) {
  logJobId = id;
  document.getElementById('modalTitle').textContent = 'Log — ' + id;
  document.getElementById('logModal').className = 'modal-overlay open';
  await loadLog(id);
  if (logInterval) clearInterval(logInterval);
  logInterval = setInterval(() => loadLog(logJobId), 1000);
}

async function loadLog(id) {
  try {
    const res = await fetch(API + '/api/jobs/' + id);
    const job = await res.json();
    const box = document.getElementById('logBox');
    const lines = (job.log || []).join('\n');
    box.textContent = lines || '(nessun output ancora)';
    box.scrollTop = box.scrollHeight;
  } catch (e) {
    document.getElementById('logBox').textContent = 'Errore nel caricare il log';
  }
}

function closeModal() {
  document.getElementById('logModal').className = 'modal-overlay';
  if (logInterval) { clearInterval(logInterval); logInterval = null; }
}

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
  if (e.key === 'Enter' && document.activeElement === document.getElementById('urlInput')) startDownload();
});

// Poll jobs ogni 1.5s
setInterval(refreshJobs, 1500);
refreshJobs();
