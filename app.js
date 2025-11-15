// Synapse v1.0 — main app logic (BOA light theme)
// Auth0 config (from you)
const AUTH0_DOMAIN = "synapse.ca.auth0.com";
const AUTH0_CLIENT_ID = "CwHqV2oGQEDbNUvjJrQzF63DwTrAYNHJ";
const CALLBACK_URL = "https://nosh-ii.github.io/synapse_scoring/";

// DOM refs
const bandsBody = document.getElementById('bandsBody');
const finalsBody = document.getElementById('finalsBody');
const finalsX = document.getElementById('finalsX');
const addBandBtn = document.getElementById('addBand');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const clearBtn = document.getElementById('clearBtn');
const workspaceSelect = document.getElementById('workspaceSelect');
const newWorkspaceBtn = document.getElementById('newWorkspaceBtn');
const renameWorkspaceBtn = document.getElementById('renameWorkspaceBtn');
const deleteWorkspaceBtn = document.getElementById('deleteWorkspaceBtn');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const guestBtn = document.getElementById('guestBtn');
const userLabel = document.getElementById('userLabel');
const exportCSVLink = document.getElementById('exportCSV');

// state
let auth0 = null;
let isAuthenticated = false;
let user = null;
let state = { bands: [], finalX: 5 };
let currentWorkspace = 'default_guest'; // default guest workspace key

// Helpers
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const uidKey = u => `synapse_${u}`;

// --- Auth0 Integration (CDN createAuth0Client is available) ---
async function initAuth() {
  try {
    auth0 = await createAuth0Client({
      domain: AUTH0_DOMAIN,
      client_id: AUTH0_CLIENT_ID,
      authorizationParams: { redirect_uri: CALLBACK_URL },
      cacheLocation: 'localstorage',
      useRefreshTokens: true
    });

    // Handle redirect callback if present
    if (window.location.search.includes('code=') && window.location.search.includes('state=')) {
      try { await auth0.handleRedirectCallback(); } catch(e) { console.warn('Callback handling error', e); }
      window.history.replaceState({}, document.title, CALLBACK_URL);
    }

    isAuthenticated = await auth0.isAuthenticated();
    if (isAuthenticated) { user = await auth0.getUser(); onLogin(); }
    else { updateAuthUI(); loadWorkspaceFromStorage(); }
  } catch (err) { console.error('Auth init error', err); updateAuthUI(); loadWorkspaceFromStorage(); }
}

function updateAuthUI() {
  if (isAuthenticated && user) {
    userLabel.textContent = `Signed in as ${user.name || user.email}`;
    loginBtn.style.display = 'none';
    logoutBtn.style.display = 'inline-block';
    guestBtn.style.display = 'none';
  } else {
    userLabel.textContent = 'Not signed in';
    loginBtn.style.display = 'inline-block';
    logoutBtn.style.display = 'none';
    guestBtn.style.display = 'inline-block';
  }
}

async function login() {
  if (!auth0) return alert('Auth not initialized');
  await auth0.loginWithRedirect({ authorizationParams: { redirect_uri: CALLBACK_URL } });
}

async function logout() {
  if (!auth0) return;
  await auth0.logout({ logoutParams: { returnTo: CALLBACK_URL } });
  // after logout, reset to guest workspace
  isAuthenticated = false; user = null;
  currentWorkspace = 'default_guest'; loadWorkspaceFromStorage(); updateAuthUI();
}

async function onLogin() {
  isAuthenticated = true;
  user = await auth0.getUser();
  // set workspace to user-specific default
  currentWorkspace = uidKey(user.sub) + '_default';
  // migrate guest data if any
  migrateGuestToUser();
  updateWorkspaceList();
  loadWorkspaceFromStorage();
  updateAuthUI();
}

// --- Storage & Workspaces ---
function storageKeyForWorkspace(ws) { return `synapse_workspace::${ws}`; }

function saveState() {
  try { localStorage.setItem(storageKeyForWorkspace(currentWorkspace), JSON.stringify(state)); } catch(e) { console.warn('Save failed', e); }
}

function loadWorkspaceFromStorage() {
  const raw = localStorage.getItem(storageKeyForWorkspace(currentWorkspace));
  if (raw) state = JSON.parse(raw);
  else state = { bands: [], finalX: Number(finalsX.value) || 5 };
  state.bands = state.bands || [];
  state.finalX = state.finalX || Number(finalsX.value) || 5;
  renderAllRows();
  recalcAndApplyRanks();
  updateWorkspaceList();
}

function updateWorkspaceList() {
  const keys = Object.keys(localStorage).filter(k => k.startsWith('synapse_workspace::'));
  workspaceSelect.innerHTML = '';
  if (!keys.includes(storageKeyForWorkspace(currentWorkspace))) {
    localStorage.setItem(storageKeyForWorkspace(currentWorkspace), JSON.stringify(state));
    keys.push(storageKeyForWorkspace(currentWorkspace));
  }
  keys.forEach(k => {
    const opt = document.createElement('option');
    opt.value = k.replace('synapse_workspace::','');
    opt.textContent = opt.value.replace(uidKey(''),'').replace(/_/g,' ');
    if (opt.value === currentWorkspace) opt.selected = true;
    workspaceSelect.appendChild(opt);
  });
}

function createNewWorkspace() {
  const name = prompt('New workspace name (no slashes):');
  if (!name) return;
  const owner = isAuthenticated && user ? uidKey(user.sub) : 'guest';
  const key = owner + '_' + name.replace(/\s+/g,'_');
  currentWorkspace = key;
  state = { bands: [], finalX: Number(finalsX.value) || 5 };
  saveState(); updateWorkspaceList(); renderAllRows(); recalcAndApplyRanks();
}

function renameWorkspace() {
  const newName = prompt('New workspace name:');
  if (!newName) return;
  const newKey = (currentWorkspace.split('_')[0]) + '_' + newName.replace(/\s+/g,'_');
  const raw = localStorage.getItem(storageKeyForWorkspace(currentWorkspace));
  if (raw) { localStorage.setItem(storageKeyForWorkspace(newKey), raw); localStorage.removeItem(storageKeyForWorkspace(currentWorkspace)); currentWorkspace = newKey; updateWorkspaceList(); }
}

function deleteWorkspace() {
  if (!confirm('Delete current workspace? This cannot be undone.')) return;
  localStorage.removeItem(storageKeyForWorkspace(currentWorkspace));
  currentWorkspace = 'default_guest';
  loadWorkspaceFromStorage();
}

function migrateGuestToUser() {
  try {
    const guestRaw = localStorage.getItem(storageKeyForWorkspace('default_guest'));
    if (!guestRaw) return;
    const userKey = uidKey(user.sub) + '_default';
    const userRaw = localStorage.getItem(storageKeyForWorkspace(userKey));
    if (!userRaw) { localStorage.setItem(storageKeyForWorkspace(userKey), guestRaw); }
  } catch(e){ console.warn('migrate error', e); }
}

// --- Scoring logic ---
function computeBand(b) {
  const ge = num(b.ge1)+num(b.ge2)+num(b.ge3);
  const visual = num(b.vpi)+num(b.vpe);
  const music = num(b.mpi)+num(b.mpe);
  const penalty = num(b.penalty);
  const total = Math.round((ge + visual + music - penalty) * 100)/100;
  return { ge, visual, music, penalty, total };
}

function recalcRanks() {
  state.bands.forEach(b => b._computed = computeBand(b));
  const arr = state.bands.map((b,i)=>({i,tot:b._computed.total})).sort((a,b)=> b.tot - a.tot);
  arr.forEach((it, idx) => { state.bands[it.i]._computed.overall = idx+1; });
  const byClass = {};
  arr.forEach(it => { const cls = state.bands[it.i].cls || 'Unknown'; byClass[cls] = byClass[cls] || []; byClass[cls].push(it); });
  Object.keys(byClass).forEach(cls => { byClass[cls].forEach((it, idx) => state.bands[it.i]._computed.classRank = idx+1); });
}

// --- Table rendering & per-input updates (no full rerender on input) ---
function createRow(i) {
  const b = state.bands[i];
  const tr = document.createElement('tr');
  tr.dataset.i = i;
  tr.innerHTML = `
    <td><input class="input name" data-field="name" type="text" value="${escapeHtml(b.name||'')}" /></td>
    <td><input class="input city" data-field="city" type="text" value="${escapeHtml(b.city||'')}" /></td>
    <td><select class="input cls" data-field="cls">${classOptions(b.cls)}</select></td>
    <td><input class="input ge1" data-field="ge1" type="number" min="0" max="20" value="${b.ge1||0}" /></td>
    <td><input class="input ge2" data-field="ge2" type="number" min="0" max="20" value="${b.ge2||0}" /></td>
    <td><input class="input ge3" data-field="ge3" type="number" min="0" max="20" value="${b.ge3||0}" /></td>
    <td class="calc geCell"></td>
    <td><input class="input vpi" data-field="vpi" type="number" min="0" max="10" value="${b.vpi||0}" /></td>
    <td><input class="input vpe" data-field="vpe" type="number" min="0" max="10" value="${b.vpe||0}" /></td>
    <td class="calc visualCell"></td>
    <td><input class="input mpi" data-field="mpi" type="number" min="0" max="10" value="${b.mpi||0}" /></td>
    <td><input class="input mpe" data-field="mpe" type="number" min="0" max="10" value="${b.mpe||0}" /></td>
    <td class="calc musicCell"></td>
    <td><input class="input penalty" data-field="penalty" type="number" value="${b.penalty||0}" /></td>
    <td class="calc totalCell"></td>
    <td class="rank overallCell"></td>
    <td class="rank classCell"></td>
    <td><button class="delBtn" title="Delete">✕</button></td>
  `;

  // listeners
  tr.querySelectorAll('input.input, select.input').forEach(inp => {
    inp.addEventListener('input', (e) => {
      const field = inp.dataset.field;
      const ri = Number(tr.dataset.i);
      if (inp.tagName.toLowerCase() === 'select') state.bands[ri][field] = inp.value;
      else if (inp.type === 'number') state.bands[ri][field] = inp.value === '' ? 0 : Number(inp.value);
      else state.bands[ri][field] = inp.value;
      state.bands[ri]._computed = computeBand(state.bands[ri]);
      updateComputedCellsForRow(ri);
      recalcAndApplyRanks();
      saveState();
    }, {passive:true});
  });

  tr.querySelector('.delBtn').addEventListener('click', () => {
    const idx = Number(tr.dataset.i);
    state.bands.splice(idx,1);
    renderAllRows();
    recalcAndApplyRanks();
    saveState();
  });

  return tr;
}

function escapeHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function classOptions(selected) { 
  const opts = ['1A','2A','3A','4A','5A','6A'];
  return opts.map(o => `<option value="${o}" ${o===selected?'selected':''}>${o}</option>`).join('');
}

function updateComputedCellsForRow(i) {
  const tr = bandsBody.querySelector(`tr[data-i="${i}"]`);
  if (!tr) return;
  const c = state.bands[i]._computed || computeBand(state.bands[i]);
  tr.querySelector('.geCell').textContent = c.ge;
  tr.querySelector('.visualCell').textContent = c.visual;
  tr.querySelector('.musicCell').textContent = c.music;
  tr.querySelector('.totalCell').textContent = c.total.toFixed(2);
  tr.querySelector('.overallCell').textContent = c.overall || '';
  tr.querySelector('.classCell').textContent = c.classRank || '';
  const finalN = Number(state.finalX) || 0;
  if (finalN > 0 && Number(c.overall) <= finalN) tr.classList.add('final-row'); else tr.classList.remove('final-row');
}

function recalcAndApplyRanks() {
  recalcRanks();
  for (let i=0;i<state.bands.length;i++) updateComputedCellsForRow(i);
  renderFinals();
}

function renderAllRows() {
  bandsBody.innerHTML = '';
  for (let i=0;i<state.bands.length;i++) {
    const tr = createRow(i);
    bandsBody.appendChild(tr);
    state.bands[i]._computed = computeBand(state.bands[i]);
    updateComputedCellsForRow(i);
  }
}

function renderFinals() {
  finalsBody.innerHTML = '';
  const finalN = Number(state.finalX) || 0;
  const sorted = state.bands.slice().sort((a,b)=> b._computed.total - a._computed.total);
  sorted.forEach((b, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${b._computed.overall}</td><td>${escapeHtml(b.name)}</td><td>${escapeHtml(b.city)}</td><td>${escapeHtml(b.cls)}</td><td>${b._computed.total.toFixed(2)}</td><td>${b._computed.overall}</td>`;
    if (finalN>0 && b._computed.overall <= finalN) tr.classList.add('final-row');
    finalsBody.appendChild(tr);
  });
}

// --- Row management ---
function addBand() {
  state.bands.push({name:'New Band', city:'City', cls:'4A', ge1:0,ge2:0,ge3:0, vpi:0,vpe:0, mpi:0,mpe:0, penalty:0});
  saveState(); renderAllRows(); recalcAndApplyRanks();
}

// --- Import/Export ---
function exportJSON() {
  const data = { state, workspace: currentWorkspace };
  const blob = new Blob([JSON.stringify(data, null,2)], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${currentWorkspace}_synapse.json`; a.click();
}

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (parsed && parsed.state) state = parsed.state;
      else if (Array.isArray(parsed)) state.bands = parsed;
      saveState(); renderAllRows(); recalcAndApplyRanks();
    } catch(err) { alert('Invalid JSON file'); }
  };
  reader.readAsText(file);
}

// Export CSV (simple)
function exportCSV() {
  const rows = [['Band','City','Class','Total','Overall Rank','Class Rank']];
  const sorted = state.bands.slice().sort((a,b)=> b._computed.total - a._computed.total);
  sorted.forEach(b=> rows.push([b.name,b.city,b.cls,b._computed.total.toFixed(2),b._computed.overall,b._computed.classRank]));
  const csv = rows.map(r=> r.map(c=> '"' + String(c).replace(/"/g,'""') + '"').join(',')).join('\\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'synapse_export.csv'; a.click();
}

// Clear all
function clearAll() {
  if (!confirm('Clear all bands?')) return;
  state.bands = []; saveState(); renderAllRows(); recalcAndApplyRanks();
}

// --- Utility UI wiring ---
addBandBtn.addEventListener('click', addBand);
exportBtn.addEventListener('click', exportJSON);
document.getElementById('exportCSV').addEventListener('click', exportCSV);
clearBtn.addEventListener('click', clearAll);
finalsX.addEventListener('input', (e)=> { state.finalX = Number(e.target.value)||0; saveState(); recalcAndApplyRanks(); });
newWorkspaceBtn.addEventListener('click', createNewWorkspace);
renameWorkspaceBtn.addEventListener('click', renameWorkspace);
deleteWorkspaceBtn.addEventListener('click', deleteWorkspace);
workspaceSelect.addEventListener('change', (e)=> { currentWorkspace = e.target.value; loadWorkspaceFromStorage(); });

exportBtn.addEventListener('click', () => { 
  const input = document.createElement('input'); input.type='file'; input.accept='.json'; input.onchange = (ev) => { importJSON(ev.target.files[0]); }; input.click();
});

loginBtn.addEventListener('click', login);
logoutBtn.addEventListener('click', logout);
guestBtn.addEventListener('click', ()=> { isAuthenticated = false; user = null; currentWorkspace = 'default_guest'; loadWorkspaceFromStorage(); updateAuthUI(); });

// --- Init sample/default ---
function loadSampleIfEmpty() {
  if (!state.bands || state.bands.length===0) {
    state.bands = [
      {name:'Catawba Ridge HS', city:'Fort Mill, SC', cls:'5A', ge1:18,ge2:17,ge3:19, vpi:9,vpe:9, mpi:9,mpe:9, penalty:0},
      {name:'Fort Mill HS', city:'Fort Mill, SC', cls:'5A', ge1:16,ge2:16,ge3:15, vpi:8,vpe:8, mpi:8,mpe:8, penalty:1},
      {name:'Nation Ford HS', city:'Fort Mill, SC', cls:'4A', ge1:15,ge2:14,ge3:15, vpi:7,vpe:7, mpi:7,mpe:7, penalty:0}
    ];
    saveState();
  }
}

function init() {
  currentWorkspace = 'default_guest';
  finalsX.value = state.finalX || 5;
  loadWorkspaceFromStorage();
  loadSampleIfEmpty();
  renderAllRows();
  recalcAndApplyRanks();
  updateWorkspaceList();
  initAuth();
}

// Run
init();
