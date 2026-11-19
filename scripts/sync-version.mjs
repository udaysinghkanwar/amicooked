// `npm version` bumps package.json; this copies the new version into src/version.ts so the binary
// and the npm package always report the same number. Runs from the "version" script in package.json.
import { readFileSync, writeFileSync } from "fs";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const file = new URL("../src/version.ts", import.meta.url);
writeFileSync(file, `// Must match package.json; a unit test checks this\nexport const VERSION = "${version}";\n`);
console.log(`src/version.ts -> ${version}`);
