import type { School } from "./config.js";
import { stripVTControlCharacters } from "node:util";
import { z } from "zod";
import { PRESETS } from "./schoolPresets.js";

export { PRESETS } from "./schoolPresets.js";

/** API versions the tools are written against. Setup checks the school supports them. */
export const API_VERSIONS = { le: "1.57", lp: "1.43" } as const;

export function findPreset(id: string): School | undefined {
  const key = normalizeName(id);
  return PRESETS.find((s) => [s.id, s.host, s.name, ...(s.aliases ?? [])].some((value) => normalizeName(value) === key));
}

type Fetch = typeof fetch;

const REQUEST_TIMEOUT_MS = 10000;
const MAX_RESPONSE_BYTES = 256000;
const MAX_CANDIDATE_HOSTS = 8;
const MAX_LINKED_PAGES = 2;
const MAX_REDIRECT_REQUESTS = 6;
const normalizeName = (name: string) => name.trim().toLowerCase().replace(/[’']/g, "").replace(/\s+/g, " ");
const directorySchema = z.object({
  class: z.array(z.string()).refine((classes) => classes.includes("institutions")),
  entities: z.array(z.unknown()).default([]),
});
const institutionSchema = z.object({
  properties: z.object({ name: z.string().trim().min(1) }),
  links: z.array(z.unknown()),
});
const linkSchema = z.object({ rel: z.array(z.string()), href: z.string() });
const versionsSchema = z.array(z.object({ ProductCode: z.string(), SupportedVersions: z.array(z.string()) }));

/** Bound downloads, including responses from student-provided portals; cancel the unused body. */
async function readResponseText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let remaining = MAX_RESPONSE_BYTES;
  try {
    while (remaining > 0) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = value.subarray(0, remaining);
      remaining -= chunk.length;
      chunks.push(decoder.decode(chunk, { stream: true }));
    }
    return chunks.join("") + decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export interface SchoolMatch {
  name: string;
  loginUrl: string;
}

export class AmbiguousSchoolError extends Error {
  constructor(public matches: SchoolMatch[]) {
    super(`Several schools match. Use a more specific school name or pass its login URL with --school:\n${matches.map((s) => `  ${s.name}: ${s.loginUrl}`).join("\n")}`);
  }
}

/** Public directory used by https://login-finder.d2l.com/; no account or API key required. */
export async function searchSchools(name: string, fetchImpl: Fetch = fetch): Promise<SchoolMatch[]> {
  const url = new URL("https://lms-disco.api.brightspace.com/institutions");
  url.searchParams.set("contains", name.trim());
  try {
    const res = await fetchImpl(url.href, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) throw new Error("Directory unavailable");
    const data = directorySchema.parse(JSON.parse(await readResponseText(res)));
    const matches: SchoolMatch[] = [];
    for (const entity of data.entities) {
      const institution = institutionSchema.safeParse(entity);
      if (!institution.success) continue;
      const name = stripVTControlCharacters(institution.data.properties.name).replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim();
      if (!name) continue;
      for (const rawLink of institution.data.links) {
        const link = linkSchema.safeParse(rawLink);
        if (!link.success || !link.data.rel.includes("lms")) continue;
        try {
          const login = normalizeUrl(link.data.href);
          if (!matches.some((m) => normalizeName(m.name) === normalizeName(name) && m.loginUrl === login.href)) {
            matches.push({ name, loginUrl: login.href });
          }
        } catch { /* Ignore malformed directory links. */ }
      }
    }
    return matches;
  } catch {
    throw new Error("Couldn't search the Brightspace school directory. Try again or paste your school's course portal URL.");
  }
}

function isPortalUrl(input: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(input) || /^[^\s/]+\.[^\s/]+(?:\/[^\s]*)?$/.test(input);
}

/** Resolve a preset, school name, or pasted portal URL. Never guess between directory matches. */
export async function resolveSchool(input: string, fetchImpl: Fetch = fetch): Promise<School> {
  const value = input.trim();
  if (!value) throw new Error("Enter a school name or course portal URL.");
  const preset = findPreset(value);
  if (preset) return preset;
  if (isPortalUrl(value)) return detectSchool(value, fetchImpl);

  const matches = await searchSchools(value, fetchImpl);
  const exact = matches.filter((s) => normalizeName(s.name) === normalizeName(value));
  const candidates = exact.length ? exact : matches;
  if (!candidates.length) throw new Error(`Couldn't find a Brightspace school named "${value}". Try its full name or paste your school's course portal URL.`);
  if (candidates.length > 1) throw new AmbiguousSchoolError(candidates);
  return resolveSchoolMatch(candidates[0], fetchImpl);
}

/** Validate the directory's portal before saving it or opening a login window. */
export async function resolveSchoolMatch(match: SchoolMatch, fetchImpl: Fetch = fetch): Promise<School> {
  const school = await detectSchool(match.loginUrl, fetchImpl);
  if (school.id !== "custom") return school;
  return { ...school, name: match.name, loginUrl: normalizeUrl(match.loginUrl).href };
}

/** True if `host` serves the Brightspace versions API with the versions we need. */
export async function checkBrightspaceHost(host: string, fetchImpl: Fetch = fetch): Promise<boolean> {
  try {
    const url = `https://${host}/d2l/api/versions/`;
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) return false;
    // A redirect to another LMS host is a discovery clue, not proof the original host is the API host.
    if (new URL(res.url || url).origin !== new URL(url).origin) return false;
    const products = versionsSchema.parse(JSON.parse(await readResponseText(res)));
    const supports = (code: "le" | "lp") =>
      products.some((p) => p.ProductCode === code && p.SupportedVersions.includes(API_VERSIONS[code]));
    return supports("le") && supports("lp");
  } catch {
    return false;
  }
}

function normalizeUrl(input: string): URL {
  const trimmed = input.trim();
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  const bareHostWithPort = /^[a-z0-9.-]+\.[a-z0-9-]+:\d+(?:\/|$)/i.test(trimmed);
  if (hasScheme && !bareHostWithPort && !/^https:\/\//i.test(trimmed)) {
    throw new Error("Use an HTTPS school portal URL without embedded usernames or passwords.");
  }
  let url: URL;
  try {
    url = new URL(/^https:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error("Paste your school's HTTPS course portal URL, such as https://courses.myschool.edu/d2l/home.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Use an HTTPS school portal URL without embedded usernames or passwords.");
  }
  // Authentication responses are temporary and must not be saved as a school's login URL.
  if ([...url.searchParams.keys()].some((key) => /^(samlrequest|samlresponse|code|access_token|id_token)$/i.test(key))) {
    throw new Error("That looks like a temporary sign-in link. Finish signing in, then paste your course homepage URL (it contains /d2l/home).");
  }
  url.hash = "";
  return url;
}

/** Only follow links with explicit LMS evidence; this is a small discovery pass, not a web crawler. */
function d2lLinksIn(html: string, pageUrl: string): URL[] {
  const links = new Map<string, URL>();
  const add = (href: string, label = "") => {
    try {
      const url = normalizeUrl(new URL(href.replace(/&amp;/gi, "&"), pageUrl).href);
      if (/\/d2l(?:\/|$)/i.test(url.pathname) || /(^|\.)brightspace\.com$/i.test(url.hostname) ||
          findPreset(url.host) || /brightspace|\bd2l\b|desire2learn/i.test(`${href} ${label}`)) {
        links.set(url.href, url);
      }
    } catch { /* Not a reusable HTTPS LMS link. */ }
  };
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi)) {
    add(match[1] ?? match[2] ?? match[3], match[4].replace(/<[^>]*>/g, " "));
    if (links.size >= MAX_CANDIDATE_HOSTS) break;
  }
  // Some portals embed the target in a script/config rather than an anchor.
  for (const match of html.matchAll(/https:\/\/[a-z0-9.-]+\/d2l\/[^\s"'<>]*/gi)) {
    add(match[0]);
    if (links.size >= MAX_CANDIDATE_HOSTS) break;
  }
  return [...links.values()].slice(0, MAX_CANDIDATE_HOSTS);
}

async function fetchPage(url: string, fetchImpl: Fetch): Promise<{ finalUrl: URL; hosts: string[]; html: string }> {
  let current = new URL(url);
  const hosts = new Set<string>();
  try {
    // Keep intermediate hosts: a short URL can pass through Brightspace before ending at Microsoft SSO.
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    for (let hop = 0; hop < MAX_REDIRECT_REQUESTS; hop++) {
      hosts.add(current.host);
      const res = await fetchImpl(current.href, { redirect: "manual", signal });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers?.get("location");
        await res.body?.cancel();
        if (!location) break;
        const next = new URL(location, current);
        if (next.protocol !== "https:" || next.username || next.password) break;
        current = next;
        continue;
      }
      const finalUrl = new URL(res.url || current.href);
      if (finalUrl.protocol !== "https:") break;
      hosts.add(finalUrl.host);
      return { finalUrl, hosts: [...hosts], html: res.ok ? await readResponseText(res) : "" };
    }
  } catch { /* A blocked identity provider should not discard an already observed LMS host. */ }
  return { finalUrl: current, hosts: [...hosts], html: "" };
}

/**
 * Work out the school from whatever URL a student logs in through: the D2L host itself,
 * a page that redirects there, or a portal that links to it.
 */
export async function detectSchool(input: string, fetchImpl: Fetch = fetch): Promise<School> {
  const url = normalizeUrl(input);
  const preset = PRESETS.find((s) => s.host === url.host || (s.loginUrl && new URL(s.loginUrl).host === url.host));
  if (preset) return preset;

  const checks = new Map<string, Promise<boolean>>();
  const check = (host: string) => {
    if (!checks.has(host)) checks.set(host, checkBrightspaceHost(host, fetchImpl));
    return checks.get(host)!;
  };
  const schoolFor = (host: string): School => findPreset(host) ?? {
    id: "custom", name: host, lmsName: "D2L", host,
    ...(host !== url.host ? { loginUrl: url.href } : {}),
  };
  // A pasted course/homepage URL already identifies the LMS; avoid fetching private course paths.
  if (await check(url.host)) return schoolFor(url.host);

  const candidates = new Set<string>();
  const linkedPages = new Set<string>();
  const visited = new Set<string>();
  const inspect = async (pageUrl: string) => {
    if (visited.has(pageUrl)) return;
    visited.add(pageUrl);
    const page = await fetchPage(pageUrl, fetchImpl);
    for (const host of page.hosts) if (candidates.size < MAX_CANDIDATE_HOSTS) candidates.add(host);
    for (const link of d2lLinksIn(page.html, page.finalUrl.href)) {
      if (candidates.size < MAX_CANDIDATE_HOSTS) candidates.add(link.host);
      if (linkedPages.size < MAX_LINKED_PAGES && !visited.has(link.href)) linkedPages.add(link.href);
    }
  };
  for (const pageUrl of new Set([url.href, url.origin + "/"])) await inspect(pageUrl);
  const validHosts = async () => (await Promise.all([...candidates].map(async (host) => await check(host) ? host : null)))
    .filter((host): host is string => host !== null);
  let hosts = await validHosts();
  if (!hosts.length) {
    // A university homepage may link to an LMS landing page which then links to Brightspace.
    for (const pageUrl of [...linkedPages]) await inspect(pageUrl);
    hosts = await validHosts();
  }
  if (hosts.length > 1) {
    throw new AmbiguousSchoolError(hosts.map((host) => ({
      name: findPreset(host)?.name ?? host,
      // Select the verified LMS itself, so choosing it cannot repeat this ambiguous portal scan.
      loginUrl: findPreset(host)?.loginUrl ?? `https://${host}/d2l/home`,
    })));
  }
  if (hosts.length === 1) return schoolFor(hosts[0]);
  throw new Error(
    `Couldn't find D2L Brightspace at ${url.host}. Log in to your school's D2L in a browser and paste the address of your course homepage (it contains /d2l/home).`
  );
}
