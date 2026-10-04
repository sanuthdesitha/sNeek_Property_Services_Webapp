// @vitest-environment node
import {beforeEach,it,expect,vi} from 'vitest';
import {assertStartedWorkReviewed,inspectStartedWorkReview,loadStartedWorkReview} from '@/lib/billing/started-work-reconciliation';
let invoice:any;let job:any;let tx:any;
const version=new Date('2026-10-15T01:00:00Z');
beforeEach(()=>{job={id:'job',jobNumber:'J1',status:'IN_PROGRESS',updatedAt:version,completedAt:null,timeLogs:[{startedAt:version,stoppedAt:null}],propertyId:'property',property:{clientId:'client'},fixedPrice:50,jobType:'STANDARD_CLEAN',invoiceNote:'Extra oven'};invoice={status:'DRAFT',clientId:'client',lines:[{id:'line',jobId:'job',quantity:1,unitPrice:50,lineTotal:50}],metadata:{startedWorkReview:{version:1,required:false,periodStart:'2026-10-01T00:00:00Z',periodEnd:'2026-10-15T23:59:59Z',jobs:[{jobId:'job',updatedAt:version.toISOString(),agreedAmount:50}]}}};tx={$queryRaw:vi.fn(),job:{findMany:vi.fn(async()=>[job])},propertyClientRate:{findMany:vi.fn(async()=>[])},priceBook:{findMany:vi.fn(async()=>[])}};});
it('blocks every unresolved provisional review before current-data/provider work',async()=>{invoice.metadata.startedWorkReview.required=true;await expect(assertStartedWorkReviewed(invoice,tx,true)).rejects.toThrow('provisional');expect(tx.job.findMany).not.toHaveBeenCalled();});
it('requires explicit approval after confirmation and locks job evidence while approving',async()=>{await expect(assertStartedWorkReviewed(invoice,tx)).rejects.toThrow('Approve the reviewed draft');await expect(assertStartedWorkReviewed(invoice,tx,true)).resolves.toBeUndefined();expect(tx.$queryRaw).toHaveBeenCalledOnce();});
it.each(['completion','price','manual-line'])('detects %s change after confirmation before draft approval',async change=>{if(change==='completion'){job.status='COMPLETED';job.completedAt=new Date('2026-10-16');job.updatedAt=new Date('2026-10-16');}if(change==='price')job.fixedPrice=70;if(change==='manual-line')invoice.lines[0].lineTotal=70;await expect(assertStartedWorkReviewed(invoice,tx,true)).rejects.toThrow('changed after review');expect((await inspectStartedWorkReview(invoice,tx))?.changedJobIds).toEqual(['job']);});
it('preserves approved collection while surfacing later completion/billing correction',async()=>{invoice.status='APPROVED';job.fixedPrice=75;await expect(assertStartedWorkReviewed(invoice,tx)).resolves.toBeUndefined();expect(tx.job.findMany).not.toHaveBeenCalled();expect((await inspectStartedWorkReview(invoice,tx))?.requiresReview).toBe(true);expect(invoice.lines[0].lineTotal).toBe(50);});
it.each(['client','rate','evidence'])('keeps historical invoice readable when current %s prevents reconciliation',async change=>{if(change==='client')job.property.clientId='other';if(change==='rate')job.fixedPrice=null;if(change==='evidence')job.timeLogs=[];expect(await inspectStartedWorkReview(invoice,tx)).toMatchObject({requiresReview:true,error:expect.any(String)});await expect(loadStartedWorkReview(invoice,tx)).rejects.toThrow();});
it('leaves legacy nonstarted invoices unaffected',async()=>{invoice.metadata={};await expect(assertStartedWorkReviewed(invoice,tx)).resolves.toBeUndefined();expect(await inspectStartedWorkReview(invoice,tx)).toBeNull();expect(tx.job.findMany).not.toHaveBeenCalled();});

it.each([{version:2}, {jobs:null}, {periodStart:"invalid"}, {periodEnd:"invalid"}])('fails closed for malformed stored review %j', async patch => {
  Object.assign(invoice.metadata.startedWorkReview, patch);
  await expect(loadStartedWorkReview(invoice,tx)).rejects.toThrow('snapshot is invalid');
  expect(tx.job.findMany).not.toHaveBeenCalled();
});
it('retains removed snapshot job IDs and manual non-job lines for office reconciliation',async()=>{
  invoice.metadata.startedWorkReview.jobs.push({jobId:'removed',updatedAt:version.toISOString(),agreedAmount:10});
  invoice.lines.push({id:'manual',jobId:null,quantity:1,unitPrice:10,lineTotal:10});
  const state=await loadStartedWorkReview(invoice,tx);
  expect(state?.changedJobIds).toEqual(['removed']);
  await expect(assertStartedWorkReviewed(invoice,tx,true)).rejects.toThrow('changed after review');
});
it('handles non-Error data failures with an office-review message',async()=>{
  tx.job.findMany.mockRejectedValue('offline');
  expect(await inspectStartedWorkReview(invoice,tx)).toMatchObject({requiresReview:true,error:'Office reconciliation required.'});
});
it('builds a completed carryover snapshot with an empty note and no prior snapshot',async()=>{
  job.timeLogs=[{startedAt:new Date('2026-09-30')}];job.status='COMPLETED';job.completedAt=new Date('2026-09-30');job.invoiceNote=null;
  invoice.metadata.startedWorkReview.jobs=[];
  const state=await loadStartedWorkReview(invoice,tx);
  expect(state?.current[0].invoiceNote).toContain('Prior-period');
  expect(state?.changedJobIds).toEqual(['job']);
  job.timeLogs=[{startedAt:version}];job.completedAt=version;
  expect((await loadStartedWorkReview(invoice,tx))?.current[0].invoiceNote).toBeNull();
});
