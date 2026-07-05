"use strict";exports.id=70357,exports.ids=[70357],exports.modules={71375:(e,t,a)=>{a.d(t,{Gg:()=>s,MH:()=>d,oT:()=>l});var r=a(75571),o=a(5018),n=a(9487);async function s(){return(0,r.getServerSession)(o.L)}async function l(){let e=await s();if(!e?.user)throw Error("UNAUTHORIZED");let t=await n.db.user.findUnique({where:{id:e.user.id},select:{id:!0,isActive:!0,role:!0}});if(!t?.isActive)throw Error("UNAUTHORIZED");return e.user.role=t.role,e}async function d(e){let t=await l();if(!e.includes(t.user.role))throw Error("FORBIDDEN");return t}},94085:(e,t,a)=>{a.d(t,{RZ:()=>m,V2:()=>u,pi:()=>p});var r=a(53524),o=a(9487),n=a(99756),s=a(30534),l=a(54549),d=a(29810),i=a(33929);async function u(e){let{start:t,end:a}=function(e,t){let a=new Date;return{start:e?(0,i.a1)(e):new Date(a.getFullYear(),a.getMonth(),1),end:t?(0,i._m)(t):a}}(e.startDate,e.endDate),u=!0===e.showSpentHours,[c,p]=await Promise.all([o.db.user.findUnique({where:{id:e.userId},select:{name:!0,email:!0,phone:!0,address:!0,suburb:!0,state:!0,postcode:!0,abn:!0,hourlyRate:!0,bankBsb:!0,bankAccountNumber:!0,bankAccountName:!0}}),(0,n.hO)()]);if(!c?.email)throw Error("Cleaner account not found.");let m=[];if(e.excludeInvoicedJobs)for(let t of(await o.db.cleanerInvoiceSubmission.findMany({where:{cleanerId:e.userId,status:{not:"VOID"}},select:{lineData:!0}}))){let e=t.lineData??{};if(Array.isArray(e.jobIds))for(let t of e.jobIds)"string"==typeof t&&m.push(t)}let h=Array.from(new Set([...e.excludedJobIds??[],...m])),g={OR:[{completedAt:{gte:t,lte:a}},{completedAt:null,scheduledDate:{gte:t,lte:a}}],status:{in:[r.JobStatus.SUBMITTED,r.JobStatus.QA_REVIEW,r.JobStatus.COMPLETED,r.JobStatus.INVOICED]},assignments:{some:{userId:e.userId}},...h.length>0?{id:{notIn:h}}:{}};e.excludePaidJobs&&(g.AND=[e.includePaidRunId?{OR:[{payrollRunId:null},{payrollRunId:e.includePaidRunId}]}:{payrollRunId:null}]);let b=await o.db.job.findMany({where:g,include:{property:{select:{name:!0}},assignments:{select:{userId:!0,payRate:!0,removedAt:!0}}},orderBy:{scheduledDate:"asc"}}),y=b.map(e=>e.id),v=y.length?await o.db.cleanerPayAdjustment.findMany({where:{cleanerId:e.userId,jobId:{in:y},status:r.PayAdjustmentStatus.APPROVED},select:{jobId:!0,approvedAmount:!0,requestedAmount:!0,cleanerNote:!0}}):[],A=await o.db.cleanerPayAdjustment.findMany({where:{cleanerId:e.userId,status:r.PayAdjustmentStatus.PENDING,OR:[{job:{OR:[{completedAt:{gte:t,lte:a}},{completedAt:null,scheduledDate:{gte:t,lte:a}}]}},{jobId:null,requestedAt:{gte:t,lte:a}}]},select:{requestedAmount:!0}}),f=await o.db.cleanerPayAdjustment.findMany({where:{cleanerId:e.userId,jobId:null,status:r.PayAdjustmentStatus.APPROVED,requestedAt:{gte:t,lte:a}},select:{id:!0,title:!0,cleanerNote:!0,approvedAmount:!0,requestedAmount:!0,requestedAt:!0,reviewedAt:!0},orderBy:{requestedAt:"asc"}}),x=new Map,$=new Map;for(let e of v){if(!e.jobId)continue;let t=Number(e.approvedAmount??e.requestedAmount??0);x.set(e.jobId,(x.get(e.jobId)??0)+t);let a=e.cleanerNote?.trim();if(a){let t=$.get(e.jobId)??[];t.includes(a)||t.push(a),$.set(e.jobId,t)}}let w=new Map;if(y.length>0)for(let t of(await o.db.timeLog.findMany({where:{userId:e.userId,jobId:{in:y},stoppedAt:{not:null}},select:{jobId:!0,durationM:!0}}))){let e=w.get(t.jobId)??0;w.set(t.jobId,e+(t.durationM??0)/60)}let I=b.map(t=>{let a=t.assignments.filter(e=>!e.removedAt),r=Math.max(1,a.length),o=a.find(t=>t.userId===e.userId)??t.assignments.find(t=>t.userId===e.userId);if(!o)return null;let n=Math.max(0,w.get(t.id)??0),d=e.jobHourOverrides?.[t.id],i=null!=d&&Number.isFinite(Number(d))&&Number(d)>=0,m=(0,s.T7)(t.internalNotes),h=x.get(t.id)??0,g=e.jobComments?.[t.id]?.trim()||"",b=t.isRework?"number"==typeof t.reworkPayAmount&&Number.isFinite(t.reworkPayAmount)?t.reworkPayAmount:0:void 0,y=void 0!==b?b:m.cleanerPayouts?.[e.userId],v=(0,l.GD)({jobType:t.jobType,estimatedHours:t.estimatedHours},{payRate:o.payRate,userHourlyRate:c.hourlyRate},{cleanerJobHourlyRates:p.cleanerJobHourlyRates},{cleanerId:e.userId,activeAssignmentCount:r,timerHours:n,customPayout:y,transportAllowance:m.transportAllowances?.[e.userId],approvedAdjustments:h}),A=i?(0,l.GD)({jobType:t.jobType,estimatedHours:t.estimatedHours},{payRate:o.payRate,userHourlyRate:c.hourlyRate},{cleanerJobHourlyRates:p.cleanerJobHourlyRates},{cleanerId:e.userId,activeAssignmentCount:r,timerHours:n,customPayout:m.cleanerPayouts?.[e.userId],transportAllowance:m.transportAllowances?.[e.userId],approvedAdjustments:h,hoursOverride:Number(d)}):v,f=i&&Math.abs(A.hours-v.hours)>1e-4;return{jobId:t.id,date:new Date(t.scheduledDate).toLocaleDateString("en-AU",{timeZone:"Australia/Sydney"}),jobName:`${t.property.name} - ${t.jobType.replace(/_/g," ")}`,property:t.property.name,jobType:t.jobType.replace(/_/g," "),split:A.split,payBasis:A.payBasis,rate:A.rateMissing?null:A.rate,rateMissing:A.rateMissing,hours:A.hours,originalHours:v.hours,isHoursOverridden:f,hoursChangeNote:f?`${v.hours.toFixed(2)} -> ${A.hours.toFixed(2)}`:void 0,spentHours:u?n:null,baseAmount:A.base,approvedExtraAmount:A.adjustments,transportAllowance:A.transportAllowance,amount:A.total,extraRequestNote:($.get(t.id)??[]).join(" | "),comment:g}}).filter(e=>!!e),N=new Set(e.excludedRunIds??[]),j=(await (0,d.hs)({cleanerId:e.userId,start:t,end:a})).filter(e=>!N.has(e.id)),S=(await (0,d.qx)({cleanerId:e.userId,start:t,end:a})).filter(e=>!N.has(e.id)),D=j.map(e=>({runId:e.id,date:new Date(e.completedAt||e.updatedAt||e.createdAt).toLocaleDateString("en-AU",{timeZone:"Australia/Sydney"}),runName:e.name,properties:Array.from(new Set(e.rows.map(e=>e.propertyName))).join(", "),amount:Number(e.totals.actualTotalCost??0),paymentMethod:e.payment.method.replace(/_/g," "),note:e.reimbursementNote||e.payment.note||void 0})),R=D.reduce((e,t)=>e+t.amount,0),T=S.map(e=>({runId:e.id,date:new Date(e.completedAt||e.updatedAt||e.createdAt).toLocaleDateString("en-AU",{timeZone:"Australia/Sydney"}),runName:e.name,properties:Array.from(new Set(e.rows.map(e=>e.propertyName))).join(", "),minutes:Number(e.shoppingTime.approvedMinutes??0),hourlyRate:Number(e.shoppingTime.approvedRate??0),amount:Number(e.shoppingTime.approvedAmount??0),note:e.shoppingTime.note||void 0})),P=T.reduce((e,t)=>e+t.amount,0),M=f.map(e=>({id:e.id,date:new Date(e.reviewedAt??e.requestedAt).toLocaleDateString("en-AU",{timeZone:"Australia/Sydney"}),description:e.title?.trim()||e.cleanerNote?.trim()||"Extra payment",amount:Number(e.approvedAmount??e.requestedAmount??0)})),B=M.reduce((e,t)=>e+t.amount,0),C=I.reduce((e,t)=>e+t.hours,0),U=I.reduce((e,t)=>e+t.amount,0)+B+R+P,H=A.reduce((e,t)=>e+Number(t.requestedAmount??0),0),E=[c.address,c.suburb,c.state,c.postcode].map(e=>"string"==typeof e?e.trim():"").filter(Boolean);return{cleanerName:c.name??c.email,cleanerEmail:c.email,cleanerPhone:c.phone??void 0,cleanerAddress:E.length?E.join(", "):void 0,cleanerAbn:c.abn??void 0,cleanerBankBsb:c.bankBsb??void 0,cleanerBankAccountNumber:c.bankAccountNumber??void 0,cleanerBankAccountName:c.bankAccountName??void 0,start:t,end:a,hours:C,estimatedPay:U,showSpentHours:u,rows:I,expenseRows:D,expenseTotal:R,shoppingTimeRows:T,shoppingTimeTotal:P,extraLineRows:M,extraLineTotal:B,pendingAdjustmentCount:A.length,pendingAdjustmentAmount:H,companyName:p.companyName,logoUrl:p.reportLogoUrl||p.logoUrl}}function c(e){return`$${e.toFixed(2)}`}function p(e){let t=`INV-${e.start.toISOString().slice(0,10).replace(/-/g,"")}-${e.end.toISOString().slice(0,10).replace(/-/g,"")}`,a=e.rows.some(e=>e.transportAllowance>0),r=e.rows.some(e=>e.isHoursOverridden),o=e.rows.filter(e=>e.isHoursOverridden).length,n=e.rows.some(e=>!!(e.comment&&e.comment.trim()||e.extraRequestNote&&e.extraRequestNote.trim())),s=e.expenseRows.map(e=>`
        <tr>
          <td class="cell">${e.date}</td>
          <td class="cell">${h(e.runName)}</td>
          <td class="cell">${h(e.properties)}</td>
          <td class="cell">${h(e.paymentMethod)}</td>
          <td class="cell right">${c(e.amount)}</td>
          <td class="cell">${e.note?h(e.note):"-"}</td>
        </tr>
      `).join(""),l=e.shoppingTimeRows.map(e=>`
        <tr>
          <td class="cell">${e.date}</td>
          <td class="cell">${h(e.runName)}</td>
          <td class="cell">${h(e.properties)}</td>
          <td class="cell right">${e.minutes}</td>
          <td class="cell right">${c(e.hourlyRate)}</td>
          <td class="cell right">${c(e.amount)}</td>
          <td class="cell">${e.note?h(e.note):"-"}</td>
        </tr>
      `).join(""),d=e.extraLineRows.map(e=>`
        <tr>
          <td class="cell">${e.date}</td>
          <td class="cell">${h(e.description)}</td>
          <td class="cell right">${c(e.amount)}</td>
        </tr>
      `).join(""),i=e.logoUrl?`<img class="logo" src="${h(e.logoUrl)}" alt="${h(e.companyName)} logo" />`:"",u=[e.cleanerAddress?`<p>${h(e.cleanerAddress)}</p>`:"",e.cleanerPhone?`<p>Mobile: ${h(e.cleanerPhone)}</p>`:"",`<p>Email: ${h(e.cleanerEmail)}</p>`,e.cleanerAbn?`<p>ABN: ${h(e.cleanerAbn)}</p>`:""].filter(Boolean).join(""),p=[e.cleanerBankAccountName?`<p>Account name: ${h(e.cleanerBankAccountName)}</p>`:"",e.cleanerBankBsb?`<p>BSB: ${h(e.cleanerBankBsb)}</p>`:"",e.cleanerBankAccountNumber?`<p>Account number: ${h(e.cleanerBankAccountNumber)}</p>`:""].filter(Boolean).join(""),m=`
        <div class="parties">
          <div class="party">
            <h2>From (Contractor)</h2>
            <p><strong>${h(e.cleanerName)}</strong></p>
            ${u}
          </div>
          <div class="party">
            <h2>Bill to</h2>
            <p><strong>${h(e.companyName)}</strong></p>
            <p>Accounts Payable</p>
          </div>
          <div class="party">
            <h2>Payment details</h2>
            ${p||'<p style="color:#b91c1c;">No bank details on file</p>'}
          </div>
        </div>`,g=e.rows.map(t=>{let o=[];t.extraRequestNote?.trim()&&o.push(`<div><strong>Extra request:</strong> ${h(t.extraRequestNote)}</div>`),t.comment?.trim()&&o.push(`<div><strong>Cleaner comment:</strong> ${h(t.comment)}</div>`);let s=o.length>0?o.join(""):"-";return`
        <tr${t.isHoursOverridden?' class="changed-row"':""}>
          <td class="cell">${t.date}</td>
          <td class="cell">${h(t.property)}</td>
          <td class="cell">${h(t.jobType)}</td>
          <td class="cell right">${t.split}</td>
          <td class="cell right">${null!=t.rate?`${c(t.rate)}${t.rateMissing?" (default)":""}`:"Not set"}</td>
          <td class="cell right">${t.hours.toFixed(2)}</td>
          ${r?`<td class="cell">${t.hoursChangeNote?h(t.hoursChangeNote):"-"}</td>`:""}
          ${e.showSpentHours?`<td class="cell right">${(t.spentHours??0).toFixed(2)}</td>`:""}
          <td class="cell right">${c(t.baseAmount)}</td>
          <td class="cell right">${c(t.approvedExtraAmount)}</td>
          ${a?`<td class="cell right">${c(t.transportAllowance)}</td>`:""}
          <td class="cell right">${c(t.amount)}</td>
          ${n?`<td class="cell">${s}</td>`:""}
        </tr>
      `}).join("");return`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>Cleaner Invoice</title>
        <style>
          body { font-family: Arial, sans-serif; color: #111; margin: 24px; }
          .header { display: flex; justify-content: space-between; margin-bottom: 18px; gap: 12px; }
          .brand { display: flex; gap: 12px; align-items: center; }
          .logo { max-width: 180px; max-height: 64px; width: auto; height: auto; object-fit: contain; background: #ffffff; border-radius: 8px; padding: 5px; }
          .parties { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 14px 0; }
          .party { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; }
          .party h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: #666; margin: 0 0 6px; }
          .party p { margin: 2px 0; font-size: 12px; color: #222; }
          .title { font-size: 24px; margin: 0; }
          .sub { color: #555; margin: 2px 0; font-size: 12px; }
          .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 16px 0; }
          .box { border: 1px solid #ddd; border-radius: 8px; padding: 10px; }
          .label { color: #666; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
          .value { font-weight: bold; font-size: 16px; margin-top: 4px; }
          .rule { margin-top: 10px; font-size: 11px; color: #666; }
          table { width: 100%; border-collapse: collapse; margin-top: 12px; }
          th { text-align: left; border-bottom: 2px solid #ddd; padding: 8px; font-size: 12px; }
          .cell { border-bottom: 1px solid #eee; padding: 8px; font-size: 12px; vertical-align: top; }
          .right { text-align: right; white-space: nowrap; }
          .empty { border: 1px dashed #ddd; border-radius: 8px; padding: 16px; margin-top: 12px; color: #666; }
          .changed-row { background: #fffbeb; }
          .changed-note { margin-top: 8px; font-size: 11px; color: #92400e; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="brand">
            ${i}
            <div>
              <h1 class="title">Tax Invoice</h1>
              <p class="sub"><strong>From:</strong> ${h(e.cleanerName)} (${h(e.cleanerEmail)})</p>
              <p class="sub"><strong>Period:</strong> ${e.start.toLocaleDateString("en-AU",{timeZone:"Australia/Sydney"})} to ${e.end.toLocaleDateString("en-AU",{timeZone:"Australia/Sydney"})}</p>
            </div>
          </div>
          <div style="text-align:right;">
            <p class="sub"><strong>Invoice #:</strong> ${h(t)}</p>
            <p class="sub"><strong>Issued:</strong> ${new Date().toLocaleDateString("en-AU",{timeZone:"Australia/Sydney"})}</p>
            ${e.cleanerAbn?`<p class="sub"><strong>ABN:</strong> ${h(e.cleanerAbn)}</p>`:'<p class="sub" style="color:#b91c1c;">No ABN on file</p>'}
          </div>
        </div>
        ${m}

        <div class="summary">
          <div class="box">
            <div class="label">Paid Hours</div>
            <div class="value">${e.hours.toFixed(2)}</div>
          </div>
          <div class="box">
            <div class="label">Estimated Pay</div>
            <div class="value">${c(e.estimatedPay)}</div>
          </div>
          <div class="box">
            <div class="label">Shopping Reimbursements</div>
            <div class="value">${c(e.expenseTotal)}</div>
          </div>
          <div class="box">
            <div class="label">Shopping Time</div>
            <div class="value">${c(e.shoppingTimeTotal)}</div>
          </div>
          <div class="box">
            <div class="label">Payable Jobs</div>
            <div class="value">${e.rows.length}</div>
          </div>
          <div class="box">
            <div class="label">Invoice Type</div>
            <div class="value">Contractor</div>
          </div>
        </div>

        <p class="rule">Pay rule: fixed/allocated hours are paid in full and split equally across assigned cleaners. If fixed hours are not set, pay uses the cleaner's clocked timer. Approved extras are added per job.</p>
        ${o>0?`<p class="changed-note">Hours overridden on ${o} row(s). Changed rows are highlighted.</p>`:""}

        ${e.expenseRows.length>0?`
              <h2 style="margin-top:20px;font-size:16px;">Shopping reimbursements</h2>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Run</th>
                    <th>Properties</th>
                    <th>Paid By</th>
                    <th class="right">Amount</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>${s}</tbody>
              </table>
            `:""}

        ${e.shoppingTimeRows.length>0?`
              <h2 style="margin-top:20px;font-size:16px;">Shopping time</h2>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Run</th>
                    <th>Properties</th>
                    <th class="right">Minutes</th>
                    <th class="right">Rate</th>
                    <th class="right">Amount</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>${l}</tbody>
              </table>
            `:""}

        ${e.extraLineRows.length>0?`
              <h2 style="margin-top:20px;font-size:16px;">Extra payments (not job-linked)</h2>
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th class="right">Amount</th>
                  </tr>
                </thead>
                <tbody>${d}</tbody>
              </table>
            `:""}

        ${e.rows.length>0?`
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Property</th>
                    <th>Job Type</th>
                    <th class="right">Split</th>
                    <th class="right">Rate</th>
                    <th class="right">Paid Hours</th>
                    ${r?"<th>Hours Changed</th>":""}
                    ${e.showSpentHours?'<th class="right">Hours Spent</th>':""}
                    <th class="right">Base</th>
                    <th class="right">Approved Extras</th>
                    ${a?'<th class="right">Transport</th>':""}
                    <th class="right">Total</th>
                    ${n?"<th>Comment</th>":""}
                  </tr>
                </thead>
                <tbody>${g}</tbody>
              </table>
            `:'<div class="empty">No payable jobs found in this date range.</div>'}
      </body>
    </html>
  `}async function m(e){let{renderPdfFromHtml:t}=await Promise.all([a.e(96905),a.e(85052)]).then(a.bind(a,85052));return t(e,"cleaner invoice PDF generation",{margin:{top:"16mm",right:"10mm",bottom:"16mm",left:"10mm"}})}function h(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#039;")}},33929:(e,t,a)=>{a.d(t,{Iq:()=>y,PH:()=>m,_m:()=>s,a1:()=>n,m4:()=>p,pQ:()=>l,qk:()=>b,us:()=>g,wO:()=>d,wS:()=>h});var r=a(22418);let o="Australia/Sydney";function n(e){return(0,r.Nm)(`${e}T00:00:00.000`,o)}function s(e){return(0,r.Nm)(`${e}T23:59:59.999`,o)}function l(e=new Date){return(0,r.CV)(e,o,"yyyy-MM-dd")}function d(e){return(0,r.CV)(e,o,"yyyy-MM-dd")}function i(e){let[t,a,r]=e.split("-").map(Number);return[t,a,r]}function u(e){let[t,a,r]=i(e);return new Date(Date.UTC(t,a-1,r))}function c(e){let t=e.getUTCFullYear(),a=String(e.getUTCMonth()+1).padStart(2,"0"),r=String(e.getUTCDate()).padStart(2,"0");return`${t}-${a}-${r}`}function p(e,t){let a=u(e);return a.setUTCDate(a.getUTCDate()+t),c(a)}function m(e){let t=u(e),a=t.getUTCDay();return t.setUTCDate(t.getUTCDate()+(0===a?-6:1-a)),c(t)}function h(e){let[t,a]=i(e);return`${t}-${String(a).padStart(2,"0")}-01`}function g(e){let[t,a]=i(e),r=new Date(Date.UTC(t,a,0)).getUTCDate();return`${t}-${String(a).padStart(2,"0")}-${String(r).padStart(2,"0")}`}function b(e){return`${i(e)[0]}-01-01`}function y(e){return`${i(e)[0]}-12-31`}}};