import { DOMParser } from "@xmldom/xmldom";

// Slide SVGs an AI writes through MCP (#21). Each one is parsed, checked against element and attribute allowlists,
// and rewritten from the checked tree, so the rasterizer only ever sees shapes, text, gradients and filters that
// point at their own #ids or embedded images. No styles, scripts, other namespaces or base-URL changes survive.

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

const ELEMENTS = new Set([
  "svg", "g", "defs", "title", "desc", "symbol", "use", "image",
  "rect", "circle", "ellipse", "line", "polyline", "polygon", "path", "text", "tspan", "textPath",
  "linearGradient", "radialGradient", "stop", "pattern", "clipPath", "mask", "marker",
  "filter", "feBlend", "feColorMatrix", "feComponentTransfer", "feComposite", "feConvolveMatrix",
  "feDiffuseLighting", "feDisplacementMap", "feDistantLight", "feDropShadow", "feFlood", "feFuncA", "feFuncB",
  "feFuncG", "feFuncR", "feGaussianBlur", "feMerge", "feMergeNode", "feMorphology", "feOffset", "fePointLight",
  "feSpecularLighting", "feSpotLight", "feTile", "feTurbulence",
]);

const ATTRIBUTES = new Set(`
  id href version viewBox preserveAspectRatio transform x y x1 y1 x2 y2 cx cy r rx ry fx fy fr width height d points
  pathLength dx dy rotate textLength lengthAdjust startOffset method spacing side
  fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-dasharray
  stroke-dashoffset stroke-miterlimit opacity visibility display overflow color paint-order vector-effect
  font-family font-size font-weight font-style font-variant text-anchor dominant-baseline alignment-baseline
  baseline-shift letter-spacing word-spacing text-decoration writing-mode
  offset stop-color stop-opacity gradientUnits gradientTransform spreadMethod
  patternUnits patternContentUnits patternTransform clipPathUnits clip-path clip-rule
  mask maskUnits maskContentUnits marker-start marker-mid marker-end markerWidth markerHeight markerUnits refX refY orient
  filter filterUnits primitiveUnits in in2 result stdDeviation mode operator k1 k2 k3 k4 values type tableValues slope
  intercept amplitude exponent flood-color flood-opacity lighting-color baseFrequency numOctaves seed stitchTiles scale
  xChannelSelector yChannelSelector radius azimuth elevation surfaceScale diffuseConstant specularConstant
  specularExponent kernelMatrix kernelUnitLength order divisor bias targetX targetY edgeMode preserveAlpha
  pointsAtX pointsAtY pointsAtZ limitingConeAngle z color-interpolation-filters
`.trim().split(/\s+/));

const EMBEDDED = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]*$/;
export const SVG_LIMITS = { elements: 5000, depth: 40 };

// Node types from the DOM spec
const ELEMENT = 1, TEXT = 3, CDATA = 4, COMMENT = 8;

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Checked = { markup: string; problem?: undefined } | { problem: string; markup?: undefined };

/** Checks an SVG and returns markup rebuilt from only the allowed parts, or why it isn't allowed. */
export function sanitizeSvg(content: string): Checked {
  const fail = (problem: string): Checked => ({ problem });
  if (/<!DOCTYPE|<!ENTITY/i.test(content)) return fail("SVG files can't declare a DOCTYPE or ENTITY.");
  const issues: string[] = [];
  const report = (message: string) => { issues.push(message); };
  const doc = new DOMParser({ errorHandler: { warning: report, error: report, fatalError: report } })
    .parseFromString(content, "image/svg+xml");
  const root = doc?.documentElement;
  if (issues.length || !root || root.localName !== "svg") return fail("That isn't a well-formed SVG file.");
  for (let node = doc.firstChild; node; node = node.nextSibling) {
    if (node !== root && ![COMMENT, TEXT].includes(node.nodeType) && node.nodeName !== "xml") return fail("SVG files can't include processing instructions.");
  }

  // First pass: structure, names and ids
  const ids = new Set<string>();
  let count = 0;
  const walk = (element: Element, depth: number): string | null => {
    if (depth > SVG_LIMITS.depth) return `SVG files can nest up to ${SVG_LIMITS.depth} levels.`;
    if (++count > SVG_LIMITS.elements) return `SVG files can hold up to ${SVG_LIMITS.elements} elements.`;
    if (element.namespaceURI && element.namespaceURI !== SVG_NS) return "SVG files can only use SVG elements.";
    if (!ELEMENTS.has(element.localName)) return `SVG slides can't use <${element.localName}>.`;
    const id = element.getAttribute("id");
    if (id) ids.add(id);
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === ELEMENT) {
        const problem = walk(child as Element, depth + 1);
        if (problem) return problem;
      } else if (![TEXT, CDATA, COMMENT].includes(child.nodeType)) return "SVG files can only hold elements and text.";
    }
    return null;
  };
  const structure = walk(root, 0);
  if (structure) return fail(structure);

  // Second pass: attributes, then rebuild the markup from what passed
  const build = (element: Element): string | { problem: string } => {
    const attributes: string[] = element === root ? [`xmlns="${SVG_NS}"`] : [];
    for (let i = 0; i < element.attributes.length; i++) {
      const attribute = element.attributes[i];
      const { name, localName, namespaceURI, value } = attribute;
      if (name === "xmlns" || name.startsWith("xmlns:")) {
        if (value !== SVG_NS && value !== XLINK_NS) return { problem: "SVG files can only declare the SVG and XLink namespaces." };
        continue;
      }
      const xlinkHref = namespaceURI === XLINK_NS && localName === "href";
      if ((namespaceURI && !xlinkHref) || !ATTRIBUTES.has(localName)) {
        return { problem: `SVG slides can't use the ${name} attribute.` };
      }
      if (localName === "href") {
        const target = value.trim();
        if (target.startsWith("#") ? !ids.has(target.slice(1)) : !EMBEDDED.test(target)) {
          return { problem: `SVG files can only link to their own #ids or embedded data:image values, not "${target.slice(0, 60)}".` };
        }
      } else {
        if (value.includes("\\")) return { problem: "SVG attributes can't use escapes." };
        for (const [, ref] of value.matchAll(/url\(\s*['"]?([^'")\s]*)/gi)) {
          if (!ref.startsWith("#") || !ids.has(ref.slice(1))) return { problem: "SVG attributes can only use url(#id) for an id in the same file." };
        }
      }
      attributes.push(`${localName}="${escape(value)}"`);
    }
    let children = "";
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === ELEMENT) {
        const built = build(child as Element);
        if (typeof built !== "string") return built;
        children += built;
      } else if (child.nodeType === TEXT || child.nodeType === CDATA) children += escape(child.nodeValue ?? "");
    }
    const open = [element.localName, ...attributes].join(" ");
    return children ? `<${open}>${children}</${element.localName}>` : `<${open}/>`;
  };
  const markup = build(root);
  return typeof markup === "string" ? { markup: markup + "\n" } : fail(markup.problem);
}

/** Why this SVG isn't allowed, or null when it's safe to render. */
export const svgProblem = (content: string): string | null => sanitizeSvg(content).problem ?? null;
