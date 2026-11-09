import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import { getD2LCookies, hasActiveSession, clearTokenCache } from "../auth.js";
import { client } from "../client.js";
import { getConfig, getSchool } from "../config.js";
import { listCourses } from "../courseResolver.js";
import { extractContent } from "../extract.js";
import { getFile, listEntries, readTextCached } from "../library.js";
import { json, type Tool } from "./types.js";

/** Keep tool results a sensible size; read_file's offset pages through the rest. */
const MAX_CHARS = 60000;

export function sanitizeName(name: string): string {
  const cleaned = name
    .replace(/[\/\\:*?"<>|\x00-\x1f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    .slice(0, 120);
  return cleaned || "untitled";
}

function page(text: string | null, offset = 0) {
  if (text === null) return { content: null, note: "No text could be extracted (image, scanned PDF or unsupported format)." };
  const content = text.slice(offset, offset + MAX_CHARS);
  const rest = text.length - offset - content.length;
  return rest > 0
    ? { content, note: `Showing characters ${offset}-${offset + content.length} of ${text.length}. Call read_file with offset ${offset + content.length} for more.` }
    : { content };
}

interface TocNode {
  Title: string;
  Topics?: { Title: string; Url?: string }[];
  Modules?: TocNode[];
}

const TOC_TTL_MS = 10 * 60 * 1000;
const tocCache = new Map<number, { at: number; modules: TocNode[] }>();

/** Find which module (folder path) and topic title a file URL belongs to in the course's content. */
async function locateTopic(orgUnitId: number, fileUrl: string): Promise<{ modulePath: string[]; title: string } | null> {
  let cached = tocCache.get(orgUnitId);
  if (!cached || Date.now() - cached.at > TOC_TTL_MS) {
    const toc = (await client.getContentToc(orgUnitId)) as { Modules: TocNode[] };
    cached = { at: Date.now(), modules: toc.Modules || [] };
    tocCache.set(orgUnitId, cached);
  }
  const target = decodeURIComponent(new URL(fileUrl).pathname);
  const search = (modules: TocNode[], trail: string[]): { modulePath: string[]; title: string } | null => {
    for (const mod of modules) {
      const here = [...trail, mod.Title];
      for (const topic of mod.Topics || []) {
        if (topic.Url && decodeURIComponent(topic.Url.split("?")[0]) === target) return { modulePath: here, title: topic.Title };
      }
      const found = search(mod.Modules || [], here);
      if (found) return found;
    }
    return null;
  };
  return search(cached.modules, []);
}

/** GET a D2L file with the session cookies; retries once with a fresh login if the session expired. */
async function fetchD2L(url: string, headers: Record<string, string>): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let target = url;
    let res: Response | null = null;
    for (let hop = 0; hop < 5; hop++) {
      res = await fetch(target, { headers: { ...headers, Cookie: await getD2LCookies() }, redirect: "manual" });
      const location = res.headers.get("location");
      if (res.status < 300 || res.status >= 400 || res.status === 304 || !location) break;
      target = new URL(location, target).toString();
    }
    if (res && new URL(target).pathname.startsWith("/d2l/login")) {
      clearTokenCache();
      continue;
    }
    if (res && (res.ok || res.status === 304)) return res;
    throw new Error(`D2L returned ${res?.status} for ${url}`);
  }
  throw new Error("Your D2L session expired and logging in again failed.");
}

async function downloadFile(url: string, refresh?: boolean) {
  const fullUrl = new URL(url, `https://${getSchool().host}`).toString();
  const urlPath = decodeURIComponent(new URL(fullUrl).pathname);
  const urlFilename = urlPath.split("/").filter(Boolean).pop() || "download";

  // /content/enforced/781481-SFWRENG_3O03_deza_1_2269/file.pdf, or an org unit id elsewhere in the path
  const enforced = urlPath.match(/\/content\/enforced\/(\d+)-([^/]+)\//);
  const orgUnitId = enforced ? Number(enforced[1]) : Number(urlPath.match(/\/(\d{5,})(?:\/|$)/)?.[1]) || null;

  // Course and module lookups hit the API, so only resolve the folder on a first download
  const resolveTarget = async (): Promise<string> => {
    const course = orgUnitId ? (await listCourses().catch(() => [])).find((c) => c.id === orgUnitId) : undefined;
    const courseFolder = sanitizeName(course?.name ?? enforced?.[2] ?? "Other");
    // Mirror the course's module structure and use the topic's title as the filename
    const location = orgUnitId ? await locateTopic(orgUnitId, fullUrl).catch(() => null) : null;
    const ext = path.extname(urlFilename);
    const filename = location?.title.trim()
      ? sanitizeName(location.title.toLowerCase().endsWith(ext.toLowerCase()) ? location.title : `${location.title}${ext}`)
      : sanitizeName(urlFilename);
    return path.join(getConfig().filesDir, courseFolder, ...(location?.modulePath ?? []).map(sanitizeName), filename);
  };

  const result = await getFile({
    url: fullUrl,
    targetPath: resolveTarget,
    fetch: (headers) => fetchD2L(fullUrl, headers),
    canRevalidate: hasActiveSession,
    refresh,
  });
  const text = await readTextCached(result.path, extractContent);
  return { path: result.path, size: result.size, status: result.status, ...(result.note ? { libraryNote: result.note } : {}), ...page(text) };
}

/** A downloaded file by full path, file name, or a unique part of its name. Only library files, so nothing else on disk is exposed. */
function findLibraryFile(query: string): string {
  const entries = listEntries();
  const exact = entries.find((e) => e.path === query);
  if (exact) return exact.path;

  const q = path.basename(query).toLowerCase();
  const byName = entries.filter((e) => path.basename(e.path).toLowerCase() === q);
  const matches = byName.length ? byName : entries.filter((e) => path.basename(e.path).toLowerCase().includes(q));
  if (matches.length === 1) return matches[0].path;
  if (matches.length === 0) throw new Error(`No downloaded file matches "${query}". Use download_file first.`);
  throw new Error(`"${query}" matches several files: ${matches.slice(0, 8).map((m) => m.path).join("; ")}. Use the full path.`);
}

export const downloadFileTool: Tool = {
  name: "download_file",
  description:
    "Download a course file (slides, handouts, assignment PDFs) and return its text. Pass the file URL from get_course_content (e.g. /content/enforced/12345-COURSE/week7.pdf). Files are saved once into the student's course folder and served from disk afterwards. Set refresh=true only if the student says the file changed.",
  schema: {
    url: z.string().describe("File URL or path from get_course_content"),
    refresh: z.boolean().optional().describe("Re-check D2L for a newer version"),
  },
  handler: async (args) => json(await downloadFile(args.url, args.refresh)),
};

export const readFileTool: Tool = {
  name: "read_file",
  description:
    "Read the text of a file you already downloaded with download_file, by file name or path. Use offset to continue a long file.",
  schema: {
    file: z.string().describe("File name (or part of it) or full path of a downloaded file"),
    offset: z.coerce.number().min(0).optional().describe("Character offset to continue from"),
  },
  handler: async (args) => {
    const filePath = findLibraryFile(args.file);
    const text = await readTextCached(filePath, extractContent);
    return json({ path: filePath, size: fs.statSync(filePath).size, ...page(text, args.offset) });
  },
};
