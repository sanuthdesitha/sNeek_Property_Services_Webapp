import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {StartedWorkReviewPanel} from '@/components/v2/admin/finance/started-work-review';
const fetcher=vi.fn();const updated=vi.fn();
const props:any={invoiceId:'invoice',status:'DRAFT',updatedAt:'2026-10-16T00:00:00Z',review:{version:1,required:true,periodStart:'2026-09-30T14:00:00Z',periodEnd:'2026-10-15T12:59:59.999Z',jobs:[{jobId:'job',jobNumber:'J1',agreedAmount:50,unfinishedAtCutoff:true,priorPeriodCarryover:true}]},inspection:{requiresReview:true,changedJobIds:[]},onUpdated:updated};
beforeEach(()=>{vi.resetAllMocks();vi.stubGlobal('fetch',fetcher);fetcher.mockResolvedValue({ok:true,json:async()=>({ok:true})});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('labels provisional carryover, renders Sydney dates and requires review evidence',async()=>{render(<StartedWorkReviewPanel {...props}/>);expect(screen.getByText(/prior-period carryover/)).toBeVisible();expect(screen.getByText(/1\/10\/2026 to 15\/10\/2026/)).toBeVisible();const confirm=screen.getByRole('button',{name:'Confirm reviewed provisional amounts'});expect(confirm).toBeDisabled();fireEvent.change(screen.getByRole('textbox'),{target:{value:'  Checked agreed price and unfinished work.  '}});fireEvent.click(confirm);await waitFor(()=>expect(updated).toHaveBeenCalledOnce());expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({action:'CONFIRM',expectedUpdatedAt:props.updatedAt,evidenceNote:'Checked agreed price and unfinished work.'});expect(await screen.findByRole('status')).toHaveTextContent('No invoice was sent, paid or exported');});
it('refreshes draft without claiming confirmation and retains visible error',async()=>{fetcher.mockResolvedValueOnce({ok:false,json:async()=>({error:'Invoice changed; reload.'})});render(<StartedWorkReviewPanel {...props}/>);fireEvent.click(screen.getByRole('button',{name:'Refresh draft from jobs'}));expect(await screen.findByRole('status')).toHaveTextContent('Invoice changed');expect(updated).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Refresh draft from jobs'}));await waitFor(()=>expect(updated).toHaveBeenCalledOnce());expect(screen.getByRole('status')).toHaveTextContent('then confirm your review');});
it('shows issued correction warning without exposing amount mutation actions',()=>{render(<StartedWorkReviewPanel {...props} status="SENT" inspection={{requiresReview:true,changedJobIds:['job']}}/>);expect(screen.getByRole('alert')).toHaveTextContent('snapshot has not been changed');expect(screen.queryByRole('button')).toBeNull();expect(fetcher).not.toHaveBeenCalled();});

it('shows completed reviewed work and disables confirmation on inspection error',()=>{
  const review={...props.review,required:false,jobs:[{jobId:'job',jobNumber:null,agreedAmount:50,unfinishedAtCutoff:false,priorPeriodCarryover:false}]};
  const mounted=render(<StartedWorkReviewPanel {...props} review={review} inspection={null}/>);
  expect(screen.getByText(/completed by cutoff/)).toHaveTextContent('job:');
  expect(screen.getByText(/This remains a draft/)).toBeVisible();
  mounted.rerender(<StartedWorkReviewPanel {...props} review={review} inspection={{requiresReview:true,changedJobIds:[],error:'Evidence unavailable'}}/>);
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'Evidence reviewed in the office'}});
  expect(screen.getByRole('alert')).toHaveTextContent('Evidence unavailable');
  expect(screen.getByRole('button',{name:'Confirm reviewed provisional amounts'})).toBeDisabled();
  mounted.rerender(<StartedWorkReviewPanel {...props} review={review} inspection={{requiresReview:true,changedJobIds:['job']}}/>);
  expect(screen.getByRole('alert')).toHaveTextContent('Refresh and review the draft');
});
it.each(['response','rejection'])('shows a fallback failure message for %s',async kind=>{
  if(kind==='response')fetcher.mockResolvedValue({ok:false,json:async()=>({})});else fetcher.mockRejectedValue('offline');
  render(<StartedWorkReviewPanel {...props}/>);
  fireEvent.click(screen.getByRole('button',{name:'Refresh draft from jobs'}));
  expect(await screen.findByRole('status')).toHaveTextContent('Review could not be saved.');
  expect(updated).not.toHaveBeenCalled();
});
