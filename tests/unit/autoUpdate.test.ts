import { beforeEach, afterEach, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getConfig, reloadConfig, writeConfig } from "../../src/config.js";
import { maybeStartAutomaticUpdate, automaticUpdateCommand, automaticUpdateStatus } from "../../src/cli/autoUpdate.js";
import { installationChannel } from "../../src/clients/self.js";
import { updateCommand, acquireUpdateLock } from "../../src/cli/update.js";
let root: string;
const runtime = { execPath: "/a path/amicooked", argv: ["/a path/amicooked"], platform: process.platform, isCompiled: true };
beforeEach(() => {
 root=fs.mkdtempSync(path.join(os.tmpdir(),"amicooked-auto-"));
 vi.stubEnv("AMICOOKED_HOME",path.join(root,".amicooked"));vi.stubEnv("HOME",root);vi.stubEnv("USERPROFILE",root);reloadConfig();
 vi.spyOn(console,"log").mockImplementation(()=>{});
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();reloadConfig();fs.rmSync(root,{recursive:true,force:true});});
const school = { id: "mcmaster", name: "McMaster", lmsName: "Avenue", host: "avenue.cllmcmaster.ca" };

it("starts detached by default after setup, at most once daily",()=>{
 const launch=vi.fn();
 expect(maybeStartAutomaticUpdate({runtime,launch,now:1})).toBe(false);
 expect(fs.readdirSync(root)).toEqual([]);
 writeConfig({school});
 expect(maybeStartAutomaticUpdate({runtime,launch,now:100})).toBe(true);
 expect(launch.mock.calls[0].slice(0,2)).toEqual([runtime.execPath,["auto-update","run"]]);
 expect(maybeStartAutomaticUpdate({runtime,launch,now:101})).toBe(false);
 expect(maybeStartAutomaticUpdate({runtime,launch,now:100+86400000})).toBe(true);
 expect(console.log).not.toHaveBeenCalled();
 writeConfig({automaticUpdates:false});
 expect(maybeStartAutomaticUpdate({runtime,launch,now:200000000})).toBe(false);
});

it("suspends checks after uninstall", () => {
 writeConfig({school, uninstalled: true});
 const launch = vi.fn();
 expect(maybeStartAutomaticUpdate({runtime, launch})).toBe(false);
 expect(launch).not.toHaveBeenCalled();
});
it("does not repeatedly retry a failed launch or break an MCP session",()=>{
 writeConfig({school});const launch=vi.fn(()=>{throw Error("offline");});
 expect(maybeStartAutomaticUpdate({runtime,launch,now:10})).toBe(false);
 expect(maybeStartAutomaticUpdate({runtime,launch,now:11})).toBe(false);expect(launch).toHaveBeenCalledTimes(1);
});
it("does not update source checkouts and allows installed npm packages",()=>{
 expect(installationChannel({...runtime,isCompiled:false,argv:["node","/source/dist/cli.js"]})).toBe(null);
 expect(installationChannel({...runtime,isCompiled:false,argv:["node","/prefix/node_modules/amicooked/dist/cli.js"]})).toBe("npm");
 expect(installationChannel({...runtime,isCompiled:false,argv:["node","C:\\prefix\\node_modules\\amicooked\\dist\\cli.js"]})).toBe("npm");
});
it.skipIf(process.platform === "win32")("recognizes npm's executable symlink for automatic updates", () => {
 const script = path.join(root, "node_modules/amicooked/dist/cli.js");
 fs.mkdirSync(path.dirname(script), { recursive: true });fs.writeFileSync(script, "");
 const link = path.join(root, "amicooked");fs.symlinkSync(script, link);
 expect(installationChannel({...runtime,isCompiled:false,argv:[process.execPath,link]})).toBe("npm");
});
it("disabling prevents a pending worker from doing network or install work",async()=>{
 writeConfig({automaticUpdates:false});expect(await automaticUpdateCommand("run")).toBe(0);
 const fetcher=vi.fn(async()=>Response.json({tag_name:"v0.1.8",body:"patch",assets:[]}));const run=vi.fn();
 expect(await updateCommand({json:true,compatibleOnly:true},{fetch:fetcher,version:"0.1.7",run,allowed:()=>false})).toBe(0);expect(run).not.toHaveBeenCalled();
});
it("leaves a new minor release for an explicit manual update",async()=>{
 const run=vi.fn();const fetcher=vi.fn(async()=>Response.json({tag_name:"v0.2.0",assets:[]}));
 expect(await updateCommand({json:true,compatibleOnly:true},{fetch:fetcher,version:"0.1.7",run})).toBe(0);
 expect(run).not.toHaveBeenCalled();expect(JSON.parse(vi.mocked(console.log).mock.calls[0][0])).toMatchObject({manualUpdateRequired:true,updated:false});
});
it("serializes manual/automatic installs and recovers a confirmed dead owner",()=>{
 const release=acquireUpdateLock();expect(()=>acquireUpdateLock()).toThrow("Another update");release();
 fs.writeFileSync(path.join(root,".amicooked/update.lock"),JSON.stringify({pid:2147483647,id:"dead"}));
 const recovered=acquireUpdateLock();recovered();expect(fs.existsSync(path.join(root,".amicooked/update.lock"))).toBe(false);
});
it("refuses to downgrade installed guides from an older runtime",async()=>{
 fs.mkdirSync(path.join(root,".amicooked"));fs.writeFileSync(path.join(root,".amicooked/installed-version.json"),JSON.stringify({version:"0.1.9"}));
 const fetcher=vi.fn(async()=>Response.json({tag_name:"v0.1.7",assets:[]}));
 expect(await updateCommand({json:true},{fetch:fetcher,version:"0.1.7"})).toBe(1);
 expect(JSON.parse(vi.mocked(console.log).mock.calls[0][0]).error).toContain("newer");
 expect(JSON.parse(fs.readFileSync(path.join(root,".amicooked/installed-version.json"),"utf8")).version).toBe("0.1.9");
});

it("ignores damaged attempt state without overriding the configured update preference", () => {
 writeConfig({school});
 for (const data of ["null", '{"lastAttempt":"invalid","enabled":false}', "{broken"]) {
  fs.writeFileSync(path.join(root,".amicooked/automatic-update.json"),data);
  expect(automaticUpdateStatus()).toMatchObject({lastAttempt:undefined});
  expect(maybeStartAutomaticUpdate({runtime,launch:vi.fn(),now:100})).toBe(true);
 }
});
