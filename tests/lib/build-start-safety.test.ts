// @vitest-environment node
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it, vi } from "vitest";
it("build and runtime generation hooks cannot implicitly migrate or bootstrap an account",()=>{
 for(const file of ["scripts/prebuild.cjs","scripts/ensure-prisma-client.cjs"]){
  const spawn=vi.fn(()=>({status:0,stdout:"",stderr:""}));
  vm.runInNewContext(readFileSync(file,"utf8"),{require:(name:string)=>name==="node:child_process"?{spawnSync:spawn}:name==="node:fs"?{existsSync:()=>false}:{resolve:()=>"unused"},process:{env:{},platform:"linux",cwd:()=>"/tmp",stdout:{write:vi.fn()},stderr:{write:vi.fn()},exit:vi.fn()},console:{log:vi.fn()}});
  expect(spawn.mock.calls.map((call:any)=>[call[0],call[1]])).toEqual([["npm",["run","db:generate"]]]);
 }
 const pkg=JSON.parse(readFileSync("package.json","utf8"));
 expect(pkg.scripts.prestart).not.toMatch(/migrate|bootstrap|db:push|seed/);
 expect(readFileSync("docker-compose.yml","utf8")).not.toMatch(/migrate deploy|admin:bootstrap/);
 expect(pkg.scripts["db:deploy"]).toBe("prisma migrate deploy");
});
