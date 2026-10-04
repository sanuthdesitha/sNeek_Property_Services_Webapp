import { expect, it, vi } from "vitest";
import { applyQaToolEffect, qaEffectFingerprint } from "@/lib/qa/tool-effect";
it("unchanged amended damage entry reuses linked case; changed payload cannot silently duplicate", async () => {
 const receipts = new Map(); const create = vi.fn(async ({data}) => {receipts.set(data.key,data);return data;});
 const tx:any = {appSetting:{findUnique:vi.fn(async({where})=>receipts.get(where.key)),create}};
 const effect=vi.fn(async()=>"case-1");
 expect(await applyQaToolEffect(tx,"job","damage:entry",{description:"broken",area:"bath"},effect)).toBe("case-1");
 expect(await applyQaToolEffect(tx,"job","damage:entry",{area:"bath",description:"broken"},effect)).toBe("case-1");
 await expect(applyQaToolEffect(tx,"job","damage:entry",{description:"changed"},effect)).rejects.toThrow(/Correct that record/);
 expect(effect).toHaveBeenCalledTimes(1);
});
it("failed linked stock creation produces no success receipt",async()=>{
 const tx:any={appSetting:{findUnique:vi.fn(async()=>null),create:vi.fn()}};
 await expect(applyQaToolEffect(tx,"job","restock",[],async()=>{throw new Error("DB failure")})).rejects.toThrow("DB failure");
 expect(tx.appSetting.create).not.toHaveBeenCalled();
});

it("legacy amended action without receipt fails closed rather than recreating unknown prior work",async()=>{
 const effect=vi.fn();const tx:any={appSetting:{findUnique:vi.fn(async()=>null),create:vi.fn()}};
 await expect(applyQaToolEffect(tx,"job","restock",[],effect,true)).rejects.toThrow(/no reliable linked-record receipt/);expect(effect).not.toHaveBeenCalled();
});

it("fingerprints preserve meaningful ordered/null values but ignore missing optional object fields",()=>{
 expect(qaEffectFingerprint({lines:[{id:"stock",note:null,quantity:2}],optional:undefined})).toBe(qaEffectFingerprint({lines:[{quantity:2,note:null,id:"stock"}]}));
 expect(qaEffectFingerprint(["a","b"])).not.toBe(qaEffectFingerprint(["b","a"]));
 expect(qaEffectFingerprint(undefined)).toBe(qaEffectFingerprint(null));
});
