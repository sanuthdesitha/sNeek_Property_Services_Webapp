// @vitest-environment node
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({connection:vi.fn(),fetch:vi.fn()}));
vi.mock('@/lib/db',()=>({db:{xeroConnection:{findFirst:m.connection}}}));
import {pushClientInvoiceToXero,pushCleanerBillToXero} from '@/lib/xero/client';
const lines=[{description:'Work',quantity:1,unitAmount:50}];
const client=(key?:string)=>pushClientInvoiceToXero({invoiceNumber:'INV1',clientName:'Client',clientEmail:'client@local',clientXeroContactId:'contact',lineItems:lines,idempotencyKey:key});
const cleaner=(key?:string)=>pushCleanerBillToXero({cleanerName:'Cleaner',cleanerEmail:'cleaner@local',cleanerXeroContactId:'contact',lineItems:lines,idempotencyKey:key});
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('fetch',m.fetch);m.connection.mockResolvedValue({tenantId:'tenant',accessToken:'test-token',expiresAt:new Date(Date.now()+3600000)});m.fetch.mockResolvedValue({ok:true,json:async()=>({Invoices:[{InvoiceID:'remote'}]})});});
afterEach(()=>vi.unstubAllGlobals());
it.each([['client',client,'ACCREC'],['cleaner',cleaner,'ACCPAY']] as const)('transports %s stable key with draft payload',async(kind,send,type)=>{await send('document-key');await send('document-key');expect(m.fetch.mock.calls.map(call=>call[1].headers['Idempotency-Key'])).toEqual(['document-key','document-key']);const request=m.fetch.mock.calls[0][1];expect(request.method).toBe('PUT');expect(request.headers['Xero-tenant-id']).toBe('tenant');expect(JSON.parse(request.body).Invoices[0]).toMatchObject({Type:type,Status:'DRAFT',Contact:{ContactID:'contact'}});});
it('does not invent keys for callers without one',async()=>{await client();expect(m.fetch.mock.calls[0][1].headers).not.toHaveProperty('Idempotency-Key');});
it('retains provider validation detail while refusing failed export',async()=>{m.fetch.mockResolvedValue({ok:false,status:400,text:async()=>JSON.stringify({Elements:[{ValidationErrors:[{Message:'Invalid account'}]}]})});await expect(client('document-key')).rejects.toThrow('Invalid account');});
it.each([client,cleaner])('refuses success-shaped response with no remote invoice identity',async send=>{m.fetch.mockResolvedValue({ok:true,json:async()=>({Invoices:[]})});await expect(send('document-key')).rejects.toThrow('Failed to create Xero');});
it('does not call transport without an active connection',async()=>{m.connection.mockResolvedValue(null);await expect(client('document-key')).rejects.toThrow('No active Xero connection');expect(m.fetch).not.toHaveBeenCalled();});
