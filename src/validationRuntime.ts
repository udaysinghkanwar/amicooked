// Initialize Zod before SDK schema declarations. Bun's bundled zod/v4 barrel can
// otherwise omit its initialization when the app also imports Zod's root entry.
// Reading configuration leaves the validation policy unchanged.
import { z } from "zod";
z.config();
