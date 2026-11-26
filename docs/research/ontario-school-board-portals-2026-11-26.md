# Ontario school-board Brightspace portals

Researched and checked November 26, 2026 (America/Toronto).

## Scope and verification

36 board presets: the 10 English public/Catholic boards in Toronto, Peel, York, Durham and Halton, plus Viamonde and MonAvenir, and 24 boards serving other major Ontario centres. This is a selected Ontario coverage list, not a list of every Ontario or Canadian board. French-language boards serve regions larger than individual cities; the GTA entries also serve communities elsewhere in southern Ontario.

For every row, D2L's public institution directory identified the student LMS host, an unauthenticated GET to the host's /d2l/api/versions/ endpoint confirmed le 1.57 and lp 1.43 support, and the /d2l/login URL returned HTTP 200 after redirects. These checks do not establish that student sign-in, token capture, grades or course tools work at that board. No student accounts or credentials were used.

The directory can also return professional-development instances and approximate name matches. Only the named board's student instance is included below. Login URLs start on the board's Brightspace host and let the board redirect to its current identity provider; transient Microsoft/Google/CFORP sign-in URLs are not stored.

## Presets

| Area | Preset ID | Board | Student login | D2L directory record | API check |
| --- | --- | --- | --- | --- | --- |
| Greater Toronto Area | tdsb | Toronto District School Board | [Login](https://tdsb.elearningontario.ca/d2l/login) | [Toronto DSB](https://lms-disco.api.brightspace.com/institutions?contains=Toronto) | [Compatible](https://tdsb.elearningontario.ca/d2l/api/versions/) |
| Greater Toronto Area | tcdsb | Toronto Catholic District School Board | [Login](https://tcdsb.elearningontario.ca/d2l/login) | [Toronto CDSB](https://lms-disco.api.brightspace.com/institutions?contains=Toronto) | [Compatible](https://tcdsb.elearningontario.ca/d2l/api/versions/) |
| Greater Toronto Area | pdsb | Peel District School Board | [Login](https://pdsb.elearningontario.ca/d2l/login) | [Peel DSB](https://lms-disco.api.brightspace.com/institutions?contains=Peel) | [Compatible](https://pdsb.elearningontario.ca/d2l/api/versions/) |
| Greater Toronto Area | dpcdsb | Dufferin-Peel Catholic District School Board | [Login](https://dpcdsb.elearningontario.ca/d2l/login) | [Dufferin-Peel CDSB](https://lms-disco.api.brightspace.com/institutions?contains=Dufferin) | [Compatible](https://dpcdsb.elearningontario.ca/d2l/api/versions/) |
| Greater Toronto Area | yrdsb | York Region District School Board | [Login](https://yrdsb.elearningontario.ca/d2l/login) | [York Region DSB](https://lms-disco.api.brightspace.com/institutions?contains=York) | [Compatible](https://yrdsb.elearningontario.ca/d2l/api/versions/) |
| Greater Toronto Area | ycdsb | York Catholic District School Board | [Login](https://ycdsb.elearningontario.ca/d2l/login) | [York CDSB](https://lms-disco.api.brightspace.com/institutions?contains=York) | [Compatible](https://ycdsb.elearningontario.ca/d2l/api/versions/) |
| Greater Toronto Area | ddsb | Durham District School Board | [Login](https://durham.elearningontario.ca/d2l/login) | [Durham DSB](https://lms-disco.api.brightspace.com/institutions?contains=Thames) | [Compatible](https://durham.elearningontario.ca/d2l/api/versions/) |
| Greater Toronto Area | dcdsb | Durham Catholic District School Board | [Login](https://durhamrc.elearningontario.ca/d2l/login) | [Durham CDSB](https://lms-disco.api.brightspace.com/institutions?contains=Durham) | [Compatible](https://durhamrc.elearningontario.ca/d2l/api/versions/) |
| Greater Toronto Area | hdsb | Halton District School Board | [Login](https://hdsb.elearningontario.ca/d2l/login) | [Halton DSB](https://lms-disco.api.brightspace.com/institutions?contains=Hamilton) | [Compatible](https://hdsb.elearningontario.ca/d2l/api/versions/) |
| Greater Toronto Area | hcdsb | Halton Catholic District School Board | [Login](https://hcdsb.elearningontario.ca/d2l/login) | [Halton Catholic District School Board](https://lms-disco.api.brightspace.com/institutions?contains=Hamilton) | [Compatible](https://hcdsb.elearningontario.ca/d2l/api/versions/) |
| Greater Toronto Area | viamonde | Conseil scolaire Viamonde | [Login](https://csv.apprentissageelectroniqueontario.ca/d2l/login) | [Conseil scolaire Viamonde](https://lms-disco.api.brightspace.com/institutions?contains=Viamonde) | [Compatible](https://csv.apprentissageelectroniqueontario.ca/d2l/api/versions/) |
| Greater Toronto Area | monavenir | Conseil scolaire catholique MonAvenir | [Login](https://cscmonavenir.apprentissageelectroniqueontario.ca/d2l/login) | [Conseil scolaire catholique MonAvenir](https://lms-disco.api.brightspace.com/institutions?contains=MonAvenir) | [Compatible](https://cscmonavenir.apprentissageelectroniqueontario.ca/d2l/api/versions/) |
| Hamilton | hwdsb | Hamilton-Wentworth District School Board | [Login](https://hwdsb.elearningontario.ca/d2l/login) | [Hamilton-Wentworth District School Board](https://lms-disco.api.brightspace.com/institutions?contains=Hamilton) | [Compatible](https://hwdsb.elearningontario.ca/d2l/api/versions/) |
| Hamilton | hwcdsb | Hamilton-Wentworth Catholic District School Board | [Login](https://hwcdsb.elearningontario.ca/d2l/login) | [Hamilton-Wentworth CDSB](https://lms-disco.api.brightspace.com/institutions?contains=Hamilton) | [Compatible](https://hwcdsb.elearningontario.ca/d2l/api/versions/) |
| Ottawa | ocdsb | Ottawa-Carleton District School Board | [Login](https://ocdsb.elearningontario.ca/d2l/login) | [Ottawa-Carleton DSB](https://lms-disco.api.brightspace.com/institutions?contains=Ottawa) | [Compatible](https://ocdsb.elearningontario.ca/d2l/api/versions/) |
| Ottawa | ocsb | Ottawa Catholic School Board | [Login](https://ocsb.elearningontario.ca/d2l/login) | [Ottawa Catholic School Board](https://lms-disco.api.brightspace.com/institutions?contains=Ottawa) | [Compatible](https://ocsb.elearningontario.ca/d2l/api/versions/) |
| Ottawa | cepeo | Conseil des écoles publiques de l'Est de l'Ontario | [Login](https://cepeo.apprentissageelectroniqueontario.ca/d2l/login) | [Conseil des écoles publiques de l'Est de l'Ontario](https://lms-disco.api.brightspace.com/institutions?contains=CEPEO) | [Compatible](https://cepeo.apprentissageelectroniqueontario.ca/d2l/api/versions/) |
| Ottawa | cecce | Conseil des écoles catholiques du Centre-Est | [Login](https://cecce.apprentissageelectroniqueontario.ca/d2l/login) | [Conseil des écoles catholiques du centre-Est de l'Ontario](https://lms-disco.api.brightspace.com/institutions?contains=CECCE) | [Compatible](https://cecce.apprentissageelectroniqueontario.ca/d2l/api/versions/) |
| Kitchener–Waterloo / Cambridge | wrdsb | Waterloo Region District School Board | [Login](https://wrdsb.elearningontario.ca/d2l/login) | [Waterloo Region DSB](https://lms-disco.api.brightspace.com/institutions?contains=Waterloo) | [Compatible](https://wrdsb.elearningontario.ca/d2l/api/versions/) |
| Kitchener–Waterloo / Cambridge | wcdsb | Waterloo Catholic District School Board | [Login](https://wcdsb.elearningontario.ca/d2l/login) | [Waterloo CDSB](https://lms-disco.api.brightspace.com/institutions?contains=Waterloo) | [Compatible](https://wcdsb.elearningontario.ca/d2l/api/versions/) |
| London / Thames Valley | tvdsb | Thames Valley District School Board | [Login](https://tvdsb.elearningontario.ca/d2l/login) | [Thames Valley DSB](https://lms-disco.api.brightspace.com/institutions?contains=Thames) | [Compatible](https://tvdsb.elearningontario.ca/d2l/api/versions/) |
| London / Thames Valley | ldcsb | London District Catholic School Board | [Login](https://ldcsb.elearningontario.ca/d2l/login) | [London District Catholic School Board](https://lms-disco.api.brightspace.com/institutions?contains=London) | [Compatible](https://ldcsb.elearningontario.ca/d2l/api/versions/) |
| Windsor / Essex | gecdsb | Greater Essex County District School Board | [Login](https://gecdsb.elearningontario.ca/d2l/login) | [Greater Essex County DSB](https://lms-disco.api.brightspace.com/institutions?contains=Essex) | [Compatible](https://gecdsb.elearningontario.ca/d2l/api/versions/) |
| Windsor / Essex | wecdsb | Windsor-Essex Catholic District School Board | [Login](https://wecdsb.elearningontario.ca/d2l/login) | [Windsor-Essex CDSB](https://lms-disco.api.brightspace.com/institutions?contains=Windsor) | [Compatible](https://wecdsb.elearningontario.ca/d2l/api/versions/) |
| Niagara / St. Catharines | dsbn | District School Board of Niagara | [Login](https://dsbn.elearningontario.ca/d2l/login) | [DSB of Niagara](https://lms-disco.api.brightspace.com/institutions?contains=Niagara) | [Compatible](https://dsbn.elearningontario.ca/d2l/api/versions/) |
| Niagara / St. Catharines | ncdsb | Niagara Catholic District School Board | [Login](https://niagaracatholic.elearningontario.ca/d2l/login) | [Niagara CDSB](https://lms-disco.api.brightspace.com/institutions?contains=Niagara) | [Compatible](https://niagaracatholic.elearningontario.ca/d2l/api/versions/) |
| Barrie / Simcoe / Muskoka | scdsb | Simcoe County District School Board | [Login](https://scdsb.elearningontario.ca/d2l/login) | [Simcoe County DSB](https://lms-disco.api.brightspace.com/institutions?contains=Simcoe) | [Compatible](https://scdsb.elearningontario.ca/d2l/api/versions/) |
| Barrie / Simcoe / Muskoka | smcdsb | Simcoe Muskoka Catholic District School Board | [Login](https://smcdsb.elearningontario.ca/d2l/login) | [Simcoe Muskoka CDSB](https://lms-disco.api.brightspace.com/institutions?contains=Simcoe) | [Compatible](https://smcdsb.elearningontario.ca/d2l/api/versions/) |
| Kingston / surrounding area | ldsb | Limestone District School Board | [Login](https://ldsb.elearningontario.ca/d2l/login) | [Limestone DSB](https://lms-disco.api.brightspace.com/institutions?contains=Limestone) | [Compatible](https://ldsb.elearningontario.ca/d2l/api/versions/) |
| Kingston / surrounding area | alcdsb | Algonquin and Lakeshore Catholic District School Board | [Login](https://alcdsb.elearningontario.ca/d2l/login) | [Algonquin and Lakeshore CDSB](https://lms-disco.api.brightspace.com/institutions?contains=Algonquin) | [Compatible](https://alcdsb.elearningontario.ca/d2l/api/versions/) |
| Guelph / Wellington | ugdsb | Upper Grand District School Board | [Login](https://ugdsb.elearningontario.ca/d2l/login) | [Upper Grand DSB](https://lms-disco.api.brightspace.com/institutions?contains=Upper+Grand) | [Compatible](https://ugdsb.elearningontario.ca/d2l/api/versions/) |
| Guelph / Wellington | welcdsb | Wellington Catholic District School Board | [Login](https://welcdsb.elearningontario.ca/d2l/login) | [Wellington CDSB](https://lms-disco.api.brightspace.com/institutions?contains=Wellington) | [Compatible](https://welcdsb.elearningontario.ca/d2l/api/versions/) |
| Thunder Bay | lakehead-dsb | Lakehead District School Board | [Login](https://lhbe.elearningontario.ca/d2l/login) | [Lakehead DSB](https://lms-disco.api.brightspace.com/institutions?contains=Lakehead) | [Compatible](https://lhbe.elearningontario.ca/d2l/api/versions/) |
| Thunder Bay | tbcdsb | Thunder Bay Catholic District School Board | [Login](https://tbcdsb.elearningontario.ca/d2l/login) | [Thunder Bay CDSB](https://lms-disco.api.brightspace.com/institutions?contains=Thunder+Bay) | [Compatible](https://tbcdsb.elearningontario.ca/d2l/api/versions/) |
| Sudbury | rainbow | Rainbow District School Board | [Login](https://rdsb.elearningontario.ca/d2l/login) | [Rainbow District School Board](https://lms-disco.api.brightspace.com/institutions?contains=Rainbow) | [Compatible](https://rdsb.elearningontario.ca/d2l/api/versions/) |
| Sudbury | sudbury-cdsb | Sudbury Catholic District School Board | [Login](https://srcdsb.elearningontario.ca/d2l/login) | [Sudbury CDSB](https://lms-disco.api.brightspace.com/institutions?contains=Sudbury) | [Compatible](https://srcdsb.elearningontario.ca/d2l/api/versions/) |

## Board-published cross-checks

These official board resources independently confirm selected GTA routes and explain student login:

- [TDSB virtual-school access](https://schoolweb.tdsb.on.ca/bala/Virtual-School): tdsb.elearningontario.ca and the staff/student login option.
- [TCDSB continuing-education program](https://assets.tcdsb.org/continuingeducation/6003433/2025-26_Fall_NS_Program_v4%282%29.pdf): tcdsb.elearningontario.ca.
- [Dufferin-Peel eLearning](https://www.dpcdsb.org/programs-services/elearning): dpcdsb.elearningontario.ca and board network credentials.
- [YRDSB Brightspace/D2L instructions](https://www2.yrdsb.ca/student-tools-and-resources/brightspaced2l): yrdsb.elearningontario.ca/d2l/login.
- [York Catholic eLearning registration](https://www.ycdsb.ca/wp-content/uploads/elearning-Registration-process.pdf): ycdsb.elearningontario.ca.
- [Durham Continuing Education login instructions](https://www.dce.ca/en/programs/resources/eLearning/D2L-Login-Instructions.pdf): durham.elearningontario.ca. Older document; use the current board sign-in flow.
- [Durham Catholic continuing education](https://www.con-ed.ca/secondary-programs/secondary-summer-school-programs/reach-ahead-program/): durhamrc.elearningontario.ca.
- [Halton Brightspace](https://www.hdsb.ca/academics-resources/secondary-programs-pathways-tools/brightspace/): board-provided student Brightspace link.
- [Halton Catholic course login](https://merton.hcdsb.org/wp-content/uploads/2023/09/Welcome-Letter-Module-1.pdf): hcdsb.elearningontario.ca.

## Routing choices

Preset IDs, full names and explicit aliases resolve locally without directory access. Broad city/region names such as Toronto, York and Peel are not aliases for one board. University IDs such as waterloo and lakehead retain their existing meanings; wrdsb/wcdsb and lakehead-dsb select the boards. Wellington uses welcdsb, and Sudbury Catholic uses sudbury-cdsb to avoid collisions with Waterloo Catholic and Simcoe County.

For unlisted boards, name discovery still uses the [D2L Login Finder directory](https://login-finder.d2l.com/), with a choice on ambiguous matches and a pasted-URL fallback. Supporting a board's Brightspace portal does not add support for its Google Classroom, Edsby, PowerSchool or other systems, or guarantee every course uses Brightspace.
