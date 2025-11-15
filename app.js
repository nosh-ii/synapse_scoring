// Synapse v1.0 — Trello-style card UI (client-side only)
// No auth, local-first. Drop into same folder as index.html/styles.css

// Config
const STORAGE_KEY = 'synapse_v1_data';
const DEFAULT_FINALS = 5;
const PENALTY_PER_VIOLATION = 0.75; // negative (subtract) per violation

// DOM refs
const cardsContainer = document.getElementById('cardsContainer');
const detailPanel = document.getElementById('detailPanel');
const addBandBtn = document.getElementById('addBandBtn');
const finalsXInput = document.getElementById('finalsX');
const finalsCountDisplay = document.getElementById('finalsCountDisplay');
const finalsList = document.getElementById('finalsList');
const exportJSONBtn = document.getElementById('exportJSON');
const importJSONBtn = document.getElementById('importJSONBtn');
const filePicker = document.getElementById('filePicker');
const exportCSVBtn = document.getElementById('exportCSV');
const clearBtn = document.getElementById('clearBtn');
const searchInput = document.getElementById('searchInput');

// State
let state = {
  finalsX: DEFAULT_FINALS,
  bands: [] // each band: { id, name, city, cls, ge1,ge2,ge3, vpi,vpe, mpi,mpe, violations, manualPenalty }
};
let cardEls = new Map(); // id -> element
let selectedId = null;

// Helpers
const uid = () => Math.random().toString(36).slice(2,9);
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
const load = () => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { state = JSON.parse(raw); } catch(e){ console.warn('Load parse err', e); }
  } else {
    // seed sample
    state.bands = [
      { id: uid(), name:'Catawba Ridge HS', city:'Fort Mill, SC', cls:'5A', ge1:18, ge2:17, ge3:19, vpi:9, vpe:9, mpi:9, mpe:9, violations:0, manualPenalty:0 },
      { id: uid(), name:'Fort Mill HS', city:'Fort Mill, SC', cls:'5A', ge1:16, ge2:16, ge3:15, vpi:8, vpe:8, mpi:8, mpe:8, violations:1, manualPenalty:0 },
      { id: uid(), name:'Nation Ford HS', city:'Fort Mill, SC', cls:'4A', ge1:15, ge2:14, ge3:15, vpi:7, vpe:7, mpi:7, mpe:7, violations:0, manualPenalty:0 }
    ];
    state.finalsX = DEFAULT_FINALS;
    save();
  }
};

// Scoring
function computeBandTotals(b){
  const ge = num(b.ge1) + num(b.ge2) + num(b.ge3); // 0-60
  const visual = num(b.vpi) + num(b.vpe); // 0-20
  const music = num(b.mpi) + num(b.mpe); // 0-20
  const violations = Math.max(0, Math.floor(num(b.violations || 0)));
  const penalty = (num(b.manualPenalty) && num(b.manualPenalty) !== 0) ? num(b.manualPenalty) : (violations * PENALTY_PER_VIOLATION);
  const total = Math.round((ge + visual + music - penalty) * 100) / 100;
  return { ge, visual, music, penalty, total, violations };
}

function computeAllRanks(){
  // compute totals
  state.bands.forEach(b => b._c = computeBandTotals(b));
  // sort descending by total, highest first
  const sorted = state.bands.slice().sort((a,b)=> b._c.total - a._c.total);
  // competition ranking: 1,2,2,4 (standard competition ranking)
  let prev = null, rank = 0, count = 0;
  for (let i=0;i<sorted.length;i++){
    count++;
    if (prev === null || sorted[i]._c.total !== prev) {
      rank = count;
      prev = sorted[i]._c.total;
    }
    sorted[i]._c.rank = rank;
  }
  // apply ranks back to state
  sorted.forEach(s => {
    const band = state.bands.find(b => b.id === s.id);
    if (band) band._c.rank = s._c.rank;
  });
}

// UI rendering (create card once, then update)
function createCardElement(b){
  const el = document.createElement('div');
  el.className = 'card';
  el.draggable = true;
  el.dataset.id = b.id;

  const left = document.createElement('div'); left.className = 'left';
  const h4 = document.createElement('h4'); h4.textContent = b.name || 'Unnamed Band';
  const meta = document.createElement('div'); meta.className = 'meta'; meta.textContent = `${b.city || ''} · ${b.cls || ''}`;
  const scores = document.createElement('div'); scores.className = 'scores';
  const pillTotal = document.createElement('div'); pillTotal.className = 'pill total-pill'; pillTotal.textContent = 'Total: 0.00';
  const pillGE = document.createElement('div'); pillGE.className = 'pill'; pillGE.textContent = 'GE: 0';
  const pillVis = document.createElement('div'); pillVis.className = 'pill'; pillVis.textContent = 'VIS: 0';
  const pillMus = document.createElement('div'); pillMus.className = 'pill'; pillMus.textContent = 'MUS: 0';
  scores.append(pillTotal, pillGE, pillVis, pillMus);

  left.append(h4, meta, scores);

  const actions = document.createElement('div'); actions.className = 'actions';
  const editBtn = document.createElement('button'); editBtn.textContent = 'Edit';
  const delBtn = document.createElement('button'); delBtn.textContent = 'Delete';
  const rankDiv = document.createElement('div'); rankDiv.className = 'rank-badge'; rankDiv.textContent = '#';
  actions.append(editBtn, delBtn, rankDiv);

  el.append(left, actions);

  // listeners
  editBtn.addEventListener('click', ()=> selectBand(b.id));
  delBtn.addEventListener('click', ()=>{
    if (!confirm(`Delete band "${b.name}"?`)) return;
    state.bands = state.bands.filter(x=>x.id!==b.id);
    save();
    removeCard(b.id);
    if (selectedId === b.id) clearDetail();
    computeAllRanks(); updateAllDisplays();
  });

  // drag and drop reorder
  el.addEventListener('dragstart', (e)=>{
    e.dataTransfer.setData('text/plain', b.id);
    el.classList.add('dragging');
  });
  el.addEventListener('dragend', ()=> el.classList.remove('dragging'));
  el.addEventListener('dragover', (e)=> e.preventDefault());
  el.addEventListener('drop', (e)=>{
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain');
    if (!draggedId) return;
    if (draggedId === b.id) return;
    reorderBands(draggedId, b.id);
  });

  // store references inside element
  el._refs = { title:h4, meta, pillTotal, pillGE, pillVis, pillMus, rankDiv };

  return el;
}

function appendCard(b){
  const el = createCardElement(b);
  cardEls.set(b.id, el);
  cardsContainer.appendChild(el);
  updateCardDisplay(b);
}

function removeCard(id){
  const el = cardEls.get(id);
  if (el && el.parentNode) el.parentNode.removeChild(el);
  cardEls.delete(id);
}

function reorderBands(draggedId, targetId){
  const idxFrom = state.bands.findIndex(b=>b.id===draggedId);
  const idxTo = state.bands.findIndex(b=>b.id===targetId);
  if (idxFrom < 0 || idxTo < 0) return;
  const [item] = state.bands.splice(idxFrom,1);
  state.bands.splice(idxTo,0,item);
  save();
  renderCards(); computeAllRanks(); updateAllDisplays();
}

function updateCardDisplay(b){
  const el = cardEls.get(b.id);
  if (!el) return;
  const refs = el._refs;
  refs.title.textContent = b.name || 'Unnamed Band';
  refs.meta.textContent = `${b.city || ''} · ${b.cls || ''}`;
  const c = b._c || computeBandTotals(b);
  refs.pillTotal.textContent = `Total: ${c.total.toFixed(2)}`;
  refs.pillGE.textContent = `GE ${c.ge}`;
  refs.pillVis.textContent = `VIS ${c.visual}`;
  refs.pillMus.textContent = `MUS ${c.music}`;
  refs.rankDiv.textContent = `#${b._c && b._c.rank ? b._c.rank : ''}`;
  // highlight finalists
  const finalsX = Number(state.finalsX || 0);
  if (finalsX > 0 && c.rank && c.rank <= finalsX) {
    el.classList.add('final-row-style');
  } else {
    el.classList.remove('final-row-style');
  }
}

function renderCards(){
  cardsContainer.innerHTML = '';
  cardEls.clear();
  for (const b of state.bands) appendCard(b);
}

// Detail panel: show form for selected band
function selectBand(id){
  selectedId = id;
  const band = state.bands.find(b=>b.id===id);
  if (!band) return;
  detailPanel.classList.remove('empty');
  detailPanel.innerHTML = '';
  const container = document.createElement('div');

  // header
  const header = document.createElement('div'); header.style.display='flex'; header.style.justifyContent='space-between'; header.style.alignItems='center';
  const title = document.createElement('h3'); title.textContent = band.name || 'Unnamed Band';
  const saveNameBtn = document.createElement('button'); saveNameBtn.className='btn'; saveNameBtn.textContent='Save Name';
  header.append(title, saveNameBtn);

  // editable fields: name, city, class
  const nameRow = document.createElement('div'); nameRow.className='form-row';
  const nameLabel = document.createElement('label'); nameLabel.textContent='School name';
  const nameInput = document.createElement('input'); nameInput.className='input'; nameInput.value = band.name || '';
  nameRow.append(nameLabel, nameInput);

  const cityRow = document.createElement('div'); cityRow.className='form-row';
  const cityLabel = document.createElement('label'); cityLabel.textContent='City';
  const cityInput = document.createElement('input'); cityInput.className='input'; cityInput.value = band.city || '';
  cityRow.append(cityLabel, cityInput);

  const classRow = document.createElement('div'); classRow.className='form-row';
  const classLabel = document.createElement('label'); classLabel.textContent='Class';
  const classSelect = document.createElement('select'); classSelect.className='input';
  ['1A','2A','3A','4A','5A','6A'].forEach(opt=>{
    const o = document.createElement('option'); o.value=o.textContent=opt;
    if (band.cls===opt) o.selected=true;
    classSelect.appendChild(o);
  });
  classRow.append(classLabel, classSelect);

  // GE section
  const geSec = document.createElement('div'); geSec.className='section';
  const geH = document.createElement('h4'); geH.textContent='General Effect (60)';
  geSec.append(geH);
  ['ge1','ge2','ge3'].forEach(k=>{
    const row = document.createElement('div'); row.className='form-row';
    const lab = document.createElement('label'); lab.textContent = `${k.toUpperCase()} (0–20)`;
    const inp = document.createElement('input'); inp.type='number'; inp.min=0; inp.max=20; inp.className='input'; inp.value = band[k] || 0;
    row.append(lab, inp);
    geSec.append(row);
    inp.addEventListener('input', ()=> { band[k] = Number(inp.value||0); band._c = computeBandTotals(band); computeAllRanks(); save(); updateCardDisplay(band); updateDetailTotals(); updateFinalsList(); });
  });

  // Visual
  const visSec = document.createElement('div'); visSec.className='section';
  const visH = document.createElement('h4'); visH.textContent='Visual (20)';
  visSec.append(visH);
  ['vpi','vpe'].forEach(k=>{
    const row = document.createElement('div'); row.className='form-row';
    const lab = document.createElement('label'); lab.textContent = `${k.toUpperCase()} (0–10)`;
    const inp = document.createElement('input'); inp.type='number'; inp.min=0; inp.max=10; inp.className='input'; inp.value = band[k] || 0;
    row.append(lab, inp);
    visSec.append(row);
    inp.addEventListener('input', ()=> { band[k] = Number(inp.value||0); band._c = computeBandTotals(band); computeAllRanks(); save(); updateCardDisplay(band); updateDetailTotals(); updateFinalsList(); });
  });

  // Music
  const musSec = document.createElement('div'); musSec.className='section';
  const musH = document.createElement('h4'); musH.textContent='Music (20)';
  musSec.append(musH);
  ['mpi','mpe'].forEach(k=>{
    const row = document.createElement('div'); row.className='form-row';
    const lab = document.createElement('label'); lab.textContent = `${k.toUpperCase()} (0–10)`;
    const inp = document.createElement('input'); inp.type='number'; inp.min=0; inp.max=10; inp.className='input'; inp.value = band[k] || 0;
    row.append(lab, inp);
    musSec.append(row);
    inp.addEventListener('input', ()=> { band[k] = Number(inp.value||0); band._c = computeBandTotals(band); computeAllRanks(); save(); updateCardDisplay(band); updateDetailTotals(); updateFinalsList(); });
  });

  // Penalties
  const penSec = document.createElement('div'); penSec.className='section';
  const penH = document.createElement('h4'); penH.textContent='Penalties / Timing';
  penSec.append(penH);
  const violRow = document.createElement('div'); violRow.className='form-row';
  const violLabel = document.createElement('label'); violLabel.textContent='# Violations (× −0.75)';
  const violInp = document.createElement('input'); violInp.type='number'; violInp.className='input'; violInp.min=0; violInp.value = band.violations || 0;
  violRow.append(violLabel, violInp);
  penSec.append(violRow);

  const manualRow = document.createElement('div'); manualRow.className='form-row';
  const manualLabel = document.createElement('label'); manualLabel.textContent='Manual penalty (points to subtract)';
  const manualInp = document.createElement('input'); manualInp.type='number'; manualInp.className='input'; manualInp.value = band.manualPenalty || 0;
  manualRow.append(manualLabel, manualInp);
  penSec.append(manualRow);

  // Total & actions
  const totalBox = document.createElement('div'); totalBox.className = 'total-box';
  const totalLeft = document.createElement('div'); totalLeft.innerHTML = '<div class="label-muted">Current subtotal</div>';
  const totalRight = document.createElement('div'); totalRight.className = 'big'; totalRight.textContent = '0.00';
  totalBox.append(totalLeft, totalRight);

  const actionsBox = document.createElement('div'); actionsBox.style.display='flex'; actionsBox.style.gap='8px'; actionsBox.style.marginTop='10px';
  const saveBtn = document.createElement('button'); saveBtn.className='btn primary'; saveBtn.textContent='Save';
  const closeBtn = document.createElement('button'); closeBtn.className='btn'; closeBtn.textContent='Close';
  actionsBox.append(saveBtn, closeBtn);

  // wire inputs
  nameInput.addEventListener('input', ()=> { band.name = nameInput.value; cardEls.get(band.id)._refs.title.textContent = band.name; save(); });
  cityInput.addEventListener('input', ()=> { band.city = cityInput.value; cardEls.get(band.id)._refs.meta.textContent = `${band.city} · ${band.cls}`; save(); });
  classSelect.addEventListener('change', ()=> { band.cls = classSelect.value; cardEls.get(band.id)._refs.meta.textContent = `${band.city} · ${band.cls}`; save(); });

  violInp.addEventListener('input', ()=> { band.violations = Math.max(0, Math.floor(Number(violInp.value||0))); band._c = computeBandTotals(band); computeAllRanks(); save(); updateCardDisplay(band); updateDetailTotals(); updateFinalsList(); });
  manualInp.addEventListener('input', ()=> { band.manualPenalty = Number(manualInp.value||0); band._c = computeBandTotals(band); computeAllRanks(); save(); updateCardDisplay(band); updateDetailTotals(); updateFinalsList(); });

  saveBtn.addEventListener('click', ()=> {
    // force compute & save
    band._c = computeBandTotals(band);
    computeAllRanks(); save();
    updateCardDisplay(band);
    updateAllDisplays();
    alert('Saved.');
  });
  closeBtn.addEventListener('click', ()=> { clearDetail(); });

  saveNameBtn.addEventListener('click', ()=> {
    band.name = nameInput.value.trim() || band.name;
    cardEls.get(band.id)._refs.title.textContent = band.name;
    save();
    title.textContent = band.name;
  });

  container.append(header, nameRow, cityRow, classRow, geSec, visSec, musSec, penSec, totalBox, actionsBox);
  detailPanel.appendChild(container);

  // initial totals update
  band._c = computeBandTotals(band);
  computeAllRanks();
  updateAllDisplays();

  function updateDetailTotals(){
    const c = band._c || computeBandTotals(band);
    totalRight.textContent = c.total.toFixed(2);
    totalLeft.innerHTML = `<div class="label-muted">GE ${c.ge} · VIS ${c.visual} · MUSIC ${c.music} · Penalty ${c.penalty}</div>`;
  }
  updateDetailTotals();
}

// clear detail panel
function clearDetail(){
  selectedId = null;
  detailPanel.classList.add('empty');
  detailPanel.innerHTML = '<div class="detail-empty">Select a band (or create a new one) to edit scores.</div>';
}

// update displays for all cards and finals
function updateAllDisplays(){
  state.bands.forEach(b => {
    b._c = computeBandTotals(b);
  });
  computeAllRanks();
  // update cards
  state.bands.forEach(b => updateCardDisplay(b));
  // update finals list
  updateFinalsList();
  // save
  save();
}

// finals list render
function updateFinalsList(){
  finalsList.innerHTML = '';
  const finalsX = Number(state.finalsX || 0);
  const sorted = state.bands.slice().sort((a,b)=> b._c.total - a._c.total);
  // show top X then a separation for others
  sorted.forEach((b, idx)=>{
    const el = document.createElement('div');
    el.className = 'final-item';
    if (finalsX>0 && b._c.rank <= finalsX) el.classList.add('final');
    el.innerHTML = `<div>${b._c.rank}. ${escapeHtml(b.name)} <small class="label-muted">(${b.cls})</small></div><div>${b._c.total.toFixed(2)}</div>`;
    finalsList.appendChild(el);
  });
  finalsCountDisplay.textContent = finalsX;
}

// add band
function addBand(){
  const name = prompt('Band name:','New Band');
  if (name === null) return;
  const b = { id: uid(), name: name || 'New Band', city:'', cls:'4A', ge1:0, ge2:0, ge3:0, vpi:0, vpe:0, mpi:0, mpe:0, violations:0, manualPenalty:0 };
  state.bands.push(b);
  save();
  appendCard(b);
  computeAllRanks();
  updateAllDisplays();
  selectBand(b.id);
}

// remove all
function clearAll(){
  if (!confirm('Clear ALL bands and reset?')) return;
  state.bands = [];
  save();
  renderCards();
  clearDetail();
  updateFinalsList();
}

// import/export
function exportJSON(){
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'synapse_export.json'; a.click();
}
function importJSON(file){
  const fr = new FileReader();
  fr.onload = (e)=>{
    try {
      const parsed = JSON.parse(e.target.result);
      if (parsed && Array.isArray(parsed.bands)) {
        state = parsed;
      } else if (Array.isArray(parsed)) {
        state.bands = parsed;
      } else if (parsed && parsed.bands) {
        state = parsed;
      } else {
        alert('Invalid JSON format.');
        return;
      }
      // ensure ids exist
      state.bands = state.bands.map(b => ({ id: b.id || uid(), ...b }));
      save();
      renderCards();
      computeAllRanks();
      updateAllDisplays();
      clearDetail();
    } catch(err){
      alert('Failed to import JSON: ' + err.message);
    }
  };
  fr.readAsText(file);
}
function exportCSV(){
  const rows = [['Name','City','Class','GE','Visual','Music','Penalty','Total','Overall Rank','Violations']];
  const sorted = state.bands.slice().sort((a,b)=> b._c.total - a._c.total);
  sorted.forEach(b=>{
    rows.push([b.name,b.city,b.cls,b._c.ge,b._c.visual,b._c.music,b._c.penalty,b._c.total,b._c.rank,b._c.violations]);
  });
  const csv = rows.map(r=> r.map(v=> `"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='synapse_export.csv'; a.click();
}

// util
function escapeHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// search filter
function filterCards(){
  const q = (searchInput.value || '').trim().toLowerCase();
  for (const b of state.bands){
    const el = cardEls.get(b.id);
    if (!el) continue;
    const txt = `${b.name} ${b.city} ${b.cls}`.toLowerCase();
    el.style.display = q ? (txt.includes(q) ? '' : 'none') : '';
  }
}

// init
function init(){
  load();
  finalsXInput.value = state.finalsX || DEFAULT_FINALS;
  finalsXInput.addEventListener('input', ()=> {
    state.finalsX = Math.max(0, Number(finalsXInput.value || 0));
    computeAllRanks(); updateAllDisplays();
  });
  addBandBtn.addEventListener('click', addBand);
  exportJSONBtn.addEventListener('click', exportJSON);
  importJSONBtn.addEventListener('click', ()=> filePicker.click());
  filePicker.addEventListener('change', (e)=> {
    if (e.target.files && e.target.files[0]) importJSON(e.target.files[0]);
    filePicker.value = '';
  });
  exportCSVBtn.addEventListener('click', exportCSV);
  clearBtn.addEventListener('click', clearAll);
  searchInput.addEventListener('input', filterCards);

  // initial render
  renderCards();
  computeAllRanks();
  updateAllDisplays();
}

// rendering current state -> ensure each band has card
function appendCard(b){
  if (cardEls.has(b.id)) {
    updateCardDisplay(b);
    return;
  }
  const el = createCardElement(b);
  cardEls.set(b.id, el);
  cardsContainer.appendChild(el);
}

// initial render function
function renderCards(){
  cardsContainer.innerHTML = '';
  cardEls.clear();
  for (const b of state.bands) {
    appendCard(b);
  }
}

// kick off
init();
