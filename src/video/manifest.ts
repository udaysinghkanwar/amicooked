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

export function platformDownloads(target: VideoTarget) {
  const assets = targets[target];
  const nodeDirectory = `node-v${nodeVersion}-${target.replace("win32", "win")}`;
  const nodeArchive = nodeDirectory + (target.startsWith("win32") ? ".zip" : ".tar.gz");
  const chromeDirectory = `chrome-headless-shell-${assets.chromePlatform}`;
  return {
    nodeDirectory,
    chromeDirectory,
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
