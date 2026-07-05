"use strict";exports.id=32229,exports.ids=[32229],exports.modules={32229:(e,t,n)=>{n.d(t,{At:()=>x,EL:()=>h,Uc:()=>v,ie:()=>$,jD:()=>I,p1:()=>g});var i=n(84770),r=n(53524),o=n(81233),d=n(22418),a=n(9487),p=n(85052),l=n(66429),s=n(99756),c=n(63653),b=n(54549);let y=[r.JobStatus.ASSIGNED,r.JobStatus.EN_ROUTE,r.JobStatus.IN_PROGRESS,r.JobStatus.PAUSED,r.JobStatus.WAITING_CONTINUATION_APPROVAL,r.JobStatus.SUBMITTED,r.JobStatus.QA_REVIEW,r.JobStatus.COMPLETED,r.JobStatus.INVOICED];function u(e){return`$${e.toFixed(2)}`}function m(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#39;")}async function g(){let[e,t,n,i]=await Promise.all([a.db.client.findMany({where:{isActive:!0},select:{id:!0,name:!0,email:!0,properties:{select:{id:!0,name:!0}}},orderBy:[{name:"asc"}]}),a.db.property.findMany({where:{isActive:!0},select:{id:!0,name:!0,suburb:!0,clientId:!0,client:{select:{name:!0}}},orderBy:[{name:"asc"}]}),a.db.propertyClientRate.findMany({include:{property:{select:{id:!0,name:!0,clientId:!0,client:{select:{name:!0}}}}},orderBy:[{property:{name:"asc"}},{jobType:"asc"}]}),a.db.clientInvoice.findMany({include:{client:{select:{id:!0,name:!0,email:!0}},lines:!0},orderBy:[{createdAt:"desc"}],take:100})]);return{clients:e,properties:t,rates:n,invoices:i}}async function x(e){return a.db.propertyClientRate.upsert({where:{propertyId_jobType:{propertyId:e.propertyId,jobType:e.jobType}},create:{propertyId:e.propertyId,jobType:e.jobType,baseCharge:e.baseCharge,billingUnit:e.billingUnit?.trim()||"PER_JOB",defaultDescription:e.defaultDescription?.trim()||null,isActive:e.isActive??!0},update:{baseCharge:e.baseCharge,billingUnit:e.billingUnit?.trim()||"PER_JOB",defaultDescription:e.defaultDescription?.trim()||null,isActive:e.isActive??!0},include:{property:{select:{id:!0,name:!0,clientId:!0,client:{select:{name:!0}}}}}})}async function f(){let e=(0,o.WU)(new Date,"yyyyMMdd");return`INV-${e}-${(0,i.randomUUID)().slice(0,6).toUpperCase()}`}async function I(e){let[t,n,i,o,p]=await Promise.all([a.db.client.findUnique({where:{id:e.clientId},select:{id:!0,name:!0,email:!0}}),a.db.propertyClientRate.findMany({where:{property:{clientId:e.clientId},...e.propertyId?{propertyId:e.propertyId}:{},isActive:!0}}),a.db.clientInvoiceLine.findMany({where:{jobId:{not:null},invoice:{status:{not:r.ClientInvoiceStatus.VOID},clientId:e.clientId}},select:{jobId:!0}}),(0,s.hO)(),a.db.priceBook.findMany({where:{isActive:!0},select:{jobType:!0,baseRate:!0}})]);if(!t)throw Error("Client not found.");let l=new Set(i.map(e=>e.jobId).filter(e=>!!e)),u=n.map(e=>({propertyId:e.propertyId,jobType:e.jobType,baseCharge:e.baseCharge,defaultDescription:e.defaultDescription})),m=(await a.db.job.findMany({where:{property:{clientId:e.clientId,...e.propertyId?{id:e.propertyId}:{}},status:{in:y},cleanSkipStatus:{not:"SKIPPED"},...e.periodStart||e.periodEnd?{OR:[{completedAt:{...e.periodStart?{gte:e.periodStart}:{},...e.periodEnd?{lte:e.periodEnd}:{}}},{completedAt:null,scheduledDate:{...e.periodStart?{gte:e.periodStart}:{},...e.periodEnd?{lte:e.periodEnd}:{}}}]}:{}},include:{property:{select:{id:!0,name:!0,suburb:!0}}},orderBy:[{scheduledDate:"asc"}]})).filter(e=>!l.has(e.id)),g=new Map(m.map(e=>[e.id,(0,b.ZF)({jobType:e.jobType,propertyId:e.propertyId,fixedPrice:e.fixedPrice},{propertyRates:u,priceBook:p})])),x=m.filter(e=>g.get(e.id)?.rateMissing);if(x.length>0){let e=x.map(e=>`${e.jobNumber||e.id} (${e.jobType}) at ${e.property.name}`).join(", ");throw Error(`Missing client rates for ${x.length} job(s): ${e}. Set rates in Billing Rates before invoicing.`)}let I=m.map(e=>{let t=g.get(e.id);if(!t||null==t.amount)return null;let n=t.description?.trim()||`${e.property.name} - ${String(e.jobType).replace(/_/g," ")} - ${(0,d.CV)(new Date(e.scheduledDate),"Australia/Sydney","dd MMM yyyy")}`,i=t.amount;return{jobId:e.id,shoppingRunId:null,description:n,note:e.invoiceNote?.trim()||null,quantity:1,unitPrice:i,lineTotal:i,category:"SERVICE"}}).filter(Boolean),h=(await a.db.shoppingRun.findMany({where:{settlements:{some:{clientBillable:!0,adminApprovedForClient:!0,includedInClientInvoiceId:null}},...e.periodStart||e.periodEnd?{updatedAt:{...e.periodStart?{gte:e.periodStart}:{},...e.periodEnd?{lte:e.periodEnd}:{}}}:{},lines:{some:e.propertyId?{propertyId:e.propertyId}:{property:{clientId:e.clientId}}}},include:{lines:{include:{property:{select:{id:!0,name:!0,clientId:!0}}}},settlements:{where:{clientBillable:!0,adminApprovedForClient:!0,includedInClientInvoiceId:null},take:1}},orderBy:[{updatedAt:"asc"}]})).filter(t=>{if(0===t.lines.length)return!1;let n=t.lines.map(e=>e.property);return!(n.some(t=>!t||t.clientId!==e.clientId)||e.propertyId&&n.some(t=>t.id!==e.propertyId))&&t.settlements.length>0}).map(e=>{let t=e.settlements[0],n=Number(e.lines.reduce((e,t)=>e+Number(t.lineCost??0),0).toFixed(2));return n<=0?null:{jobId:null,shoppingRunId:e.id,description:`Shopping reimbursement - ${e.title}`,note:null,quantity:1,unitPrice:n,lineTotal:n,category:"SHOPPING_REIMBURSEMENT",settlementId:t.id}}).filter(Boolean),$=[...I,...h.map(({settlementId:e,...t})=>t)];if(0===$.length)throw Error("No billable completed jobs found for the selected client and period.");let v=e.gstEnabled??o.pricing.gstEnabled,{subtotal:A,gstAmount:w,totalAmount:S}=(0,c._)($.reduce((e,t)=>e+t.lineTotal,0),{gstEnabled:v}),j=await f();return await a.db.$transaction(async n=>{let i=await n.clientInvoice.create({data:{clientId:t.id,invoiceNumber:j,status:r.ClientInvoiceStatus.DRAFT,periodStart:e.periodStart??null,periodEnd:e.periodEnd??null,subtotal:A,gstAmount:w,totalAmount:S,gstEnabled:v,metadata:{source:"job-rate-generator",shoppingRunCount:h.length},lines:{create:$}},include:{client:{select:{id:!0,name:!0,email:!0}},lines:{include:{job:{select:{id:!0,jobNumber:!0,scheduledDate:!0,property:{select:{name:!0,suburb:!0}}}}}}}});return h.length>0&&await n.shoppingSettlement.updateMany({where:{id:{in:h.map(e=>e.settlementId)}},data:{includedInClientInvoiceId:i.id}}),i})}async function h(e){return a.db.clientInvoice.findUnique({where:{id:e},include:{client:{select:{id:!0,name:!0,email:!0,phone:!0,address:!0,suburb:!0,state:!0,postcode:!0}},lines:{include:{job:{select:{id:!0,jobNumber:!0,scheduledDate:!0,property:{select:{name:!0,suburb:!0}}}}},orderBy:[{sortOrder:"asc"},{createdAt:"asc"}]}}})}async function $(e,t,n,i){return(0,p.renderPdfFromHtml)(function(e,t,n,i){let r=e.lines.map(e=>{let t=null!=e.job?`${m(e.job.property.name)} \xb7 ${m(e.job.jobNumber||e.job.id)} \xb7 ${(0,o.WU)(new Date(e.job.scheduledDate),"dd MMM yyyy")}`:"";return`
        <tr>
          <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;">
            <div style="font-weight:600;">${m(e.description)}</div>
            ${t?`<div style="font-size:12px;color:#6b7280;">${t}</div>`:""}
            ${e.note?`<div style="font-size:12px;color:#374151;margin-top:4px;">${m(e.note)}</div>`:""}
          </td>
          <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${e.quantity.toFixed(2)}</td>
          <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${u(e.unitPrice)}</td>
          <td style="padding:10px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${u(e.lineTotal)}</td>
        </tr>
      `}).join(""),d=Number(e.gstAmount??0)>0?`
          <div style="display:flex;justify-content:space-between;padding:8px 0;">
            <span>GST</span>
            <strong>${u(e.gstAmount)}</strong>
          </div>
        `:"",a=i?.defaultPaymentTermsDays??14,p=(0,o.WU)(new Date(new Date(e.createdAt).getTime()+864e5*a),"dd MMM yyyy"),s=i?.bankAccountNumber?`
        <div style="margin-top:32px;padding:16px;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;">
          <p style="margin:0 0 8px;font-weight:700;font-size:14px;">Payment Details</p>
          ${i.bankName?`<p style="margin:2px 0;font-size:13px;"><strong>Bank:</strong> ${m(i.bankName)}</p>`:""}
          ${i.bankAccountName?`<p style="margin:2px 0;font-size:13px;"><strong>Account name:</strong> ${m(i.bankAccountName)}</p>`:""}
          ${i.bankBsb?`<p style="margin:2px 0;font-size:13px;"><strong>BSB:</strong> ${m(i.bankBsb)}</p>`:""}
          <p style="margin:2px 0;font-size:13px;"><strong>Account number:</strong> ${m(i.bankAccountNumber)}</p>
          <p style="margin:2px 0;font-size:13px;"><strong>Reference:</strong> ${m(e.invoiceNumber)}</p>
          ${i.paymentNote?`<p style="margin:8px 0 0;font-size:12px;color:#6b7280;">${m(i.paymentNote)}</p>`:""}
        </div>
      `:"",c=function(e){let t=(e??"").trim();if(!t)return"";if(/^(https?:|data:)/i.test(t))return t;try{return(0,l.$r)(t.replace(/^\/+/,""))}catch{return t}}(n),b=e.client,y=[b.suburb,b.state,b.postcode].filter(Boolean).join(" ").trim();return`
    <html>
      <body style="font-family:Arial,sans-serif;color:#111827;margin:32px;max-width:800px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;">
          <div>
            ${c?`<img src="${c}" alt="${m(t)}" style="height:56px;margin-bottom:12px;background:#ffffff;border-radius:8px;padding:6px;" />`:""}
            <h1 style="margin:0 0 4px;font-size:26px;color:#111827;">${m(t)}</h1>
            ${i?.abn?`<p style="margin:2px 0;font-size:12px;color:#6b7280;">ABN: ${m(i.abn)}</p>`:""}
            ${i?.companyAddress?`<p style="margin:2px 0;font-size:12px;color:#6b7280;">${m(i.companyAddress)}</p>`:""}
          </div>
          <div style="text-align:right;">
            <p style="margin:0;font-size:22px;font-weight:700;color:#111827;">TAX INVOICE</p>
            <p style="margin:4px 0 0;font-size:14px;"><strong>${m(e.invoiceNumber)}</strong></p>
            <p style="margin:4px 0 0;font-size:13px;color:#6b7280;">Date: ${(0,o.WU)(new Date(e.createdAt),"dd MMM yyyy")}</p>
            <p style="margin:4px 0 0;font-size:13px;color:#6b7280;">Due: ${p}</p>
            <p style="margin:6px 0 0;display:inline-block;padding:3px 10px;border-radius:4px;font-size:12px;font-weight:700;background:${"PAID"===e.status?"#d1fae5":"SENT"===e.status?"#dbeafe":"#fef3c7"};color:${"PAID"===e.status?"#065f46":"SENT"===e.status?"#1e40af":"#92400e"};">${m(e.status)}</p>
          </div>
        </div>

        <div style="margin-bottom:28px;padding:14px 16px;border:1px solid #e5e7eb;border-radius:6px;background:#f9fafb;">
          <p style="margin:0 0 4px;font-size:11px;font-weight:600;text-transform:uppercase;color:#6b7280;letter-spacing:0.05em;">Bill To</p>
          <p style="margin:0;font-weight:700;font-size:16px;">${m(b.name)}</p>
          ${b.address?`<p style="margin:2px 0 0;font-size:13px;color:#374151;">${m(b.address)}</p>`:""}
          ${y?`<p style="margin:1px 0 0;font-size:13px;color:#374151;">${m(y)}</p>`:""}
          ${b.phone?`<p style="margin:2px 0 0;font-size:13px;color:#6b7280;">${m(b.phone)}</p>`:""}
          ${b.email?`<p style="margin:2px 0 0;font-size:13px;color:#6b7280;">${m(b.email)}</p>`:""}
          ${e.periodStart&&e.periodEnd?`<p style="margin:4px 0 0;font-size:12px;color:#6b7280;">Service period: ${(0,o.WU)(new Date(e.periodStart),"dd MMM yyyy")} – ${(0,o.WU)(new Date(e.periodEnd),"dd MMM yyyy")}</p>`:""}
        </div>

        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
          <thead>
            <tr style="background:#f3f4f6;">
              <th style="text-align:left;padding:10px 12px;border-bottom:2px solid #111827;font-size:13px;">Description</th>
              <th style="text-align:right;padding:10px 12px;border-bottom:2px solid #111827;font-size:13px;">Qty</th>
              <th style="text-align:right;padding:10px 12px;border-bottom:2px solid #111827;font-size:13px;">Rate</th>
              <th style="text-align:right;padding:10px 12px;border-bottom:2px solid #111827;font-size:13px;">Total</th>
            </tr>
          </thead>
          <tbody>${r}</tbody>
        </table>

        <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
          <div style="min-width:280px;">
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-top:1px solid #e5e7eb;">
              <span style="color:#6b7280;">Subtotal</span>
              <strong>${u(e.subtotal)}</strong>
            </div>
            ${d}
            <div style="display:flex;justify-content:space-between;padding:12px 0;border-top:2px solid #111827;font-size:18px;">
              <span><strong>Total (AUD)</strong></span>
              <strong>${u(e.totalAmount)}</strong>
            </div>
          </div>
        </div>

        ${s}
      </body>
    </html>
  `}(e,t,n,i),"client invoice PDF generation")}async function v(e){let t=Number(e.gstAmount??0)>0?"OUTPUT":"NONE";return[["ContactName","EmailAddress","InvoiceNumber","InvoiceDate","DueDate","Description","Quantity","UnitAmount","TaxType","Reference"],...e.lines.map(n=>[e.client.name,e.client.email||"",e.invoiceNumber,(0,o.WU)(new Date(e.createdAt),"yyyy-MM-dd"),(0,o.WU)(new Date(e.periodEnd||e.createdAt),"yyyy-MM-dd"),n.description,n.quantity.toFixed(2),n.unitPrice.toFixed(2),t,n.job?.jobNumber||n.job?.id||n.id])].map(e=>e.map(e=>`"${String(e).replace(/"/g,'""')}"`).join(",")).join("\n")}},63653:(e,t,n)=>{function i(e){return Number(e.toFixed(2))}function r(e,t){let n=i(Math.max(0,Number(e)||0)),r=t.gstEnabled?i(.1*n):0,o=i(n+r);return{subtotal:n,gstAmount:r,totalAmount:o}}n.d(t,{_:()=>r})}};