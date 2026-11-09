import type { School } from "./config.js";

/** API versions the tools are written against. Setup checks the school supports them. */
export const API_VERSIONS = { le: "1.57", lp: "1.43" } as const;

/** Ontario Brightspace schools, hosts checked against /d2l/api/versions/. Only McMaster is login-tested. */
export const PRESETS: School[] = [
  { id: "mcmaster", name: "McMaster University", lmsName: "Avenue to Learn", host: "avenue.cllmcmaster.ca", loginUrl: "https://avenue.mcmaster.ca/login.php" },
  { id: "waterloo", name: "University of Waterloo", lmsName: "LEARN", host: "learn.uwaterloo.ca" },
  { id: "western", name: "Western University", lmsName: "OWL Brightspace", host: "westernu.brightspace.com" },
  { id: "queens", name: "Queen's University", lmsName: "onQ", host: "onq.queensu.ca" },
  { id: "guelph", name: "University of Guelph", lmsName: "CourseLink", host: "courselink.uoguelph.ca" },
  { id: "laurier", name: "Wilfrid Laurier University", lmsName: "MyLearningSpace", host: "mylearningspace.wlu.ca" },
  { id: "tmu", name: "Toronto Metropolitan University", lmsName: "D2L Brightspace", host: "courses.torontomu.ca" },
  { id: "uottawa", name: "University of Ottawa", lmsName: "Brightspace", host: "uottawa.brightspace.com" },
  { id: "carleton", name: "Carleton University", lmsName: "Brightspace", host: "brightspace.carleton.ca" },
  { id: "brock", name: "Brock University", lmsName: "Brightspace", host: "brightspace.brocku.ca" },
  { id: "windsor", name: "University of Windsor", lmsName: "Brightspace", host: "brightspace.uwindsor.ca" },
  { id: "laurentian", name: "Laurentian University", lmsName: "D2L", host: "d2l.laurentian.ca" },
  { id: "lakehead", name: "Lakehead University", lmsName: "myCourseLink", host: "mycourselink.lakeheadu.ca" },
];

export function findPreset(id: string): School | undefined {
  const key = id.trim().toLowerCase();
  return PRESETS.find((s) => s.id === key || s.host === key);
}

type Fetch = typeof fetch;

/** True if `host` serves the Brightspace versions API with the versions we need. */
export async function checkBrightspaceHost(host: string, fetchImpl: Fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`https://${host}/d2l/api/versions/`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return false;
    const products = (await res.json()) as Array<{ ProductCode: string; SupportedVersions: string[] }>;
    const supports = (code: "le" | "lp") =>
      products.some((p) => p.ProductCode === code && p.SupportedVersions.includes(API_VERSIONS[code]));
    return supports("le") && supports("lp");
  } catch {
    return false;
  }
}

function normalizeUrl(input: string): URL {
  const trimmed = input.trim();
  return new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
}

/** Hosts of absolute links into /d2l/ found in a page, e.g. an SSO portal linking to the real D2L host. */
function d2lHostsIn(html: string): string[] {
  const hosts = [...html.matchAll(/https:\/\/([a-z0-9.-]+)\/d2l\//gi)].map((m) => m[1].toLowerCase());
  return [...new Set(hosts)];
}

async function fetchPage(url: string, fetchImpl: Fetch): Promise<{ finalHost: string; html: string } | null> {
  try {
    const res = await fetchImpl(url, { redirect: "follow", signal: AbortSignal.timeout(10000) });
    return { finalHost: new URL(res.url || url).host, html: await res.text() };
  } catch {
    return null;
  }
}

/**
 * Work out the school from whatever URL a student logs in through: the D2L host itself,
 * a page that redirects there, or a portal that links to it.
 */
export async function detectSchool(input: string, fetchImpl: Fetch = fetch): Promise<School> {
  const url = normalizeUrl(input);
  const preset = PRESETS.find((s) => s.host === url.host || (s.loginUrl && new URL(s.loginUrl).host === url.host));
  if (preset) return preset;

  const candidates = [url.host];
  for (const pageUrl of [url.href, url.origin + "/"]) {
    const page = await fetchPage(pageUrl, fetchImpl);
    if (page) candidates.push(page.finalHost, ...d2lHostsIn(page.html));
  }

  for (const host of [...new Set(candidates)]) {
    if (await checkBrightspaceHost(host, fetchImpl)) {
      return {
        id: "custom",
        name: host,
        lmsName: "D2L",
        host,
        ...(host !== url.host ? { loginUrl: url.href } : {}),
      };
    }
  }
  throw new Error(
    `Couldn't find D2L Brightspace at ${url.host}. Log in to your school's D2L in a browser and paste the address of your course homepage (it contains /d2l/home).`
  );
}
