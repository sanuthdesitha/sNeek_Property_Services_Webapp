// @vitest-environment node
import {expect,it} from 'vitest';
import {hasStartedWorkEvidence,snapshotStartedWork,startedWorkPeriodWhere} from '@/lib/billing/started-work-review';
const start=new Date('2026-10-01T00:00:00Z');const end=new Date('2026-10-15T23:59:59.999Z');
const job={id:'job',status:'IN_PROGRESS',updatedAt:new Date('2026-10-16T00:00:00Z'),completedAt:null};
it('requires actual dated work and includes missed-period catch-up',()=>{expect(startedWorkPeriodWhere(start,end)).toEqual({OR:[{timeLogs:{some:{startedAt:{lte:end}}}},{status:{in:["COMPLETED","INVOICED"]},completedAt:{lte:end}}]});});

it('labels previously started unfinished carryover explicitly',()=>{const snapshot=snapshotStartedWork({...job,timeLogs:[{startedAt:new Date('2026-09-30T20:00:00Z')}]},start,end);expect(snapshot).toMatchObject({unfinishedAtCutoff:true,priorPeriodCarryover:true,firstStartedAt:'2026-09-30T20:00:00.000Z'});});
it('records late completion as unfinished at the closed cutoff, preserving current facts for review',()=>{const snapshot=snapshotStartedWork({...job,status:'COMPLETED',completedAt:new Date('2026-10-16T01:00:00Z'),timeLogs:[{startedAt:end}]},start,end);expect(snapshot).toMatchObject({status:'COMPLETED',unfinishedAtCutoff:true,priorPeriodCarryover:false,completedAt:'2026-10-16T01:00:00.000Z'});});
it('allows completed legacy evidence while excluding post-cutoff timers from snapshot',()=>{const snapshot=snapshotStartedWork({...job,status:'COMPLETED',completedAt:end,timeLogs:[{startedAt:new Date('2026-10-16T02:00:00Z')}]},start,end);expect(snapshot).toMatchObject({unfinishedAtCutoff:false,priorPeriodCarryover:false,firstStartedAt:null});});

it('does not mistake a reset job leftover completion timestamp for completed work',()=>{const snapshot=snapshotStartedWork({...job,completedAt:start,timeLogs:[{startedAt:start}]},start,end);expect(snapshot.unfinishedAtCutoff).toBe(true);});
it.each([{startedAt:new Date('invalid')},{startedAt:new Date('2026-10-16T01:00:00Z')},{startedAt:start,stoppedAt:new Date('2026-09-30')}])('rejects invalid or post-cutoff clock evidence %j',log=>{expect(hasStartedWorkEvidence({...job,timeLogs:[log]},end)).toBe(false);});
it('does not treat offered/assigned stale completion metadata as work',()=>{expect(hasStartedWorkEvidence({...job,status:'ASSIGNED',completedAt:start},end)).toBe(false);});
it('labels missed completed prior-period work as carryover',()=>{expect(snapshotStartedWork({...job,status:'COMPLETED',completedAt:new Date('2026-09-29')},start,end).priorPeriodCarryover).toBe(true);});
