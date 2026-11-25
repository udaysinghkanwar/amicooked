// Node hashes are from nodejs.org/dist/v22.23.2/SHASUMS256.txt.
// Chrome for Testing downloads are pinned to the renderer's tested build.
const nodeVersion = "22.23.2";
const chromeVersion = "158.0.8127.88";

export const targets = {
  "darwin-arm64": {
    node: "61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6",
    chromePlatform: "mac-arm64",
    chrome: "69320f6869c4defbbdac8b8fa83aef65dc63975e83bbd06899b75dbea5c464b3",
  },
  "darwin-x64": {
    node: "58e99022c2ff89395576cc7fd4d98cea24bb68081475d5f88b801ee8729fb026",
    chromePlatform: "mac-x64",
    chrome: "dc1ac31965cb2ec7794aed8c66127aceea304ae15353cd56fc4b8bde44091548",
  },
  "linux-x64": {
    node: "b294a556e639d64338823920e5866c21c02741742d2e1529ee1a225c1ec9252a",
    chromePlatform: "linux64",
    chrome: "63401333cc587645bfaeea7f0c90958b327d249251e23954a47f30112ca23d5b",
  },
  "win32-x64": {
    node: "1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97",
    chromePlatform: "win64",
    chrome: "e935ea2d4633495b5e9ab7bc66bcd982806329c0ee9ecbafc1ac9596a3b34cdb",
  },
} as const;

export type VideoTarget = keyof typeof targets;

export interface Download {
  url: string;
  sha256: string;
}

// Release archives and SHA-256 checksums from the builders linked by FFmpeg
// (Windows) or the Martin Riedl static build server (macOS and Linux).
const mediaVersion = "9.1";
const unixMedia = {
  "darwin-arm64": ["macos/arm64/1795207104_9.1", "1f66e9a690a7f1c9e60b012379f8869c11818d1797f45b21dbb2f2564ba61ae1", "6ef2df5f575042923a28537ab37adf936f28bf3e7b85de23a1447ed447ec1dbd"],
  "darwin-x64": ["macos/amd64/1795212433_9.1", "35b3d82cccc2c1d644d49d15f5e57eb913a08ef68f798042c90eecec62c51f1e", "41ca7b7cba7992e33f1da3f1bf54db8ec103a4d387b1bfac3162062e8b1074ad"],
  "linux-x64": ["linux/amd64/1795205506_9.1", "707d4fa675932cc310e39e1506ac9224049786119689e345fed1c453a8a0896e", "5e4c53c9c86d6371027efa83d62c2cea00e02ded0234d8cc952d06c9259e4b33"],
} as const;

function mediaDownloads(target: VideoTarget): { binDir: string; archives: Download[] } {
  if (target === "win32-x64") {
    const release = `ffmpeg-${mediaVersion}-essentials_build`;
    return {
      binDir: `${release}/bin`,
      archives: [{
        url: `https://github.com/GyanD/codexffmpeg/releases/download/${mediaVersion}/${release}.zip`,
        sha256: "b9bbbb3acece000cbeec994f856649354e52c773807841e78908374b24d658fd",
      }],
    };
  }
  const [build, ffmpeg, ffprobe] = unixMedia[target];
  return {
    binDir: ".",
    archives: Object.entries({ ffmpeg, ffprobe }).map(([tool, sha256]) => ({
      url: `https://ffmpeg.martin-riedl.de/download/${build}/${tool}.zip`, sha256,
    })),
  };
}

export function platformDownloads(target: VideoTarget) {
  const assets = targets[target];
  const nodeDirectory = `node-v${nodeVersion}-${target.replace("win32", "win")}`;
  const nodeArchive = nodeDirectory + (target.startsWith("win32") ? ".zip" : ".tar.gz");
  const chromeDirectory = `chrome-headless-shell-${assets.chromePlatform}`;
  return {
    nodeDirectory,
    chromeDirectory,
    media: mediaDownloads(target),
    node: { url: `https://nodejs.org/dist/v${nodeVersion}/${nodeArchive}`, sha256: assets.node },
    chrome: {
      url: `https://storage.googleapis.com/chrome-for-testing-public/${chromeVersion}/${assets.chromePlatform}/${chromeDirectory}.zip`,
      sha256: assets.chrome,
    },
  };
}

const kokoro = "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231";
export const voiceModel: Record<string, Download> = Object.fromEntries(Object.entries({
  "onnx/model_quantized.onnx": "fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478",
  "config.json": "df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f",
  "tokenizer.json": "77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34",
  "tokenizer_config.json": "be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20",
}).map(([file, sha256]) => [file, { url: `${kokoro}/${file}`, sha256 }]));
