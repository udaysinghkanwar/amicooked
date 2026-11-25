// Remove artifacts from other branches or deleted modules before packaging.
import { rmSync } from "node:fs";
rmSync(new URL("../dist/", import.meta.url), { recursive: true, force: true });
