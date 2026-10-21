/* Offline stand-in for the parts of Firebase (auth + firestore compat) and SheetJS that index.html uses.
   Data lives in IndexedDB on this device only; nothing is sent anywhere. Injected by tools/build-local.js. */
(function(){
const DB_NAME='tawzee-local',STORE='docs',DEF_PASS='000000';
const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
const err=(code,message)=>Object.assign(new Error(message||code),{code});

/* ---------- sha256 (passwords are stored as salted hashes) ---------- */
function sha256(ascii){function rr(v,a){return(v>>>a)|(v<<(32-a))}
  const maxWord=Math.pow(2,32);let i,j,result='';const words=[],bitLen=ascii.length*8;
  const hash=[],k=[];let pc=0;const comp={};
  for(let c=2;pc<64;c++){if(!comp[c]){for(i=0;i<313;i+=c)comp[i]=c;hash[pc]=(Math.pow(c,.5)*maxWord)|0;k[pc++]=(Math.pow(c,1/3)*maxWord)|0}}
  ascii+='\x80';while(ascii.length%64-56)ascii+='\x00';
  for(i=0;i<ascii.length;i++){j=ascii.charCodeAt(i);words[i>>2]|=j<<((3-i)%4)*8}
  words[words.length]=((bitLen/maxWord)|0);words[words.length]=bitLen;
  let H=hash;
  for(j=0;j<words.length;){const w=words.slice(j,j+=16);const old=H;H=H.slice(0,8);
    for(i=0;i<64;i++){const w15=w[i-15],w2=w[i-2];const a=H[0],e=H[4];
      const t1=H[7]+(rr(e,6)^rr(e,11)^rr(e,25))+((e&H[5])^((~e)&H[6]))+k[i]+(w[i]=(i<16)?w[i]:(w[i-16]+(rr(w15,7)^rr(w15,18)^(w15>>>3))+w[i-7]+(rr(w2,17)^rr(w2,19)^(w2>>>10)))|0);
      const t2=(rr(a,2)^rr(a,13)^rr(a,22))+((a&H[1])^(a&H[2])^(H[1]&H[2]));
      H=[(t1+t2)|0].concat(H);H[4]=(H[4]+t1)|0}
    for(i=0;i<8;i++)H[i]=(H[i]+old[i])|0}
  for(i=0;i<8;i++)for(j=3;j+1;j--){const b=(H[i]>>(j*8))&255;result+=(b<16?'0':'')+b.toString(16)}
  return result}
const hashPass=(salt,p)=>sha256(unescape(encodeURIComponent(salt+':'+p)));
const newSalt=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');

/* ---------- IndexedDB: one store, key = "collection/id" ---------- */
let idb=null;const cache=new Map();
function openDb(){return new Promise((res,rej)=>{let r;try{r=indexedDB.open(DB_NAME,1)}catch(e){rej(e);return}
  r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE)};
  r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);r.onblocked=()=>rej(err('blocked','قاعدة البيانات مفتوحة في نافذة أخرى.'))})}
function tx(mode,fn){return new Promise((res,rej)=>{const t=idb.transaction(STORE,mode);const s=t.objectStore(STORE);const out=fn(s);
  t.oncomplete=()=>res(out&&out.result!==undefined?out.result:undefined);t.onerror=()=>rej(t.error||err('unavailable'));t.onabort=()=>rej(t.error||err('unavailable'))})}
const ready=(async()=>{idb=await openDb();
  await new Promise((res,rej)=>{const t=idb.transaction(STORE,'readonly');const c=t.objectStore(STORE).openCursor();
    c.onsuccess=()=>{const cur=c.result;if(cur){cache.set(cur.key,cur.value);cur.continue()}else res()};c.onerror=()=>rej(c.error)});
  try{navigator.storage&&navigator.storage.persist&&navigator.storage.persist()}catch(e){}})();
ready.catch(()=>{});

/* ---------- firestore-compat ---------- */
const subs=[];// {kind:'col'|'doc', key, cb}
function snapFor(s){
  if(s.kind==='doc'){const v=cache.get(s.key);return{id:s.key.split('/')[1],exists:v!==undefined,data:()=>clone(v)}}
  const pre=s.key+'/';const docs=[];
  for(const [k,v] of cache)if(k.startsWith(pre))docs.push({id:k.slice(pre.length),exists:true,data:()=>clone(v)});
  return{docs,size:docs.length,empty:!docs.length}}
let pending=false;
function notify(){if(pending)return;pending=true;queueMicrotask(()=>{pending=false;subs.forEach(s=>{try{s.cb(snapFor(s))}catch(e){console.error(e)}})})}
async function write(key,val){await ready;if(val===undefined)cache.delete(key);else cache.set(key,clone(val));notify();
  await tx('readwrite',s=>val===undefined?s.delete(key):s.put(clone(val),key))}
const autoId=()=>{const a='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';return Array.from(crypto.getRandomValues(new Uint8Array(20)),b=>a[b%62]).join('')};
function docRef(key){return{id:key.split('/')[1],path:key,
  set:d=>write(key,d),
  update:async p=>{await ready;const cur=cache.get(key);if(cur===undefined)throw err('not-found','العنصر غير موجود. ربما حُذف.');await write(key,Object.assign(clone(cur),clone(p)))},
  delete:()=>write(key,undefined),
  get:async()=>{await ready;return snapFor({kind:'doc',key})},
  onSnapshot:cb=>listen({kind:'doc',key,cb})}}
function listen(s){subs.push(s);ready.then(()=>s.cb(snapFor(s)),()=>{});return()=>{const i=subs.indexOf(s);if(i>=0)subs.splice(i,1)}}
const db={collection:name=>({doc:id=>docRef(name+'/'+(id||autoId())),onSnapshot:cb=>listen({kind:'col',key:name,cb})}),doc:path=>docRef(path)};

/* ---------- auth-compat: two local accounts, keyed by the app's account emails ---------- */
const SKEY='td-local-session';
const authSubs=[];let current=null;
async function checkPass(email,p){await ready;const rec=cache.get('auth/'+email);return rec?rec.hash===hashPass(rec.salt,p):p===DEF_PASS}
async function setPass(email,p){const salt=newSalt();await write('auth/'+email,{salt,hash:hashPass(salt,p),updatedAt:Date.now()})}
function makeUser(email){return{email,
  reauthenticateWithCredential:async c=>{if(!(await checkPass(email,c.password)))throw err('auth/wrong-password')},
  updatePassword:async p=>{if(String(p).length<6)throw err('auth/weak-password');await setPass(email,p)}}}
function emit(){authSubs.forEach(cb=>{try{cb(current)}catch(e){console.error(e)}})}
const auth={get currentUser(){return current},languageCode:'ar',
  onAuthStateChanged(cb){authSubs.push(cb);ready.then(()=>{let e=null;try{e=localStorage.getItem(SKEY)}catch(x){}current=e?makeUser(e):null;cb(current)},x=>{window.LOCAL.failed=x;console.error(x);try{S.dbState='none';render()}catch(y){}});return()=>{}},
  async signInWithEmailAndPassword(email,p){if(!(await checkPass(email,p)))throw err('auth/wrong-password');current=makeUser(email);try{localStorage.setItem(SKEY,email)}catch(x){}emit()},
  async signOut(){current=null;try{localStorage.removeItem(SKEY)}catch(x){}emit()},
  async sendPasswordResetEmail(){throw err('local','غير متاح في النسخة المحلية.')}};

window.LOCAL={ready,failed:null,
  get fresh(){return ![...cache.keys()].some(k=>k.startsWith('auth/'))},
  async resetPass(email,p,authPass,authEmail){if(authEmail&&!(await checkPass(authEmail,authPass)))throw err('auth/wrong-password');await setPass(email,p)}};
const fbAuth=()=>auth;fbAuth.EmailAuthProvider={credential:(email,password)=>({email,password})};
window.firebase={initializeApp(){},auth:fbAuth,firestore:()=>db};

/* ---------- minimal xlsx writer: aoa_to_sheet / book_new / book_append_sheet / write ---------- */
const CRC=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
const crc32=b=>{let c=0xFFFFFFFF;for(let i=0;i<b.length;i++)c=CRC[(c^b[i])&255]^(c>>>8);return(c^0xFFFFFFFF)>>>0};
function zip(files){const enc=new TextEncoder();const parts=[],central=[];let off=0;
  for(const [name,text] of files){const nb=enc.encode(name),data=enc.encode(text),crc=crc32(data);
    const h=new DataView(new ArrayBuffer(30));h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x0800,true);h.setUint32(14,crc,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);h.setUint16(26,nb.length,true);
    const c=new DataView(new ArrayBuffer(46));c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x0800,true);c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,nb.length,true);c.setUint32(42,off,true);
    parts.push(new Uint8Array(h.buffer),nb,data);central.push(new Uint8Array(c.buffer),nb);off+=30+nb.length+data.length}
  const cs=central.reduce((a,b)=>a+b.length,0);const e=new DataView(new ArrayBuffer(22));e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,cs,true);e.setUint32(16,off,true);
  const all=[...parts,...central,new Uint8Array(e.buffer)];const out=new Uint8Array(all.reduce((a,b)=>a+b.length,0));let p=0;for(const a of all){out.set(a,p);p+=a.length}return out}
const xe=s=>String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const colName=n=>{let s='';n++;while(n){const m=(n-1)%26;s=String.fromCharCode(65+m)+s;n=(n-m-1)/26}return s};
function sheetXml(ws,rtl){const rows=ws.__rows||[];
  const cols=(ws['!cols']||[]).map((c,i)=>`<col min="${i+1}" max="${i+1}" width="${(c&&c.wch)||10}" customWidth="1"/>`).join('');
  const body=rows.map((r,ri)=>`<row r="${ri+1}">${(r||[]).map((v,ci)=>{const ref=colName(ci)+(ri+1);
    if(typeof v==='number'&&isFinite(v))return `<c r="${ref}"><v>${v}</v></c>`;
    if(v===null||v===undefined||v==='')return '';
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xe(v)}</t></is></c>`}).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"${rtl?' rightToLeft="1"':''}/></sheetViews>${cols?`<cols>${cols}</cols>`:''}<sheetData>${body}</sheetData></worksheet>`}
window.XLSX={utils:{aoa_to_sheet:rows=>({__rows:rows}),book_new:()=>({SheetNames:[],Sheets:{}}),book_append_sheet:(wb,ws,name)=>{wb.SheetNames.push(name);wb.Sheets[name]=ws}},
  write(wb){const rtl=!!(wb.Workbook&&wb.Workbook.Views&&wb.Workbook.Views[0]&&wb.Workbook.Views[0].RTL);const n=wb.SheetNames.length;const idx=[...Array(n).keys()];
    const files=[
      ['[Content_Types].xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${idx.map(i=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
      ['_rels/.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${idx.map(i=>`<sheet name="${xe(String(wb.SheetNames[i]).slice(0,31))}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`],
      ['xl/_rels/workbook.xml.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${idx.map(i=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${n+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
      ['xl/styles.xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>'],
      ...idx.map(i=>[`xl/worksheets/sheet${i+1}.xml`,sheetXml(wb.Sheets[wb.SheetNames[i]],rtl)])];
    return zip(files)}};
})();
