import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import path from "node:path";

/** Hold a process-owned lock, recovering only a confirmed dead owner. */
export function acquireLock(file: string, operation: string): () => void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const owner = JSON.stringify({ pid: process.pid, id: randomUUID() });
  for (let attempt = 0; attempt < 2; attempt++) {
    let fd: number;
    try { fd = fs.openSync(file, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const previous = fs.readFileSync(file, "utf8");
      let dead = false;
      try {
        const pid = JSON.parse(previous).pid;
        if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid lock");
        try { process.kill(pid, 0); }
        catch (e) { dead = (e as NodeJS.ErrnoException).code === "ESRCH"; }
      } catch { /* An incomplete/unknown lock may belong to a starting updater. */ }
      if (!dead) throw new Error(`Another ${operation} is running. Wait for it to finish, then retry.`);
      if (fs.readFileSync(file, "utf8") === previous) fs.rmSync(file);
      continue;
    }
    try { fs.writeFileSync(fd, owner); } finally { fs.closeSync(fd); }
    return () => {
      try { if (fs.readFileSync(file, "utf8") === owner) fs.rmSync(file); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    };
  }
  throw new Error(`Another ${operation} started. Retry later.`);
}
