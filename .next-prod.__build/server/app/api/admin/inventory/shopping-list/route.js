"use strict";(()=>{var e={};e.id=12564,e.ids=[12564],e.modules={53524:e=>{e.exports=require("@prisma/client")},72934:e=>{e.exports=require("next/dist/client/components/action-async-storage.external.js")},54580:e=>{e.exports=require("next/dist/client/components/request-async-storage.external.js")},45869:e=>{e.exports=require("next/dist/client/components/static-generation-async-storage.external.js")},20399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},58545:e=>{e.exports=require("pino")},57441:e=>{e.exports=require("sharp")},27790:e=>{e.exports=require("assert")},78893:e=>{e.exports=require("buffer")},61282:e=>{e.exports=require("child_process")},84770:e=>{e.exports=require("crypto")},18139:e=>{e.exports=require("dgram")},82266:e=>{e.exports=require("domain")},17702:e=>{e.exports=require("events")},92048:e=>{e.exports=require("fs")},32615:e=>{e.exports=require("http")},35240:e=>{e.exports=require("https")},19801:e=>{e.exports=require("os")},55315:e=>{e.exports=require("path")},68621:e=>{e.exports=require("punycode")},86624:e=>{e.exports=require("querystring")},76162:e=>{e.exports=require("stream")},74026:e=>{e.exports=require("string_decoder")},95346:e=>{e.exports=require("timers")},17360:e=>{e.exports=require("url")},21764:e=>{e.exports=require("util")},71568:e=>{e.exports=require("zlib")},98420:e=>{e.exports=import("playwright")},55519:(e,t,r)=>{r.r(t),r.d(t,{originalPathname:()=>x,patchFetch:()=>b,requestAsyncStorage:()=>m,routeModule:()=>c,serverHooks:()=>h,staticGenerationAsyncStorage:()=>g});var i={};r.r(i),r.d(i,{GET:()=>u});var o=r(49303),s=r(88716),a=r(60670),n=r(87070),p=r(71375),d=r(53524),l=r(95715);async function u(e){try{await (0,p.MH)([d.Role.ADMIN,d.Role.OPS_MANAGER]);let{searchParams:t}=new URL(e.url),r=t.get("scope")??"all",i=await (0,l.qi)(r);return n.NextResponse.json(i)}catch(e){return n.NextResponse.json({error:e.message},{status:400})}}let c=new o.AppRouteRouteModule({definition:{kind:s.x.APP_ROUTE,page:"/api/admin/inventory/shopping-list/route",pathname:"/api/admin/inventory/shopping-list",filename:"route",bundlePath:"app/api/admin/inventory/shopping-list/route"},resolvedPagePath:"E:\\sNeek Property Service\\Website\\app\\api\\admin\\inventory\\shopping-list\\route.ts",nextConfigOutput:"",userland:i}),{requestAsyncStorage:m,staticGenerationAsyncStorage:g,serverHooks:h}=c,x="/api/admin/inventory/shopping-list/route";function b(){return(0,a.patchFetch)({serverHooks:h,staticGenerationAsyncStorage:g})}},71375:(e,t,r)=>{r.d(t,{Gg:()=>a,MH:()=>p,oT:()=>n});var i=r(75571),o=r(5018),s=r(9487);async function a(){return(0,i.getServerSession)(o.L)}async function n(){let e=await a();if(!e?.user)throw Error("UNAUTHORIZED");let t=await s.db.user.findUnique({where:{id:e.user.id},select:{id:!0,isActive:!0,role:!0}});if(!t?.isActive)throw Error("UNAUTHORIZED");return e.user.role=t.role,e}async function p(e){let t=await n();if(!e.includes(t.user.role))throw Error("FORBIDDEN");return t}},95715:(e,t,r)=>{r.d(t,{kk:()=>p,qi:()=>s,uG:()=>o,w8:()=>n});var i=r(9487);async function o(e){let t=e?.scope??"all",r="all"!==t?t:void 0,o=Array.isArray(e?.propertyIds)?e?.propertyIds.filter(Boolean):[],s=await i.db.propertyStock.findMany({where:{...r?{propertyId:r}:{},...o.length>0?{propertyId:{in:o}}:{}},include:{item:!0,property:{select:{id:!0,name:!0,suburb:!0}}},orderBy:[{property:{name:"asc"}},{item:{category:"asc"}},{item:{name:"asc"}}]}),a=[];for(let e of s)e.onHand>e.reorderThreshold||a.push({propertyId:e.property.id,propertyName:e.property.name,suburb:e.property.suburb,item:{id:e.item.id,name:e.item.name,sku:e.item.sku,category:e.item.category,unit:e.item.unit,supplier:e.item.supplier},onHand:e.onHand,parLevel:e.parLevel,reorderThreshold:e.reorderThreshold,needed:Math.max(0,e.parLevel-e.onHand)});return a}async function s(e){return function(e){let t={};for(let r of e){let e=`${r.item.category}||${r.item.supplier??"Unknown"}`;t[e]||(t[e]=[]),t[e].push(r)}return t}(await o({scope:e}))}function a(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}function n(e){let t=e.generatedAt??new Date,r=function(e){let t=Object.entries(e),r=t.reduce((e,[,t])=>e+t.length,0),i=t.reduce((e,[,t])=>e+t.reduce((e,t)=>e+t.needed,0),0),o=new Set(t.flatMap(([,e])=>e.map(e=>e.propertyId))).size;return{groupCount:t.length,rowCount:r,totalUnitsNeeded:i,properties:o}}(e.grouped),i=Object.entries(e.grouped),o=e.logoUrl?.trim()||"",s=i.map(([e,t])=>{let[r,i]=e.split("||"),o=t.map(e=>`
            <tr>
              <td>${a(e.propertyName)}</td>
              <td>${a(e.suburb)}</td>
              <td>${a(e.item.name)}</td>
              <td class="right">${e.onHand}</td>
              <td class="right">${e.parLevel}</td>
              <td class="right need">${e.needed} ${a(e.item.unit)}</td>
            </tr>
          `).join("");return`
        <section class="group">
          <div class="group-head">
            <h3>${a(r)} | ${a(i||"Unknown")}</h3>
            <span>${t.length} item${1===t.length?"":"s"}</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Property</th>
                <th>Suburb</th>
                <th>Item</th>
                <th class="right">On Hand</th>
                <th class="right">Par</th>
                <th class="right">Need</th>
              </tr>
            </thead>
            <tbody>${o}</tbody>
          </table>
        </section>
      `}).join("");return`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Shopping List</title>
        <style>
          body { font-family: Arial, sans-serif; color: #111827; margin: 20px; }
          .brand { display:flex; align-items:center; gap:12px; }
          .brand img { width:48px; height:48px; object-fit:contain; border-radius:10px; border:1px solid #e5e7eb; padding:4px; background:#fff; }
          h1 { margin: 0 0 4px; font-size: 24px; }
          .sub { margin: 0; color: #4b5563; font-size: 12px; }
          .meta { margin-top: 8px; font-size: 12px; color: #4b5563; }
          .summary { margin-top: 14px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
          .tile { border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px; }
          .tile .label { font-size: 10px; text-transform: uppercase; color: #6b7280; }
          .tile .value { font-size: 16px; font-weight: 700; margin-top: 2px; }
          .group { margin-top: 18px; }
          .group-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 8px; }
          .group-head h3 { margin: 0; font-size: 14px; }
          .group-head span { color: #6b7280; font-size: 11px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th { text-align: left; border-bottom: 2px solid #d1d5db; padding: 6px; }
          td { border-bottom: 1px solid #e5e7eb; padding: 6px; }
          .right { text-align: right; white-space: nowrap; }
          .need { color: #b91c1c; font-weight: 700; }
          .empty { margin-top: 18px; padding: 14px; border: 1px dashed #d1d5db; border-radius: 8px; color: #6b7280; }
        </style>
      </head>
      <body>
        <div class="brand">
          ${o?`<img src="${a(o)}" alt="${a(e.companyName)} logo" />`:""}
          <h1>${a(e.companyName)} - Inventory Shopping List</h1>
        </div>
        <p class="sub">Scope: ${a(e.scopeLabel)}</p>
        <p class="meta">Generated: ${t.toLocaleString("en-AU")}</p>
        ${e.recipientName?`<p class="meta">Prepared for: ${a(e.recipientName)}</p>`:""}
        <div class="summary">
          <div class="tile"><div class="label">Groups</div><div class="value">${r.groupCount}</div></div>
          <div class="tile"><div class="label">Lines</div><div class="value">${r.rowCount}</div></div>
          <div class="tile"><div class="label">Properties</div><div class="value">${r.properties}</div></div>
          <div class="tile"><div class="label">Units Needed</div><div class="value">${r.totalUnitsNeeded}</div></div>
        </div>
        ${i.length>0?s:'<div class="empty">All stock levels are healthy. No items need restocking.</div>'}
      </body>
    </html>
  `}async function p(e){let{renderPdfFromHtml:t}=await Promise.all([r.e(96905),r.e(85052)]).then(r.bind(r,85052));return t(e,"shopping list PDF generation",{margin:{top:"12mm",right:"10mm",bottom:"12mm",left:"10mm"}})}}};var t=require("../../../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),i=t.X(0,[38948,51251,83714,79430,20330,3643,55972,99756,5018],()=>r(55519));module.exports=i})();