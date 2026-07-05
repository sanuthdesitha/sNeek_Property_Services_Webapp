"use strict";exports.id=4064,exports.ids=[4064],exports.modules={71375:(t,e,r)=>{r.d(e,{Gg:()=>i,MH:()=>d,oT:()=>l});var o=r(75571),a=r(5018),n=r(9487);async function i(){return(0,o.getServerSession)(a.L)}async function l(){let t=await i();if(!t?.user)throw Error("UNAUTHORIZED");let e=await n.db.user.findUnique({where:{id:t.user.id},select:{id:!0,isActive:!0,role:!0}});if(!e?.isActive)throw Error("UNAUTHORIZED");return t.user.role=e.role,t}async function d(t){let e=await l();if(!t.includes(e.user.role))throw Error("FORBIDDEN");return e}},25608:(t,e,r)=>{r.d(e,{P_:()=>g,Qz:()=>y,T5:()=>v,g3:()=>m,iV:()=>D,kk:()=>p});var o=r(53524),a=r(9487),n=r(99756),i=r(33929);let l=[o.LaundryStatus.PENDING,o.LaundryStatus.CONFIRMED,o.LaundryStatus.PICKED_UP,o.LaundryStatus.DROPPED,o.LaundryStatus.FLAGGED,o.LaundryStatus.SKIPPED_PICKUP],d={scheduled:"Scheduled date",confirmed:"Confirmed date",pickup:"Pickup date",dropped:"Drop-off date"},s={PENDING:"Pending",CONFIRMED:"Confirmed",PICKED_UP:"Picked up",DROPPED:"Dropped off",FLAGGED:"Flagged",SKIPPED_PICKUP:"Skipped pickup"};function p(t,e){return"number"==typeof t?.totalPrice&&Number.isFinite(t.totalPrice)?Number(t.totalPrice):"number"==typeof e&&Number.isFinite(e)?Number(e):0}function c(t){if(!t)return null;try{return JSON.parse(t)}catch{return null}}function u(t){return"string"==typeof t&&/^\d{4}-\d{2}-\d{2}$/.test(t)}function f(t){return`laundry_invoice_template:${t}`}async function m(t){let e={companyName:(await (0,n.hO)()).companyName,invoiceTitle:"Laundry Services Invoice",footerNote:"Thank you for your services."},r=await a.db.appSetting.findUnique({where:{key:f(t)}});if(!r||!r.value||"object"!=typeof r.value)return e;let o=r.value;return{companyName:"string"==typeof o.companyName&&o.companyName.trim()?o.companyName.trim():e.companyName,invoiceTitle:"string"==typeof o.invoiceTitle&&o.invoiceTitle.trim()?o.invoiceTitle.trim():e.invoiceTitle,footerNote:"string"==typeof o.footerNote?o.footerNote.trim():e.footerNote}}async function y(t,e){let r=await m(t),o={companyName:e.companyName?.trim()||r.companyName,invoiceTitle:e.invoiceTitle?.trim()||r.invoiceTitle,footerNote:void 0!==e.footerNote?e.footerNote.trim():r.footerNote};return await a.db.appSetting.upsert({where:{key:f(t)},create:{key:f(t),value:o},update:{value:o}}),o}async function g(t){let{period:e,start:r,end:o}=function(t){let e=t.period??"weekly",r=u(t.anchorDate)?t.anchorDate:(0,i.pQ)();if("annual"===e)return{period:e,start:(0,i.a1)((0,i.qk)(r)),end:(0,i._m)((0,i.Iq)(r))};if("custom"===e){let r=u(t.startDate)?t.startDate:(0,i.PH)((0,i.pQ)()),o=u(t.endDate)?t.endDate:(0,i.pQ)();return{period:e,start:(0,i.a1)(r),end:(0,i._m)(o)}}if("daily"===e)return{period:e,start:(0,i.a1)(r),end:(0,i._m)(r)};if("monthly"===e)return{period:e,start:(0,i.a1)((0,i.wS)(r)),end:(0,i._m)((0,i.us)(r))};let o=(0,i.PH)(r),a=(0,i.m4)(o,6);return{period:"weekly",start:(0,i.a1)(o),end:(0,i._m)(a)}}(t),n=t.dateField??"dropped",f=t.statuses&&t.statuses.length>0?t.statuses.filter(t=>l.includes(t)):null,m=t.propertyIds&&t.propertyIds.length>0?Array.from(new Set(t.propertyIds.filter(t=>"string"==typeof t&&t.trim()))):null,y={};t.propertyId?y.propertyId=t.propertyId:m&&(y.propertyId={in:m}),t.clientId&&(y.property={clientId:t.clientId}),f&&(y.status={in:f});let g=(t.taskId?await a.db.laundryTask.findMany({where:{id:t.taskId},include:{property:{select:{id:!0,name:!0,suburb:!0}},job:{select:{id:!0,scheduledDate:!0}},confirmations:{orderBy:{createdAt:"asc"}}},take:1}):await a.db.laundryTask.findMany({where:{...function(t,e,r){if(t.dateField)switch(t.dateField){case"scheduled":return{job:{scheduledDate:{gte:e,lte:r}}};case"confirmed":return{confirmedAt:{gte:e,lte:r}};case"pickup":return{pickedUpAt:{gte:e,lte:r}};default:return{droppedAt:{gte:e,lte:r}}}return t.includePending?{OR:[{droppedAt:{gte:e,lte:r}},{pickupDate:{gte:e,lte:r}},{dropoffDate:{gte:e,lte:r}}]}:{droppedAt:{gte:e,lte:r}}}(t,r,o),...y},include:{property:{select:{id:!0,name:!0,suburb:!0}},job:{select:{id:!0,scheduledDate:!0}},confirmations:{orderBy:{createdAt:"asc"}}},orderBy:("scheduled"===n?void 0:"confirmed"===n?{confirmedAt:"asc"}:"pickup"===n?{pickedUpAt:"asc"}:{droppedAt:"asc"})??void 0})).map(t=>{let e=t.confirmations.find(t=>{let e=c(t.notes);return!0===t.laundryReady&&!!t.photoUrl&&!e?.event})??null,r=t.confirmations.find(t=>c(t.notes)?.event==="PICKED_UP"),o=[...t.confirmations].reverse().find(t=>c(t.notes)?.event==="DROPPED")??null,a=c(r?.notes),n=c(o?.notes),i=p(n,t.dropoffCostAud);return{taskId:t.id,jobId:t.job.id,propertyId:t.property.id,propertyName:t.property.name,suburb:t.property.suburb,serviceDate:t.job.scheduledDate.toISOString(),pickupDate:t.pickupDate.toISOString(),dropoffDate:t.dropoffDate.toISOString(),droppedAt:(t.droppedAt??o?.createdAt??t.updatedAt).toISOString(),bagCount:"number"==typeof a?.bagCount&&Number.isFinite(a.bagCount)?Math.round(a.bagCount):"number"==typeof n?.bagCount&&Number.isFinite(n.bagCount)?Math.round(n.bagCount):null,dropoffLocation:"string"==typeof n?.dropoffLocation&&n.dropoffLocation.trim()||o?.bagLocation||null,amount:i,notes:"string"==typeof n?.notes&&n.notes.trim()||"string"==typeof t.flagNotes&&t.flagNotes.trim()||null,status:t.status,cleanerPhotoUrl:e?.photoUrl??null,pickupPhotoUrl:r?.photoUrl??null,dropoffPhotoUrl:o?.photoUrl??null,earlyDropoffReason:"string"==typeof n?.earlyDropoffReason&&n.earlyDropoffReason.trim()?n.earlyDropoffReason.trim():null,intendedDropoffDate:"string"==typeof n?.intendedDropoffDate&&n.intendedDropoffDate?n.intendedDropoffDate:null}});"scheduled"===n&&g.sort((t,e)=>new Date(t.serviceDate).getTime()-new Date(e.serviceDate).getTime());let h=g.reduce((t,e)=>t+e.amount,0),b=new Map;for(let t of g){let e=b.get(t.propertyId)??{propertyId:t.propertyId,propertyName:t.propertyName,suburb:t.suburb,jobs:0,amount:0};e.jobs+=1,e.amount+=t.amount,b.set(t.propertyId,e)}let v=Array.from(b.values()).sort((t,e)=>t.propertyName.localeCompare(e.propertyName)),D=null;if(t.taskId&&1===g.length)D=g[0].propertyName;else if(t.propertyId){let e=await a.db.property.findUnique({where:{id:t.propertyId},select:{name:!0}});D=e?.name??null}else m&&1===m.length&&(D=v[0]?.propertyName??null);let $=null;if(t.clientId){let e=await a.db.client.findUnique({where:{id:t.clientId},select:{name:!0}});$=e?.name??null}let N=f?f.map(t=>s[t]).join(", "):"All statuses";return{period:e,start:r,end:o,propertyId:t.propertyId,propertyName:D,clientName:$,dateField:n,dateFieldLabel:d[n],statusLabel:N,groupByProperty:!0===t.groupByProperty,rows:g,totalAmount:h,propertyBreakdown:v}}function h(t){return String(t??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}function b(t){return`$${t.toFixed(2)}`}function v(t){let e;let{data:r,template:o}=t,a=t=>{var e;let r=new Date(t.serviceDate).toLocaleDateString("en-AU",{timeZone:"Australia/Sydney"}),o=new Date(t.pickupDate).toLocaleDateString("en-AU",{timeZone:"Australia/Sydney"}),a=new Date(t.dropoffDate).toLocaleDateString("en-AU",{timeZone:"Australia/Sydney"});return`
      <tr>
        <td class="cell">${h(t.propertyName)}</td>
        <td class="cell">${h(t.suburb)}</td>
        <td class="cell">${h(s[e=t.status]??e)}</td>
        <td class="cell">${r}</td>
        <td class="cell">${o}</td>
        <td class="cell">${a}</td>
        <td class="cell right">${t.bagCount??"-"}</td>
        <td class="cell">${h(t.dropoffLocation??"-")}</td>
        <td class="cell">${h(t.notes??"-")}</td>
        <td class="cell">
          ${t.cleanerPhotoUrl||t.pickupPhotoUrl||t.dropoffPhotoUrl?`
                <div style="display:flex;gap:4px;flex-wrap:wrap;">
                  ${t.cleanerPhotoUrl?`<div><div class="muted" style="font-size:10px;">Cleaner</div><img src="${h(t.cleanerPhotoUrl)}" style="height:52px;width:52px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb;" /></div>`:""}
                  ${t.pickupPhotoUrl?`<div><div class="muted" style="font-size:10px;">Pickup</div><img src="${h(t.pickupPhotoUrl)}" style="height:52px;width:52px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb;" /></div>`:""}
                  ${t.dropoffPhotoUrl?`<div><div class="muted" style="font-size:10px;">Drop-off</div><img src="${h(t.dropoffPhotoUrl)}" style="height:52px;width:52px;object-fit:cover;border-radius:6px;border:1px solid #e5e7eb;" /></div>`:""}
                </div>
              `:"-"}
          ${t.earlyDropoffReason?`<div class="muted" style="font-size:10px;margin-top:4px;">Early return: ${h(t.earlyDropoffReason)}</div>`:""}
        </td>
        <td class="cell right">${b(t.amount)}</td>
      </tr>
      `};if(r.groupByProperty&&r.rows.length>0){let t=new Map;for(let e of r.rows){let r=t.get(e.propertyId)??[];r.push(e),t.set(e.propertyId,r)}e=Array.from(t.values()).sort((t,e)=>t[0].propertyName.localeCompare(e[0].propertyName)).map(t=>{let e=t.reduce((t,e)=>t+e.amount,0);return`
          <tr>
            <td class="cell group-head" colspan="11">
              ${h(t[0].propertyName)}
              <span class="muted" style="font-weight:400;">\xb7 ${h(t[0].suburb)} \xb7 ${t.length} job${1===t.length?"":"s"}</span>
            </td>
          </tr>`+t.map(a).join("")+`
          <tr>
            <td class="cell subtotal" colspan="10">Subtotal — ${h(t[0].propertyName)}</td>
            <td class="cell subtotal right">${b(e)}</td>
          </tr>`}).join("")+`
      <tr>
        <td class="cell grand" colspan="10">Grand total</td>
        <td class="cell grand right">${b(r.totalAmount)}</td>
      </tr>`}else e=r.rows.map(a).join(""),r.rows.length>0&&(e+=`
        <tr>
          <td class="cell grand" colspan="10">Total</td>
          <td class="cell grand right">${b(r.totalAmount)}</td>
        </tr>`);let n=r.propertyBreakdown.map(t=>`
      <tr>
        <td class="cell">${h(t.propertyName)}</td>
        <td class="cell">${h(t.suburb)}</td>
        <td class="cell right">${t.jobs}</td>
        <td class="cell right">${b(t.amount)}</td>
      </tr>
    `).join(""),i=r.clientName?`Client: ${r.clientName}${r.propertyName?` \xb7 ${r.propertyName}`:""}`:r.propertyName?`Property: ${r.propertyName}`:"All properties",l=`${r.start.toLocaleDateString("en-AU",{timeZone:"Australia/Sydney"})} - ${r.end.toLocaleDateString("en-AU",{timeZone:"Australia/Sydney"})}`;return`<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>${h(o.companyName)} - Laundry Invoice</title>
      <style>
        body { font-family: Arial, sans-serif; color: #111827; margin: 20px; }
        .header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
        .title { margin: 0; font-size: 22px; }
        .sub { margin: 4px 0 0; color: #6b7280; font-size: 12px; }
        .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 14px; }
        .tile { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; }
        .label { font-size: 10px; color: #6b7280; text-transform: uppercase; }
        .value { font-size: 16px; font-weight: 700; margin-top: 2px; }
        .section { margin-top: 18px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th { text-align: left; border-bottom: 2px solid #d1d5db; padding: 8px; }
        .cell { border-bottom: 1px solid #e5e7eb; padding: 8px; vertical-align: top; }
        .right { text-align: right; white-space: nowrap; }
        .muted { color: #6b7280; }
        .group-head { background: #f3f4f6; font-weight: 700; font-size: 12px; }
        .subtotal { background: #fafafa; font-weight: 600; }
        .grand { background: #111827; color: #ffffff; font-weight: 700; }
        .footer { margin-top: 24px; font-size: 12px; color: #6b7280; }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <h1 class="title">${h(o.companyName)}</h1>
          <p class="sub">${h(o.invoiceTitle)}</p>
          <p class="sub">${h(i)}</p>
          <p class="sub">Period (${h(r.dateFieldLabel)}): ${h(l)}</p>
          <p class="sub">Statuses: ${h(r.statusLabel)}</p>
        </div>
        <div class="muted" style="font-size:12px;text-align:right;">
          <div><strong>Generated:</strong> ${new Date().toLocaleString("en-AU",{timeZone:"Australia/Sydney"})}</div>
          <div><strong>Jobs:</strong> ${r.rows.length}</div>
        </div>
      </div>

      <div class="summary">
        <div class="tile"><div class="label">Properties</div><div class="value">${r.propertyBreakdown.length}</div></div>
        <div class="tile"><div class="label">Jobs</div><div class="value">${r.rows.length}</div></div>
        <div class="tile"><div class="label">Date basis</div><div class="value" style="font-size:13px;">${h(r.dateFieldLabel)}</div></div>
        <div class="tile"><div class="label">Total</div><div class="value">${b(r.totalAmount)}</div></div>
      </div>

      <div class="section">
        <h3 style="margin:0 0 8px;">Property Breakdown</h3>
        <table>
          <thead>
            <tr>
              <th>Property</th>
              <th>Suburb</th>
              <th class="right">Jobs</th>
              <th class="right">Amount</th>
            </tr>
          </thead>
          <tbody>${n||'<tr><td class="cell" colspan="4">No completed laundry returns in selected period.</td></tr>'}</tbody>
        </table>
      </div>

      <div class="section">
        <h3 style="margin:0 0 8px;">Job Breakdown</h3>
        <table>
          <thead>
            <tr>
              <th>Property</th>
              <th>Suburb</th>
              <th>Status</th>
              <th>Service Date</th>
              <th>Pickup</th>
              <th>Return</th>
              <th class="right">Bags</th>
              <th>Drop-off Location</th>
              <th>Notes</th>
              <th>Evidence</th>
              <th class="right">Amount</th>
            </tr>
          </thead>
          <tbody>${e||'<tr><td class="cell" colspan="11">No jobs found for selected period.</td></tr>'}</tbody>
        </table>
      </div>

      <div class="footer">
        ${h(o.footerNote||"")}
      </div>
    </body>
  </html>`}async function D(t){let{renderPdfFromHtml:e}=await Promise.all([r.e(96905),r.e(85052)]).then(r.bind(r,85052));return e(t,"laundry invoice PDF generation",{margin:{top:"12mm",right:"8mm",bottom:"12mm",left:"8mm"}})}},33929:(t,e,r)=>{r.d(e,{Iq:()=>h,PH:()=>f,_m:()=>i,a1:()=>n,m4:()=>u,pQ:()=>l,qk:()=>g,us:()=>y,wO:()=>d,wS:()=>m});var o=r(22418);let a="Australia/Sydney";function n(t){return(0,o.Nm)(`${t}T00:00:00.000`,a)}function i(t){return(0,o.Nm)(`${t}T23:59:59.999`,a)}function l(t=new Date){return(0,o.CV)(t,a,"yyyy-MM-dd")}function d(t){return(0,o.CV)(t,a,"yyyy-MM-dd")}function s(t){let[e,r,o]=t.split("-").map(Number);return[e,r,o]}function p(t){let[e,r,o]=s(t);return new Date(Date.UTC(e,r-1,o))}function c(t){let e=t.getUTCFullYear(),r=String(t.getUTCMonth()+1).padStart(2,"0"),o=String(t.getUTCDate()).padStart(2,"0");return`${e}-${r}-${o}`}function u(t,e){let r=p(t);return r.setUTCDate(r.getUTCDate()+e),c(r)}function f(t){let e=p(t),r=e.getUTCDay();return e.setUTCDate(e.getUTCDate()+(0===r?-6:1-r)),c(e)}function m(t){let[e,r]=s(t);return`${e}-${String(r).padStart(2,"0")}-01`}function y(t){let[e,r]=s(t),o=new Date(Date.UTC(e,r,0)).getUTCDate();return`${e}-${String(r).padStart(2,"0")}-${String(o).padStart(2,"0")}`}function g(t){return`${s(t)[0]}-01-01`}function h(t){return`${s(t)[0]}-12-31`}}};