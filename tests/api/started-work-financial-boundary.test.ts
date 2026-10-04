// @vitest-environment node
import {beforeEach,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
const m=vi.hoisted(()=>({invoice:vi.fn(),pdf:vi.fn(),csv:vi.fn(),email:vi.fn(),update:vi.fn(),notify:vi.fn()}));
vi.mock('@/lib/auth/session',()=>({requireRole:async()=>({user:{id:'admin'}})}));
vi.mock('@/lib/db',()=>({db:{clientInvoice:{update:m.update},notification:{create:m.notify}}}));
vi.mock('@/lib/billing/client-invoices',()=>({getClientInvoice:m.invoice,renderClientInvoicePdf:m.pdf,buildClientInvoiceXeroCsv:m.csv}));
vi.mock('@/lib/settings',()=>({getAppSettings:async()=>({companyName:'Test'})}));
vi.mock('@/lib/commercial/delivery-profiles',()=>({resolveClientDeliveryRecipients:async()=>['client@local']}));
vi.mock('@/lib/email-templates',()=>({renderEmailTemplate:()=>({subject:'Invoice',html:'Invoice'})}));
vi.mock('@/lib/notifications/email',()=>({sendEmailDetailed:m.email}));
import {POST as send} from '@/app/api/admin/invoices/[id]/send/route';
import {POST as csv} from '@/app/api/admin/invoices/[id]/xero-export/route';
let invoice:any;const context={params:{id:'invoice'}};const request=()=>new NextRequest('http://local/send',{method:'POST',body:'{}'});
beforeEach(()=>{vi.resetAllMocks();invoice={id:'invoice',status:'DRAFT',clientId:'client',client:{name:'Client',email:'client@local'},invoiceNumber:'INV1',totalAmount:50,lines:[],metadata:{startedWorkReview:{version:1,required:true,periodStart:'2026-10-01',periodEnd:'2026-10-15',jobs:[]}}};m.invoice.mockImplementation(async()=>invoice);m.pdf.mockResolvedValue(Buffer.from('pdf'));m.csv.mockResolvedValue('csv');m.email.mockResolvedValue({ok:true});});
it.each([['send',send],['csv',csv]] as const)('blocks %s before document/provider work when review unresolved or merely confirmed draft',async(_label,handler)=>{expect((await handler(request(),context)).status).toBe(400);invoice.metadata.startedWorkReview.required=false;expect((await handler(request(),context)).status).toBe(400);expect(m.pdf).not.toHaveBeenCalled();expect(m.csv).not.toHaveBeenCalled();expect(m.email).not.toHaveBeenCalled();expect(m.update).not.toHaveBeenCalled();});
it('permits explicit send of approved immutable snapshot',async()=>{invoice.status='APPROVED';invoice.metadata.startedWorkReview.required=false;expect((await send(request(),context)).status).toBe(200);expect(m.email).toHaveBeenCalledOnce();});
it('keeps nonstarted draft send behavior unchanged',async()=>{invoice.metadata={};expect((await send(request(),context)).status).toBe(200);expect(m.email).toHaveBeenCalledOnce();});
