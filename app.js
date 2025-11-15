// Synapse app.js - BOA Modern
(() => {
  const STORAGE_KEY = "synapse_v1_state";
  const finalsKey = "synapse_v1_finalX";

  // DOM
  const bandsBody = document.getElementById("bandsBody");
  const finalsBody = document.getElementById("finalsBody");
  const finalsXInput = document.getElementById("finalsX");
  const addBandBtn = document.getElementById("addBand");
  const loadSampleBtn = document.getElementById("loadSample");
  const exportJSONBtn = document.getElementById("exportJSON");
  const exportCSVBtn = document.getElementById("exportCSV");

  // state
  let state = { bands: [], finalX: 5 };

  // utilities
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const saveState = () => { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); localStorage.setItem(finalsKey, state.finalX); };
  const loadState = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) state = JSON.parse(raw);
      else state = { bands: [], finalX: 5 };
      const fx = Number(localStorage.getItem(finalsKey));
      if (!Number.isNaN(fx)) state.finalX = fx;
    } catch (e) { state = { bands: [], finalX: 5 }; }
  };

  // scoring following BOA Regional: GE(60)=sum(3 judges 0-20), Visual(20)=vpi+vpe(0-10), Music(20)=mpi+mpe(0-10)
  function computeBand(b) {
    const ge = num(b.ge1)+num(b.ge2)+num(b.ge3); // 0..60
    const visual = num(b.vpi)+num(b.vpe); // 0..20
    const music = num(b.mpi)+num(b.mpe); // 0..20
    const penalty = num(b.penalty); // points to subtract
    const total = Math.round((ge + visual + music - penalty) * 100)/100;
    return { ge, visual, music, penalty, total };
  }

  function recalcRanks() {
    // compute totals
    state.bands.forEach(b => b._computed = computeBand(b));
    // overall ranking
    const arr = state.bands.map((b,i)=>({i,tot:b._computed.total})).sort((a,b)=> b.tot - a.tot);
    arr.forEach((it, idx) => { state.bands[it.i]._computed.overall = idx+1; });
    // class ranking
    const byClass = {};
    arr.forEach(it => {
      const cls = state.bands[it.i].cls || "Unknown";
      byClass[cls] = byClass[cls] || [];
      byClass[cls].push(it);
    });
    Object.keys(byClass).forEach(cls => {
      byClass[cls].forEach((it, idx) => state.bands[it.i]._computed.classRank = idx+1);
    });
  }

  // create a new table row element for band i, attach listeners that update only the band object and computed cells
  function createRow(i) {
    const b = state.bands[i];
    const tr = document.createElement("tr");
    tr.dataset.i = i;

    tr.innerHTML = `
      <td><input class="input name" data-field="name" type="text" value="${escapeHtml(b.name||'')}" /></td>
      <td><input class="input city" data-field="city" type="text" value="${escapeHtml(b.city||'')}" /></td>
      <td><input class="input cls" data-field="cls" type="text" value="${escapeHtml(b.cls||'')}" /></td>

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

    // attach listeners for inputs - update only relevant fields and computed cells
    tr.querySelectorAll("input.input").forEach(inp=>{
      inp.addEventListener("input", (e)=>{
        const fld = inp.dataset.field;
        const rowIndex = Number(tr.dataset.i);
        // store raw string for text fields; for numbers, coerce to number-like string
        if(inp.type === "number") state.bands[rowIndex][fld] = inp.value === "" ? 0 : Number(inp.value);
        else state.bands[rowIndex][fld] = inp.value;
        // recompute minimal stuff
        state.bands[rowIndex]._computed = computeBand(state.bands[rowIndex]);
        // update displayed computed cells for this row
        updateComputedCellsForRow(rowIndex);
        // recompute ranks and update only rank cells and finalist styling
        recalcAndApplyRanks();
        saveState();
      }, {passive:true});
    });

    // delete handler
    tr.querySelector(".delBtn").addEventListener("click", ()=>{
      const idx = Number(tr.dataset.i);
      state.bands.splice(idx,1);
      // re-render entire tbody safely (reindex rows)
      renderAllRows();
      recalcAndApplyRanks();
      saveState();
    });

    return tr;
  }

  // escape helper
  function escapeHtml(s){ return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

  // update computed cells for row i
  function updateComputedCellsForRow(i) {
    const tr = bandsBody.querySelector(`tr[data-i="${i}"]`);
    if(!tr) return;
    const c = state.bands[i]._computed;
    tr.querySelector(".geCell").textContent = c.ge;
    tr.querySelector(".visualCell").textContent = c.visual;
    tr.querySelector(".musicCell").textContent = c.music;
    tr.querySelector(".totalCell").textContent = c.total.toFixed(2);
    tr.querySelector(".overallCell").textContent = c.overall || "";
    tr.querySelector(".classCell").textContent = c.classRank || "";
    // apply finalist styling if needed
    const finalX = Number(state.finalX) || 0;
    if(finalX > 0 && Number(c.overall) <= finalX) tr.classList.add("final-row");
    else tr.classList.remove("final-row");
  }

  // recompute ranks and update finals table & rank cells
  function recalcAndApplyRanks() {
    recalcRanks();
    // update all rank cells and totals and finalist styling
    for(let i=0;i<state.bands.length;i++) updateComputedCellsForRow(i);
    renderFinals();
  }

  // render all rows (used on initial load or after deletion to reindex)
  function renderAllRows() {
    bandsBody.innerHTML = "";
    for(let i=0;i<state.bands.length;i++) {
      const tr = createRow(i);
      bandsBody.appendChild(tr);
      // compute initial computed values
      state.bands[i]._computed = computeBand(state.bands[i]);
      updateComputedCellsForRow(i);
    }
  }

  // finals table render
  function renderFinals() {
    finalsBody.innerHTML = "";
    const finalX = Number(state.finalX) || 0;
    if(finalX <= 0) return;
    const finalists = state.bands.slice().sort((a,b)=> b._computed.total - a._computed.total).slice(0, finalX);
    finalists.forEach((b, idx)=>{
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${b._computed.overall}</td><td>${escapeHtml(b.name)}</td><td>${escapeHtml(b.city)}</td><td>${escapeHtml(b.cls)}</td><td>${b._computed.total.toFixed(2)}</td><td>${b._computed.overall}</td>`;
      finalsBody.appendChild(tr);
    });
  }

  // exports
  function exportJSON(){
    const blob = new Blob([JSON.stringify(state, null,2)], {type:"application/json"});
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "synapse_export.json"; a.click();
  }
  function exportCSV(){
    const rows = [["Band","City","Class","Prelim Score","Overall Rank","Class Rank"]];
    const sorted = state.bands.slice().sort((a,b)=> b._computed.total - a._computed.total);
    sorted.forEach(b=> rows.push([b.name,b.city,b.cls,b._computed.total.toFixed(2), b._computed.overall, b._computed.classRank]));
    const csv = rows.map(r=> r.map(c=> '"'+String(c).replace(/"/g,'""')+'"').join(",")).join("\n");
    const blob = new Blob([csv], {type:"text/csv"});
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "synapse_export.csv"; a.click();
  }

  // sample load
  function loadSample(){
    state = {
      finalX:5,
      bands: [
        {name:"Catawba Ridge HS", city:"Fort Mill, SC", cls:"AAAAA (5A)", ge1:18,ge2:17,ge3:19, vpi:9,vpe:9, mpi:9,mpe:9, penalty:0},
        {name:"Fort Mill HS", city:"Fort Mill, SC", cls:"AAAAA (5A)", ge1:16,ge2:16,ge3:15, vpi:8,vpe:8, mpi:8,mpe:8, penalty:1},
        {name:"Nation Ford HS", city:"Fort Mill, SC", cls:"AAAA (4A)", ge1:15,ge2:14,ge3:15, vpi:7,vpe:7, mpi:7,mpe:7, penalty:0},
        {name:"Christian County HS (KY)", city:"Hopkinsville, KY", cls:"AA (2A)", ge1:12,ge2:11,ge3:12, vpi:6,vpe:6, mpi:6,mpe:6, penalty:2}
      ]
    };
    saveState(); renderAllRows(); recalcAndApplyRanks();
  }

  // init
  function init(){
    loadState();
    // ensure some bands
    if(!state.bands || state.bands.length === 0) loadSample();
    // set finals input
    finalsXInput.value = state.finalX || 0;
    finalsXInput.addEventListener("input", (e)=>{
      state.finalX = Number(e.target.value) || 0;
      saveState();
      recalcAndApplyRanks();
    }, {passive:true});

    addBand.addEventListener("click", ()=>{
      state.bands.push({name:"New Band", city:"City", cls:"Class", ge1:0,ge2:0,ge3:0, vpi:0,vpe:0, mpi:0,mpe:0, penalty:0});
      saveState(); renderAllRows(); recalcAndApplyRanks();
    });

    loadSampleBtn.addEventListener("click", ()=>{ if(confirm("Load sample data? This will overwrite current data.")) loadSample(); });
    exportJSONBtn.addEventListener("click", exportJSON);
    exportCSVBtn.addEventListener("click", exportCSV);

    // Import handling
    const importInput = document.createElement("input");
    importInput.type = "file"; importInput.accept = ".json"; importInput.style.display="none";
    importInput.addEventListener("change", (e)=>{
      const f = e.target.files[0];
      if(!f) return;
      f.text().then(txt=>{
        try {
          const parsed = JSON.parse(txt);
          if(parsed && parsed.bands) state = parsed;
          else state = {bands: parsed, finalX: state.finalX || 0};
          saveState(); renderAllRows(); recalcAndApplyRanks();
        } catch(err){ alert("Invalid JSON file."); }
      });
    });
    document.body.appendChild(importInput);
    document.getElementById("importFile")?.remove?.(); // remove stray if present
    document.getElementById("importBtn")?.addEventListener("click", ()=> importInput.click());

    // initial render
    renderAllRows();
    recalcAndApplyRanks();
  }

  // run
  init();
})();