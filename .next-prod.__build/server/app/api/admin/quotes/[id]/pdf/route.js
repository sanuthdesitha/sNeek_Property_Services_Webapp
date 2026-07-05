"use strict";(()=>{var e={};e.id=37623,e.ids=[37623],e.modules={53524:e=>{e.exports=require("@prisma/client")},72934:e=>{e.exports=require("next/dist/client/components/action-async-storage.external.js")},54580:e=>{e.exports=require("next/dist/client/components/request-async-storage.external.js")},45869:e=>{e.exports=require("next/dist/client/components/static-generation-async-storage.external.js")},20399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},58545:e=>{e.exports=require("pino")},57441:e=>{e.exports=require("sharp")},27790:e=>{e.exports=require("assert")},78893:e=>{e.exports=require("buffer")},61282:e=>{e.exports=require("child_process")},84770:e=>{e.exports=require("crypto")},18139:e=>{e.exports=require("dgram")},82266:e=>{e.exports=require("domain")},17702:e=>{e.exports=require("events")},92048:e=>{e.exports=require("fs")},32615:e=>{e.exports=require("http")},35240:e=>{e.exports=require("https")},19801:e=>{e.exports=require("os")},55315:e=>{e.exports=require("path")},68621:e=>{e.exports=require("punycode")},86624:e=>{e.exports=require("querystring")},76162:e=>{e.exports=require("stream")},74026:e=>{e.exports=require("string_decoder")},95346:e=>{e.exports=require("timers")},17360:e=>{e.exports=require("url")},21764:e=>{e.exports=require("util")},71568:e=>{e.exports=require("zlib")},98420:e=>{e.exports=import("playwright")},94695:(e,t,r)=>{r.r(t),r.d(t,{originalPathname:()=>h,patchFetch:()=>b,requestAsyncStorage:()=>f,routeModule:()=>g,serverHooks:()=>m,staticGenerationAsyncStorage:()=>y});var i={};r.r(i),r.d(i,{GET:()=>x});var n=r(49303),o=r(88716),a=r(60670),s=r(87070),l=r(53524),p=r(71375),d=r(9487),c=r(24874),u=r(99756);async function x(e,{params:t}){try{await (0,p.MH)([l.Role.ADMIN,l.Role.OPS_MANAGER]);let[e,i]=await Promise.all([d.db.quote.findUnique({where:{id:t.id},include:{client:{select:{name:!0,email:!0}},lead:{select:{name:!0,email:!0}}}}),(0,u.hO)()]);if(!e)return s.NextResponse.json({error:"Quote not found"},{status:404});let n=(0,c.V)(e,{companyName:i.companyName,logoUrl:i.reportLogoUrl||i.logoUrl,companyAddress:i.invoicing?.companyAddress});try{let{renderPdfFromHtml:t}=await r.e(50431).then(r.bind(r,85052)),i=await t(n,"quote PDF generation");return new s.NextResponse(new Uint8Array(i),{headers:{"Content-Type":"application/pdf","Content-Disposition":`attachment; filename="quote-${e.id}.pdf"`}})}catch{return new s.NextResponse(n,{headers:{"Content-Type":"text/html","Content-Disposition":`inline; filename="quote-${e.id}.html"`}})}}catch(t){let e="UNAUTHORIZED"===t.message?401:"FORBIDDEN"===t.message?403:400;return s.NextResponse.json({error:t.message},{status:e})}}let g=new n.AppRouteRouteModule({definition:{kind:o.x.APP_ROUTE,page:"/api/admin/quotes/[id]/pdf/route",pathname:"/api/admin/quotes/[id]/pdf",filename:"route",bundlePath:"app/api/admin/quotes/[id]/pdf/route"},resolvedPagePath:"E:\\sNeek Property Service\\Website\\app\\api\\admin\\quotes\\[id]\\pdf\\route.ts",nextConfigOutput:"",userland:i}),{requestAsyncStorage:f,staticGenerationAsyncStorage:y,serverHooks:m}=g,h="/api/admin/quotes/[id]/pdf/route";function b(){return(0,a.patchFetch)({serverHooks:m,staticGenerationAsyncStorage:y})}},71375:(e,t,r)=>{r.d(t,{Gg:()=>a,MH:()=>l,oT:()=>s});var i=r(75571),n=r(5018),o=r(9487);async function a(){return(0,i.getServerSession)(n.L)}async function s(){let e=await a();if(!e?.user)throw Error("UNAUTHORIZED");let t=await o.db.user.findUnique({where:{id:e.user.id},select:{id:!0,isActive:!0,role:!0}});if(!t?.isActive)throw Error("UNAUTHORIZED");return e.user.role=t.role,e}async function l(e){let t=await s();if(!e.includes(t.user.role))throw Error("FORBIDDEN");return t}},24874:(e,t,r)=>{r.d(t,{V:()=>a});var i=r(81233),n=r(66429);function o(e){return String(e??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}function a(e,t){let r=t?.companyName?.trim()||"sNeek Property Services",a=function(e){let t=e.trim();if(!t)return"";if(/^(https?:|data:)/i.test(t))return t;try{return(0,n.$r)(t.replace(/^\/+/,""))}catch{return t}}(t?.logoUrl??""),s=t?.companyAddress?.trim()||"",l=e.client?.name??e.lead?.name??"Client",p=[e.client?.address??e.lead?.address,e.client?.suburb??e.lead?.suburb].filter(Boolean).join(", ")||"",d=Array.isArray(e.lineItems)?e.lineItems:[],{cleanNotes:c}=function(e){if(!e)return{meta:null,cleanNotes:null};let t=/\[\[META:([\s\S]+?)\]\]/,r=e.match(t);if(!r)return{meta:null,cleanNotes:e};let i=null;try{i=JSON.parse(r[1])}catch{i=null}return{meta:i,cleanNotes:e.replace(t,"").trim()||null}}(e.notes),u="#2b3036",x="#3a4047",g="#6b7280",f="#e5e7eb",y=Number(e.gstAmount??0),m=String(e.quoteNumber??e.id).slice(-7).padStart(7,"0").toUpperCase(),h=String(e.serviceType??"").replace(/_/g," ").toLowerCase().replace(/\b\w/g,e=>e.toUpperCase()),b=(h?`${h} Quote`:"Quote").toUpperCase(),$=(0,i.WU)(new Date(e.createdAt),"dd-MM-yyyy"),v=e.validUntil?(0,i.WU)(new Date(e.validUntil),"dd-MM-yyyy"):(0,i.WU)(new Date(new Date(e.createdAt).getTime()+12096e5),"dd-MM-yyyy"),w=d.map((e,t)=>{let r=Number(e.qty)%1==0?Number(e.qty):Number(e.qty).toFixed(2);return`
      <tr style="${t%2==1?"background:#fafafa;":""}">
        <td style="padding:12px 14px;border-bottom:1px solid ${f};text-align:center;font-size:13px;color:${u};width:48px;">${r}</td>
        <td style="padding:12px 14px;border-bottom:1px solid ${f};font-size:13px;color:${u};">${o(e.label)}</td>
        <td style="padding:12px 14px;border-bottom:1px solid ${f};text-align:right;font-size:13px;color:${u};">${Number(e.unitPrice).toFixed(2)}</td>
        <td style="padding:12px 14px;border-bottom:1px solid ${f};text-align:right;font-size:13px;color:${u};font-weight:600;">$${Number(e.total).toFixed(2)}</td>
      </tr>`}).join(""),q=y>0?`<tr><td style="padding:9px 14px;color:${g};font-size:13px;">GST (10%)</td><td style="padding:9px 14px;text-align:right;color:${u};font-size:13px;">$${y.toFixed(2)}</td></tr>`:"",S=(e,t)=>`<tr>
      <td style="padding:4px 0;text-align:right;font-size:13px;font-weight:700;color:${u};white-space:nowrap;">${o(e)}</td>
      <td style="padding:4px 0 4px 28px;text-align:right;font-size:13px;color:${u};white-space:nowrap;">${o(t)}</td>
    </tr>`,A=a?`<div style="display:inline-block;border:1px solid ${f};border-radius:10px;background:#ffffff;padding:16px 22px;">
        <img src="${o(a)}" alt="${o(r)}" style="display:block;height:46px;max-width:210px;object-fit:contain;background:#ffffff;" />
      </div>`:`<div style="display:inline-block;border:1px solid ${f};border-radius:10px;padding:24px 34px;color:${g};font-size:14px;font-weight:600;background:#ffffff;">${o(r)}</div>`;return`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${o(r)} — Quote ${o(m)}</title>
  </head>
  <body style="margin:0;padding:0;background:#ffffff;font-family:Arial, Helvetica, sans-serif;color:${u};">
    <div style="max-width:820px;margin:0 auto;padding:48px 48px 40px 48px;">

      <!-- Header: company (left) + logo chip (right) -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="vertical-align:top;">
            <div style="font-size:21px;font-weight:700;color:${u};">${o(r)}</div>
            ${s?`<div style="margin-top:6px;font-size:13px;line-height:1.5;color:${g};">${o(s).replace(/, /g,",<br/>")}</div>`:""}
          </td>
          <td style="vertical-align:top;text-align:right;">${A}</td>
        </tr>
      </table>

      <!-- Title -->
      <div style="margin:34px 0 30px 0;text-align:center;font-size:40px;font-weight:800;letter-spacing:6px;color:${x};line-height:1.15;">${o(b)}</div>

      <!-- Bill to (left) + meta (right) -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="vertical-align:top;width:58%;">
            <div style="font-size:13px;font-weight:700;color:${u};margin-bottom:8px;">Bill To</div>
            <div style="font-size:18px;color:${u};">${o(l)}</div>
            ${p?`<div style="margin-top:6px;font-size:13px;line-height:1.5;color:${g};">${o(p).replace(/, /g,",<br/>")}</div>`:""}
          </td>
          <td style="vertical-align:top;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              ${S("Quote #",m)}
              ${S("Quote date",$)}
              ${S("Due date",v)}
            </table>
          </td>
        </tr>
      </table>

      <!-- Items -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:34px;">
        <thead>
          <tr style="background:${x};">
            <th style="padding:12px 14px;text-align:center;font-size:12px;letter-spacing:.5px;text-transform:uppercase;color:#ffffff;font-weight:700;">Qty</th>
            <th style="padding:12px 14px;text-align:left;font-size:12px;letter-spacing:.5px;text-transform:uppercase;color:#ffffff;font-weight:700;">Description</th>
            <th style="padding:12px 14px;text-align:right;font-size:12px;letter-spacing:.5px;text-transform:uppercase;color:#ffffff;font-weight:700;">Unit Price</th>
            <th style="padding:12px 14px;text-align:right;font-size:12px;letter-spacing:.5px;text-transform:uppercase;color:#ffffff;font-weight:700;">Amount</th>
          </tr>
        </thead>
        <tbody>${w}</tbody>
      </table>

      <!-- Totals -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">
        <tr><td></td><td style="width:320px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr><td style="padding:9px 14px;color:${g};font-size:13px;">Subtotal</td><td style="padding:9px 14px;text-align:right;color:${u};font-size:13px;">$${Number(e.subtotal).toFixed(2)}</td></tr>
            ${q}
            <tr style="background:#f3f4f6;">
              <td style="padding:13px 14px;font-size:15px;font-weight:800;color:${u};">Total (AUD)</td>
              <td style="padding:13px 14px;text-align:right;font-size:16px;font-weight:800;color:${u};">$${Number(e.totalAmount).toFixed(2)}</td>
            </tr>
          </table>
        </td></tr>
      </table>

      <!-- Terms -->
      <div style="margin-top:40px;">
        <div style="font-size:14px;font-weight:700;color:${u};margin-bottom:10px;">Terms and Conditions</div>
        ${c?`<div style="font-size:13px;color:${u};line-height:1.7;white-space:pre-wrap;">${o(c)}</div>`:`<div style="font-size:13px;color:${u};line-height:1.7;">Payment is due within 14 days of acceptance.<br/>Please make payment to ${o(r)}.</div>`}
      </div>

      <!-- Signature -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:80px;">
        <tr><td></td><td style="width:300px;text-align:center;">
          <div style="border-top:1px solid ${u};padding-top:8px;font-size:12px;color:${g};">customer signature</div>
        </td></tr>
      </table>

    </div>
  </body>
</html>`}},66429:(e,t,r)=>{r.d(t,{$r:()=>u,LS:()=>c,lf:()=>d,oq:()=>x,s3:()=>a});var i=r(96905),n=r.n(i),o=r(9487);let a=new(n())({endpoint:process.env.S3_ENDPOINT,accessKeyId:process.env.AWS_ACCESS_KEY_ID,secretAccessKey:process.env.AWS_SECRET_ACCESS_KEY,region:process.env.S3_REGION??"auto",signatureVersion:"v4"}),s=process.env.S3_BUCKET_NAME,l=null;async function p(){let e=Date.now();if(l&&e-l.at<6e4)return l.value;let t={};try{let e=await o.db.appSetting.findUnique({where:{key:"integrationCredentials"}});t=e?.value??{}}catch{t={}}let r=t.s3BucketName||process.env.S3_BUCKET_NAME||"",i={client:t.awsAccessKeyId&&t.awsSecretAccessKey?new(n())({endpoint:t.s3Endpoint||process.env.S3_ENDPOINT,accessKeyId:t.awsAccessKeyId||process.env.AWS_ACCESS_KEY_ID,secretAccessKey:t.awsSecretAccessKey||process.env.AWS_SECRET_ACCESS_KEY,region:t.s3Region||process.env.S3_REGION||"auto",signatureVersion:"v4"}):a,bucket:r};return l={value:i,at:e},i}async function d(e,t,r=300){let{client:i,bucket:n}=await p();return i.getSignedUrlPromise("putObject",{Bucket:n,Key:e,ContentType:t,Expires:r})}async function c(e,t=3600){let{client:r,bucket:i}=await p();return r.getSignedUrlPromise("getObject",{Bucket:i,Key:e,Expires:t})}function u(e){let t=(process.env.S3_PUBLIC_BASE_URL??"").replace(/\/+$/,""),r=String(e).split("/").map(e=>encodeURIComponent(e)).join("/");return`${t}/${r}`}async function x(e){await a.deleteObject({Bucket:s,Key:e}).promise()}}};var t=require("../../../../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),i=t.X(0,[38948,51251,83714,79430,20330,3643,55972,96905,81233,99756,5018],()=>r(94695));module.exports=i})();