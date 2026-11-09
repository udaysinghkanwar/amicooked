import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { extractContent } from "../../src/extract.js";

/** A one-page PDF that says `text` (pdf.js tolerates the missing xref offsets). */
function tinyPdf(text: string): Buffer {
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  return Buffer.from(
    [
      "%PDF-1.4",
      "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
      "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
      "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
      `4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`,
      "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
      "trailer << /Root 1 0 R >>",
      "%%EOF",
    ].join("\n")
  );
}

describe("extractContent", () => {
  it("returns text files as-is", async () => {
    expect(await extractContent(Buffer.from("hello"), ".MD")).toBe("hello");
  });

  it("reads PDF text page by page", async () => {
    const text = await extractContent(tinyPdf("Midterm covers weeks 1 to 6"), ".pdf");
    expect(text).toContain("--- Page 1 ---");
    expect(text).toContain("Midterm covers weeks 1 to 6");
  });

  it("reads PowerPoint slides in order with speaker notes", async () => {
    const zip = new JSZip();
    const slide = (body: string) => `<p:sld><a:p><a:t>${body}</a:t></a:p><a:p><a:t>7</a:t></a:p></p:sld>`;
    zip.file("ppt/slides/slide10.xml", slide("Ten"));
    zip.file("ppt/slides/slide2.xml", slide("Two &amp; more"));
    zip.file("ppt/notesSlides/notesSlide2.xml", slide("Say this"));
    const text = await extractContent(await zip.generateAsync({ type: "nodebuffer" }), ".pptx");
    expect(text).toBe("--- Slide 2 ---\nTwo & more\n[Notes] Say this\n\n--- Slide 10 ---\nTen");
  });

  it("returns null for unreadable formats", async () => {
    expect(await extractContent(Buffer.from([0x89, 0x50]), ".png")).toBeNull();
    expect(await extractContent(Buffer.from("not a pdf"), ".pdf")).toBeNull();
  });
});
