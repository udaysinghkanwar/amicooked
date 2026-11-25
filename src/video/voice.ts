// Runs with the managed Node, beside the locked packages. The model is local.
export const voiceScript = `
import { readFile } from "node:fs/promises";
import { KokoroTTS } from "kokoro-js";
import { env } from "@huggingface/transformers";

const [model, input, output] = process.argv.slice(2);
env.allowRemoteModels = false;
env.allowLocalModels = true;
const tts = await KokoroTTS.from_pretrained(model, { dtype: "q8", device: "cpu" });
const audio = await tts.generate(await readFile(input, "utf8"), { voice: "am_michael" });
await audio.save(output);
`;
