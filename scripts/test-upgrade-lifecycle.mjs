// Optional release acceptance: real previous npm package + binary to this candidate.
// Usage: node scripts/test-upgrade-lifecycle.mjs <previous-binary> <candidate-tarball>
// Downloads amicooked@0.1.5 into a disposable prefix; never touches a user's installation.
import assert from "node:assert/strict";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const previous = path.resolve(process.argv[2]);
const tarball = path.resolve(process.argv[3]);
const candidate = path.resolve(`build/amicooked-${process.platform}-${process.arch}`);
const root=fs.mkdtempSync(path.join(os.tmpdir(),"amicooked-release-lifecycle-"));
const env={...process.env,HOME:root,USERPROFILE:root,CODEX_HOME:path.join(root,".codex"),GEMINI_CLI_HOME:path.join(root,".gemini"),AMICOOKED_HOME:path.join(root,".amicooked"),AMICOOKED_SKIP_VIDEO_DEPS: "1", AMICOOKED_NO_TELEMETRY:"1"};
Object.assign(process.env,env);
const run=(command,args)=>execFileSync(command,args,{env,encoding:"utf8",timeout:180000});
const {reloadConfig}=await import("../dist/config.js");reloadConfig();
const {updateCommand,binaryAsset}=await import("../dist/cli/update.js");
const {VERSION}=await import("../dist/version.js");
const results=[];
const upgradeEvents=[];
const report=async event=>{upgradeEvents.push(event);return true;};
let client;
try {
 fs.mkdirSync(env.AMICOOKED_HOME,{recursive:true});
 fs.writeFileSync(path.join(env.AMICOOKED_HOME,"config.json"),JSON.stringify({version:1,browser:"chrome",filesDir:path.join(root,"downloads"),school:{id:"mcmaster",name:"McMaster",lmsName:"Avenue",host:"avenue.cllmcmaster.ca"}}));
 fs.writeFileSync(path.join(env.AMICOOKED_HOME,"token.json"),"preserved session fixture");
 const saved=fs.readFileSync(path.join(env.AMICOOKED_HOME,"token.json"),"utf8");
 const skill=path.join(root,"client/skills/amicooked");fs.mkdirSync(skill,{recursive:true});
 fs.writeFileSync(path.join(skill,"SKILL.md"),"Original customized v0.1.5 skill");fs.writeFileSync(path.join(skill,"personal.md"),"Keep my notes");
 const config=JSON.parse(fs.readFileSync(path.join(env.AMICOOKED_HOME,"config.json")));config.skillDirs=[skill];fs.writeFileSync(path.join(env.AMICOOKED_HOME,"config.json"),JSON.stringify(config));reloadConfig();
 const target=path.join(root,"amicooked");fs.copyFileSync(previous,target);fs.chmodSync(target,0o755);assert.equal(run(target,["--version"]).trim(),"0.1.5");
 client=new Client({name:"previous-release",version:"1"});await client.connect(new StdioClientTransport({command:target,args:["mcp"],env}));assert((await client.listTools()).tools.some(t=>t.name==="am_i_cooked"));
 const asset=binaryAsset(process.platform,process.arch),bytes=fs.readFileSync(candidate);const base=`https://github.com/udaysinghkanwar/amicooked/releases/download/v${VERSION}/`;
 const fetcher=async url=>String(url).endsWith("releases/latest")?Response.json({tag_name:`v${VERSION}`,body:"Candidate release fixture",assets:[asset,"SHA256SUMS"].map(name=>({name,browser_download_url:base+name}))}):new Response(String(url).endsWith("SHA256SUMS")?`${createHash("sha256").update(bytes).digest("hex")}  ${asset}\n`:bytes);
 assert.equal(await updateCommand({json:true,compatibleOnly:true},{report,fetch:fetcher,version:"0.1.5",runtime:{execPath:target,argv:[target],platform:process.platform,isCompiled:true}}),0);
 assert.deepEqual(upgradeEvents,[{from:"0.1.5",to:VERSION,mode:"automatic",channel:"native"}]);
 assert.equal(run(target,["--version"]).trim(),VERSION);assert.equal(run(target+".previous",["--version"]).trim(),"0.1.5");
 assert((await client.listTools()).tools.some(t=>t.name==="am_i_cooked"));await client.close();client=null;
 assert(fs.existsSync(path.join(skill,"references/lecture-videos.md")));assert.equal(fs.readFileSync(path.join(skill,"personal.md"),"utf8"),"Keep my notes");assert.equal(fs.readFileSync(path.join(env.AMICOOKED_HOME,"token.json"),"utf8"),saved);
 assert.equal(JSON.parse(run(target,["auto-update","status","--json"])).enabled,true);
 // Real detached worker, real GitHub check, isolated install. MCP stdout must remain valid.
 client=new Client({name:"automatic-update-acceptance",version:"1"});await client.connect(new StdioClientTransport({command:target,args:["mcp"],env}));
 const log=path.join(env.AMICOOKED_HOME,"logs/automatic-update.log");
 for(let i=0;i<120;i++){if(fs.existsSync(log)&&fs.readFileSync(log,"utf8").includes('"latestVersion"'))break;await new Promise(r=>setTimeout(r,250));}
 assert.match(fs.readFileSync(log,"utf8"),/"latestVersion"/);assert((await client.listTools()).tools.some(t=>t.name==="get_feature_guide"));
 await client.close();client=null;
 const firstAttempt=fs.readFileSync(path.join(env.AMICOOKED_HOME,"automatic-update.json"),"utf8");
 client=new Client({name:"automatic-update-throttle",version:"1"});await client.connect(new StdioClientTransport({command:target,args:["mcp"],env}));await client.close();client=null;
 assert.equal(fs.readFileSync(path.join(env.AMICOOKED_HOME,"automatic-update.json"),"utf8"),firstAttempt);

 run(target,["uninstall"]);assert.equal(JSON.parse(run(target,["auto-update","status","--json"])).enabled,false);assert.equal(fs.readFileSync(path.join(skill,"personal.md"),"utf8"),"Keep my notes");
 run(target,["setup","--clients","none","--skill-dir",skill,"--school","mcmaster","--no-login","--yes"]);
 assert.equal(JSON.parse(run(target,["auto-update","status","--json"])).enabled,true);
 assert.equal(await updateCommand({json:true},{report,fetch:fetcher,runtime:{execPath:target,argv:[target],platform:process.platform,isCompiled:true}}),0);
 assert.equal(upgradeEvents.length,1);
 results.push({upgradeEvent:"automatic/native",channel:"native",from:"0.1.5",to:VERSION,previousProcessKeptWorking:true,uninstallReinstall:true,retainedSessionAndNotes:true,autoDisabledAfterUninstall:true});
 // Exercise a real npm replacement. Only the candidate package argument is redirected to the local tarball.
 run("npm",["install","--prefix",root,"--no-audit","--no-fund","amicooked@0.1.5"]);
 const script=path.join(root,"node_modules/amicooked/dist/cli.js");assert.equal(run(process.execPath,[script,"--version"]).trim(),"0.1.5");
 fs.rmSync(path.join(env.AMICOOKED_HOME,"installed-version.json"),{force:true});
 assert.equal(await updateCommand({json:true},{report,version:"0.1.5",fetch:fetcher,runtime:{execPath:process.execPath,argv:[process.execPath,script],platform:process.platform,isCompiled:false},run:(cmd,args)=>run(cmd,args.map(a=>a===`amicooked@${VERSION}`?tarball:a)).trim()}),0);
 assert.deepEqual(upgradeEvents[1],{from:"0.1.5",to:VERSION,mode:"manual",channel:"npm"});
 assert.equal(run(process.execPath,[script,"--version"]).trim(),VERSION);assert(JSON.parse(run(process.execPath,[script,"features","--json"])).features.some(f=>f.id==="lecture-videos"));
 run(process.execPath,[script,"uninstall"]);run(process.execPath,[script,"setup","--clients","none","--skill-dir",skill,"--school","mcmaster","--no-login","--yes"]);
 assert.equal(fs.readFileSync(path.join(env.AMICOOKED_HOME,"token.json"),"utf8"),saved);
 results.push({upgradeEvent:"manual/npm",channel:"npm",from:"0.1.5",to:VERSION,realNpmReplacement:true,uninstallReinstall:true,retainedSession:true});
 console.log(JSON.stringify(results,null,2));
} finally {await client?.close();fs.rmSync(root,{recursive:true,force:true});}
