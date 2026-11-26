# School-email discovery and signup collection

Research date: November 26, 2026 (America/Toronto). Scope: all 49 current Am I Cooked presets: 13 universities and 36 Ontario school boards. This is research and a proposed design; this document does not enable email collection or change setup behavior.

## Recommendation

Ask for a school email during interactive CLI setup and use an exact, maintained domain-to-institution registry to suggest the school. Keep school-name search and pasted portal URLs available. After a successful connection, ask whether the student wants to subscribe to Am I Cooked product updates, with an option to use another contact address. Save the contact centrally only after the disclosed signup/consent step. Keep anonymous installation counts separate.

The school address helps route the user to their learning platform. The contact address is where they want to receive messages; a personal address may be more useful after graduation or where school mail blocks external senders. Do not require the two addresses to be equal.

## Proposed setup copy and sequence

1. **What's your school email?** Helper: “We'll use its domain to suggest your school. You can choose your school instead.” Provide Skip / Choose school manually.
2. On a supported domain: **Found McMaster University — Avenue to Learn. Continue?** Give Continue and Choose another school. For shared/uncertain mappings show candidates, not a guessed portal. Unknown/personal email domains use school-name search or a URL.
3. Open the known school login URL and let the student sign in there. Never ask for a school password in the CLI. Keep the email exactly as entered for any identity-provider login; an alternate Google suffix is not automatically a valid Microsoft login.
4. Once the selected AI app is connected: **Get Am I Cooked feature updates and early-access invitations by email?** Explicit Yes / No, default No. Explain that choosing Yes saves the selected contact address and signup details with Am I Cooked / its email provider. Link to the privacy notice and identify the sender. Avoid vague “other stuff”.
5. If Yes: **Send updates to [school address] or use another email?** Record a pending subscription and send a confirmation through the email provider once configured. Subscription verification must not block course access or successful setup. Show pending/failed status accurately.
6. Count successful installations independently. A skipped email or declined marketing consent can still increment an anonymous setup count. Do not call those users contactable subscribers.

Use the interactive prompt as the normal path. A separate web signup page is useful for people who have not installed yet; it should use the same contact/subscription backend. A raw --email flag can be optional for explicit automation but is a poor default because shell history and command logs retain arguments. AI-assisted setup should not copy a student's email into shared logs or model instructions.

## What the current code actually does

- src/cli/setup.ts asks for a school, opens the school's portal, checks whoami/courses, configures clients and reports a successful anonymous setup.
- src/config.ts stores local school/browser settings. It has no email/contact fields.
- src/client.ts calls /users/whoami. D2L's documented WhoAmIUser has identifiers, names and pronouns, but no dedicated email field. UniqueName is not guaranteed to be an email. UserData has ExternalEmail, which can be null and is subject to access/privacy controls. Do not add broad user-directory permissions simply to collect marketing emails.
- src/telemetry.ts and site/api/e.js implement counters. They are not a contact database, email-verification service or newsletter subscription system.
- The name discovery directory used by D2L's Login Finder is a source of institution names and LMS links. Its advertised search fields are contains, lat and lon; do not assume it offers a verified email-domain routing contract.

Sources: [D2L WhoAmIUser / UserData](https://docs.valence.desire2learn.com/res/user.html), [D2L Pulse login flow](https://community.d2l.com/brightspace/kb/articles/1857-log-in-and-out-of-brightspace-pulse), [public institution-search API](https://lms-disco.api.brightspace.com/institutions?contains=Toronto).

## Findings that affect the design

- Email domains and portal hostnames often differ: mylaurier.ca maps to mylearningspace.wlu.ca; cmail.carleton.ca to brightspace.carleton.ca; pdsb.net to pdsb.elearningontario.ca; mytools2go.ca to wecdsb.elearningontario.ca.
- A board can use multiple account domains. Halton Catholic documents students.hcdsb.org for Microsoft/Brightspace and students.myhcdsb.org for Google. Sudbury Catholic's guide documents separate Microsoft/vLE and Google suffixes. These domains can suggest one school without being interchangeable login names.
- TDSB's 2026 secondary-account notice moves student addresses from student.tdsb.on.ca to tdsb.ca. Ottawa Catholic's current student domain is stu.ocsb.ca; the board retired ocsbstudent.ca in 2022. A static list needs source URLs and review dates, and must allow overrides.
- Finding an institution is different from proving a deliverable mailbox or current enrollment. Staff and alumni may share university domains. Confirmed contact email does not prove a student role, and a Brightspace login does not prove control of an unrelated contact address.
- School email may not accept outside messages. OCDSB explicitly distinguishes internal-only email for grades 4–6 from external email for grades 7–12. CEPEO's historical Google terms also describe age/grade restrictions. Do not make an external confirmation email a prerequisite for connecting the learning platform.
- Do not infer an LMS from Microsoft/Google MX records or an SSO tenant. Many schools share the same mail providers and may use different learning platforms.

Additional sources: [TDSB migration notice](https://schoolweb.tdsb.on.ca/northernss/Home/ctl/Detail/mid/204717/ItemID/24073), [Halton Catholic platform domains](https://www.hcdsb.org/students/online-platforms/), [OCSB current student access](https://www.ocsb.ca/parents/), [OCSB retirement notice](https://www.ocsb.ca/2022/05/10/your-student-account-is-being-shut-down-heres-how-to-transfer-your-data/), [OCDSB email restrictions](https://www.ocdsb.ca/family-community-support/remote-learning-support).

## Coverage and evidence quality

49 institutions reviewed: 36 have a documented domain/account pattern, 8 have an explicit pattern in an older guide that needs current reconfirmation, and 5 need more evidence for the student suffix. A recently crawled old document is not a recently updated policy.

“Documented” means the source supports the indicated domain or account format. It does not mean we verified a student's mailbox, authenticated at that school, or confirmed every grade/campus/role. Older notices may establish migrations but are not proof every historical alias remains deliverable. Never reject a student solely for not matching these patterns.

All 13 university hosts passed the app's checkBrightspaceHost check for le 1.57 and lp 1.43 during this research. The 36 board hosts passed the same unauthenticated API-version checks earlier in this session; their sources are recorded in [the board-portal research](ontario-school-board-portals-2026-11-26.md). API compatibility does not establish successful student login, token capture or course access.

### Universities

| Institution | Email/account domain | LMS and configured portal | Evidence | Notes |
| --- | --- | --- | --- | --- |
| McMaster University | mcmaster.ca | [Avenue to Learn](https://avenue.mcmaster.ca/login.php) | [Documented](https://office365.mcmaster.ca/office-365-3/email-calendaring/) | MacID email; Microsoft 365. |
| University of Waterloo | uwaterloo.ca | [LEARN](https://learn.uwaterloo.ca/d2l/home) | [Documented](https://uwaterloo.ca/student-it-services/) | Current student domain; do not require the historical edu.uwaterloo.ca suffix. |
| Western University | uwo.ca | [OWL Brightspace](https://westernu.brightspace.com/d2l/home) | [Documented](https://wts.uwo.ca/microsoft-365/getting-started/email-faq.html) | Shared with staff and some alumni; domain does not prove current enrollment. |
| Queen's University | queensu.ca | [onQ](https://onq.queensu.ca/d2l/home) | [Documented](https://www.queensu.ca/registrar/registration/student-guide-registration) | Official student email; domain also exists for alumni. |
| University of Guelph | uoguelph.ca | [CourseLink](https://courselink.uoguelph.ca/d2l/home) | [Documented](https://www.uoguelph.ca/registrar/new-student-registration-guide) | Official U of G email; Gryph Mail uses Outlook/Microsoft 365. |
| Wilfrid Laurier University | mylaurier.ca | [MyLearningSpace](https://mylearningspace.wlu.ca/d2l/home) | [Documented](https://students.wlu.ca/campus-services/tech-services/accounts-and-security/index.html) | Student domain differs from the university website and staff domain wlu.ca. |
| Toronto Metropolitan University | torontomu.ca | [D2L Brightspace](https://courses.torontomu.ca/d2l/home) | [Documented](https://www.torontomu.ca/calendar/2026-2027/policies-and-procedures/enrolment-records/general-information/) | Current calendar specifies username@torontomu.ca. Do not require legacy ryerson.ca. |
| University of Ottawa | uottawa.ca | [Brightspace](https://uottawa.brightspace.com/d2l/home) | [Documented](https://www.uottawa.ca/en/current-students) | Official university student email. |
| Carleton University | cmail.carleton.ca | [Brightspace](https://brightspace.carleton.ca/d2l/home) | [Documented](https://carleton.ca/its/all-services/email/carleton-student-email/) | Student email; staff use cunet.carleton.ca and other aliases. |
| Brock University | brocku.ca | [Brightspace](https://brightspace.brocku.ca/d2l/home) | [Documented](https://brocku.ca/policies/wp-content/uploads/sites/94/End-User-Logical-Access-Standards.pdf) | Institutional email accounts for students, faculty and staff; Microsoft 365. |
| University of Windsor | uwindsor.ca | [Brightspace](https://brightspace.uwindsor.ca/d2l/home) | [Documented](https://www.uwindsor.ca/itservices/getting-started-students) | Official UWinID email; Outlook/Microsoft 365. |
| Laurentian University | Not confirmed as a student-specific suffix | [D2L](https://d2l.laurentian.ca/d2l/home) | [Needs review](https://laurentian.ca/academics/online-distance-education/recommended-technology) | Official guide confirms student Google email and Brightspace, but reviewed student guidance does not explicitly state the suffix. laurentian.ca is the institution domain; avoid claiming the student pattern is verified. |
| Lakehead University | lakeheadu.ca | [myCourseLink](https://mycourselink.lakeheadu.ca/d2l/home) | [Documented](https://www.lakeheadu.ca/faculty-and-staff/departments/services/helpdesk/faq) | University account/email domain; distinct from Lakehead District School Board. |

### Ontario school boards

| Institution | Email/account domain | Configured Brightspace portal | Evidence | Notes |
| --- | --- | --- | --- | --- |
| Toronto District School Board | tdsb.ca; student.tdsb.on.ca (legacy) | [Brightspace](https://tdsb.elearningontario.ca/d2l/login) | [Documented](https://schoolweb.tdsb.on.ca/northernss/Home/ctl/Detail/mid/204717/ItemID/24073) | Secondary account migration February 6–8, 2026; legacy address remains an email alias according to the notice. Do not assume all grades migrated identically. |
| Toronto Catholic District School Board | tcdsb.ca | [Brightspace](https://tcdsb.elearningontario.ca/d2l/login) | [Documented](https://www.tcdsb.org/page/digital-store) | Official student Microsoft 365 account identifier. Mailbox delivery is a separate question. |
| Peel District School Board | pdsb.net | [Brightspace](https://pdsb.elearningontario.ca/d2l/login) | [Documented](https://sites.google.com/pdsb.net/louisearbourguidance/getting-started-at-l-a) | Student number at pdsb.net, not the peelschools.org website domain. |
| Dufferin-Peel Catholic District School Board | student.dpcdsb.org (email); educ.dpcdsb.org (login) | [Brightspace](https://dpcdsb.elearningontario.ca/d2l/login) | [Dated guide](https://augst.dpcdsb.org/download/525074) | Board-issued guide explicitly distinguishes the student email address from the login identifier. Reconfirm current format before making either mandatory. |
| York Region District School Board | gapps.yrdsb.ca | [Brightspace](https://yrdsb.elearningontario.ca/d2l/login) | [Documented](https://www2.yrdsb.ca/student-tools-and-resources/brightspaced2l) | Official Brightspace troubleshooting names the student Google account domain. |
| York Catholic District School Board | ycdsbk12.ca | [Brightspace](https://ycdsb.elearningontario.ca/d2l/login) | [Documented](https://sba.ycdsb.ca/students/) | Student account domain; differs from ycdsb.ca staff/website domain. |
| Durham District School Board | ddsbstudent.ca | [Brightspace](https://durham.elearningontario.ca/d2l/login) | [Documented](https://pineridgess.ddsb.ca/en/students/gmail-info.aspx) | Secondary student email format in board school guide; same institution as Durham DSB. |
| Durham Catholic District School Board | dclive.ca | [Brightspace](https://durhamrc.elearningontario.ca/d2l/login) | [Documented](https://www.dcdsb.ca/our-families/student-logins/) | Current Student Logins page requires StudentNumber@dclive.ca. |
| Halton District School Board | hdsb.ca | [Brightspace](https://hdsb.elearningontario.ca/d2l/login) | [Dated guide](https://garyallan.ca/wp-content/uploads/2021/04/Summer-IILE-info-and-FAQ-2021.docx.pdf) | Student account suffix specified by HDSB continuing-education program; current HDSB resources confirm student Google accounts but do not explicitly repeat the suffix. |
| Halton Catholic District School Board | students.hcdsb.org; students.myhcdsb.org | [Brightspace](https://hcdsb.elearningontario.ca/d2l/login) | [Documented](https://www.hcdsb.org/students/online-platforms/) | First domain for Microsoft 365/Brightspace; second for Google Workspace. Both can suggest the same board but are not interchangeable login strings. |
| Conseil scolaire Viamonde | csviamonde.net | [EAV / Brightspace](https://csv.apprentissageelectroniqueontario.ca/d2l/login) | [Dated guide](https://csviamonde.ca/fileadmin/ecoles/Ecole_elementaire_La_Source/lettre_aux_parents_-_continuite_des_apprentissages_3_avril_2020.pdf) | Student Microsoft account domain in a 2020 board school letter, not the csviamonde.ca staff/website suffix. Reconfirm current usage. |
| Conseil scolaire catholique MonAvenir | mon-avenir.ca | [EAV / Brightspace](https://cscmonavenir.apprentissageelectroniqueontario.ca/d2l/login) | [Dated guide](https://www.cscmonavenir.ca/wp-content/uploads/2020/04/guide-parents-elementaire.pdf) | Student identifier in board guide; differs from the public cscmonavenir.ca website. |
| Hamilton-Wentworth District School Board | hwdsb.on.ca | [The Hub / Brightspace](https://hwdsb.elearningontario.ca/d2l/login) | [Documented](https://www.hwdsb.on.ca/wp-content/uploads/2021/05/student_email_instructions.pdf) | Board student email guide; same domain is also used by staff. |
| Hamilton-Wentworth Catholic District School Board | hwcdsb.ca | [Brightspace](https://hwcdsb.elearningontario.ca/d2l/login) | [Dated guide](https://cdnsm5-ss21.sharpschool.com/UserFiles/Servers/Server_370166/File/School%20Life/Technologies/Tech%20Help/Virtual%20Learning%20Support/Getting%20Started%20Elementary%20Virtual%20Learning.pdf) | Official board-hosted school guide gives school username plus @hwcdsb.ca. |
| Ottawa-Carleton District School Board | ocdsb.ca | [Brightspace](https://ocdsb.elearningontario.ca/d2l/login) | [Documented](https://sites.google.com/ocdsb.ca/ocdsb-student-portal) | Board Student Portal shows a student address at ocdsb.ca. Grades 4–6 have internal email restrictions; grades 7–12 can exchange outside email. |
| Ottawa Catholic School Board | stu.ocsb.ca | [Brightspace](https://ocsb.elearningontario.ca/d2l/login) | [Documented](https://www.ocsb.ca/parents/) | Current Parents Hub specifies student credentials; ocsbstudent.ca was retired in 2022. |
| Conseil des écoles publiques de l'Est de l'Ontario | Not confirmed | [EAV / Brightspace](https://cepeo.apprentissageelectroniqueontario.ca/d2l/login) | [Needs review](https://omer-deslauriers.cepeo.on.ca/parents/ressources-pedagogiques/ressources-en-ligne-odl/) | Public guides confirm board Google accounts but reviewed guidance does not establish the student suffix. Do not infer it from staff addresses at cepeo.on.ca. |
| Conseil des écoles catholiques du Centre-Est | ecolecatholique.ca | [EAV / Brightspace](https://cecce.apprentissageelectroniqueontario.ca/d2l/login) | [Documented](https://paul-desmarais.ecolecatholique.ca/communique-hebdomadaire) | 2026 school communication explicitly identifies the student Google domain and graduate account expiry. |
| Waterloo Region District School Board | wrdsb.ca | [Brightspace](https://wrdsb.elearningontario.ca/d2l/login) | [Documented](https://jma.wrdsb.ca/2017/06/27/wrdsb-email-addresses-to-change-august-21/) | Board-published migration replaced wrdsb.on.ca, ins.wrdsb.ca and googleapps.wrdsb.ca with wrdsb.ca. Historical notice; keep a manual fallback. |
| Waterloo Catholic District School Board | wcdsb.ca | [Brightspace](https://wcdsb.elearningontario.ca/d2l/login) | [Documented](https://wcdsb.ca/students/) | Current Student Links page specifies student login format. This is Waterloo Catholic, not Wellington. |
| Thames Valley District School Board | gotvdsb.ca | [Brightspace](https://tvdsb.elearningontario.ca/d2l/login) | [Documented](https://www.tvdsb.ca/parents/adult-and-continuing-education/adult-day-school/ads-faq/) | Board Brightspace login instructions use the student number at gotvdsb.ca. |
| London District Catholic School Board | ldcsb.org | [Brightspace](https://ldcsb.elearningontario.ca/d2l/login) | [Documented](https://www.ldcsb.ca/apps/pages/index.jsp?pREC_ID=1360103&type=d&uREC_ID=1076468) | Board course-calendar instructions specify 5/6-digit student number at ldcsb.org; do not infer ldcsb.ca from the website. |
| Greater Essex County District School Board | Not confirmed | [Brightspace](https://gecdsb.elearningontario.ca/d2l/login) | [Needs review](https://www.publicboard.ca/en/programs-and-learning/edsby-brightspace-and-teams-help.aspx) | Official resources confirm student Microsoft 365 accounts, but reviewed page obscures the email example and does not establish a readable student suffix. |
| Windsor-Essex Catholic District School Board | mytools2go.ca | [Brightspace](https://wecdsb.elearningontario.ca/d2l/login) | [Documented](https://www.wecdsb.on.ca/common/pages/UserFile.aspx?fileId=110334405) | 2026/27 board student handbook supplies this email domain, not the wecdsb.on.ca website domain. |
| District School Board of Niagara | students.dsbn.org | [Brightspace](https://dsbn.elearningontario.ca/d2l/login) | [Documented](https://sirwinston.dsbn.org/docs/default-source/default-document-library/swc-new-student-guidebook15d9e2d2-bdd2-4c86-b62d-2f0086c4a8b0.pdf) | School-published student login guide specifies the student domain. |
| Niagara Catholic District School Board | niagaracatholic.ca | [Brightspace](https://niagaracatholic.elearningontario.ca/d2l/login) | [Documented](https://www.niagaracatholic.ca/parents/n_c_v_l_e_parent_portal) | Board NCVLE guide describes the student login username. Confirm account vs deliverable mailbox separately. |
| Simcoe County District School Board | scdsb.on.ca | [Brightspace](https://scdsb.elearningontario.ca/d2l/login) | [Documented](https://www.scdsb.on.ca/elementary/use_of_technology_for_learning/digital_tools_and_accessibility) | Current board Digital Tools page specifies student account format. |
| Simcoe Muskoka Catholic District School Board | smcdsb.on.ca | [Brightspace](https://smcdsb.elearningontario.ca/d2l/login) | [Documented](https://gsh.schools.smcdsb.on.ca/news/what_s_happening/virtual_learning_environment) | Board school guide specifies student ID plus @smcdsb.on.ca. |
| Limestone District School Board | limestone.on.ca | [Brightspace](https://ldsb.elearningontario.ca/d2l/login) | [Documented](https://www.limestone.on.ca/learning_technology_support_for_students) | Board student support page explicitly describes student Outlook email accounts. |
| Algonquin and Lakeshore Catholic District School Board | alcdsb.on.ca | [Brightspace](https://alcdsb.elearningontario.ca/d2l/login) | [Dated guide](https://old.alcdsb.on.ca/community/COVID-19/Documents/Accessing%20and%20Joining%20FreshGrade%20Student%20from%20Home%20%28Parents%29.pdf) | Archived board parent/student guide supplies this sign-in suffix. Public legacy PDF links can now fail; recheck before enforcing it. |
| Upper Grand District School Board | ugcloud.ca | [Brightspace](https://ugdsb.elearningontario.ca/d2l/login) | [Documented](https://sites.google.com/ugcloud.ca/pgreidllcgcvi/faqs) | Official student school guide confirms UGCloud/Gmail; staff communication guide distinguishes ugcloud.ca from staff ugdsb.on.ca accounts. |
| Wellington Catholic District School Board | Not confirmed | [Brightspace](https://welcdsb.elearningontario.ca/d2l/login) | [Needs review](https://bishopmacdonell.wellingtoncdsb.ca/UserFiles/Servers/Server_22181959/File/Registration/Secondary%20School%20Annual%20Information%20Package%202024-25.pdf) | Official annual information package documents student Outlook access but reviewed text does not establish the address suffix. Do not guess from the website. |
| Lakehead District School Board | lakeheadschools.ca | [Brightspace](https://lhbe.elearningontario.ca/d2l/login) | [Documented](https://www.lakeheadschools.ca/student-resources/office-365/) | Official Office 365 student page explicitly says to append @lakeheadschools.ca. Do not confuse with Lakehead University. |
| Thunder Bay Catholic District School Board | Not confirmed | [Brightspace](https://tbcdsb.elearningontario.ca/d2l/login) | [Needs review](https://tbcschools.ca/) | Board portal and Brightspace host are verified separately; no authoritative student account-format guide found. Staff-email directories were excluded. |
| Rainbow District School Board | rscloud.ca | [Brightspace](https://rdsb.elearningontario.ca/d2l/login) | [Dated guide](https://lockerby.rainbowschools.ca/wp-content/uploads/sites/10/2020/09/RDSB_Information_Student_D2L_Login.pdf) | Board student Brightspace/Gmail guide documents rscloud.ca; not the rainbowschools.ca website domain. |
| Sudbury Catholic District School Board | sudburycatholicstudents.ca (Microsoft/vLE); sudburycdsb.ca (Google) | [Brightspace](https://srcdsb.elearningontario.ca/d2l/login) | [Dated guide](https://www.sudburycatholicschools.ca/wp-content/uploads/sites/5/2020/04/On-line-Help.pdf) | Official guide explicitly distinguishes the vLE/Microsoft and Google/Gmail account suffixes. Reconfirm current usage; do not rewrite the entered address. |

## Other major GTA institutions: recognize unsupported platforms

A school-domain match must also carry an LMS type and support state. Do not route every Canadian university email to a Brightspace URL.

- **University of Toronto:** Quercus is powered by Canvas. The current Brightspace client cannot read it. [U of T platform description](https://www.rotman.utoronto.ca/programs/professional-development-programs/executive-programs/programs-for-individuals/technical-requirements-for-online-programs/).
- **York University:** eClass is Moodle based. The current Brightspace client cannot read it. [York platform description](https://www.yorku.ca/unit/vpf/new-faculty/).
- **Sheridan:** SLATE uses D2L Brightspace; this is a candidate for future directory/preset expansion, not a school added by this research. [Sheridan SLATE documentation](https://ltsa.sheridancollege.ca/digital-learning-support-hub/whats-new-in-slate/).
- **Centennial:** official guidance identifies eCentennial, but the reviewed source did not independently establish its underlying current vendor, so do not label it supported based on the brand name alone. [Centennial course delivery](https://banner.centennialcollege.ca/prod/twbkfrmt.P_DispHelp?pagename_in=bwskfshd.P_CrseSchd).

These are platform identifications, not outage/status checks or end-to-end integration tests.

## Routing implementation contract

Keep a registry with schoolId, exact domain, accountKind (email/login/Google), evidenceUrl, checkedAt, confidence/status and LMS support. Prefer explicit verified domains over broad suffix wildcards. Normalize domain case and internationalized domain representation, but preserve the entered email. Do not infer someone's name or role from the local part. Reject malformed addresses without network calls. Do not match mcmaster.ca.attacker.example or fakemcmaster.ca to mcmaster.ca.

Resolve in this order:

1. An explicitly chosen --school remains authoritative; flag an email mismatch as a suggestion rather than silently switching schools.
2. A unique documented domain suggests the corresponding supported school, with an easy override. Older/uncertain records require confirmation or manual choice.
3. Unknown/personal domains use the school-name directory search already implemented, then the pasted-URL fallback. Do not send the complete email address to D2L, a search engine or an LLM.
4. An explicitly recognized unsupported institution gets an accurate unsupported-platform message. Do not fabricate a Brightspace host.
5. Cache the user's selected school locally. Domain guesses never replace the school's real sign-in flow or act as authorization.

## Signup/contact backend

For the first version, use the existing Vercel hosting for a narrow signup endpoint and an email platform with contact management, confirmation, campaigns and unsubscribe handling. Brevo is one concrete option with a documented double-opt-in contact API. A full app account system and Microsoft/Google OAuth are unnecessary solely to detect schools or maintain an updates list. This is an architecture recommendation; no provider account was created, no integration was configured and no emails were sent.

Recommended records/attributes:

| Field | Purpose |
| --- | --- |
| contactId | Opaque provider/internal identifier; do not use a Brightspace user ID |
| contactEmail | The address the user explicitly chose for updates |
| schoolId | Confirmed institution; keep “unknown/custom” available |
| signupRequestedAt | Time they deliberately requested signup |
| setupCompletedAt | Optional activation event, distinct from signup intent |
| emailVerifiedAt | Set only from confirmation/provider evidence |
| marketingConsentAt and consentVersion | What wording they accepted and when |
| subscriptionStatus | pending, subscribed, unsubscribed or suppressed |
| source and appVersion | e.g. CLI setup; useful for activation/support |

Only add a separate schoolEmail field if there is a clear user-facing reason to retain it. Domain routing alone can be performed locally without storing the address centrally. Do not collect course lists, grades, browser cookies, bearer tokens, a date of birth, an OEN/student number or device identifiers for the contact list.

The endpoint should validate and allowlist fields, keep provider keys server-side, limit abuse, deduplicate contacts idempotently, respect existing unsubscribe/suppression status, and not trust a client-supplied verified/subscribed flag. A reinstall must not silently resubscribe someone. Count signup requests, confirmed subscribers and successful setups separately. If registration fails, report it and keep setup usable; retry only a previously consented registration. No public endpoint may list the contacts.

Use provider webhooks to reflect confirmations/unsubscribes. A simple confirmation link is recommended for contact ownership/list quality, not a condition for school portal access. The provider can be the initial source of truth instead of creating a second independent spreadsheet/contact database.

Source: [Brevo double-opt-in contact API](https://developers.brevo.com/reference/create-doi-contact). Provider choice is a proposal, not a pricing or delivery guarantee.

## Consent and school-age users

Explain both purposes plainly: using the domain to find a portal, and storing a contact address to send specified kinds of updates. Keep marketing opt-in separate and optional; include unsubscribe handling. Canadian CRTC guidance says commercial electronic messages generally require consent, sender identification and an unsubscribe mechanism; do not treat entering an address for school discovery as blanket permission for promotional mail. The precise legal obligations depend on the actual service and users.

K–12 use makes age-appropriate consent part of the product design. The Canadian privacy regulator generally expects parent/guardian consent for children under 13 and meaningful, maturity-appropriate consent for older youth; non-essential uses should be opt-in. Do not silently enable a child marketing list through the existing anonymous telemetry. Decide the age/guardian flow before launching K–12 contact collection, without collecting full birthdates merely to build an email list.

Sources: [CRTC CASL FAQ](https://crtc.gc.ca/eng/com500/faq500.htm), [OPC meaningful consent](https://www.priv.gc.ca/en/privacy-topics/privacy-for-businesses/appropriate-handling-of-personal-information/collecting-personal-information-and-consent/consent/gl_omc_201805/), [OPC Children's Privacy Code](https://www.priv.gc.ca/en/privacy-topics/privacy-for-businesses/protection-of-children-for-businesses/childrens-privacy-code/children-code-final-report-2026/).

## Proposed delivery sequence

1. Add and test a source-backed domain registry and email-to-school suggestions, preserving name/URL fallbacks. Keep the five unresolved student-domain entries out of automatic matching until there is stronger evidence; reconfirm dated patterns where possible.
2. Add the school-email prompt, editable school confirmation, contact-email choice and explicit updates opt-in. Preserve noninteractive and --no-login paths; do not prompt inside MCP tool calls.
3. Connect the signup endpoint to a chosen contact/email service, publish the privacy/consent wording and configure sender identity, confirmation and unsubscribe flows. Keep existing anonymous telemetry semantics unchanged.
4. Test duplicate setup, alternate contact email, unknown domains, staff/alumni addresses, stale board domains, email/school disagreement, declined consent, blocked school mail, registration failure and unsubscribe/reinstall behavior. Test with consenting adult accounts before enabling K–12 marketing collection.
