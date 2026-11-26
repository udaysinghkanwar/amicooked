import { DOMParser } from "@xmldom/xmldom";

// Slide SVGs an AI writes through MCP (#21). They're parsed and checked against an allowlist, so the rasterizer
// only ever sees shapes, text, gradients and filters that point at their own #ids or embedded images.

const ELEMENTS = new Set([
  "svg", "g", "defs", "title", "desc", "metadata", "symbol", "use", "image", "switch",
  "rect", "circle", "ellipse", "line", "polyline", "polygon", "path", "text", "tspan", "textPath",
  "linearGradient", "radialGradient", "stop", "pattern", "clipPath", "mask", "marker", "style",
  "filter", "feBlend", "feColorMatrix", "feComponentTransfer", "feComposite", "feConvolveMatrix",
  "feDiffuseLighting", "feDisplacementMap", "feDistantLight", "feDropShadow", "feFlood", "feFuncA", "feFuncB",
  "feFuncG", "feFuncR", "feGaussianBlur", "feMerge", "feMergeNode", "feMorphology", "feOffset", "fePointLight",
  "feSpecularLighting", "feSpotLight", "feTile", "feTurbulence",
]);
const EMBEDDED = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]*$/;
export const SVG_LIMITS = { elements: 5000, depth: 40 };

// Node types from the DOM spec
const ELEMENT = 1, TEXT = 3, CDATA = 4, COMMENT = 8;

/** Only url(#id) references, with no CSS escapes or imports that could hide another kind. */
function cssProblem(css: string, ids: Set<string>): string | null {
  if (css.includes("\\")) return "SVG styles can't use CSS escapes.";
  if (/@import/i.test(css)) return "SVG styles can't @import other files.";
  for (const [, ref] of css.matchAll(/url\(\s*['"]?([^'")\s]*)/gi)) {
    if (!ref.startsWith("#") || !ids.has(ref.slice(1))) return "SVG styles can only use url(#id) for an id in the same file.";
  }
  return null;
}

/** Why this SVG isn't allowed, or null when it's safe to render. */
export function svgProblem(content: string): string | null {
  if (/<!DOCTYPE|<!ENTITY/i.test(content)) return "SVG files can't declare a DOCTYPE or ENTITY.";
  const issues: string[] = [];
  const report = (message: string) => { issues.push(message); };
  const doc = new DOMParser({ errorHandler: { warning: report, error: report, fatalError: report } })
    .parseFromString(content, "image/svg+xml");
  const root = doc?.documentElement;
  if (issues.length || !root || root.localName !== "svg") return "That isn't a well-formed SVG file.";

  const ids = new Set<string>();
  const elements: Element[] = [];
  let tooDeep = false;
  const collect = (node: Element, depth: number) => {
    if (depth > SVG_LIMITS.depth) { tooDeep = true; return; }
    elements.push(node);
    const id = node.getAttribute("id");
    if (id) ids.add(id);
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === ELEMENT) collect(child as Element, depth + 1);
      else if (![TEXT, CDATA, COMMENT].includes(child.nodeType)) return void (tooDeep = true);
    }
  };
  for (let node = doc.firstChild; node; node = node.nextSibling) {
    if (node !== root && ![COMMENT, TEXT].includes(node.nodeType) && node.nodeName !== "xml") return "SVG files can't include processing instructions.";
  }
  collect(root, 0);
  if (tooDeep) return `SVG files can nest up to ${SVG_LIMITS.depth} levels and only hold elements and text.`;
  if (elements.length > SVG_LIMITS.elements) return `SVG files can hold up to ${SVG_LIMITS.elements} elements.`;

  for (const element of elements) {
    if (!ELEMENTS.has(element.localName)) return `SVG slides can't use <${element.localName}>.`;
    if (element.localName === "style") {
      const problem = cssProblem(element.textContent ?? "", ids);
      if (problem) return problem;
    }
    for (let i = 0; i < element.attributes.length; i++) {
      const { localName, value } = element.attributes[i];
      if (/^on/i.test(localName)) return "SVG files can't include event handlers.";
      if (localName === "href" || localName === "src") {
        const target = value.trim();
        if (target.startsWith("#") ? !ids.has(target.slice(1)) : !EMBEDDED.test(target)) {
          return `SVG files can only link to their own #ids or embedded data:image values, not "${target.slice(0, 60)}".`;
        }
      } else {
        const problem = cssProblem(value, ids);
        if (problem) return problem;
      }
    }
  }
  return null;
}
