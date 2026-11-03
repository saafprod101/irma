/* إرما: مزامنة خريطة الفريق مع بوابات العملاء. تعمل في صفحة الفريق وتنعكس فوراً على البوابة. */
(function(){
  if (!window.IRMA_RAW) return;
  const engineSrc = document.getElementById('engine').textContent;
  const engine = () => new Function(engineSrc + ';return {workerRun};')();
  const riyadh = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const P = {}, busy = {}, again = {};
  const newKey = () => { const b = crypto.getRandomValues(new Uint8Array(24)); return btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); };
  const portalBase = () => location.origin + location.pathname.replace(/team\/?(index\.html)?$/,'') + 'portal/';
  const note = e => { try{ console.warn('[irma-sync]', e && (e.code||e.message||e)); }catch(x){} };

  function watch(cid, key){
    if (P[cid] && P[cid].key===key) return P[cid];
    const raw = window.IRMA_RAW('spaces/'+key+'/');
    const p = P[cid] = {key, raw, main:undefined, approvals:null, requests:null, msgs:null, ratings:null, bookings:null};
    const on = () => kick(cid);
    raw.doc('portal/main').onSnapshot(s=>{ p.main = s.exists ? s.data() : null; on(); }, note);
    for (const c of ['approvals','requests','msgs','ratings','bookings'])
      raw.collection(c).onSnapshot(s=>{ p[c] = s.docs.map(d=>Object.assign({id:d.id}, d.data())); on(); }, note);
    return p;
  }
  function kick(cid){ if (busy[cid]){ again[cid]=true; return; } busy[cid]=true; sync(cid).catch(note).finally(()=>{ busy[cid]=false; if (again[cid]){ again[cid]=false; kick(cid); } }); }
  const strip = o => { const c = Object.assign({}, o); delete c.updatedAt; return JSON.stringify(c); };

  async function sync(cid){
    const c = C[cid], p = P[cid];
    if (!c || !c.loaded || !p || p.main===undefined || !p.approvals || !p.requests || !p.msgs || !p.ratings || !p.bookings) return;
    const db = S.db, b = B(cid), raw = p.raw, tasks = c.tsRaw;
    /* العميل ← الفريق */
    for (const a of p.approvals){
      if (!(a.status==='approved'||a.status==='changes') || a.synced===true || !a.response) continue;
      const at = a.response.at, cur = tasks[a.code] || {status:'approved'};
      let patch;
      if (a.status==='approved') patch = {client:'ok', clientAt:at, lastUpdate:{at, by:'client', kind:'client', text:a.response.note||'اعتمد العميل عبر البوابة'}};
      else { const it = a.response.items, txt = it ? it.filter(x=>!x.ok).map(x=>(x.name||'ملف')+': '+x.note).join(' | ') + (it.some(x=>x.ok)?` (واعتمد ${it.filter(x=>x.ok).length} ملف)`:'') : a.response.note;
        patch = {status:'returned', client:'changes', clientAt:at, returnedAt:at, lastUpdate:{at, by:'client', kind:'client_changes', text:txt||''}}; }
      await db.doc(b+'tasks/'+a.code).set(Object.assign({}, cur, patch));
      await db.doc(b+'tasks/'+a.code+'/log/client_'+String(at).replace(/\D/g,'')).set({at, by:'client', uid:null, kind:patch.lastUpdate.kind, text:patch.lastUpdate.text});
      await raw.doc('approvals/'+a.id).update({synced:true});
    }
    for (const r of p.requests) if (r.synced!==true){
      await db.doc(b+'requests/'+r.id).set({title:r.title, details:r.details||'', wanted:r.wanted||null, link:r.link||null, at:r.at, status:'new', reply:'', synced:true, from:'portal'});
      await raw.doc('requests/'+r.id).update({synced:true});
    }
    for (const r of c.requests) if (r.synced===false){
      await raw.doc('requests/'+r.id).set({title:r.title, details:r.details||'', wanted:r.wanted||null, link:r.link||null, at:r.at, by:'team', status:r.status, reply:r.reply||'', synced:true},{merge:true});
      await db.doc(b+'requests/'+r.id).update({synced:true});
    }
    for (const m of p.msgs) if (m.synced!==true){
      await db.doc(b+'clientmsgs/p_'+m.id).set({code:m.code, title:m.title||'', by:m.by, text:m.text, at:m.at, synced:true, portalId:m.id});
      await raw.doc('msgs/'+m.id).update({synced:true});
    }
    for (const m of c.cmsgs) if (m.synced===false){
      await raw.doc('msgs/t_'+m.id).set({code:m.code, title:m.title||'', by:'team', text:m.text, at:m.at, synced:true, internalId:m.id});
      await db.doc(b+'clientmsgs/'+m.id).update({synced:true});
    }
    for (const r of p.ratings) if (r.synced!==true){
      await db.doc(b+'tasks/'+r.code).set(Object.assign({}, tasks[r.code]||{}, {clientRating:{stars:r.stars, note:r.note||'', at:r.at}}));
      await raw.doc('ratings/'+r.code).update({synced:true});
    }
    for (const k of p.bookings) if (k.synced!==true){
      await db.doc(b+'requests/booking_'+k.id).set({title:'حجز اجتماع مراجعة: '+k.slot.replace('T',' الساعة '), details:'اختاره العميل من البوابة.', wanted:k.review, link:null, at:k.at, status:'new', reply:'', synced:true, from:'portal'});
      await raw.doc('bookings/'+k.id).update({confirmed:true, synced:true});
    }
    /* الفريق ← العميل */
    const out = engine().workerRun({team:S.team, settings:c.settings, tasks:Object.assign({}, c.tsRaw), custom:c.custom, today:riyadh()});
    const snap = out.snap, ids = new Set(snap.approvals.map(a=>a.id));
    for (const a of snap.approvals) if (!p.approvals.some(x=>x.id===a.id)) await raw.doc('approvals/'+a.id).set(a.data);
    for (const a of p.approvals) if (a.status==='pending' && !ids.has(a.id)){
      const t = tasks[a.code] || {};
      if (t.client==='ok') await raw.doc('approvals/'+a.id).update({status:'approved', synced:true, response:{by:'team', at:t.clientAt, note:'سجّله فريق إرما'}});
      else await raw.doc('approvals/'+a.id).update({status:'withdrawn', synced:true});
    }
    if (!p.main || strip(p.main)!==strip(snap.portal)) await raw.doc('portal/main').set(Object.assign({}, snap.portal, {updatedAt:new Date().toISOString()}));
  }

  async function setup(cid){
    const c = C[cid]; if (!c || !c.loaded) return;
    const st = c.settings || {};
    if (!st.client) return;
    if (st.portalKey){ watch(cid, st.portalKey); kick(cid); return; }
    if (setup[cid]) return; setup[cid] = true;
    const key = newKey();
    await S.db.doc(B(cid)+'settings/main').update({portalKey:key, portalUrl:portalBase()+'?k='+key});
    await S.db.doc('clients/'+cid).set(Object.assign({}, S.clients[cid]||{}, {name:st.client, status:(S.clients[cid]||{}).status||'active', setup:{drive:'none', portal:'done'}}));
  }
  setInterval(()=>{ if (!S.db || !S.regLoaded) return; for (const cid of activeClients()) setup(cid).catch(note); }, 1500);
  window.addEventListener('irma-kick', ()=>{ for (const k of Object.keys(P)) kick(k); });
  window.IRMA_BRIDGE = {P, kick};
})();
