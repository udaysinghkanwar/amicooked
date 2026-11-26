# Custom Brightspace portal discovery

Reviewed November 26, 2026. Scope: how public Brightspace MCP implementations accept an institution that is absent from their presets, and what Am I Cooked should do with a student-provided portal URL. This is a source review, not a functional/security audit of those projects. No third-party code was installed or executed.

## Recommendation

Keep a first-class “paste your course portal link” option. A preset or email-domain match is a convenience, not a prerequisite. Accept a Brightspace hostname, a course/homepage URL, or a stable public portal link which redirects or links to Brightspace. Discover and validate the API host separately from the URL where the student starts signing in. Keep the existing local browser sign-in flow.

The URL identifies the institution's LMS instance, not the student's identity or permission to access courses. Successful browser authentication and authenticated course checks remain necessary. Some institutions share an instance across campuses; choosing a campus can remain part of the school's own sign-in page.

## Existing MCP implementations

| Project | Reviewed implementation | Relevant behavior | Implication for Am I Cooked |
| --- | --- | --- | --- |
| RohanMuppa/brightspace-mcp-server | [setup.ts](https://github.com/RohanMuppa/brightspace-mcp-server/blob/4dc1f91979fffe90f4a2c9a238640e741f6adc54/src/setup.ts), [prepare.ts](https://github.com/RohanMuppa/brightspace-mcp-server/blob/4dc1f91979fffe90f4a2c9a238640e741f6adc54/src/setup/prepare.ts) | Accepts an explicit URL independently of school presets. Preparation normalizes the URL to an origin, probes API versions, and avoids saving an unreachable new school. The setup wizard can ask for the Brightspace address. | Support arbitrary verified LMS hosts and validate before replacing working settings. Presets are optional. |
| bencered/d2l-mcp-server | [auth.ts](https://github.com/bencered/d2l-mcp-server/blob/219205f1b36cb6a030f0f9403f33a49d15a0778b/src/auth.ts) | Reads D2L_HOST, defaults to learn.ul.ie, and constructs an HTTPS /d2l/home URL. | A user-provided hostname can be enough to target Brightspace; it does not require a worldwide hardcoded school list. This inspected file does not provide public-web portal discovery. |
| JhostinAleck/brightspace-mcp | [setup prompts](https://github.com/JhostinAleck/brightspace-mcp/blob/e69fd2adad4be8d6b074c78ffa1ccc7324862a1a/src/cli/commands/setup/prompts.ts), [README](https://github.com/JhostinAleck/brightspace-mcp/blob/e69fd2adad4be8d6b074c78ffa1ccc7324862a1a/README.md) | Prompts for an HTTPS base URL and can configure a separate authentication/login URL. Its documented profiles support several authentication strategies. | Preserve the distinction between the LMS/API host and the login entry point. Our student-facing flow can keep passwords/MFA in the school's browser. |
| hamzakammar/mcp-workspace (Horizon) | [D2L auth routes](https://github.com/hamzakammar/mcp-workspace/blob/e8a2715d6b46f21e092b17de5bb3bff65a7f83ea/d2l-mcp/src/api/d2lAuthRoutes.ts), [README](https://github.com/hamzakammar/mcp-workspace/blob/e8a2715d6b46f21e092b17de5bb3bff65a7f83ea/README.md) | The D2L auth-start route accepts d2lHost, falls back to configuration/a Waterloo host, and starts a browser session for the authenticated user. | Caller-provided institution hosts are a practical pattern. The inspected route is not evidence of universal school-name or portal discovery. |

These projects use different authentication architectures. They are not proof that every Brightspace school works end to end, and their use of a user-supplied URL does not imply that any arbitrary university homepage can be resolved automatically.

## D2L's own approach

D2L Pulse lets users search by institution name and enter the institution's LMS URL when it is not listed. Its organization-search documentation explains that the directory's name and URL are institution metadata and that changes can take time to propagate. A pasted URL is therefore a normal fallback, not an unusual workaround.

Sources: [Pulse login](https://community.d2l.com/brightspace/kb/articles/1663-log-in-and-out-of-brightspace-pulse), [organization discovery](https://community.d2l.com/brightspace/kb/articles/22398-brightspace-pulse-organization-search). The [D2L routing table](https://docs.valence.desire2learn.com/http-routingtable.html) documents /d2l/api/versions/; the app uses it to check the API contracts it actually needs.

## Current implementation and improvements

Am I Cooked already accepted pasted URLs and could find a host through a final redirect or an absolute /d2l/ link. This change improves that existing path:

1. A direct Brightspace URL is checked using the host's public versions endpoint before fetching any course path. A deep course URL is not scraped to discover the host.
2. HTTPS redirect chains retain intermediate hosts. A short link can pass through the actual LMS and finish at Microsoft/another identity provider; the final identity-provider host is not mistaken for the API host.
3. Public-page inspection recognizes relative links, protocol-relative links, LMS root links labelled Brightspace/D2L, and HTML-escaped query separators. Relative links resolve against the page's actual final URL.
4. If the first public page exposes only an LMS landing-page link, discovery can inspect up to two linked pages. It does not crawl the entire university website, run page scripts, submit forms or sign in headlessly.
5. Candidate hosts must expose the required Brightspace LE/LP API versions. If several different instances pass, setup asks which one to use. Automated setup returns the choices with its existing needs-input exit code instead of choosing the first link. Selecting a result uses a direct verified LMS URL, avoiding a repeat of the ambiguous scan.
6. The configured API host is distinct from a stable portal login URL. Discovery preserves the supplied stable portal URL for custom hosts when it differs from the API host. Authentication-response links containing SAMLRequest, SAMLResponse, code, access_token or id_token are rejected as input rather than saved for later logins. Embedded credentials and non-HTTPS URLs are rejected.

Discovery is deliberately bounded: the supplied page and its origin root, at most two linked LMS pages, at most eight candidate hosts, at most six HTTP requests per redirect chain with a shared ten-second timeout per chain, and at most 256,000 bytes read from each response, with unused bodies cancelled. API probes have their existing ten-second timeout. These limits can produce a safe failure on an unusually complex portal; they are not a promise to inspect every link.

## Validation

- Unit/regression coverage includes direct and deep URLs, redirect chains ending at an identity provider, relative landing pages, root-domain Brightspace links, escaped links, multiple valid hosts, bounded discovery and rejected transient/insecure input.
- PR preparation on current main passed the full npm test command: 287 Vitest tests across 33 files, Gemini integration checks, JavaScript/native updater smoke tests and shell-installer checks. The TypeScript build passed. The video acceptance command intentionally skips external downloads outside GitHub Actions; the cross-platform CI matrix runs it remotely.
- Live unauthenticated discovery succeeded for Sheridan's https://slate.sheridancollege.ca/d2l/home and McGill's https://mycourses2.mcgill.ca/d2l/home. Neither institution is in the current preset list; both resolved as custom schools.
- Live discovery also resolved McGill's stable https://mcgill.ca/mycourses link to mycourses2.mcgill.ca and preserved the stable entry link for login. McGill's [official access guide](https://mcgill.service-now.com/itportal?id=kb_article_view&sysparm_article=KB0010853) identifies this entry link, and its [service-links guide](https://mcgill.service-now.com/itportal?id=kb_article_view&sysparm_article=KB0011039) identifies the actual LMS host.
- A guessed mycourses.mcgill.ca host failed validation. The app did not turn that failure into a fabricated school record. This reinforces the value of asking for the actual link a student uses.
- No student signed in during these checks. They do not establish token capture, enrollment retrieval, grades or course-file access at Sheridan or McGill.

## Remaining limits and fallback

A general institution homepage without a visible LMS link cannot always reveal the correct portal. Some portals require JavaScript, a prior session or sign-in before they expose the link. In those cases, ask the student to open their usual course site, sign in there, and paste the final address containing /d2l/. Do not ask them for browser cookies, bearer tokens, authentication callback URLs or their school password.

The URL alone may identify only the host, not a human-friendly institution name. Save it as a custom school; improve the display name separately if needed. Do not invent the institution's official name from its hostname. Name/email discovery should continue to fall back to this URL path, and email signup collection remains a separate, consented feature.

This work is local and unpublished. Research informed the design; third-party implementation code was not copied.
