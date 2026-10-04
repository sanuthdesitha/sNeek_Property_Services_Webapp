// @vitest-environment node
import {beforeEach,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({role:vi.fn(),job:vi.fn(),quote:vi.fn(),save:vi.fn(),audit:vi.fn(),email:vi.fn(),recipients:vi.fn(),notification:vi.fn()}));
vi.mock('@/lib/auth/session',()=>({requireRole:m.role}));
vi.mock('@/lib/db',()=>({db:{job:{findUnique:m.job,updateMany:m.save},quote:{findFirst:m.quote},auditLog:{create:m.audit},notification:{create:m.notification}}}));
vi.mock('@/lib/settings',()=>({getAppSettings:async()=>({companyName:'Test',pricing:{gstEnabled:false,gstRate:10,pricesIncludeGst:false}})}));
vi.mock('@/lib/notifications/email',()=>({sendEmailDetailed:m.email}));
vi.mock('@/lib/email-templates',()=>({wrapEmailHtml:(v:any)=>String(v)}));
vi.mock('@/lib/commercial/delivery-profiles',()=>({resolveClientDeliveryRecipients:m.recipients}));
import {POST,DELETE} from '@/app/api/admin/jobs/[id]/quote-extras/route';
import {serializeJobInternalNotes} from '@/lib/jobs/meta';
let job:any;const context={params:{id:'job'}};
const call=(body:any,remove=false)=>(remove?DELETE:POST)(new Request('http://local',{method:remove?'DELETE':'POST',body:JSON.stringify(body)}) as any,context);
beforeEach(()=>{vi.resetAllMocks();job={id:'job',jobNumber:'J1',jobType:'STANDARD_CLEAN',scheduledDate:new Date(),fixedPrice:100,invoiceNote:null,internalNotes:null,property:{name:'Test property',client:{id:'client',name:'Client',email:'client@local'}}};m.role.mockResolvedValue({user:{id:'admin'}});m.job.mockImplementation(async()=>job);m.quote.mockResolvedValue(null);m.save.mockResolvedValue({count:1});m.recipients.mockResolvedValue(['client@local']);m.email.mockResolvedValue({ok:true});});
it('defaults additions to draft-only and compares all previous billing inputs',async()=>{const result=await call({add:[{label:'Oven',price:20}]});expect(result.status).toBe(200);expect(await result.json()).toMatchObject({emailed:false,fixedPrice:120});expect(m.email).not.toHaveBeenCalled();expect(m.save.mock.calls[0][0].where).toEqual({id:'job',fixedPrice:100,internalNotes:null,invoiceNote:null});});
it.each([{id:'oven',label:'New label',price:10},{label:'  OVEN  ',price:10}])('rejects duplicate identity or normalized label %j',async add=>{job.internalNotes=serializeJobInternalNotes({additionals:[{id:'oven',label:'Oven'}]} as any);expect((await call({add:[add]})).status).toBe(409);expect(m.save).not.toHaveBeenCalled();});
it('rejects stale optimistic save before audit or client notification',async()=>{m.save.mockResolvedValue({count:0});expect((await call({add:[{label:'Oven',price:20}],notifyClient:true})).status).toBe(409);expect(m.audit).not.toHaveBeenCalled();expect(m.email).not.toHaveBeenCalled();});
it('only sends when explicitly requested',async()=>{expect((await call({add:[{label:'Oven',price:20}],notifyClient:true})).status).toBe(200);expect(m.email).toHaveBeenCalledOnce();expect(m.notification.mock.calls[0][0].data.status).toBe('SENT');});
it('defaults removal to draft-only too',async()=>{job.internalNotes=serializeJobInternalNotes({additionals:[{id:'oven',label:'Oven'}],additionalPrices:{oven:20}} as any);expect((await call({removeLabels:['Oven']},true)).status).toBe(200);expect(m.email).not.toHaveBeenCalled();expect(m.save.mock.calls[0][0].data.fixedPrice).toBe(80);});
