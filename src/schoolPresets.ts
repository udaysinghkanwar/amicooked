import type { School } from "./config.js";

/** Canadian Brightspace universities plus two school boards; every other school is found by name or URL.
 * API checks are not proof of a successful student login.
 * Board portal sources and verification: docs/research/ontario-school-board-portals-2026-11-26.md.
 */
export const PRESETS: Array<School & { aliases?: string[] }> = [
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
  { id: "mcgill", name: "McGill University", lmsName: "myCourses", host: "mycourses2.mcgill.ca" },
  { id: "ucalgary", name: "University of Calgary", aliases: ["Calgary", "UCalgary", "U of C"], lmsName: "D2L Brightspace", host: "d2l.ucalgary.ca" },

  // School boards on the provincial Brightspace. Other boards are found through "Somewhere else".
  { id: "tdsb", name: "Toronto District School Board", aliases: ["Toronto DSB"], lmsName: "Brightspace", host: "tdsb.elearningontario.ca", loginUrl: "https://tdsb.elearningontario.ca/d2l/login" },
  { id: "pdsb", name: "Peel District School Board", aliases: ["Peel DSB"], lmsName: "Brightspace", host: "pdsb.elearningontario.ca", loginUrl: "https://pdsb.elearningontario.ca/d2l/login" },
];
