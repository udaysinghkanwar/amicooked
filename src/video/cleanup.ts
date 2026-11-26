import * as fs from "node:fs";

export interface VideoCleanupWarning {
  code: "video_cleanup_deferred";
  path: string;
  errno: string;
}

/** Only call for the exact scratch directory returned by this operation's mkdtemp. Never scan user folders. */
export function cleanupVideoWork(work: string, warnings: VideoCleanupWarning[] = []) {
  try {
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    // Disposable-file housekeeping must not replace a capability result, a render error or a verified MP4.
    const errno = (error as NodeJS.ErrnoException).code ?? "UNKNOWN";
    warnings.push({ code: "video_cleanup_deferred", path: work, errno });
    console.error(`Video temporary files could not be removed (${errno}); cleanup deferred: ${work}`);
  }
}
