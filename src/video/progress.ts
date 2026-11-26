export interface VideoProgress {
  stage: string;
  renderer?: "hyperframes" | "slides";
  scene?: number;
  total?: number;
  updatedAt: string;
}

export type VideoReporter = (progress: VideoProgress) => void;

/** CLI diagnostics go to stderr; stdout stays machine-readable for every AI client. */
export const logVideoProgress: VideoReporter = progress => {
  console.error(`[video] ${progress.renderer ?? "probe"}: ${progress.stage}` +
    (progress.scene !== undefined ? ` ${progress.scene}/${progress.total}` : ""));
};

export function videoProgress(report: VideoReporter, stage: string, details: Omit<VideoProgress, "stage" | "updatedAt"> = {}) {
  report({ stage, ...details, updatedAt: new Date().toISOString() });
}
