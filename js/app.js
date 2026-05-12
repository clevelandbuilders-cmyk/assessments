/* ── Helpers ─────────────────────────────────────────────────────────── */
const $  = id => document.getElementById(id);
const ts = t  => t?.toDate?.() || (t ? new Date(t) : new Date());
const fmt = t => ts(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function showToast(msg) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#111;color:#fff;padding:10px 20px;border-radius:8px;font-size:14px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.3);max-width:90vw;text-align:center';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}
window.showToast = showToast;

/* ── App State ───────────────────────────────────────────────────────── */
const state = {
  jobs:          [],
  currentJobId:  null,
  currentPhotos: [],
  teamMembers:   [],
  notifications: [],
  unsubJobs:     null,
  unsubPhotos:   null,
  unsubNotifs:   null,
};

/* ── Firebase init (skipped in demo mode) ────────────────────────────── */
if (!window.DEMO_MODE) {
  firebase.initializeApp(firebaseConfig);
  firebase.firestore().enablePersistence({ synchronizeTabs: true }).catch(() => {});
}

/* ── Auth flow ───────────────────────────────────────────────────────── */
Auth.init(onSignedIn, onSignedOut);

async function onSignedIn(user) {
  $('loadingScreen').hidden = true;
  $('loginScreen').hidden   = true;
  $('app').hidden           = false;

  // Show demo banner when not connected to Firebase
  if (window.DEMO_MODE && !$('demoBanner')) {
    const banner = document.createElement('div');
    banner.id = 'demoBanner';
    banner.style.cssText = 'background:#f59e0b;color:#000;text-align:center;font-size:13px;font-weight:500;padding:6px 16px;position:fixed;top:56px;left:0;right:0;z-index:99';
    banner.textContent = '⚠️ Demo Mode — data is stored only on this device. Add your Firebase config to enable cloud sync.';
    document.body.appendChild(banner);
    document.querySelector('.layout').style.marginTop = '30px';
  }

  const initials = (user.displayName || user.email || '?').charAt(0).toUpperCase();
  $('userBtn').textContent         = initials;
  $('userDisplayName').textContent = user.displayName || '';
  $('userEmail').textContent       = user.email || '';

  // Real-time listeners
  state.unsubJobs = DB.listenJobs(jobs => {
    state.jobs = jobs;
    renderJobList();
    if (state.currentJobId && !jobs.find(j => j.id === state.currentJobId)) {
      state.currentJobId = null;
      $('jobView').hidden   = true;
      $('emptyState').hidden = false;
    }
  });

  state.unsubNotifs = DB.listenNotifications(user.uid, notifs => {
    state.notifications = notifs;
    renderNotifBadge();
  });

  // Load team for tag modal
  state.teamMembers = await DB.getUsers();
}

function onSignedOut() {
  // Tear down listeners
  state.unsubJobs?.();
  state.unsubPhotos?.();
  state.unsubNotifs?.();
  state.unsubJobs = state.unsubPhotos = state.unsubNotifs = null;
  state.jobs = []; state.currentJobId = null; state.currentPhotos = [];

  $('loadingScreen').hidden = true;
  $('app').hidden           = true;
  $('loginScreen').hidden   = false;
}

/* ── Job list ────────────────────────────────────────────────────────── */
function renderJobList(filter) {
  filter = filter ?? $('jobSearch').value;
  const q        = filter.toLowerCase();
  const filtered = state.jobs.filter(j =>
    j.name.toLowerCase().includes(q) || (j.address || '').toLowerCase().includes(q)
  );

  $('jobList').innerHTML = '';
  $('sidebarEmpty').hidden = !!filtered.length || !!filter;

  filtered.forEach(j => {
    const li = document.createElement('li');
    li.className = 'job-item' + (j.id === state.currentJobId ? ' active' : '');
    li.innerHTML = `
      <div class="job-item-name">${escHtml(j.name)}</div>
      ${j.address ? `<div class="job-item-address">${escHtml(j.address)}</div>` : ''}
      <div class="job-item-meta">${fmt(j.createdAt)}</div>`;
    li.addEventListener('click', () => selectJob(j.id));
    $('jobList').appendChild(li);
  });
}

/* ── Select job ──────────────────────────────────────────────────────── */
function selectJob(id) {
  state.currentJobId = id;
  const job = state.jobs.find(j => j.id === id);
  if (!job) return;

  $('jobTitle').textContent   = job.name;
  $('jobAddress').textContent = job.address || '';
  $('jobDate').textContent    = 'Created ' + fmt(job.createdAt) + (job.notes ? ' · ' + job.notes : '');

  $('emptyState').hidden = true;
  $('jobView').hidden    = false;
  renderJobList();

  // Unsubscribe previous photo listener
  state.unsubPhotos?.();
  state.currentPhotos = [];
  $('photoGrid').innerHTML = '';

  state.unsubPhotos = DB.listenJobPhotos(id, photos => {
    state.currentPhotos = photos;
    renderPhotos();
  });

  // Close sidebar on mobile
  if (window.innerWidth < 640) $('sidebar').classList.add('collapsed');
}

/* ── Render photos ───────────────────────────────────────────────────── */
function renderPhotos() {
  $('photoGrid').innerHTML = '';
  state.currentPhotos.forEach(p => {
    const card = document.createElement('div');
    card.className = 'photo-card';
    card.dataset.id = p.id;

    const img = document.createElement('img');
    img.src     = p.annotatedUrl || p.originalUrl;
    img.alt     = '';
    img.loading = 'lazy';
    card.appendChild(img);

    const del = document.createElement('button');
    del.className = 'photo-delete';
    del.title     = 'Delete photo';
    del.textContent = '✕';
    del.addEventListener('click', e => { e.stopPropagation(); deletePhoto(p.id); });
    card.appendChild(del);

    if (p.tags?.length) {
      const dot = document.createElement('span');
      dot.className   = 'photo-tag-dot';
      dot.textContent = '👤 ' + p.tags.length;
      card.appendChild(dot);
    }

    card.addEventListener('click', () => openAnnotator(p.id));
    $('photoGrid').appendChild(card);
  });
}

/* ── Upload photos ───────────────────────────────────────────────────── */
async function addPhotosFromFiles(files) {
  if (!state.currentJobId || !files.length) return;
  const arr = Array.from(files);

  const progressEl = $('uploadProgress');
  const fillEl     = $('progressFill');
  const labelEl    = $('progressLabel');
  progressEl.hidden = false;

  for (let i = 0; i < arr.length; i++) {
    labelEl.textContent = `Uploading ${i + 1} of ${arr.length}…`;
    await DB.uploadPhoto(state.currentJobId, arr[i], pct => {
      fillEl.style.width = pct + '%';
    });
  }

  fillEl.style.width    = '100%';
  labelEl.textContent   = 'Done!';
  setTimeout(() => { progressEl.hidden = true; fillEl.style.width = '0%'; }, 1200);

  // Reset file input so the same file can be re-selected
  $('photoInput').value  = '';
  $('cameraInput').value = '';
}

async function deletePhoto(id) {
  if (!confirm('Delete this photo?')) return;
  await DB.deletePhoto(id);
}

/* ── Job CRUD ────────────────────────────────────────────────────────── */
let editingJobId = null;

function openJobModal(jobId = null) {
  editingJobId = jobId;
  $('jobModalTitle').textContent = jobId ? 'Edit Job' : 'New Job';
  if (jobId) {
    const j = state.jobs.find(j => j.id === jobId);
    $('jobName').value         = j.name;
    $('jobAddressInput').value = j.address || '';
    $('jobNotes').value        = j.notes   || '';
  } else {
    $('jobName').value = $('jobAddressInput').value = $('jobNotes').value = '';
  }
  $('jobModal').hidden = false;
  $('jobName').focus();
}

async function saveJob() {
  const name = $('jobName').value.trim();
  if (!name) { $('jobName').focus(); return; }
  const data = { name, address: $('jobAddressInput').value.trim(), notes: $('jobNotes').value.trim() };

  if (editingJobId) {
    await DB.updateJob(editingJobId, data);
  } else {
    const id = await DB.addJob(data);
    // Wait for the listener to pick it up, then select
    setTimeout(() => selectJob(id), 300);
  }
  $('jobModal').hidden = true;
}

async function deleteCurrentJob() {
  if (!state.currentJobId) return;
  const job = state.jobs.find(j => j.id === state.currentJobId);
  if (!confirm(`Delete "${job?.name}" and all its photos? This cannot be undone.`)) return;

  state.unsubPhotos?.();
  state.unsubPhotos  = null;
  const id           = state.currentJobId;
  state.currentJobId = null;
  $('jobView').hidden    = true;
  $('emptyState').hidden = false;

  await DB.deleteJob(id);
}

/* ── Notifications ───────────────────────────────────────────────────── */
function renderNotifBadge() {
  const unread = state.notifications.filter(n => !n.read).length;
  $('notifBadge').hidden      = !unread;
  $('notifBadge').textContent = unread > 9 ? '9+' : String(unread);
}

function renderNotifPanel() {
  const list  = $('notifList');
  const empty = $('notifEmpty');
  list.innerHTML = '';
  if (!state.notifications.length) { empty.hidden = false; return; }
  empty.hidden = true;
  state.notifications.forEach(n => {
    const li = document.createElement('li');
    li.className = 'notif-item' + (n.read ? '' : ' notif-unread');
    li.innerHTML = `<strong>${escHtml(n.fromName)} tagged you</strong>${escHtml(n.message)}<br><time>${fmt(n.createdAt)}</time>`;
    list.appendChild(li);
  });
}

/* ── Tag photo ───────────────────────────────────────────────────────── */
let taggingPhotoId = null;

async function openTagModal(photoId) {
  taggingPhotoId = photoId;
  $('tagMessage').value = '';

  // Refresh team list
  state.teamMembers = await DB.getUsers();
  const currentUid  = Auth.currentUser?.uid;
  const sel         = $('tagMemberSelect');
  sel.innerHTML     = '<option value="">-- Select a member --</option>';
  state.teamMembers
    .filter(m => m.uid !== currentUid)
    .forEach(m => {
      const opt = document.createElement('option');
      opt.value       = m.uid;
      opt.textContent = m.name || m.email;
      sel.appendChild(opt);
    });

  if (sel.options.length === 1) {
    showToast('No other team members found. Have them create an account first.');
    return;
  }

  $('tagModal').hidden = false;
}

async function sendTag() {
  const toUid = $('tagMemberSelect').value;
  if (!toUid) { alert('Please select a team member.'); return; }

  const member  = state.teamMembers.find(m => m.uid === toUid);
  const message = $('tagMessage').value.trim() || 'You were tagged in a photo';
  const photo   = state.currentPhotos.find(p => p.id === taggingPhotoId);
  const job     = state.jobs.find(j => j.id === state.currentJobId);
  if (!photo || !job) return;

  const tags = [...(photo.tags || []), {
    memberId:   toUid,
    memberName: member?.name || member?.email || '',
    message,
    ts:         Date.now(),
  }];

  await Promise.all([
    DB.updatePhotoTags(taggingPhotoId, tags),
    DB.addNotification({
      toUid,
      fromUid:  Auth.currentUser.uid,
      fromName: Auth.currentUser.displayName || Auth.currentUser.email,
      photoId:  taggingPhotoId,
      jobId:    state.currentJobId,
      jobName:  job.name,
      message,
    }),
  ]);

  $('tagModal').hidden = true;
  showToast(`${member?.name || 'Team member'} has been tagged and notified.`);
}

/* ── Annotator bridge ────────────────────────────────────────────────── */
function openAnnotator(photoId) {
  const photo = state.currentPhotos.find(p => p.id === photoId);
  if (!photo) return;
  $('photoModal').hidden = false;
  if (window.annotator) window.annotator.load(photo);
}
window.openAnnotator = openAnnotator;
window.appState      = state;

/* ── Event wiring ────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // Sidebar toggle
  $('menuBtn').addEventListener('click', () => $('sidebar').classList.toggle('collapsed'));

  // Job CRUD
  $('addJobBtn').addEventListener('click', () => openJobModal());
  $('cancelJobBtn').addEventListener('click', () => { $('jobModal').hidden = true; });
  $('saveJobBtn').addEventListener('click', saveJob);
  $('jobName').addEventListener('keydown', e => { if (e.key === 'Enter') saveJob(); });
  $('editJobBtn').addEventListener('click', () => openJobModal(state.currentJobId));
  $('deleteJobBtn').addEventListener('click', deleteCurrentJob);

  // Search
  $('jobSearch').addEventListener('input', e => renderJobList(e.target.value));

  // Photo uploads
  $('photoInput').addEventListener('change',  e => addPhotosFromFiles(e.target.files));
  $('cameraInput').addEventListener('change', e => addPhotosFromFiles(e.target.files));

  // Drag & drop
  const dz = $('dropZone');
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', ()  => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('drag-over');
    if (state.currentJobId) addPhotosFromFiles(e.dataTransfer.files);
  });

  // Notifications
  $('notifBtn').addEventListener('click', e => {
    e.stopPropagation();
    const panel = $('notifPanel');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      renderNotifPanel();
      DB.markAllNotificationsRead(Auth.currentUser.uid).then(renderNotifBadge);
    }
  });
  $('clearNotifs').addEventListener('click', () => {
    DB.markAllNotificationsRead(Auth.currentUser?.uid).then(() => {
      renderNotifBadge();
      renderNotifPanel();
    });
  });
  document.addEventListener('click', () => { $('notifPanel').hidden = true; });

  // Annotator close
  $('closeAnnotatorBtn').addEventListener('click', () => { $('photoModal').hidden = true; });

  // Tag
  $('tagBtn').addEventListener('click', () => {
    if (window.annotator?.currentPhotoId) openTagModal(window.annotator.currentPhotoId);
  });
  $('cancelTagBtn').addEventListener('click', () => { $('tagModal').hidden = true; });
  $('sendTagBtn').addEventListener('click', sendTag);
});
