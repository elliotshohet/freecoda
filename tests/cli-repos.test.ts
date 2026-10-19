import { test, expect } from "bun:test";
import { createRequire } from "node:module";
const { Command } = createRequire(new URL("../packages/cli/package.json", import.meta.url))("commander");
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { saveConfig } from "../packages/cli/src/config";
import { registerRepoCommands } from "../packages/cli/src/repos";
test("CLI repository configuration uses account authorization and shared settings without cloning", async () => {
 const directory=await mkdtemp(path.join(tmpdir(),"freecoda-repos-"));
 const previousDir=process.env.FREECODA_CONFIG_DIR, originalFetch=globalThis.fetch, originalLog=console.log;
 process.env.FREECODA_CONFIG_DIR=directory;
 const requests: {path:string;method:string;body?:any}[]=[];
 const repository={repositoryId:456,installationId:123,owner:"owner",name:"repo",defaultBranch:"main",private:true};
 try {
  await saveConfig({server:"https://freecoda.com",token:"fixture-device-token-not-a-real-credential",trustedRoots:[],theme:"auto"});
  console.log=()=>{};
  globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
   expect((init?.headers as Record<string,string>).Authorization).toBe("Bearer fixture-device-token-not-a-real-credential");
   expect(init?.redirect).toBe("error");
   const url=new URL(String(input));
   requests.push({path:url.pathname,method:init?.method||"GET",...(init?.body?{body:JSON.parse(String(init.body))}:{})});
   return Response.json(url.pathname.endsWith("/repos")?{repos:[repository],installUrl:null}:{repositories:[]});
  }) as typeof fetch;
  const program=new Command();registerRepoCommands(program);
  await program.parseAsync(["node","freecoda","repos","configure","owner/repo","--branch","develop","--directory","apps/web"]);
  expect(requests.map(request=>[request.path,request.method])).toEqual([["/api/v1/github/repos","GET"],["/api/v1/github/repositories","GET"],["/api/v1/github/repositories","PUT"]]);
  expect(requests[2].body).toEqual({repositories:[{repositoryId:456,installationId:123,owner:"owner",name:"repo",branch:"develop",appDirectory:"apps/web",enabled:true}]});
  expect(requests[2].body.repositories[0]).not.toHaveProperty("private");
 } finally {
  globalThis.fetch=originalFetch;console.log=originalLog;
  if(previousDir===undefined)delete process.env.FREECODA_CONFIG_DIR;else process.env.FREECODA_CONFIG_DIR=previousDir;
  await rm(directory,{recursive:true,force:true});
 }
});
