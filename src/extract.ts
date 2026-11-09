import JSZip from "jszip";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".csv", ".json", ".xml", ".html", ".htm", ".css",
  ".js", ".ts", ".py", ".java", ".c", ".cpp", ".h", ".tex", ".sql",
]);

const decodeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Text of a PowerPoint XML part: <a:t> runs, one line per <a:p> paragraph, minus slide-number placeholders. */
function slideXmlText(xml: string): string {
  return xml
    .split(/<\/a:p>/)
    .map((para) => decodeXml([...para.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => m[1]).join("")).trim())
    .filter((line) => line && !/^\d+$/.test(line))
    .join("\n");
}

async function pptxText(data: Buffer): Promise<string | null> {
  const zip = await JSZip.loadAsync(data);
  const slideNumber = (name: string) => Number(name.match(/(\d+)\.xml$/)?.[1] ?? 0);
  const slides = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  const parts: string[] = [];
  for (const name of slides) {
    const n = slideNumber(name);
    let text = slideXmlText(await zip.file(name)!.async("string"));
    const notes = zip.file(`ppt/notesSlides/notesSlide${n}.xml`);
    if (notes) {
      const notesText = slideXmlText(await notes.async("string"));
      if (notesText) text += `\n[Notes] ${notesText}`;
    }
    parts.push(`--- Slide ${n} ---\n${text || "(no text, likely a diagram or image)"}`);
  }
  return parts.length ? parts.join("\n\n") : null;
}

async function pdfText(data: Buffer): Promise<string | null> {
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = (text as string[]).map((page, i) => `--- Page ${i + 1} ---\n${page.trim()}`);
  return pages.length ? pages.join("\n\n") : null;
}

/** Plain text from a course file, or null for formats we can't read (images, old .doc, ...). */
export async function extractContent(data: Buffer, ext: string): Promise<string | null> {
  const lower = ext.toLowerCase();
  try {
    if (TEXT_EXTENSIONS.has(lower)) return data.toString("utf-8");
    if (lower === ".docx") return (await mammoth.extractRawText({ buffer: data })).value.trim() || null;
    if (lower === ".pptx" || lower === ".ppsx") return await pptxText(data);
    if (lower === ".pdf") return await pdfText(data);
  } catch (error) {
    console.error(`[extract] couldn't read ${lower} file: ${error instanceof Error ? error.message : error}`);
  }
  return null;
}
