// Builds index-local.html (offline, one device, IndexedDB) from index.html.
// Run after every change to index.html:  node tools/build-local.js
const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const shim=fs.readFileSync(path.join(__dirname,'local-shim.js'),'utf8');

function rep(re,to,count=1){const n=(html.match(new RegExp(re.source,re.flags.includes('g')?re.flags:re.flags+'g'))||[]).length;
  if(n!==count)throw new Error(`expected ${count} match(es) for ${re}, found ${n}`);html=html.replace(re,to)}
const lit=s=>new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g');

// no network: drop web fonts (system Arabic fonts are used) and CDN scripts (replaced by the shim)
rep(/<link[^>]+fonts\.googleapis\.com[^>]*>\r?\n?/g,'',2);
rep(/<script src="https:[^"]+"><\/script>\r?\n?/g,'',4);
rep(/<script>(\r?\n)document\.documentElement\.lang/,`<script>$1${shim.replace(/\$/g,'$$$$')}</script>$1<script>$1document.documentElement.lang`);

rep(lit('<title>أوامر التوزيع</title>'),'<title>أوامر التوزيع (محلي)</title>');
rep(lit('متابعة أوامر صرف المواد على المناطق'),'متابعة أوامر صرف المواد على المناطق · نسخة محلية، البيانات على هذا الجهاز فقط');
rep(lit('تعذّر تحميل خدمة البيانات. تحقق من الإنترنت ثم أعد تحميل الصفحة.'),'تعذّر فتح قاعدة البيانات المحلية في هذا المتصفح. افتح الملف في Chrome أو Edge خارج نافذة التصفح الخاص.',2);
rep(/const FB_CONFIG=\{[^}]*\};/,'const FB_CONFIG={};');
rep(/const EMAILS=\{[^}]*\};/,"const EMAILS={admin:'admin@local',user:'user@local'};");

// first run hint on the login card
rep(lit('<div class="ferr" id="lerr"></div>'),`\${window.LOCAL&&LOCAL.fresh?'<div class="hint on">أول تشغيل: الرقم السري للحسابين 000000. غيّره من الإعدادات بعد الدخول.</div>':''}
      <div class="ferr" id="lerr"></div>`);

// forgotten password: no email on a standalone device
rep(/  forgot\(\)\{[\s\S]*?\n(?=  settings\(\)\{)/,`  forgot(){if(S.loginRole!=='admin'){openModal(\`<h3>نسيت الرقم السري للمستخدم</h3><p style="margin:0">يستطيع المدير تعيين رقم سري جديد لحساب المستخدم على هذا الجهاز.</p><form novalidate style="display:grid;gap:12px">
    <div><label class="lb" for="m-ap">الرقم السري للمدير</label><input class="in" id="m-ap" type="password" inputmode="numeric" autocomplete="off"></div>
    <div><label class="lb" for="m-up">الرقم السري الجديد للمستخدم</label><input class="in" id="m-up" type="password" inputmode="numeric" autocomplete="new-password"><div class="hint">٦ خانات على الأقل.</div></div>
    <div class="ferr" id="m-err"></div><div class="foot"><button class="btn primary">حفظ</button><button type="button" class="btn" data-m="cancel">إلغاء</button></div></form>\`,
    {ok:async()=>{const p=nd(v('m-up'));if(p.length<6)return mErr('الرقم السري الجديد يجب أن يكون ٦ خانات على الأقل.');
      try{await LOCAL.resetPass(EMAILS.user,p,nd(v('m-ap')),EMAILS.admin);closeModal();toast('تم تعيين الرقم السري للمستخدم')}catch(e){mErr(authErr(e))}}});return}
    openModal(\`<h3>نسيت الرقم السري للمدير</h3><p style="margin:0">الرقم السري محفوظ على هذا الجهاز فقط ولا يمكن استرجاعه. يمكنك إعادة ضبطه إلى <b dir="ltr">000000</b> ثم تغييره من الإعدادات. البيانات لا تُحذف.</p>
    <div><label class="lb" for="m-rs">للتأكيد اكتب: إعادة ضبط</label><input class="in" id="m-rs" autocomplete="off"></div>
    <div class="ferr" id="m-err"></div><div class="foot"><button type="button" class="btn danger solid" data-m="reset">إعادة الضبط</button><button type="button" class="btn" data-m="cancel">إلغاء</button></div>\`,
    {reset:async()=>{if(v('m-rs').trim()!=='إعادة ضبط')return mErr('اكتب «إعادة ضبط» في خانة التأكيد.');try{await LOCAL.resetPass(EMAILS.admin,'000000');closeModal();toast('أُعيد ضبط الرقم السري للمدير إلى 000000')}catch(e){mErr(dbErr(e))}}})},
`);

if(/https?:\/\/(?!www\.w3\.org|schemas\.openxmlformats\.org)/.test(html.replace(/<!--[\s\S]*?-->/g,'')))
  console.warn('warning: a web address is still referenced:',html.match(/https?:\/\/(?!www\.w3\.org|schemas\.openxmlformats\.org)[^\s"'`)<]+/g));
fs.writeFileSync(path.join(root,'index-local.html'),html);
console.log('index-local.html written ('+Math.round(html.length/1024)+' KB)');
