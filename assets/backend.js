/* إرما: طبقة البيانات. تربط الصفحات بـ Firestore بنفس الواجهة التي تستخدمها (db / user). */
(function(){
  const ROLE = window.IRMA_ROLE;
  const CODE_KEY = 'irma-team-code';
  firebase.initializeApp(window.IRMA_FIREBASE);
  const fs = firebase.firestore();
  try{ fs.settings({ignoreUndefinedProperties:true, merge:true}); }catch(e){}

  /* Firestore لا يقبل مصفوفة داخل مصفوفة، فتُغلَّف عند الكتابة وتُفك عند القراءة */
  const enc = (v, inArr) => {
    if (Array.isArray(v)){ const a = v.map(x=>enc(x,true)); return inArr ? {__a:a} : a; }
    if (v && typeof v==='object'){ const o={}; for (const k of Object.keys(v)) if (v[k]!==undefined) o[k]=enc(v[k],false); return o; }
    return v;
  };
  const dec = v => {
    if (Array.isArray(v)) return v.map(dec);
    if (v && typeof v==='object'){ if (Array.isArray(v.__a) && Object.keys(v).length===1) return v.__a.map(dec); const o={}; for (const k of Object.keys(v)) o[k]=dec(v[k]); return o; }
    return v;
  };
  const err = e => { if (e && e.code==='permission-denied'){ const x = new Error('permission'); x.code='invalid_argument'; return x; } return e; };
  const guard = p => p.catch(e=>{ throw err(e); });
  const ds = s => ({id:s.id, exists:s.exists, data:()=>dec(s.data())});
  const qs = q => ({docs:q.docs.map(ds), size:q.size, empty:q.empty});

  function Doc(prefix, path){
    const ref = fs.doc(prefix+path);
    return {
      id: ref.id, path,
      onSnapshot:(cb,eb)=>ref.onSnapshot(s=>cb(ds(s)), e=>eb&&eb(err(e))),
      get:()=>guard(ref.get()).then(ds),
      set:(d,o)=>guard(ref.set(enc(d),o||{})),
      update:d=>guard(ref.update(enc(d))),
      delete:()=>guard(ref.delete()),
      acquire:async()=>({acquired:true, release:async()=>{}}),
      collection:n=>Col(prefix, path+'/'+n)
    };
  }
  function Col(prefix, path, q){
    const base = q || fs.collection(prefix+path);
    return {
      path,
      orderBy:(f,d)=>Col(prefix, path, base.orderBy(f,d||'asc')),
      limit:n=>Col(prefix, path, base.limit(n)),
      doc:id=>Doc(prefix, path+'/'+id),
      add:d=>guard(fs.collection(prefix+path).add(enc(d))).then(r=>({id:r.id})),
      onSnapshot:(cb,eb)=>base.onSnapshot(s=>cb(qs(s)), e=>eb&&eb(err(e))),
      get:()=>guard(base.get()).then(qs)
    };
  }
  const API = prefix => ({doc:p=>Doc(prefix,p), collection:p=>Col(prefix,p)});
  const USER = {id:async()=>null, isOwner:async()=>false, can:async()=>true};

  async function teamSignIn(){
    const u = new URLSearchParams(location.search).get('k');
    if (u){ try{ localStorage.setItem(CODE_KEY,u); }catch(e){} try{ history.replaceState(null,'',location.pathname+location.hash); }catch(e){} }
    let code = null; try{ code = localStorage.getItem(CODE_KEY); }catch(e){}
    code = code || u;
    if (!code){ gate(); throw new Error('no-code'); }
    const auth = firebase.auth();
    const prior = await new Promise(r=>{ const off = auth.onAuthStateChanged(u=>{ off(); r(u); }); });
    const user = prior || (await auth.signInAnonymously()).user;
    const me = fs.doc('teamUids/'+user.uid);
    let ok = false;
    try{ ok = (await me.get()).exists; }catch(e){}
    if (!ok){
      try{ await me.set({code, at:new Date().toISOString()}); ok = true; }
      catch(e){ try{ localStorage.removeItem(CODE_KEY); }catch(x){} gate(true); throw new Error('bad-code'); }
    }
    return true;
  }
  function gate(bad){
    const show = () => {
      if (document.getElementById('irma-gate')) return;
      const d = document.createElement('div'); d.id='irma-gate'; d.dir='rtl'; d.lang='ar';
      d.style.cssText='position:fixed;inset:0;z-index:999;display:grid;place-items:center;padding:16px;background:#2C3227;color:#F5F5F5;font-family:"IBM Plex Sans Arabic",Tahoma,sans-serif';
      d.innerHTML='<form style="display:grid;gap:12px;max-width:340px;width:100%"><h1 style="margin:0;font-size:24px">خريطة مهام فريق إرما</h1><p style="margin:0;color:#CFB898">'+(bad?'الرمز غير صحيح. افتح رابط الفريق أو أدخل الرمز.':'هذه الصفحة لفريق إرما. افتح رابط الفريق أو أدخل الرمز.')+'</p><input id="irma-code" type="password" autocomplete="off" aria-label="رمز الفريق" style="padding:10px 12px;border-radius:10px;border:1px solid #CFB898;background:#353B30;color:#F5F5F5;font:inherit"><button style="padding:10px;border-radius:999px;border:0;background:#CFB898;color:#2C3227;font:600 15px inherit;cursor:pointer">دخول</button></form>';
      d.querySelector('form').addEventListener('submit',e=>{ e.preventDefault(); const v=d.querySelector('input').value.trim(); if(!v) return; try{ localStorage.setItem(CODE_KEY,v); }catch(x){} location.reload(); });
      document.body.appendChild(d);
    };
    if (document.body) show(); else document.addEventListener('DOMContentLoaded',show);
  }

  if (ROLE==='team'){
    const ready = teamSignIn();
    window.IRMA_RAW = API;
    window.claude = {use: async n => { await ready; return n==='db' ? API('board/main/') : USER; }};
  } else if (ROLE==='portal'){
    const key = new URLSearchParams(location.search).get('k');
    if (key && /^[A-Za-z0-9_-]{24,}$/.test(key)){
      window.claude = {use: async n => n==='db' ? API('spaces/'+key+'/') : USER};
    }
  }
})();
