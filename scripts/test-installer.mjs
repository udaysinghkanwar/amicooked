// Real shell/PowerShell installer lifecycle, using local release bytes and disposable HOME.
import assert from "node:assert/strict";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const windows = process.platform === "win32";
const root=fs.mkdtempSync(path.join(os.tmpdir(),"amicooked-installer-"));
const binary=path.resolve(`build/amicooked-${windows ? "windows" : process.platform}-${process.arch}${windows ? ".exe" : ""}`);
const asset=path.basename(binary);const fixtures=path.join(root,"release");fs.mkdirSync(fixtures);fs.copyFileSync(binary,path.join(fixtures,asset));
const sums=`${createHash("sha256").update(fs.readFileSync(binary)).digest("hex")}  ${asset}\n`;fs.writeFileSync(path.join(fixtures,"SHA256SUMS"),sums);
const server=spawn(process.execPath,["-e",`const http=require('node:http'),fs=require('node:fs'),path=require('node:path');http.createServer((q,s)=>{const f=path.join(process.env.FIXTURES,path.basename(q.url));try{s.end(fs.readFileSync(f))}catch{s.writeHead(404).end()}}).listen(0,'127.0.0.1',function(){process.send(this.address().port)})`],{env:{...process.env,FIXTURES:fixtures},stdio:["ignore","ignore","inherit","ipc"]});
let client;
try {
 const port=await new Promise((resolve,reject)=>{server.once("message",resolve);server.once("error",reject);server.once("exit",()=>reject(Error("fixture server stopped")));});
 const env={...process.env,HOME:root,USERPROFILE:root,CODEX_HOME:path.join(root,".codex"),AMICOOKED_HOME:path.join(root,".amicooked"),AMICOOKED_DOWNLOAD_BASE:`http://127.0.0.1:${port}`,AMICOOKED_NO_TELEMETRY:"1",AMICOOKED_NO_SETUP:"1",AMICOOKED_NO_PATH:"1",GEMINI_CLI_HOME:path.join(root,".gemini"),APPDATA:path.join(root,"AppData/Roaming"),LOCALAPPDATA:path.join(root,"AppData/Local")};
 const run=(command,args)=>execFileSync(command,args,{env,encoding:"utf8",timeout:30000});
 const [installer,...installerArgs]=windows ? ["pwsh","-NoProfile","-NonInteractive","-File",path.resolve("install/install.ps1")] : ["sh",path.resolve("install/install.sh"),"--no-setup"];
 const install=()=>run(installer,installerArgs);
 const failedInstall=(reason,next)=> {
  const result=spawnSync(installer,installerArgs,{env,encoding:"utf8",timeout:30000});
  assert.equal(result.status,1);
  assert.match(result.stdout,reason);
  assert.match(result.stdout,next);
  assert.equal(result.stderr,"");
 };
 install();const installed=path.join(env.AMICOOKED_HOME,windows ? "bin/amicooked.exe" : "bin/amicooked");assert(fs.existsSync(installed));
 const version=run(installed,["--version"]).trim();const profile=windows ? null : fs.readFileSync(path.join(root,".profile"),"utf8");
 fs.writeFileSync(path.join(env.AMICOOKED_HOME,"config.json"),JSON.stringify({version:1,browser:"chrome",filesDir:path.join(root,"downloads")}));
 const skill=path.join(root,"other/skills/amicooked");const setup=["setup","--clients","none","--school","mcmaster","--skill-dir",skill,"--no-login","--yes","--skip-video-deps"];
 run(installed,setup);fs.writeFileSync(path.join(env.AMICOOKED_HOME,"token.json"),"retained installer session");
 if (windows) {
  // Emulate only detection of an installed Antigravity CLI. Run the real setup and MCP executable.
  const agy = path.join(env.LOCALAPPDATA, "agy", "bin", "agy.exe");
  fs.mkdirSync(path.dirname(agy), { recursive: true });
  fs.writeFileSync(agy, "");
  run(installed, ["auto-update", "disable"]);
  const geminiSetup = ["setup", "--clients", "gemini", "--school", "mcmaster", "--no-login", "--yes", "--skip-video-deps"];
  assert.match(run(installed, geminiSetup), /MCP handshake and 15 tools verified/);
  const configFile = path.join(root, ".gemini", "config", "mcp_config.json");
  const config = fs.readFileSync(configFile, "utf8");
  run(installed, geminiSetup);
  assert.equal(fs.readFileSync(configFile, "utf8"), config);
  const launch = JSON.parse(config).mcpServers.amicooked;
  assert.equal(fs.realpathSync.native(launch.command), fs.realpathSync.native(installed));
  assert.deepEqual(launch.args, ["mcp"]);
  assert.match(run(installed, ["doctor"]), /15 tools verified/);
  client = new Client({ name: "windows-antigravity-config-test", version: "1" });
  await client.connect(new StdioClientTransport({ ...launch, stderr: "ignore" }));
  const result = await client.callTool({ name: "get_lecture_video_workflow", arguments: {} });
  assert.notEqual(result.isError, true);
  assert.match(JSON.parse(result.content[0].text).instructions, /Lecture videos/);
  await client.close();
  client = null;
  run(installed, ["uninstall"]);
  assert.equal(JSON.parse(fs.readFileSync(configFile, "utf8")).mcpServers.amicooked, undefined);
  console.log("Windows native executable returned the lecture video guide over MCP using the Antigravity registration.");
 }
 client=new Client({name:"installer-replacement",version:"1"});await client.connect(new StdioClientTransport({command:installed,args:["mcp"],env}));
 install();if (!windows) assert.equal(fs.readFileSync(path.join(root,".profile"),"utf8"),profile);assert.equal(run(installed,["--version"]).trim(),version);
 assert((await client.listTools()).tools.some(t=>t.name==="am_i_cooked"));await client.close();client=null;
 fs.writeFileSync(path.join(fixtures,"SHA256SUMS"),`invalid  ${asset}\n`);
 failedInstall(/Checksum mismatch/,/Rerun the installer/);
 if (windows) {
  const script=path.resolve("install/install.ps1").replaceAll("'","''");
  const piped=run("pwsh",["-NoProfile","-NonInteractive","-Command",`Get-Content -Raw '${script}' | Invoke-Expression; Write-Host "Terminal still open, exit code $LASTEXITCODE"`]);
  assert.match(piped,/Checksum mismatch/);
  assert.match(piped,/Terminal still open, exit code 1/);
 }
 fs.writeFileSync(path.join(fixtures,"SHA256SUMS"),sums);
 fs.renameSync(path.join(fixtures,asset),path.join(fixtures,"held"));
 failedInstall(/404/,/Check your connection to GitHub/);
 fs.renameSync(path.join(fixtures,"held"),path.join(fixtures,asset));
 assert.equal(run(installed,["--version"]).trim(),version);
 run(installed,["uninstall"]);fs.rmSync(installed);install();run(installed,setup);assert.equal(fs.readFileSync(path.join(env.AMICOOKED_HOME,"token.json"),"utf8"),"retained installer session");assert(fs.existsSync(path.join(skill,"references/lecture-videos.md")));
 console.log(`${windows ? "PowerShell" : "Shell"} installer passed: install, repeated reinstall, corrupt-download rejection, uninstall/remove/reinstall, session retention and new feature guides.`);
}finally{await client?.close();server.kill();fs.rmSync(root,{recursive:true,force:true});}
