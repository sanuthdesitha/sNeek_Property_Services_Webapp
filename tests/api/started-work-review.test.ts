// @vitest-environment node
import {beforeEach,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({role:vi.fn(),invoice:vi.fn(),job:vi.fn(),update:vi.fn(),line:vi.fn(),audit:vi.fn(),lock:vi.fn()}));
vi.mock('@/lib/auth/session',()=>({requireRole:m.role}));
vi.mock('@/lib/db',()=>({db:{$transaction:async(fn:any)=>fn({$queryRaw:m.lock,clientInvoice:{findUnique:m.invoice,update:m.update},clientInvoiceLine:{update:m.line},job:{findMany:m.job},propertyClientRate:{findMany:async()=>[]},priceBook:{findMany:async()=>[]},auditLog:{create:m.audit}})}}));
import {POST} from '@/app/api/admin/invoices/[id]/started-work-review/route';
let invoice:any;let job:any;const version=new Date('2026-10-15T00:00:00Z');
const send=(action='REFRESH',extra={})=>POST(new Request('http://local',{method:'POST',body:JSON.stringify({action,expectedUpdatedAt:version.toISOString(),...extra})}) as any,{params:{id:'invoice'}});
beforeEach(()=>{vi.resetAllMocks();job={id:'job',status:'COMPLETED',completedAt:new Date('2026-10-16'),updatedAt:version,timeLogs:[{startedAt:version}],propertyId:'property',property:{clientId:'client'},fixedPrice:70,jobType:'STANDARD_CLEAN',invoiceNote:'Oven approved'};invoice={id:'invoice',status:'DRAFT',clientId:'client',updatedAt:version,gstEnabled:false,lines:[{id:'line',jobId:'job',quantity:1,unitPrice:50,lineTotal:50,category:'SERVICE'}],metadata:{other:'preserve',startedWorkReview:{version:1,required:true,periodStart:'2026-10-01T00:00:00Z',periodEnd:'2026-10-15T23:59:59Z',jobs:[{jobId:'job',agreedAmount:50,updatedAt:version.toISOString()}]}}};m.role.mockResolvedValue({user:{id:'admin'}});m.invoice.mockImplementation(async()=>invoice);m.job.mockImplementation(async()=>[job]);});
it('refreshes only draft job prices and extras, preserves metadata and requires another explicit confirmation',async()=>{expect((await send()).status).toBe(200);expect(m.line.mock.calls[0][0].data).toMatchObject({unitPrice:70,lineTotal:70,quantity:1,note:expect.stringContaining('Oven approved')});expect(m.update.mock.calls[0][0].data).toMatchObject({totalAmount:70,metadata:{other:'preserve',startedWorkReview:{required:true}}});expect(m.audit).toHaveBeenCalledOnce();});
it.each(['APPROVED','SENT','PART_PAID','PAID','VOID'])('never reconciles %s invoice amounts',async status=>{invoice.status=status;expect((await send()).status).toBe(409);expect(m.line).not.toHaveBeenCalled();expect(m.update).not.toHaveBeenCalled();});
it.each([{xeroInvoiceId:'remote'},{xeroExportedAt:version},{paidAmount:1},{metadata:{xeroExportState:'PENDING'}}])('retains protected financial evidence %j',async fields=>{Object.assign(invoice,fields);expect((await send()).status).toBe(409);expect(m.update).not.toHaveBeenCalled();});
it('requires evidence for confirmation and rejects stale rendered invoice versions',async()=>{expect((await send('CONFIRM')).status).toBe(400);expect((await send('REFRESH',{expectedUpdatedAt:new Date(0).toISOString()})).status).toBe(409);expect(m.update).not.toHaveBeenCalled();});
it('refuses confirmation until changed amounts are refreshed and inspected',async()=>{expect((await send('CONFIRM',{evidenceNote:'Reviewed the agreed job price.'})).status).toBe(409);expect(m.update).not.toHaveBeenCalled();});
it('confirms current amounts with reviewer identity but does not approve or issue',async()=>{job.fixedPrice=50;expect((await send('CONFIRM',{evidenceNote:'Reviewed unfinished work and the provisional price.'})).status).toBe(200);const data=m.update.mock.calls[0][0].data;expect(data.metadata.startedWorkReview).toMatchObject({required:false,reviewedById:'admin',reviewedAt:expect.any(String)});expect(data).not.toHaveProperty('status');expect(data).not.toHaveProperty('totalAmount');});
it.each([['UNAUTHORIZED',401],['FORBIDDEN',403]])('requires office role %s',async(message,status)=>{m.role.mockRejectedValue(new Error(String(message)));expect((await send()).status).toBe(status);expect(m.invoice).not.toHaveBeenCalled();});

it('rejects missing invoice, missing snapshot and non-Error failures without writes',async()=>{
  m.invoice.mockResolvedValueOnce(null);expect((await send()).status).toBe(409);
  invoice.metadata={};expect((await send()).status).toBe(409);
  m.invoice.mockRejectedValueOnce('offline');
  expect(await (await send()).json()).toEqual({error:'Could not reconcile draft.'});
  expect(m.update).not.toHaveBeenCalled();
});
it('preserves manual lines while defaulting missing GST policy on refresh',async()=>{
  invoice.gstEnabled=null;invoice.paidAmount=null;
  invoice.lines.push({id:'manual',jobId:null,quantity:1,unitPrice:20,lineTotal:20,category:'SERVICE'});
  expect((await send()).status).toBe(200);
  expect(m.line).toHaveBeenCalledTimes(1);
  expect(m.update.mock.calls[0][0].data.totalAmount).toBe(99);
});
it('replaces the provisional review wording only after explicit evidence confirmation',async()=>{
  job.fixedPrice=50;invoice.lines[0].note='PROVISIONAL; office review required.';
  expect((await send('CONFIRM',{evidenceNote:'Reviewed provisional price and job evidence.'})).status).toBe(200);
  expect(m.line).toHaveBeenCalledWith({where:{id:'line'},data:{note:'PROVISIONAL; office-reviewed provisional estimate.'}});
});
