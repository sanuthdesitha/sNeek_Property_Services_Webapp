import { beforeEach, expect, it, vi } from "vitest";
import type { EvidenceRecord } from "@/lib/cleaner/evidence-store";
const m = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), put: vi.fn() }));
vi.mock("@/lib/cleaner/evidence-store", async original => ({ ...await original<any>(), listEvidence: m.list, getEvidence: m.get, putEvidence: m.put }));
import { reconcileEvidenceAcknowledgements, reconcileEvidenceAcknowledgementsWithChanges, projectReconciledEvidence } from "@/lib/cleaner/evidence-client";
const scope = { draftIdentity:"identity", jobId:"job", templateId:"template", formRevision:"revision" };
const media = { key:"forms/job/capture/cleaner/photo.jpg",url:"https://safe.invalid/photo",kind:"image" };
let record: EvidenceRecord; let draft: any; let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetAllMocks(); record = {...scope,id:"capture",fieldId:"photo",filename:"photo.jpg",mime:"image/jpeg",blob:new Blob(["original"]),createdAt:1,folder:"forms",source:"camera",status:"uploaded",receipt:media as any};
  draft = { evidenceReceipts: {capture:{key:media.key,fieldId:"photo",draftIdentity:scope.draftIdentity,formRevision:scope.formRevision,version:0}},state:{uploads:{photo:[media]}}};
  m.list.mockImplementation(async()=>[record]); m.get.mockImplementation(async()=>record);m.put.mockImplementation(async value=>{record=value});
  Object.defineProperty(navigator,"locks",{configurable:true,value:{request:async (_key:string,fn:()=>Promise<void>)=>fn()}});
  fetcher=vi.fn(async()=>new Response(JSON.stringify({draft})));vi.stubGlobal("fetch",fetcher);
});
it("repairs lost final device acknowledgement using matching server receipt and retains original",async()=>{const original=record.blob; const records=await reconcileEvidenceAcknowledgements(scope);expect(records[0].status).toBe("attached");expect(record.blob).toBe(original);expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0][1]).toMatchObject({cache:"no-store",headers:{"X-Cleaner-Draft-Identity":"identity"}});});
it("recovers a lost upload response from its exact allocated object without retransmitting",async()=>{record={...record,status:"uploading",receipt:undefined,allocation:{key:media.key,uploadId:"upload"}};await reconcileEvidenceAcknowledgements(scope);expect(record.status).toBe("attached");expect(record.receipt?.key).toBe(media.key);});
it.each(["identity","revision","key","destination-media","no-receipt","no-key"])("keeps genuine pending evidence blocked for mismatching %s",async mode=>{if(mode==="identity")draft.evidenceReceipts.capture.draftIdentity="other";if(mode==="revision")draft.evidenceReceipts.capture.formRevision="old";if(mode==="key")draft.evidenceReceipts.capture.key="other";if(mode==="destination-media")draft.state.uploads.photo=[];if(mode==="no-receipt")draft.evidenceReceipts={};if(mode==="no-key")record.receipt=undefined;await reconcileEvidenceAcknowledgements(scope);expect(record.status).toBe("uploaded");expect(m.put).not.toHaveBeenCalled();});
it("uses acknowledged moved destination rather than stale local field",async()=>{draft.evidenceReceipts.capture={...draft.evidenceReceipts.capture,destination:{type:"formField",fieldId:"bedroom"},fieldId:"bedroom",version:2};draft.state.uploads={bedroom:[media]};await reconcileEvidenceAcknowledgements(scope);expect(record).toMatchObject({status:"attached",fieldId:"bedroom",destinationVersion:2});});
it("does not overwrite terminal removal completed while waiting for the capture lock",async()=>{Object.defineProperty(navigator,"locks",{configurable:true,value:{request:async(_key:string,fn:()=>Promise<void>)=>{record.status="detached";return fn()}}});await reconcileEvidenceAcknowledgements(scope);expect(record.status).toBe("detached");expect(m.put).not.toHaveBeenCalled();});
it("honors a server removal without deleting original bytes",async()=>{const original=record.blob;draft.evidenceReceipts.capture.detached=true;draft.state.uploads={};await reconcileEvidenceAcknowledgements(scope);expect(record.status).toBe("detached");expect(record.blob).toBe(original);});
it("never clears pending files when the authorized server read fails",async()=>{fetcher.mockResolvedValue(new Response(JSON.stringify({error:"Not assigned"}),{status:403}));await expect(reconcileEvidenceAcknowledgements(scope)).rejects.toThrow("Not assigned");expect(m.put).not.toHaveBeenCalled();});
it("rechecks already attached evidence so a lost visible-form callback can also be restored",async()=>{record.status="attached";const result=await reconcileEvidenceAcknowledgementsWithChanges(scope);expect(fetcher).toHaveBeenCalledOnce();expect(result.reconciled).toHaveLength(1);expect(projectReconciledEvidence({uploads:{}},result.reconciled,scope).state.uploads.photo[0].key).toBe(media.key);});
it("returns repaired records for restoring missed UI callbacks into the latest local draft", async () => {
  const {reconciled}=await reconcileEvidenceAcknowledgementsWithChanges(scope);expect(reconciled).toHaveLength(1);
  const latest={answers:{note:"Edited while request was pending"},uploads:{other:[{key:"unrelated",kind:"video"}]},taskDrafts:{task:{decision:"DONE",note:"Retain this",proof:[]}},laundry:{outcome:"NOT_REQUIRED",photo:[]}};
  const result=projectReconciledEvidence(latest,reconciled,scope);expect(result.changed).toBe(true);expect(result.state.uploads.photo[0].key).toBe(media.key);expect(result.state.answers).toBe(latest.answers);expect(result.state.uploads.other).toEqual(latest.uploads.other);expect(result.state.taskDrafts.task).toEqual(latest.taskDrafts.task);
  expect(latest.uploads).not.toHaveProperty("photo");
});
it("projects moved acknowledged evidence out of stale destinations without overwriting other media",async()=>{
  const confirmed={...record,status:"attached" as const,destination:{type:"formField" as const,fieldId:"bedroom"},fieldId:"bedroom"};
  const result=projectReconciledEvidence({bulkPool:[media,{key:"other"}],uploads:{photo:[media],bedroom:[]}},[confirmed],scope);
  expect(result.state.bulkPool).toEqual([{key:"other"}]);expect(result.state.uploads.photo).toEqual([]);expect(result.state.uploads.bedroom).toEqual([media]);expect(result.changed).toBe(true);
});
it("projects explicit detach globally and never adds pending or foreign-scope media",()=>{
  const result=projectReconciledEvidence({uploads:{photo:[media]}},[{...record,status:"detached"}],scope);expect(result.changed).toBe(true);expect(result.state.uploads.photo).toEqual([]);
  const latest={uploads:{photo:[]}};expect(projectReconciledEvidence(latest,[record,{...record,status:"attached",draftIdentity:"other"}],scope)).toEqual({state:latest,changed:false});
});
it("does not repeatedly request a review when visible media already matches",()=>{
  const latest={uploads:{photo:[media]},bulkPool:[],laundry:{photo:[]},carryForward:{photos:[]}};
  expect(projectReconciledEvidence(latest,[{...record,status:"attached"}],scope)).toEqual({state:latest,changed:false});
});it("preserves photo order and optional capture metadata when reconciliation arrives in reverse order",()=>{
  const first={...media,name:"local-name.jpg",width:100,annotation:{x:1}};const second={...media,key:"second",name:"second-local.jpg",duration:2};
  const latest={uploads:{photo:[first,second]},answers:{text:"Keep"}};
  const result=projectReconciledEvidence(latest,[{...record,id:"second",status:"attached",receipt:{...second,name:"server-name.jpg"} as any},{...record,status:"attached"}],scope);
  expect(result.changed).toBe(false);expect(result.state).toBe(latest);expect(result.state.uploads.photo).toEqual([first,second]);
});
it("updates changed verified media transport fields in place while preserving capture metadata",()=>{
  const existing={...media,url:"https://old.invalid",width:100};const latest={uploads:{photo:[existing,{key:"other"}]}};
  const result=projectReconciledEvidence(latest,[{...record,status:"attached"}],scope);expect(result.changed).toBe(true);expect(result.state.uploads.photo[0]).toMatchObject({url:media.url,width:100});expect(result.state.uploads.photo[1].key).toBe("other");
});
