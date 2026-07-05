"use strict";(()=>{var e={};e.id=4553,e.ids=[4553,85052,50431],e.modules={53524:e=>{e.exports=require("@prisma/client")},72934:e=>{e.exports=require("next/dist/client/components/action-async-storage.external.js")},54580:e=>{e.exports=require("next/dist/client/components/request-async-storage.external.js")},45869:e=>{e.exports=require("next/dist/client/components/static-generation-async-storage.external.js")},20399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},58545:e=>{e.exports=require("pino")},57441:e=>{e.exports=require("sharp")},27790:e=>{e.exports=require("assert")},78893:e=>{e.exports=require("buffer")},61282:e=>{e.exports=require("child_process")},84770:e=>{e.exports=require("crypto")},18139:e=>{e.exports=require("dgram")},82266:e=>{e.exports=require("domain")},17702:e=>{e.exports=require("events")},92048:e=>{e.exports=require("fs")},32615:e=>{e.exports=require("http")},35240:e=>{e.exports=require("https")},19801:e=>{e.exports=require("os")},55315:e=>{e.exports=require("path")},68621:e=>{e.exports=require("punycode")},86624:e=>{e.exports=require("querystring")},76162:e=>{e.exports=require("stream")},74026:e=>{e.exports=require("string_decoder")},95346:e=>{e.exports=require("timers")},17360:e=>{e.exports=require("url")},21764:e=>{e.exports=require("util")},71568:e=>{e.exports=require("zlib")},98420:e=>{e.exports=import("playwright")},76580:(e,t,r)=>{r.r(t),r.d(t,{originalPathname:()=>C,patchFetch:()=>k,requestAsyncStorage:()=>q,routeModule:()=>S,serverHooks:()=>N,staticGenerationAsyncStorage:()=>_});var i={};r.r(i),r.d(i,{GET:()=>E});var o=r(49303),n=r(88716),a=r(60670),s=r(87070),l=r(53524),p=r(71375),d=r(9487),c=r(66429),u=r(99756),m=r(81233),f=r(22418),g=r(70295);let y="Australia/Sydney";function x(e){return String(e??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#39;")}function v(e){return(0,c.$r)(e)}function b(e,t={}){if(!e.length)return"";let r=t.size??150,i=e.map(e=>{let i=t.annotations?.[e],o=i?.overlayKey?`<img src="${x(v(i.overlayKey))}" alt="" style="position:absolute;inset:0;width:${r}px;height:${r}px;object-fit:cover;border-radius:10px;" />`:"",n=i?.comment?`<p style="margin:4px 0 0;width:${r}px;font-size:10px;line-height:1.3;color:#b91c1c;">${x(i.comment)}</p>`:"";return`<div style="position:relative;width:${r}px;">
        <div style="position:relative;width:${r}px;height:${r}px;">
          <img src="${x(v(e))}" alt="QA photo" style="position:absolute;inset:0;width:${r}px;height:${r}px;object-fit:cover;border-radius:10px;border:1px solid #e5e7eb;" />
          ${o}
        </div>
        ${n}
      </div>`}).join("");return`<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:10px;align-items:flex-start;">${i}</div>`}let h={LOW:"#fef9c3",MEDIUM:"#fed7aa",HIGH:"#fecaca",CRITICAL:"#fca5a5"};async function w(e){let t=await d.db.job.findUnique({where:{id:e},include:{property:{include:{client:!0}},assignments:{where:{removedAt:null},include:{user:{select:{name:!0,email:!0}}}},qaReviews:{orderBy:{createdAt:"desc"},take:1,include:{reviewedBy:{select:{name:!0,email:!0}}}},qaFormSubmissions:{orderBy:{createdAt:"desc"},take:1,include:{template:!0,submittedBy:{select:{name:!0,email:!0}},assignment:{include:{assignedTo:{select:{name:!0}},pickedUpBy:{select:{name:!0}}}}}}}});if(!t)return null;let r=t.qaFormSubmissions[0],i=t.qaReviews[0],o=function(e){if(!e||"object"!=typeof e)return null;let t=e[g.vv];return t&&"object"==typeof t?t:null}(r?.data),n=await (0,u.hO)(),a=(0,m.WU)((0,f.zW)(t.scheduledDate,y),"dd MMMM yyyy"),s=n?.companyName||"sNeek Property Services",l=n?.reportLogoUrl?.trim()||n?.logoUrl?.trim()||"",p=r?.template?.schema??null,c=r?.data&&"object"==typeof r.data?r.data:{},w=r?.categoryScores&&"object"==typeof r.categoryScores?r.categoryScores:{},$=r?.assignment?.assignedTo?.name||r?.assignment?.pickedUpBy?.name||i?.reviewedBy?.name||r?.submittedBy?.name||"QA inspector",A=o?.onSite?.minutes??r?.assignment?.onSiteMinutes??null,E=t.assignments.map(e=>e.user?.name||e.user?.email).filter(Boolean).join(", ")||"N/A",S=o?.sectionPhotos??{},q=(Array.isArray(p?.sections)?p.sections:[]).map(e=>{let t=(Array.isArray(e?.fields)?e.fields:[]).filter(e=>e?.type!=="upload").map(e=>{let t=c[e.id],r="-";if("checkbox"===e.type)r=!0===t?"Yes":"No";else if("rating"===e.type){let i=Number(e.max??5)||5;r=null==t||""===t?"-":`${Number(t)} / ${i}`}else r=null==t||""===t?"-":String(t);return`
            <tr>
              <td style="padding:8px 10px;border-bottom:1px solid #eef2f7;vertical-align:top;color:#334155;">${x(e.label??e.id)}</td>
              <td style="padding:8px 10px;border-bottom:1px solid #eef2f7;vertical-align:top;font-weight:600;color:#0f172a;">${x(r)}</td>
            </tr>`}).join(""),r=w[e.id],i=S[e.id]??[];return`
        <div style="margin:0 0 18px;">
          <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;">
            <h3 style="margin:0 0 8px;color:var(--qa-primary);">${x(e.label??"Section")}</h3>
            ${"number"==typeof r?`<span style="font-size:12px;color:#64748b;">Section score: <strong>${r}%</strong></span>`:""}
          </div>
          <table style="width:100%;border-collapse:collapse;">${t||'<tr><td style="padding:8px 10px;color:#94a3b8;">No fields captured.</td></tr>'}</table>
          ${i.length?`<p style="margin:10px 0 0;font-size:12px;color:#64748b;">Inspector photos (${i.length})</p>${b(i,{annotations:o?.mediaAnnotations})}`:""}
        </div>`}).join(""),_=(o?.damage??[]).filter(e=>e.area||e.description||(e.photoKeys??[]).length).map(e=>{let t=h[e.severity]??"#fde68a";return`
        <div style="border:1px solid #e5e7eb;border-left:4px solid ${t};border-radius:10px;padding:12px;margin:0 0 10px;background:#fff;">
          <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;">
            <strong style="color:#0f172a;">${x(e.area||"Unspecified area")}</strong>
            <span style="display:inline-block;padding:2px 8px;border-radius:9999px;background:${t};color:#7c2d12;font-size:11px;font-weight:700;">${x(e.severity)}</span>
            ${null!=e.estimatedCost?`<span style="margin-left:auto;font-size:12px;color:#64748b;">Est. cost: <strong>$${x(Number(e.estimatedCost).toFixed(2))}</strong></span>`:""}
          </div>
          ${e.description?`<p style="margin:8px 0 0;color:#334155;font-size:13px;">${x(e.description)}</p>`:""}
          ${b(e.photoKeys??[],{annotations:e.annotations})}
        </div>`}).join(""),N=(o?.nextClean??[]).map(e=>`<li style="margin:0 0 6px;color:#334155;"><strong>${"DEEP_CLEAN_AREA"===e.kind?`Deep clean — ${x(e.area||"area")}`:"Special request"}:</strong> ${x(e.note)}</li>`).join(""),C=(o?.restock??[]).filter(e=>e.quantity>0).map(e=>`<li style="margin:0 0 6px;color:#334155;">Stock <code>${x(e.propertyStockId)}</code> — qty ${x(e.quantity)}${e.note?` (${x(e.note)})`:""}</li>`).join(""),k=(o?.inventoryCount??[]).map(e=>`<li style="margin:0 0 6px;color:#334155;">Stock <code>${x(e.propertyStockId)}</code> — counted ${x(e.countedOnHand)}${e.note?` (${x(e.note)})`:""}</li>`).join(""),j=o?.rework,T=j&&j.enabled?`
        <div class="qa-card">
          <h3 style="margin:0 0 8px;color:var(--qa-primary);">Rework note</h3>
          <p style="margin:0;color:#334155;font-size:13px;"><strong>${x(j.severity)}</strong> — ${x(j.reason||"—")}</p>
          ${j.areas?.length?`<p style="margin:8px 0 0;font-size:12px;color:#64748b;">Areas redone: ${x(j.areas.join(", "))}</p>`:""}
          <p style="margin:8px 0 0;font-size:12px;color:#64748b;">Time reassigned: ${x(j.minutesFromCleaner)} min \xb7 Amount: $${x(Number(j.amountFromCleaner??0).toFixed(2))}</p>
        </div>`:"",P=i?.score??r?.score??null,I=i?.passed??r?.passed??null,D=(i?.notes??r?.notes??"").toString(),R=o?.signOff??null,U=R?.signedAt&&Number.isFinite(new Date(R.signedAt).getTime())?(0,m.WU)((0,f.zW)(new Date(R.signedAt),y),"dd MMM yyyy, h:mm a"):"",B=R&&R.signatureKey?`
        <h2>Inspector sign-off</h2>
        <div class="qa-card" style="display:flex;flex-wrap:wrap;align-items:center;gap:24px;">
          <div style="flex:0 0 auto;">
            <img src="${x(v(R.signatureKey))}" alt="Inspector signature" style="height:80px;max-width:260px;object-fit:contain;border-bottom:1px solid #cbd5e1;padding-bottom:4px;" />
            <p style="margin:6px 0 0;font-size:12px;color:#64748b;"><strong style="color:#0f172a;">${x(R.signedByName||$)}</strong>${U?` \xb7 ${x(U)}`:""}</p>
          </div>
          ${R.attested?'<p style="flex:1 1 220px;min-width:200px;margin:0;font-size:12px;color:#334155;">&#10003; The inspector attested that this QA inspection is accurate and complete, and was carried out by them.</p>':""}
        </div>`:"";return{html:`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Quality Inspection Report — ${x(t.jobNumber??t.id)}</title>
<style>
  :root { --qa-primary: hsl(222 47% 25%); --qa-accent: hsl(199 89% 42%); }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; max-width: 900px; margin: 0 auto; padding: 40px; }
  .qa-header { display:flex; align-items:center; gap:16px; padding-bottom:16px; border-bottom:3px solid var(--qa-primary); margin-bottom:20px; }
  .qa-header img { max-width:160px; max-height:60px; object-fit:contain; background:#ffffff; border-radius:8px; padding:5px; }
  .qa-header h1 { margin:0; font-size:24px; color:var(--qa-primary); }
  .qa-header p { margin:2px 0 0; font-size:13px; color:#64748b; }
  .qa-summary { display:grid; grid-template-columns:1fr 1fr; gap:10px 24px; background:#f8fafc; border:1px solid #e5e7eb; border-radius:12px; padding:16px; margin-bottom:22px; }
  .qa-summary .k { font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:#94a3b8; }
  .qa-summary .v { font-size:15px; font-weight:600; color:#0f172a; }
  .badge { display:inline-block; padding:4px 12px; border-radius:9999px; font-size:13px; font-weight:700; }
  .pass { background:#dcfce7; color:#15803d; }
  .fail { background:#fee2e2; color:#dc2626; }
  h2 { color:var(--qa-primary); font-size:17px; border-bottom:1px solid #e5e7eb; padding-bottom:6px; margin:26px 0 14px; }
  h3 { font-size:15px; }
  .qa-card { border:1px solid #e5e7eb; border-radius:12px; padding:16px; margin:0 0 14px; background:#fff; }
  ul { margin:0; padding-left:18px; font-size:13px; }
  code { background:#f1f5f9; padding:1px 4px; border-radius:4px; font-size:12px; }
  footer { margin-top:36px; font-size:11px; color:#94a3b8; border-top:1px solid #e5e7eb; padding-top:12px; }
</style>
</head>
<body>
  <div class="qa-header">
    ${l?`<img src="${x(l)}" alt="${x(s)} logo" />`:""}
    <div>
      <h1>Quality Inspection Report</h1>
      <p>${x(s)}</p>
    </div>
  </div>

  <div class="qa-summary">
    <div><div class="k">Property</div><div class="v">${x(t.property?.name??"Property")}</div></div>
    <div><div class="k">Job number</div><div class="v">${x(t.jobNumber??t.id)}</div></div>
    <div><div class="k">Address</div><div class="v">${x(`${t.property?.address??""}${t.property?.suburb?`, ${t.property.suburb}`:""}`)}</div></div>
    <div><div class="k">Date</div><div class="v">${x(a)}</div></div>
    <div><div class="k">Inspector</div><div class="v">${x($)}</div></div>
    <div><div class="k">Cleaners</div><div class="v">${x(E)}</div></div>
    <div><div class="k">Time on site</div><div class="v">${null!=A?`${x(A)} min`:"—"}</div></div>
    <div><div class="k">Result</div><div class="v">${null!=P?`<span class="badge ${I?"pass":"fail"}">${Number(P).toFixed(0)}% — ${I?"PASSED":"FAILED"}</span>`:"—"}</div></div>
  </div>

  ${r?`<h2>Checklist results</h2>${q||'<p style="color:#94a3b8;">No QA checklist captured.</p>'}`:'<p style="color:#94a3b8;">No QA submission recorded for this job yet.</p>'}

  ${_?`<h2>Damage findings</h2>${_}`:""}

  ${N?`<h2>Next-clean requests</h2><div class="qa-card"><ul>${N}</ul></div>`:""}

  ${C?`<h2>Restock requests</h2><div class="qa-card"><ul>${C}</ul></div>`:""}

  ${k?`<h2>Inventory counts</h2><div class="qa-card"><ul>${k}</ul></div>`:""}

  ${T?`<h2>Rework</h2>${T}`:""}

  ${D.trim()?`<h2>QA inspector notes</h2><div class="qa-card"><p style="margin:0;white-space:pre-wrap;color:#334155;font-size:13px;">${x(D)}</p></div>`:""}

  ${B}

  <footer>Generated by ${x(s)} — Quality Inspection Report \xb7 ${new Date().toISOString()}</footer>
</body>
</html>`,jobNumber:String(t.jobNumber??t.id)}}var $=r(85052);let A=[l.Role.QA_INSPECTOR,l.Role.OPS_MANAGER,l.Role.ADMIN,l.Role.CLEANER];async function E(e,{params:t}){try{let{searchParams:r}=new URL(e.url),i="html"===r.get("format"),o=await (0,p.MH)([...A]);if(o.user.role===l.Role.CLEANER&&!await d.db.jobAssignment.findFirst({where:{jobId:t.id,userId:o.user.id,removedAt:null},select:{id:!0}}))return s.NextResponse.json({error:"Forbidden"},{status:403});let n=await w(t.id);if(!n)return s.NextResponse.json({error:"QA report not available for this job."},{status:404});if(i)return new s.NextResponse(n.html,{headers:{"Content-Type":"text/html"}});let a=n.jobNumber.replace(/[^a-zA-Z0-9_-]/g,""),c=await (0,$.renderPdfFromHtml)(n.html,"QA report PDF generation");return new s.NextResponse(new Uint8Array(c),{headers:{"Content-Type":"application/pdf","Content-Disposition":`attachment; filename="qa-report-${a}.pdf"`,"Cache-Control":"no-store, max-age=0",Pragma:"no-cache",Expires:"0"}})}catch(t){let e="UNAUTHORIZED"===t.message?401:"FORBIDDEN"===t.message?403:400;return s.NextResponse.json({error:t.message??"QA report generation failed."},{status:e})}}let S=new o.AppRouteRouteModule({definition:{kind:n.x.APP_ROUTE,page:"/api/qa/jobs/[id]/report/route",pathname:"/api/qa/jobs/[id]/report",filename:"route",bundlePath:"app/api/qa/jobs/[id]/report/route"},resolvedPagePath:"E:\\sNeek Property Service\\Website\\app\\api\\qa\\jobs\\[id]\\report\\route.ts",nextConfigOutput:"",userland:i}),{requestAsyncStorage:q,staticGenerationAsyncStorage:_,serverHooks:N}=S,C="/api/qa/jobs/[id]/report/route";function k(){return(0,a.patchFetch)({serverHooks:N,staticGenerationAsyncStorage:_})}},71375:(e,t,r)=>{r.d(t,{Gg:()=>a,MH:()=>l,oT:()=>s});var i=r(75571),o=r(5018),n=r(9487);async function a(){return(0,i.getServerSession)(o.L)}async function s(){let e=await a();if(!e?.user)throw Error("UNAUTHORIZED");let t=await n.db.user.findUnique({where:{id:e.user.id},select:{id:!0,isActive:!0,role:!0}});if(!t?.isActive)throw Error("UNAUTHORIZED");return e.user.role=t.role,e}async function l(e){let t=await s();if(!e.includes(t.user.role))throw Error("FORBIDDEN");return t}},70295:(e,t,r)=>{r.d(t,{vv:()=>i,wB:()=>o});let i="__qaTools";function o(e,t){if(!e||!t)return null;let r=new Date(e).getTime(),i=new Date(t).getTime();return Number.isFinite(r)&&Number.isFinite(i)&&!(i<=r)?Math.max(0,Math.round((i-r)/6e4)):null}},85052:(e,t,r)=>{r.d(t,{G:()=>$,renderPdfFromHtml:()=>x});var i=r(66429),o=r(57435);let n=!!(process.env.S3_BUCKET_NAME&&process.env.AWS_ACCESS_KEY_ID&&process.env.AWS_SECRET_ACCESS_KEY),a=!!(n&&process.env.S3_PUBLIC_BASE_URL),s=Number(process.env.PDF_IMAGE_MAX_DIMENSION??1024),l=Number(process.env.PDF_IMAGE_QUALITY??75),p=Number(process.env.PDF_FETCH_TIMEOUT_MS??12e3),d=Number(process.env.PDF_RENDER_TIMEOUT_MS??3e4),c=Number(process.env.PDF_IMAGE_WAIT_TIMEOUT_MS??2e4),u=Number(process.env.PDF_TOTAL_TIMEOUT_MS??6e4),m=Promise.resolve(),f=null;async function g(e,t){let r=new AbortController,i=setTimeout(()=>r.abort(),t);try{return await fetch(e,{signal:r.signal,cache:"no-store"})}finally{clearTimeout(i)}}async function y(){return f||(f=Promise.resolve().then(r.t.bind(r,57441,23)).then(e=>e.default??e).catch(e=>(o.k.warn({err:e},"sharp not available; PDF images will not be downscaled"),null))),f}async function x(e,t,r){let i=await function(){let e;let t=new Promise(t=>{e=t}),r=m;return m=t,r.then(()=>e)}();try{return await Promise.race([v(e,t,r),new Promise((e,t)=>setTimeout(()=>t(Error(`PDF render exceeded ${u}ms total budget`)),u))])}finally{i()}}async function v(e,t,i){let{chromium:n}=await Promise.resolve().then(r.bind(r,98420)),a=null,u=null;try{a=await n.launch()}catch(e){u=e,a=await n.launch({channel:"msedge"}).catch(async()=>n.launch({channel:"chrome"}))}if(!a)throw u??Error(`Could not launch browser for ${t}.`);let m=await y(),f=null,x=null;try{f=await a.newContext(),m&&await f.route("**/*",async e=>{let t=e.request();if("image"!==t.resourceType())return e.continue();let r=t.url();if(r.startsWith("data:"))return e.continue();try{let t=await g(r,p);if(!t.ok)return e.continue();let i=Buffer.from(await t.arrayBuffer()),o=await m(i,{failOn:"none"}).rotate().resize(s,s,{fit:"inside",withoutEnlargement:!0}).jpeg({quality:l}).toBuffer();return e.fulfill({status:200,contentType:"image/jpeg",body:o})}catch(t){return o.k.warn({err:t,url:r},"PDF image resize failed; embedding original"),e.continue()}}),x=await f.newPage(),await x.setContent(e,{waitUntil:"domcontentloaded",timeout:d}),await x.evaluate(async e=>{let t=Array.from(document.images||[]);t.length&&await Promise.race([Promise.all(t.map(e=>e.complete&&e.naturalWidth>0?Promise.resolve():new Promise(t=>{let r=()=>t();e.addEventListener("load",r,{once:!0}),e.addEventListener("error",r,{once:!0})}))),new Promise(t=>setTimeout(t,e))])},c).catch(()=>{}),await x.waitForLoadState("networkidle",{timeout:1500}).catch(()=>{});let t=await x.pdf({format:"A4",printBackground:!0,...i});return Buffer.from(t)}finally{x&&await x.close().catch(()=>{}),f&&await f.close().catch(()=>{}),await a.close().catch(()=>{})}}async function b(e){if(!n||!process.env.S3_BUCKET_NAME)return null;try{let t=(await i.s3.getObject({Bucket:process.env.S3_BUCKET_NAME,Key:`reports/${e}/report.pdf`}).promise()).Body;if(!t)return null;if(Buffer.isBuffer(t))return t;if(t instanceof Uint8Array||"string"==typeof t)return Buffer.from(t);return null}catch{return null}}async function h(e){try{let t=await g(e,p);if(!t.ok)return null;return Buffer.from(await t.arrayBuffer())}catch{return null}}async function w(e,t){if(a&&process.env.S3_BUCKET_NAME)try{await i.s3.putObject({Bucket:process.env.S3_BUCKET_NAME,Key:`reports/${e}/report.pdf`,Body:t,ContentType:"application/pdf"}).promise()}catch(t){o.k.warn({err:t,jobId:e},"Failed to refresh stored job report PDF")}}async function $(e,t,r={}){if(e.htmlContent&&!r.preferStored)try{let r=await x(e.htmlContent,"job report PDF generation");return await w(t,r),r}catch(e){o.k.warn({err:e,jobId:t},"Fresh job report PDF render failed; falling back to stored PDF")}let i=await b(t);if(i)return i;if(e.pdfUrl){let t=await h(e.pdfUrl);if(t)return t}return e.htmlContent?x(e.htmlContent,"job report PDF generation"):null}},66429:(e,t,r)=>{r.d(t,{$r:()=>u,LS:()=>c,lf:()=>d,oq:()=>m,s3:()=>a});var i=r(96905),o=r.n(i),n=r(9487);let a=new(o())({endpoint:process.env.S3_ENDPOINT,accessKeyId:process.env.AWS_ACCESS_KEY_ID,secretAccessKey:process.env.AWS_SECRET_ACCESS_KEY,region:process.env.S3_REGION??"auto",signatureVersion:"v4"}),s=process.env.S3_BUCKET_NAME,l=null;async function p(){let e=Date.now();if(l&&e-l.at<6e4)return l.value;let t={};try{let e=await n.db.appSetting.findUnique({where:{key:"integrationCredentials"}});t=e?.value??{}}catch{t={}}let r=t.s3BucketName||process.env.S3_BUCKET_NAME||"",i={client:t.awsAccessKeyId&&t.awsSecretAccessKey?new(o())({endpoint:t.s3Endpoint||process.env.S3_ENDPOINT,accessKeyId:t.awsAccessKeyId||process.env.AWS_ACCESS_KEY_ID,secretAccessKey:t.awsSecretAccessKey||process.env.AWS_SECRET_ACCESS_KEY,region:t.s3Region||process.env.S3_REGION||"auto",signatureVersion:"v4"}):a,bucket:r};return l={value:i,at:e},i}async function d(e,t,r=300){let{client:i,bucket:o}=await p();return i.getSignedUrlPromise("putObject",{Bucket:o,Key:e,ContentType:t,Expires:r})}async function c(e,t=3600){let{client:r,bucket:i}=await p();return r.getSignedUrlPromise("getObject",{Bucket:i,Key:e,Expires:t})}function u(e){let t=(process.env.S3_PUBLIC_BASE_URL??"").replace(/\/+$/,""),r=String(e).split("/").map(e=>encodeURIComponent(e)).join("/");return`${t}/${r}`}async function m(e){await a.deleteObject({Bucket:s,Key:e}).promise()}}};var t=require("../../../../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),i=t.X(0,[38948,51251,83714,79430,20330,3643,55972,96905,81233,22418,99756,5018],()=>r(76580));module.exports=i})();