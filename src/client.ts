import { clearTokenCache, getToken } from "./auth.js";
import { getSchool } from "./config.js";
import { API_VERSIONS } from "./schools.js";

const LE = API_VERSIONS.le;
const LP = API_VERSIONS.lp;
const MAX_CONCURRENT = 4;
const REQUEST_TIMEOUT_MS = 20000;

export class D2LApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "D2LApiError";
  }
}

/** Caps how many D2L requests run at once, so fanning out over every course stays polite. */
class Limiter {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(private max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

export class D2LClient {
  private limiter = new Limiter(MAX_CONCURRENT);

  private async request<T>(method: string, path: string): Promise<T> {
    const url = `https://${getSchool().host}${path}`;
    return this.limiter.run(async () => {
      let response!: Response;
      // A 401 means the token was rejected (e.g. expired or revoked early):
      // drop it, log in again, and retry once
      for (let attempt = 1; attempt <= 2; attempt++) {
        const token = await getToken();
        response = await fetch(url, {
          method,
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (response.status !== 401 || attempt === 2) break;
        clearTokenCache();
      }
      if (!response.ok) {
        const text = (await response.text()).slice(0, 300);
        // Expected misses (a final grade that isn't released yet) are normal, so this only logs when asked
        if (process.env.AMICOOKED_DEBUG) console.error(`[api] ${method} ${path} -> ${response.status}`);
        throw new D2LApiError(response.status, `D2L API error ${response.status}: ${text}`);
      }
      return (await response.json()) as T;
    });
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  // Dropbox/Assignment endpoints
  getDropboxFolders(orgUnitId: number) {
    return this.get(`/d2l/api/le/${LE}/${orgUnitId}/dropbox/folders/`);
  }

  getDropboxFolder(orgUnitId: number, folderId: number) {
    return this.get(`/d2l/api/le/${LE}/${orgUnitId}/dropbox/folders/${folderId}`);
  }

  getDropboxSubmissions(orgUnitId: number, folderId: number) {
    return this.get(`/d2l/api/le/${LE}/${orgUnitId}/dropbox/folders/${folderId}/submissions/`);
  }

  // Content endpoints
  getContentToc(orgUnitId: number) {
    return this.get(`/d2l/api/le/${LE}/${orgUnitId}/content/toc`);
  }

  getContentTopic(orgUnitId: number, topicId: number) {
    return this.get(`/d2l/api/le/${LE}/${orgUnitId}/content/topics/${topicId}`);
  }

  getContentModules(orgUnitId: number) {
    return this.get(`/d2l/api/le/${LE}/${orgUnitId}/content/root/`);
  }

  getContentModule(orgUnitId: number, moduleId: number) {
    return this.get(`/d2l/api/le/${LE}/${orgUnitId}/content/modules/${moduleId}/structure/`);
  }

  // User and course info
  whoami() {
    return this.get(`/d2l/api/lp/${LP}/users/whoami`);
  }

  getCourse(orgUnitId: number) {
    return this.get(`/d2l/api/lp/${LP}/courses/${orgUnitId}`);
  }

  // Grades endpoints
  getMyGradeValues(orgUnitId: number) {
    return this.get(`/d2l/api/le/${LE}/${orgUnitId}/grades/values/myGradeValues/`);
  }

  /** The course's final calculated grade; 403/404 until the instructor releases it. */
  getMyFinalGrade(orgUnitId: number) {
    return this.get(`/d2l/api/le/${LE}/${orgUnitId}/grades/final/values/myGradeValue`);
  }

  // Calendar endpoints
  getMyCalendarEvents(orgUnitId: number, startDateTime: string, endDateTime: string) {
    const params = new URLSearchParams({ startDateTime, endDateTime });
    return this.get(`/d2l/api/le/${LE}/${orgUnitId}/calendar/events/myEvents/?${params}`);
  }

  // News/Announcements endpoints
  getNews(orgUnitId: number) {
    return this.get(`/d2l/api/le/${LE}/${orgUnitId}/news/`);
  }

  // Results are paged (100 per page); follow the bookmark to get all of them
  async getMyEnrollments() {
    const items: unknown[] = [];
    let bookmark = "";
    do {
      const query = bookmark ? `?bookmark=${encodeURIComponent(bookmark)}` : "";
      const page = (await this.get(`/d2l/api/lp/${LP}/enrollments/myenrollments/${query}`)) as {
        Items: unknown[];
        PagingInfo?: { Bookmark: string; HasMoreItems: boolean };
      };
      items.push(...page.Items);
      bookmark = page.PagingInfo?.HasMoreItems ? page.PagingInfo.Bookmark : "";
    } while (bookmark);
    return { Items: items };
  }
}

export const client = new D2LClient();
