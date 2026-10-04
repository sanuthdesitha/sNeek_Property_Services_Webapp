import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {ExpectedInvoicesPanel} from '@/components/v2/admin/cleaner-invoices/expected-invoices-panel';
const fetcher=vi.fn();
const cleaner={cleanerId:'cleaner',cleanerName:'Cleaner',cleanerEmail:'cleaner@local',employmentType:'CONTRACTOR',expectedTotal:25,expectedHours:0,jobCount:0,overriddenCount:0,approvedExtraTotal:0,pendingCount:0,pendingAmount:0,rateMissingCount:0,expenseTotal:25,shoppingTimeTotal:0,rows:[]};
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('fetch',fetcher);});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function load(variance:number|null){fetcher.mockResolvedValue({ok:true,json:async()=>({start:'2026-10-01',end:'2026-10-15',grandExpectedTotal:25,grandPendingAmount:0,cleaners:[{...cleaner,submission:{id:'invoice',status:'SUBMITTED',submittedTotal:50,submittedJobCount:0,submittedAt:'2026-10-03',variance,missingJobs:[]}}]})});render(<ExpectedInvoicesPanel/>);}
it('states manual reconciliation for incomparable historical totals instead of fabricating agreement',async()=>{load(null);expect(await screen.findByText('Manual reconciliation required')).toBeVisible();expect(screen.queryByText(/Lines up with expected/)).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Show 0 job lines'}));expect(screen.getByText(/expected total comes from expenses/)).toBeVisible();expect(fetcher.mock.calls.every(([,options])=>!options.method||options.method==='GET')).toBe(true);});
it('renders a supplied positive variance with its sign',async()=>{load(25);expect(await screen.findByText(/Variance \+\$25.00 vs expected/)).toBeVisible();expect(screen.queryByText('Manual reconciliation required')).toBeNull();});
