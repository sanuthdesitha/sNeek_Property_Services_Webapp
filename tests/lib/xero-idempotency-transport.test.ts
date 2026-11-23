// @vitest-environment node
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({connection:vi.fn(),fetch:vi.fn()}));
vi.mock('@/lib/db',()=>({db:{xeroConnection:{findFirst:m.connection}}}));
import {pushClientCreditNoteToXero,pushClientInvoiceToXero,pushCleanerBillToXero,updateClientDocumentInXero} from '@/lib/xero/client';
const lines=[{description:'Work',quantity:1,unitAmount:50}];
const client=(key?:string)=>pushClientInvoiceToXero({invoiceNumber:'INV1',clientName:'Client',clientEmail:'client@local',clientXeroContactId:'contact',lineItems:lines.map(line=>({...line,accountCode:'4000'})),idempotencyKey:key});
const cleaner=(key?:string)=>pushCleanerBillToXero({cleanerName:'Cleaner',cleanerEmail:'cleaner@local',cleanerXeroContactId:'contact',lineItems:lines.map(line=>({...line,accountCode:'477'})),idempotencyKey:key});
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('fetch',m.fetch);m.connection.mockResolvedValue({tenantId:'tenant',accessToken:'test-token',expiresAt:new Date(Date.now()+3600000)});m.fetch.mockResolvedValue({ok:true,json:async()=>({Invoices:[{InvoiceID:'remote'}]})});});
afterEach(()=>vi.unstubAllGlobals());
it.each([['client',client,'ACCREC'],['cleaner',cleaner,'ACCPAY']] as const)('transports %s stable key with draft payload',async(kind,send,type)=>{await send('document-key');await send('document-key');expect(m.fetch.mock.calls.map(call=>call[1].headers['Idempotency-Key'])).toEqual(['document-key','document-key']);const request=m.fetch.mock.calls[0][1];expect(request.method).toBe('PUT');expect(request.headers['Xero-tenant-id']).toBe('tenant');expect(JSON.parse(request.body).Invoices[0]).toMatchObject({Type:type,Status:'DRAFT',Contact:{ContactID:'contact'}});});
it('does not invent keys for callers without one',async()=>{await client();expect(m.fetch.mock.calls[0][1].headers).not.toHaveProperty('Idempotency-Key');});
it('retains provider validation detail while refusing failed export',async()=>{m.fetch.mockResolvedValue({ok:false,status:400,text:async()=>JSON.stringify({Elements:[{ValidationErrors:[{Message:'Invalid account'}]}]})});await expect(client('document-key')).rejects.toThrow('Invalid account');});
it.each([client,cleaner])('refuses success-shaped response with no remote invoice identity',async send=>{m.fetch.mockResolvedValue({ok:true,json:async()=>({Invoices:[]})});await expect(send('document-key')).rejects.toThrow('Failed to create Xero');});
it('does not call transport without an active connection',async()=>{m.connection.mockResolvedValue(null);await expect(client('document-key')).rejects.toThrow('No active Xero connection');expect(m.fetch).not.toHaveBeenCalled();});
it('sends the cleaner bill to the account it is given and refuses a line without one before contacting Xero',async()=>{await cleaner('k');expect(JSON.parse(m.fetch.mock.calls[0][1].body).Invoices[0].LineItems[0].AccountCode).toBe('477');m.fetch.mockClear();await expect(pushCleanerBillToXero({cleanerName:'Cleaner',cleanerEmail:'c@local',cleanerXeroContactId:'contact',lineItems:[{description:'Work',quantity:1,unitAmount:50,accountCode:' '}]})).rejects.toThrow('Choose the Xero account for cleaner invoices');expect(m.fetch).not.toHaveBeenCalled();});
it('sends the client invoice to the account it is given and refuses a line without one before contacting Xero (never 200)',async()=>{
  await client('k');
  expect(JSON.parse(m.fetch.mock.calls[0][1].body).Invoices[0].LineItems[0].AccountCode).toBe('4000');
  m.fetch.mockClear();
  await expect(pushClientInvoiceToXero({invoiceNumber:'INV2',clientName:'Client',clientEmail:'c@local',clientXeroContactId:'contact',lineItems:[{description:'Work',quantity:1,unitAmount:50}]})).rejects.toThrow('Choose the Xero sales account for client invoices');
  await expect(pushClientCreditNoteToXero({idempotencyKey:'cn',creditNoteNumber:'CN1',clientName:'Client',clientEmail:'c@local',clientXeroContactId:'contact',lineItems:[{description:'Work',quantity:1,unitAmount:50,accountCode:' '}]})).rejects.toThrow('Choose the Xero sales account for client invoices');
  await expect(updateClientDocumentInXero({kind:'ACCREC',xeroId:'remote',idempotencyKey:'u',lineItems:[{description:'Work',quantity:1,unitAmount:50}]})).rejects.toThrow('Choose the Xero sales account for client invoices');
  expect(m.fetch).not.toHaveBeenCalled();
});
