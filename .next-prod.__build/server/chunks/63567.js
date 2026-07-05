"use strict";exports.id=63567,exports.ids=[63567],exports.modules={70010:(e,t,r)=>{function i(e){return!0===e||"true"===e?"Yes":!1===e||"false"===e?"No":"-"}function o(e){return null==e||""===e?"-":"boolean"==typeof e?e?"Yes":"No":Array.isArray(e)?e.length?e.join(", "):"-":String(e)}function a(e,t){if(null==t||""===t)return"-";let r=Number(t);return Number.isFinite(r)?e.unit?`${r} ${e.unit}`:String(r):o(t)}function l(e,t,r){let i=r?.mediaCount??0;return i>0?`${i} file(s)`:"Not uploaded"}r.d(t,{Vk:()=>s,gX:()=>p});let n={text:{type:"text",label:"Text",icon:"Type",category:"basic",formatValue:(e,t)=>o(t)},longtext:{type:"longtext",label:"Long text",icon:"AlignLeft",category:"basic",formatValue:(e,t)=>o(t)},number:{type:"number",label:"Number",icon:"Hash",category:"basic",hasRange:!0,scorable:!0,formatValue:a},email:{type:"email",label:"Email",icon:"Mail",category:"basic",formatValue:(e,t)=>o(t)},phone:{type:"phone",label:"Phone",icon:"Phone",category:"basic",formatValue:(e,t)=>o(t)},currency:{type:"currency",label:"Currency",icon:"DollarSign",category:"basic",formatValue:(e,t)=>{if(null==t||""===t)return"-";let r=Number(t);return Number.isFinite(r)?`$${r.toFixed(2)}`:o(t)}},date:{type:"date",label:"Date",icon:"Calendar",category:"basic",formatValue:(e,t)=>o(t)},time:{type:"time",label:"Time",icon:"Clock",category:"basic",formatValue:(e,t)=>o(t)},datetime:{type:"datetime",label:"Date & time",icon:"CalendarClock",category:"basic",formatValue:(e,t)=>o(t)},select:{type:"select",label:"Dropdown",icon:"ChevronDown",category:"choice",hasOptions:!0,scorable:!0,formatValue:(e,t)=>o(t)},multiselect:{type:"multiselect",label:"Multi-select",icon:"ListChecks",category:"choice",hasOptions:!0,scorable:!0,formatValue:(e,t)=>o(t)},checkbox:{type:"checkbox",label:"Checkbox",icon:"CheckSquare",category:"choice",scorable:!0,formatValue:(e,t)=>i(t)},radio:{type:"radio",label:"Radio",icon:"CircleDot",category:"choice",hasOptions:!0,scorable:!0,formatValue:(e,t)=>o(t)},yesno:{type:"yesno",label:"Yes / No",icon:"ToggleLeft",category:"choice",scorable:!0,formatValue:(e,t)=>"na"===t||"NA"===t||"N/A"===t?"N/A":i(t)},rating:{type:"rating",label:"Star rating",icon:"Star",category:"scale",hasRange:!0,scorable:!0,formatValue:a},slider:{type:"slider",label:"Slider",icon:"SlidersHorizontal",category:"scale",hasRange:!0,scorable:!0,defaultConfig:{min:0,max:10,step:1},formatValue:a},counter:{type:"counter",label:"Counter",icon:"Plus",category:"scale",hasRange:!0,scorable:!0,defaultConfig:{min:0,step:1},formatValue:a},scale:{type:"scale",label:"Scale (1–N)",icon:"Gauge",category:"scale",hasRange:!0,scorable:!0,defaultConfig:{min:1,max:5,step:1},formatValue:a},photo:{type:"photo",label:"Photo",icon:"Camera",category:"media",isUpload:!0,scorable:!0,defaultConfig:{minPhotos:1},formatValue:l},video:{type:"video",label:"Video",icon:"Video",category:"media",isUpload:!0,defaultConfig:{maxDurationSec:60},formatValue:l},file:{type:"file",label:"Document / file",icon:"FileText",category:"media",isUpload:!0,formatValue:l},signature:{type:"signature",label:"Signature",icon:"PenLine",category:"media",formatValue:(e,t)=>"string"==typeof t&&t.startsWith("data:image/")?"Signed":"-"},temperature:{type:"temperature",label:"Temperature",icon:"Thermometer",category:"scale",hasRange:!0,scorable:!0,defaultConfig:{unit:"\xb0C",step:.5},formatValue:a},barcode:{type:"barcode",label:"Barcode / QR scan",icon:"QrCode",category:"advanced",formatValue:(e,t)=>o(t)},location:{type:"location",label:"GPS location",icon:"MapPin",category:"advanced",formatValue:(e,t)=>{if(t&&"object"==typeof t&&"lat"in t&&"lng"in t){let{lat:e,lng:r}=t;return`${Number(e).toFixed(5)}, ${Number(r).toFixed(5)}`}return o(t)}},instruction:{type:"instruction",label:"Instruction / info",icon:"Info",category:"advanced",isReadOnly:!0,formatValue:()=>"-"}};function d(e){if(e)return n[e]}function s(e){if("upload"===e)return!0;let t=d("string"==typeof e?e:void 0);return!!t?.isUpload}function p(e,t,r){let i=d(e?.type);return i?i.formatValue(e,t,r):null==t||""===t?"-":"boolean"==typeof t?t?"Yes":"No":String(t)}},95487:(e,t,r)=>{r.d(t,{Cn:()=>a,U1:()=>o,VY:()=>c,XK:()=>l,xs:()=>m,z9:()=>s});var i=r(70010);function o(e){return`${e}_details`}function a(e){let t=Array.isArray(e)?e:[],r=[];for(let e of t)if(e&&"object"==typeof e)for(let t of(r.push(e),Array.isArray(e.children)?e.children:[]))t&&"object"==typeof t&&t.id&&r.push({...t,_isChild:!0,_parentId:e.id,_parent:e});return r}function l(e,t,r,i){return!(!p(e,t,r,i)||e?._parent&&!p(e._parent,t,r,i))}function n(e,t){return"boolean"==typeof e?e===(!0===t||"true"===t):"number"==typeof e?e===Number(t):"boolean"==typeof t?(!0===e||"true"===e)===t:"number"==typeof t?Number(e)===t:String(e??"")===String(t??"")}function d(e){return!(null==e||"string"==typeof e&&""===e.trim()||Array.isArray(e)&&0===e.length)}function s(e,t,r,i){if(!e||"object"!=typeof e)return!0;let o="value"in e?e.value:e.equals,a="string"==typeof e.operator?e.operator:"equals";if("propertyField"in e)return n(r[e.propertyField],o);if("fieldId"in e){let r=t[e.fieldId];switch(void 0===r&&/laundry/i.test(String(e.fieldId))&&(r=i),a){case"answered":return d(r);case"notAnswered":return!d(r);case"notEquals":return!n(r,o);case"oneOf":return(Array.isArray(o)?o:[o]).some(e=>n(r,e));case"gt":return Number(r)>Number(o);case"lt":return Number(r)<Number(o);default:return n(r,o)}}return!0}function p(e,t,r,i){return!(r?.hasBalcony!==!0&&`${String(e?.id??"")} ${String(e?.label??"")}`.toLowerCase().includes("balcony"))&&s(e?.conditional,t,r,i)}function c(e,t,r,o){let n=Array.isArray(e?.sections)?e.sections:[],d=[];for(let e of n)if(p(e,t,r,o))for(let n of a(e?.fields))(0,i.Vk)(n?.type)&&n?.required&&n?.id&&l(n,t,r,o)&&d.push({id:String(n.id),label:"string"==typeof n.label&&n.label.trim()?n.label.trim():String(n.id),sectionId:"string"==typeof e?.id&&e.id.trim()?e.id.trim():void 0,sectionLabel:"string"==typeof e?.label&&e.label.trim()?e.label.trim():"string"==typeof e?.id&&e.id.trim()?e.id.trim():void 0});return d}function m(e,t,r,o){let n=Array.isArray(e?.sections)?e.sections:[],d=[],s=o?.fieldTypes?.length?new Set(o.fieldTypes.map(e=>e.trim().toLowerCase())):null;for(let e of n)if(p(e,t,r,o?.laundryReady))for(let n of a(e?.fields)){if(!n?.required||!n?.id||!l(n,t,r,o?.laundryReady))continue;let a="string"==typeof n.type?n.type.trim().toLowerCase():"";if((0,i.Vk)(a)||s&&!s.has(a))continue;let p=t[String(n.id)];(null==p||"string"==typeof p&&0===p.trim().length||Array.isArray(p)&&0===p.length)&&d.push({id:String(n.id),type:a||void 0,label:"string"==typeof n.label&&n.label.trim()?n.label.trim():String(n.id),sectionId:"string"==typeof e?.id&&e.id.trim()?e.id.trim():void 0,sectionLabel:"string"==typeof e?.label&&e.label.trim()?e.label.trim():"string"==typeof e?.id&&e.id.trim()?e.id.trim():void 0})}return d}},70295:(e,t,r)=>{r.d(t,{vv:()=>i,wB:()=>o});let i="__qaTools";function o(e,t){if(!e||!t)return null;let r=new Date(e).getTime(),i=new Date(t).getTime();return Number.isFinite(r)&&Number.isFinite(i)&&!(i<=r)?Math.max(0,Math.round((i-r)/6e4)):null}},63567:(e,t,r)=>{r.d(t,{l:()=>h});var i=r(9487),o=r(57435),a=r(66429),l=r(99756),n=r(81233),d=r(22418),s=r(70010),p=r(95487),c=r(70295);async function m(e){try{if(e){let t=await i.db.reportTheme.findUnique({where:{id:e}});if(t)return t}let t=await i.db.reportTheme.findFirst({where:{isDefault:!0,isActive:!0}});if(t)return t;return await i.db.reportTheme.findFirst({where:{isActive:!0}})}catch{return null}}function f(e,t){if(!e?.layout?.sections)return!0;let r=(Array.isArray(e.layout.sections)?e.layout.sections:[]).find(e=>e?.id===t);return!r||!1!==r.visible}let u=!!(process.env.S3_BUCKET_NAME&&process.env.S3_PUBLIC_BASE_URL&&process.env.AWS_ACCESS_KEY_ID&&process.env.AWS_SECRET_ACCESS_KEY);function g(e){return String(e??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;").replace(/'/g,"&#39;")}function b(e,t,r,i){return!(!0!==i.hasBalcony&&`${String(e?.id??"")} ${String(e?.label??"")}`.toLowerCase().includes("balcony"))&&(0,p.z9)(t,r,i)}function y(e){if(!e.length)return'<span style="color:#6b7280;">-</span>';let t=e.map(e=>"VIDEO"===String(e?.mediaType??"").toUpperCase()?`<a href="${e.url}" target="_blank" rel="noreferrer" style="display:inline-block;margin:4px 6px 4px 0;padding:6px 8px;background:#f3f4f6;border-radius:6px;font-size:11px;">${g(e.label??e.fieldId)} (video)</a>`:`<img src="${e.url}" alt="${g(e.label??e.fieldId)}" style="width:120px;height:90px;object-fit:cover;border-radius:6px;margin:4px 6px 4px 0;border:1px solid #e5e7eb;" />`).join("");return`<div style="display:flex;flex-wrap:wrap;align-items:flex-start;">${t}</div>`}async function h(e,t){let h=await i.db.job.findUnique({where:{id:e},include:{property:{include:{client:!0}},assignments:{include:{user:{select:{name:!0}}}},formSubmissions:{include:{template:!0,media:!0,stockTxs:{include:{propertyStock:{include:{item:!0}}}},submittedBy:{select:{name:!0}}},orderBy:{createdAt:"desc"},take:1},qaReviews:{orderBy:{createdAt:"desc"},take:1},qaFormSubmissions:{orderBy:{createdAt:"desc"},take:1,include:{submittedBy:{select:{name:!0}}}}}});if(!h)throw Error(`Job ${e} not found`);let x=h.formSubmissions[0],$=h.qaReviews[0],v=h.qaFormSubmissions?.[0]??null,S=(0,n.WU)((0,d.zW)(h.scheduledDate,"Australia/Sydney"),"dd MMMM yyyy"),w=await (0,l.hO)(),k=await m(t),A=function({job:e,submission:t,qa:r,qaSubmission:i,localDate:o,settings:l,theme:n}){let d=t?function(e,t){let r=t?.data&&"object"==typeof t.data&&t.data.__templateSchema&&"object"==typeof t.data.__templateSchema?t.data.__templateSchema:t?.template?.schema,i=Array.isArray(r?.sections)?r.sections:[],o=t?.data&&"object"==typeof t.data?t.data:{},a=o?.uploads&&"object"==typeof o.uploads?o.uploads:{},l=new Set;return{html:i.filter(t=>b(t,t?.conditional,o,e.property??{})).map(r=>{let i=(0,p.Cn)(Array.isArray(r?.fields)?r.fields:[]).filter(t=>b(t,t?.conditional,o,e.property??{})&&(0,p.XK)(t,o,e.property??{}));if(0===i.length)return"";let n=i.map(e=>{let r=e?.type==="checkbox",i=!0===o[e.id],n=function(e,t){let{answers:r,uploads:i,submission:o}=t;if(!e?.id)return"-";if((0,s.Vk)(e.type)){let t=function(e,t,r){let i=e[r];return"string"==typeof i?i.trim()?1:0:Array.isArray(i)?i.filter(e=>"string"==typeof e&&e.trim()).length:t.filter(e=>e.fieldId===r).length}(i,o?.media??[],String(e.id));return t>0?`${t} file(s)`:"Not uploaded"}if("inventory"===e.type){let e=(o?.stockTxs??[]).filter(e=>e.quantity<0);return 0===e.length?"No inventory recorded":e.map(e=>`${e.propertyStock?.item?.name??e.propertyStock?.itemId??"Item"}: ${Math.abs(e.quantity)}`).join(", ")}if("signature"===e.type){let t=r[e.id];return"string"==typeof t&&t.trim().startsWith("data:image/")?t.trim():"-"}return(0,s.gX)(e,r[e.id])}(e,{answers:o,uploads:a,submission:t}),d=(t?.media??[]).filter(t=>t.fieldId===e.id);d.forEach(e=>{e?.id&&l.add(String(e.id))});let p=r?`<span style="display:inline-block;min-width:18px;font-size:14px;line-height:1;">${i?"&#x2611;":"&#x2610;"}</span>${g(e.label??e.id??"-")}`:g(e.label??e.id??"-"),c=y(d),m=e?.type==="signature"&&"string"==typeof n&&"-"!==n?`<img src="${n}" alt="${g(e.label??e.id??"Signature")}" style="width:220px;height:90px;object-fit:contain;border:1px solid #e5e7eb;border-radius:8px;background:#ffffff;padding:6px;" />`:g(n);return`
            <tr>
              <td style="padding:8px;border-bottom:1px solid #e5e7eb;vertical-align:top;">${p}</td>
              <td style="padding:8px;border-bottom:1px solid #e5e7eb;vertical-align:top;">${r?"&nbsp;":m}</td>
              <td style="padding:8px;border-bottom:1px solid #e5e7eb;vertical-align:top;">${c}</td>
            </tr>
          `}).join("");return`
        <div class="section">
          <h3 style="margin:0 0 8px 0;">${g(r.label??"Section")}</h3>
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr>
                <th style="padding:8px;border-bottom:2px solid #d1d5db;text-align:left;">Checklist Item</th>
                <th style="padding:8px;border-bottom:2px solid #d1d5db;text-align:left;">Submitted Value</th>
                <th style="padding:8px;border-bottom:2px solid #d1d5db;text-align:left;">Evidence</th>
              </tr>
            </thead>
            <tbody>${n}</tbody>
          </table>
        </div>
      `}).join(""),usedMediaIds:l}}(e,t):{html:"",usedMediaIds:new Set},m=t?function(e){let t=new Set,r=e?.data&&"object"==typeof e.data?e.data:{},i=Array.isArray(r.__adminRequestedTasks)?r.__adminRequestedTasks.filter(e=>e&&"object"==typeof e):[];if(0===i.length)return{html:"",usedMediaIds:t};let o=i.map(r=>{let i="string"==typeof r.photoFieldId?r.photoFieldId:"",o=i?(e?.media??[]).filter(e=>e.fieldId===i):[];o.forEach(e=>{e?.id&&t.add(String(e.id))});let a="string"==typeof r.note?r.note.trim():"";return`
        <tr>
          <td style="padding:10px;border-bottom:1px solid #fecaca;vertical-align:top;">
            <strong>${g(r.title??"Admin requested task")}</strong>
            ${r.description?`<div style="margin-top:4px;font-size:12px;color:#7f1d1d;">${g(r.description)}</div>`:""}
          </td>
          <td style="padding:10px;border-bottom:1px solid #fecaca;vertical-align:top;">
            <span style="display:inline-block;padding:4px 10px;border-radius:9999px;background:#dcfce7;color:#166534;font-size:12px;font-weight:600;">
              ${r.completed?"Completed":"Incomplete"}
            </span>
            ${a?`<div style="margin-top:8px;font-size:12px;color:#111827;"><strong>Cleaner note:</strong> ${g(a)}</div>`:""}
            <div style="margin-top:8px;font-size:11px;color:#7f1d1d;">
              ${r.requiresPhoto?"Image proof required":"No image proof required"}
              ${r.requiresNote?" \xb7 Cleaner note required":""}
            </div>
          </td>
          <td style="padding:10px;border-bottom:1px solid #fecaca;vertical-align:top;">
            ${y(o)}
          </td>
        </tr>
      `}).join("");return{html:`
      <div class="section" style="border:1px solid #fecaca;border-radius:14px;background:#fff1f2;padding:18px;">
        <h3 style="margin:0 0 10px;color:#b91c1c;">Admin Requested Tasks</h3>
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr>
              <th style="padding:8px;border-bottom:2px solid #fca5a5;text-align:left;">Task</th>
              <th style="padding:8px;border-bottom:2px solid #fca5a5;text-align:left;">Submission</th>
              <th style="padding:8px;border-bottom:2px solid #fca5a5;text-align:left;">Proof</th>
            </tr>
          </thead>
          <tbody>${o}</tbody>
        </table>
      </div>
    `,usedMediaIds:t}}(t):{html:"",usedMediaIds:new Set},u=t?function(e){let t=new Set,r=e?.data&&"object"==typeof e.data?e.data:{},i=Array.isArray(r.__jobTasks)?r.__jobTasks.filter(e=>e&&"object"==typeof e):[];if(0===i.length)return{html:"",usedMediaIds:t};let o=i.map(r=>{let i="string"==typeof r.proofFieldId?r.proofFieldId:"",o=i?(e?.media??[]).filter(e=>e.fieldId===i):[];o.forEach(e=>{e?.id&&t.add(String(e.id))});let a="string"==typeof r.note?r.note.trim():"",l=String(r.decision??"OPEN"),n="NOT_COMPLETED"===l?"Not completed":"COMPLETED"===l?"Completed":l.replace(/_/g," ");return`
        <tr>
          <td style="padding:10px;border-bottom:1px solid #bfdbfe;vertical-align:top;">
            <strong>${g(r.title??"Job task")}</strong>
            ${r.description?`<div style="margin-top:4px;font-size:12px;color:#334155;">${g(r.description)}</div>`:""}
            <div style="margin-top:8px;font-size:11px;color:#475569;">
              Source: ${g(String(r.source??"ADMIN").replace(/_/g," "))}
              ${r.approvalStatus?` • ${g(String(r.approvalStatus).replace(/_/g," "))}`:""}
            </div>
          </td>
          <td style="padding:10px;border-bottom:1px solid #bfdbfe;vertical-align:top;">
            <span style="display:inline-block;padding:4px 10px;border-radius:9999px;background:${"NOT_COMPLETED"===l?"#fee2e2":"#dcfce7"};color:${"NOT_COMPLETED"===l?"#991b1b":"#166534"};font-size:12px;font-weight:600;">
              ${g(n)}
            </span>
            ${a?`<div style="margin-top:8px;font-size:12px;color:#111827;"><strong>${"NOT_COMPLETED"===l?"Reason":"Cleaner note"}:</strong> ${g(a)}</div>`:""}
          </td>
          <td style="padding:10px;border-bottom:1px solid #bfdbfe;vertical-align:top;">
            ${y(o)}
          </td>
        </tr>
      `}).join("");return{html:`
      <div class="section" style="border:1px solid #bfdbfe;border-radius:14px;background:#eff6ff;padding:18px;">
        <h3 style="margin:0 0 10px;color:#1d4ed8;">Priority Job Tasks</h3>
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr>
              <th style="padding:8px;border-bottom:2px solid #93c5fd;text-align:left;">Task</th>
              <th style="padding:8px;border-bottom:2px solid #93c5fd;text-align:left;">Outcome</th>
              <th style="padding:8px;border-bottom:2px solid #93c5fd;text-align:left;">Proof</th>
            </tr>
          </thead>
          <tbody>${o}</tbody>
        </table>
      </div>
    `,usedMediaIds:t}}(t):{html:"",usedMediaIds:new Set},h=d.html,x=(t?.media??[]).filter(e=>!d.usedMediaIds.has(String(e.id))&&!m.usedMediaIds.has(String(e.id))&&!u.usedMediaIds.has(String(e.id))),$=n??null,v=function(e){switch(e?.layout?.photoSize??"medium"){case"small":return{w:120,h:90};case"medium":default:return{w:200,h:150};case"large":return{w:320,h:240};case"hero":return{w:480,h:360}}}($),S=y(x),w=l?.companyName||"sNeek Property Services",k=$?.logoUrl?.trim()||l?.reportLogoUrl?.trim()||l?.logoUrl?.trim()||"",A=$?.primaryColorHsl||"200 98% 39%",C=$?.accentColorHsl||A,T=$?.layout?.density??"default",N=$?.layout?.photoSize??"medium",j=f($,"header"),D=f($,"summary"),_=f($,"task-checklist"),I=f($,"before-after-gallery");f($,"signature");let E=f($,"footer"),z=f($,"qa-summary"),P=function(e,t){let r=e?.titleTemplate;return r?r.replace(/\{\{\s*job\.jobNumber\s*\}\}/g,String(t.job?.jobNumber??t.job?.id??"")).replace(/\{\{\s*property\.name\s*\}\}/g,String(t.property?.name??"")).replace(/\{\{\s*job\.scheduledFor\s*\|\s*date short\s*\}\}/g,String(t.job?.scheduledDate?new Date(t.job.scheduledDate).toLocaleDateString("en-AU",{timeZone:"Australia/Sydney"}):"")):null}($,{job:e,property:e.property})||`${w} Cleaning Report`,V=$?.footerHtml?.trim()||"",M=String($?.layout?.template??"classic"),H=z?function(e,t,r){let i=e?.data&&"object"==typeof e.data?e.data:{},o=i[c.vv]&&"object"==typeof i[c.vv]?i[c.vv]:null,l=t?.score??e?.score??null,n=t?.passed??e?.passed??null,d=String(t?.notes??e?.notes??"").trim(),s=o?.sectionPhotos&&"object"==typeof o.sectionPhotos?o.sectionPhotos:{},p=[];for(let e of Object.values(s))if(Array.isArray(e))for(let t of e)"string"==typeof t&&t.trim()&&p.push(t);let m=(Array.isArray(o?.damage)?o.damage:[]).filter(e=>e&&(e.area||e.description)).map(e=>`
        <tr>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top;">${g(e.area||"—")}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top;">${g(String(e.severity??""))}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top;">${g(e.description||"—")}</td>
        </tr>`).join("");if(null==l&&!d&&!m&&0===p.length)return{html:"",photoKeys:[]};let f=p.length?`<div class="media-grid" style="margin-top:12px;">${p.map(e=>`<div class="media-item"><img src="${g((0,a.$r)(e))}" alt="QA inspection photo" style="width:${r.w}px;height:${r.h}px;object-fit:cover;border-radius:8px;" /></div>`).join("")}</div>`:"";return{html:`
    <div class="section">
      <h3 style="margin:0 0 8px 0;">Quality inspection</h3>
      ${null!=l?`<p>Result: <span class="badge ${n?"pass":"fail"}">${Number(l).toFixed(0)}% — ${n?"PASSED":"FAILED"}</span></p>`:""}
      ${d?`<div class="label">Inspector notes</div><div class="value" style="white-space:pre-wrap;">${g(d)}</div>`:""}
      ${m?`<div class="label" style="margin-top:12px;">Damage findings</div>
             <table style="width:100%;border-collapse:collapse;margin-top:6px;">
               <thead><tr>
                 <th style="padding:6px 8px;border-bottom:2px solid #d1d5db;text-align:left;">Area</th>
                 <th style="padding:6px 8px;border-bottom:2px solid #d1d5db;text-align:left;">Severity</th>
                 <th style="padding:6px 8px;border-bottom:2px solid #d1d5db;text-align:left;">Detail</th>
               </tr></thead>
               <tbody>${m}</tbody>
             </table>`:""}
      ${f?`<div class="label" style="margin-top:12px;">Inspection photos</div>${f}`:""}
    </div>`,photoKeys:p}}(i,r,v):{html:"",photoKeys:[]},L=`<p><strong>${g(e.property.name)}</strong> - ${g(e.property.address)}, ${g(e.property.suburb)}</p>
<p>Job Number: ${g(e.jobNumber??e.id)}</p>
<p>Date: ${g(o)} | Type: ${g(e.jobType.replace(/_/g," "))}</p>
<p>Cleaners: ${g(e.assignments.map(e=>e.user.name).join(", ")||"N/A")}</p>
${r?`<p>QA Score: <span class="badge ${r.passed?"pass":"fail"}">${r.score.toFixed(0)}% - ${r.passed?"PASSED":"FAILED"}</span></p>`:""}
<div class="section">
  <div class="label">Submitted By</div>
  <div class="value">${g(t?.submittedBy?.name??"Unknown")}</div>
</div>
${t?`<div class="section">
  <div class="label">Laundry Ready</div>
  <div class="value">${!0===t.laundryReady?"Yes":!1===t.laundryReady?"No":"-"}</div>
  ${t.bagLocation?`<div class="value">Bag location: ${g(t.bagLocation)}</div>`:""}
</div>`:""}`,q=_?`${m.html}
${u.html}`:"",F=I&&x.length>0?`<div class="section">
  <div class="label">Additional Evidence</div>
  <div class="media-grid photo-${N}">${S}</div>
</div>`:"",B=E?`<footer>${V||`Generated by ${g(w)} Dashboard - ${new Date().toISOString()}`}</footer>`:"",U={headTags:`<meta charset="UTF-8"/>
<!-- report-template:v4-themeable-evidence-branding -->
<!-- report-theme:${g($?.kind??"DEFAULT")}:${g($?.id??"none")} -->
<!-- report-style:${g(M)} -->`,primaryHsl:A,accentHsl:C,densityPad:"compact"===T?"24px":"comfortable"===T?"56px":"40px",sectionMargin:"compact"===T?"14px":"comfortable"===T?"32px":"24px",photoDims:v,photoSize:N,companyName:w,logoUrl:k,renderedTitle:P,showHeader:j,showSummary:D,summaryInnerHtml:L,tasksHtml:q,checklistBodyHtml:_?h||'<div class="section"><p>No checklist values captured.</p></div>':"",galleryHtml:F,qaSummaryHtml:H.html,footerHtml:B,job:e};return"luxury"===M?function(e){let t='"Cormorant Garamond", "Hoefler Text", Garamond, "Times New Roman", Georgia, serif',r='"Helvetica Neue", Helvetica, Arial, sans-serif';return`<!DOCTYPE html>
<html lang="en">
<head>
${e.headTags}
<style>
  :root {
    --primary: hsl(${e.primaryHsl});
    --accent: hsl(${e.accentHsl});
    --ink: #1f2733;
    --muted: #6b7280;
    --hairline: rgba(31,39,51,0.12);
  }
  * { box-sizing: border-box; }
  body { font-family: ${r}; color: var(--ink); max-width: 920px; margin: 0 auto; padding: 0 ${e.densityPad} ${e.densityPad}; -webkit-print-color-adjust: exact; }
  h1, h2, h3 { font-family: ${t}; font-weight: 600; letter-spacing: 0.01em; color: var(--primary); }
  p { line-height: 1.6; }

  .lux-hero {
    margin: 0 -${e.densityPad} ${e.sectionMargin};
    padding: 48px ${e.densityPad} 40px;
    background: linear-gradient(135deg, color-mix(in srgb, var(--primary) 10%, #ffffff) 0%, #ffffff 70%);
    border-bottom: 1px solid var(--hairline);
  }
  .lux-hero .eyebrow { font-family: ${r}; font-size: 11px; letter-spacing: 0.28em; text-transform: uppercase; color: var(--accent); margin: 0 0 10px; }
  .lux-hero img { max-width: 200px; max-height: 70px; object-fit: contain; display: block; margin-bottom: 22px; }
  .lux-hero h1 { margin: 0; font-size: 44px; line-height: 1.05; }
  .lux-hero .sub { font-family: ${r}; color: var(--muted); font-size: 14px; margin: 12px 0 0; }

  .section { margin: ${e.sectionMargin} 0; }
  h3 { font-size: 24px; margin: 0 0 4px; }
  h3 + * { margin-top: 12px; }
  .rule { height: 1px; background: var(--hairline); border: 0; margin: 6px 0 16px; }
  .label { font-family: ${r}; font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--accent); }
  .value { font-size: 16px; margin-top: 4px; color: var(--ink); }

  .lux-summary { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 40px; padding: 22px 26px; border: 1px solid var(--hairline); border-radius: 18px; background: #fff; }
  .lux-summary .k { font-family: ${r}; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); }
  .lux-summary .v { font-family: ${t}; font-size: 19px; color: var(--ink); margin-top: 2px; }

  .badge { display: inline-block; padding: 5px 14px; border-radius: 9999px; font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
  .pass { background: #e7f6ec; color: #16794a; }
  .fail { background: #fdeaea; color: #c53030; }

  table { width: 100%; border-collapse: collapse; }
  th { font-family: ${r}; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--hairline); }
  td { padding: 11px 12px; border-bottom: 1px solid var(--hairline); vertical-align: top; }

  .media-grid { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 14px; }
  .media-item img { width: ${e.photoDims.w}px; height: ${e.photoDims.h}px; object-fit: cover; border-radius: 14px; box-shadow: 0 6px 18px rgba(31,39,51,0.12); }
  .media-item a { display: inline-block; padding: 8px 10px; background: #f5f6f8; border-radius: 12px; font-size: 12px; }
  div[style*="display:flex"] img { width: ${e.photoDims.w}px !important; height: ${e.photoDims.h}px !important; border-radius: 14px !important; }
  .photo-${e.photoSize} img { width: ${e.photoDims.w}px; height: ${e.photoDims.h}px; }

  footer { margin-top: 48px; padding-top: 18px; border-top: 1px solid var(--hairline); font-family: ${r}; font-size: 11px; letter-spacing: 0.02em; color: var(--muted); text-align: center; }
</style>
</head>
<body>
${e.showHeader?`<div class="lux-hero">
  ${e.logoUrl?`<img src="${g(e.logoUrl)}" alt="${g(e.companyName)} logo" style="background:#ffffff;border-radius:8px;padding:6px;" />`:`<p class="eyebrow">${g(e.companyName)}</p>`}
  <h1>${g(e.job?.property?.name||e.renderedTitle)}</h1>
  <p class="sub">${g(e.renderedTitle)}</p>
</div>`:""}
${e.showSummary?`<div class="section"><div class="lux-summary">${e.summaryInnerHtml}</div></div>`:""}
${e.tasksHtml}
${e.checklistBodyHtml}
${e.qaSummaryHtml}
${e.galleryHtml}
${e.footerHtml}
</body>
</html>`}(U):`<!DOCTYPE html>
<html lang="en">
<head>
${U.headTags}
<style>
  :root {
    --primary: hsl(${U.primaryHsl});
    --accent: hsl(${U.accentHsl});
  }
  body { font-family: Arial, sans-serif; color: #1a1a1a; max-width: 900px; margin: 0 auto; padding: ${U.densityPad}; }
  .brand { display:flex; align-items:center; gap:12px; margin-bottom: 10px; }
  .brand img { max-width:180px; max-height:64px; width:auto; height:auto; object-fit:contain; }
  .brand h1 { margin:0; color: var(--primary); }
  h1, h3 { color: var(--primary); }
  .section { margin: ${U.sectionMargin} 0; }
  .label { font-size: 12px; color: #666; text-transform: uppercase; }
  .value { font-size: 16px; margin-top: 4px; }
  .badge { display: inline-block; padding: 4px 10px; border-radius: 9999px; font-size: 12px; }
  .pass { background: #dcfce7; color: #16a34a; }
  .fail { background: #fee2e2; color: #dc2626; }
  .media-grid { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px; }
  .media-item img { width: ${U.photoDims.w}px; height: ${U.photoDims.h}px; object-fit: cover; border-radius: 8px; }
  .media-item a { display: inline-block; padding: 8px; background: #f3f4f6; border-radius: 8px; font-size: 12px; }
  /* theme-driven photo sizing inside field-media renders */
  div[style*="display:flex"] img { width: ${U.photoDims.w}px !important; height: ${U.photoDims.h}px !important; }
  .photo-${U.photoSize} img { width: ${U.photoDims.w}px; height: ${U.photoDims.h}px; }
  .hero-banner { width: 100%; border-radius: 12px; overflow: hidden; margin: 0 0 ${U.sectionMargin}; border: 1px solid #e5e7eb; }
  .hero-banner img { width: 100%; height: 100%; object-fit: cover; display: block; }
  footer { margin-top: 40px; font-size: 12px; color: #999; }
</style>
</head>
<body>
${U.showHeader?`<div class="brand">
  ${U.logoUrl?`<img src="${g(U.logoUrl)}" alt="${g(U.companyName)} logo" style="background:#ffffff;border-radius:8px;padding:6px;" />`:""}
  <h1>${g(U.renderedTitle)}</h1>
</div>`:""}
${U.showSummary?U.summaryInnerHtml:""}
${U.tasksHtml}
${U.checklistBodyHtml}
${U.qaSummaryHtml}
${U.galleryHtml}
${U.footerHtml}
</body>
</html>`}({job:h,submission:x,qa:$,qaSubmission:v,localDate:S,settings:w,theme:k}),C=`reports/${e}/report.html`,T=null;if(u)try{await a.s3.putObject({Bucket:process.env.S3_BUCKET_NAME,Key:C,Body:A,ContentType:"text/html"}).promise(),T=C}catch(t){o.k.error({err:t,jobId:e},"Failed to upload report HTML to S3; keeping DB copy only")}let N=null;try{let{renderPdfFromHtml:t}=await r.e(50431).then(r.bind(r,85052)),i=await t(A,"job report PDF generation");if(u){let t=`reports/${e}/report.pdf`;await a.s3.putObject({Bucket:process.env.S3_BUCKET_NAME,Key:t,Body:i,ContentType:"application/pdf"}).promise(),N=`${process.env.S3_PUBLIC_BASE_URL}/${t}`}}catch(t){o.k.error({err:t,jobId:e},"PDF generation failed; storing HTML only")}await i.db.report.upsert({where:{jobId:e},create:{jobId:e,htmlContent:A,pdfUrl:N,s3Key:T,themeId:k?.id??null},update:{htmlContent:A,pdfUrl:N,s3Key:T,themeId:k?.id??null,updatedAt:new Date}}),o.k.info({jobId:e,pdfUrl:N},"Job report generated")}}};