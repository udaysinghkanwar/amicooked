import { petriMarkings, type Visual } from "./schema.js";

export type CueTiming = {
  id: string;
  start: number;
  end: number;
  text: string;
};
export const escape = (s: string | number) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const colors = ["#3159dc", "#087c69", "#ad5222"];
const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

/** Pure HTML/SVG generation; spec strings never become executable JavaScript. */
export function drawVisual(v: Visual, sceneId: string, cues: CueTiming[]) {
  const markup: string[] = [],
    animations: string[] = [];
  const at = (cue: string) => cues.find((c) => c.id === cue)!.start;
  const reveal = (id: string, time: number) =>
    animations.push(
      `tl.fromTo(${json(`#${id}`)},{opacity:0},{opacity:1,duration:.3},${time});`,
    );
  const note = (value: string, id: string, time: number, end?: number) => {
    markup.push(
      `<div id="${id}" class="visual-note" style="opacity:0">${escape(value)}</div>`,
    );
    reveal(id, time);
    if (end !== undefined)
      animations.push(
        `tl.to(${json(`#${id}`)},{opacity:0,duration:.1},${end});`,
      );
  };
  if (v.type === "equations" || v.type === "cards") {
    const rows = v.steps.map((s, i) => {
      const id = `${sceneId}-row-${i}`;
      reveal(id, at(s.cue));
      return v.type === "equations"
        ? `<section id="${id}" class="equation-row" style="opacity:0"><div class="math" data-math="${escape(v.steps[i].tex)}"></div><p>${escape(v.steps[i].note)}</p></section>`
        : `<section id="${id}" class="idea-row" style="opacity:0"><h2>${escape(v.steps[i].title)}</h2><p>${escape(v.steps[i].body)}</p></section>`;
    });
    markup.push(`<div class="rows">${rows.join("")}</div>`);
  } else if (v.type === "code") {
    markup.push(
      `<div class="code-panel">${v.lines.map((line, i) => `<div id="${sceneId}-line-${i + 1}" class="code-line"><span class="line-number">${i + 1}</span><code>${escape(line)}</code></div>`).join("")}</div>`,
    );
    v.steps.forEach((s, i) => {
      const start = at(s.cue),
        end = v.steps[i + 1] ? at(v.steps[i + 1].cue) : undefined;
      animations.push(
        `tl.to('#${sceneId}-line-${s.line}',{backgroundColor:'#dce6ff',color:'#173d9f',duration:.2},${start});`,
      );
      if (end !== undefined)
        animations.push(
          `tl.to('#${sceneId}-line-${s.line}',{backgroundColor:'#f3f6fc',color:'#18273c',duration:.15},${end});`,
        );
      note(s.note, `${sceneId}-note-${i}`, start, end);
    });
  } else if (v.type === "plot") {
    const points = v.series.flatMap((s) => s.points);
    const minX = Math.min(0, ...points.map((p) => p[0])),
      maxX = Math.max(1, ...points.map((p) => p[0]));
    const minY = Math.min(0, ...points.map((p) => p[1])),
      maxY = Math.max(1, ...points.map((p) => p[1]));
    const x = (n: number) => 140 + ((n - minX) / (maxX - minX)) * 1280;
    const y = (n: number) => 385 - ((n - minY) / (maxY - minY)) * 310;
    let svg = `<text x="140" y="35" font-size="30">${escape(v.yLabel)}</text><text x="780" y="465" text-anchor="middle" font-size="30">${escape(v.xLabel)}</text>`;
    for (let i = 0; i <= 4; i++) {
      const xx = minX + ((maxX - minX) * i) / 4,
        yy = minY + ((maxY - minY) * i) / 4;
      svg += `<path d="M140 ${y(yy)} H1420" stroke="#d9e1ef"/><text x="120" y="${y(yy) + 10}" text-anchor="end" font-size="28">${Number(yy.toFixed(1))}</text><text x="${x(xx)}" y="430" text-anchor="middle" font-size="28">${Number(xx.toFixed(1))}</text>`;
    }
    svg +=
      '<path d="M140 65 V385 H1430" fill="none" stroke="#60728b" stroke-width="3"/>';
    v.series.forEach((s, i) => {
      const id = `${sceneId}-series-${i}`;
      const d = s.points
        .map((p, j) => `${j ? "L" : "M"}${x(p[0])},${y(p[1])}`)
        .join(" ");
      const length = s.points
        .slice(1)
        .reduce(
          (n, p, j) =>
            n +
            Math.hypot(
              x(p[0]) - x(s.points[j][0]),
              y(p[1]) - y(s.points[j][1]),
            ),
          0,
        );
      svg += `<path id="${id}" d="${d}" fill="none" stroke="${colors[i]}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${length}" stroke-dashoffset="${length}"/><text id="${id}-label" x="${790 + i * 230}" y="35" fill="${colors[i]}" font-size="28" opacity="0">${escape(s.name)}</text>`;
      animations.push(
        `tl.fromTo('#${id}',{strokeDashoffset:${length}},{strokeDashoffset:0,duration:1.2,ease:'power2.out'},${at(s.cue)});`,
      );
      reveal(`${id}-label`, at(s.cue));
    });
    markup.push(
      `<svg class="diagram" viewBox="0 0 1600 480" aria-label="${escape(v.yLabel)} against ${escape(v.xLabel)}">${svg}</svg>`,
    );
  } else {
    const nodes =
      v.type === "graph" ? v.nodes : [...v.places, ...v.transitions];
    const point = (id: string) => {
      const n = nodes.find((n) => n.id === id)!;
      return { x: n.x * 15.5, y: n.y * 4.8 };
    };
    const edges = v.type === "graph" ? v.edges : v.arcs;
    let svg = `<defs><marker id="${sceneId}-arrow" markerUnits="userSpaceOnUse" markerWidth="18" markerHeight="18" refX="16" refY="8" orient="auto"><path d="M0 0 L16 8 L0 16" fill="#60728b"/></marker></defs>`;
    edges.forEach((e, i) => {
      const a = point(e.from),
        b = point(e.to),
        dx = b.x - a.x,
        dy = b.y - a.y,
        length = Math.hypot(dx, dy);
      const reciprocal = edges.some(
        (other) => other.from === e.to && other.to === e.from,
      );
      const bend = reciprocal ? 65 : 0;
      const mx = (a.x + b.x) / 2 - (length ? (dy / length) * bend : 0),
        my = (a.y + b.y) / 2 + (length ? (dx / length) * bend : 0);
      const d = length
        ? `M${a.x + (dx / length) * 45},${a.y + (dy / length) * 45} Q${mx},${my} ${b.x - (dx / length) * 52},${b.y - (dy / length) * 52}`
        : `M${a.x + 28},${a.y - 30} C${a.x + 125},${a.y - 145} ${a.x - 125},${a.y - 145} ${a.x - 28},${a.y - 35}`;
      svg += `<path id="${sceneId}-edge-${i}" d="${d}" fill="none" stroke="#60728b" stroke-width="4" marker-end="url(#${sceneId}-arrow)"/>`;
      if ("label" in e && typeof e.label === "string" && e.label)
        svg += `<text x="${mx}" y="${my - 24}" text-anchor="middle" font-size="30" class="edge-label">${escape(e.label)}</text>`;
    });
    nodes.forEach((n) => {
      const p = point(n.id),
        isPlace =
          v.type === "graph" || v.places.some((place) => place.id === n.id);
      svg += isPlace
        ? `<circle id="${sceneId}-node-${n.id}" cx="${p.x}" cy="${p.y}" r="45" fill="white" stroke="#3159dc" stroke-width="4"/>`
        : `<rect id="${sceneId}-node-${n.id}" x="${p.x - 18}" y="${p.y - 46}" width="36" height="92" rx="5" fill="#3159dc"/>`;
      svg += `<text x="${p.x}" y="${v.type === "graph" ? p.y + 12 : p.y + 90}" text-anchor="middle" font-size="34" fill="#18273c">${escape(n.label)}</text>`;
    });
    if (v.type === "graph") {
      v.steps.forEach((s, i) => {
        const start = at(s.cue),
          end = v.steps[i + 1] ? at(v.steps[i + 1].cue) : undefined;
        animations.push(
          `tl.to('#${sceneId}-node-${s.node}',{fill:'#beddd4',stroke:'#087c69',duration:.25},${start});`,
        );
        if (s.edge) {
          const index = v.edges.findIndex((e) => e.id === s.edge);
          animations.push(
            `tl.to('#${sceneId}-edge-${index}',{stroke:'#087c69',strokeWidth:9,duration:.35},${start});`,
          );
        }
        note(s.note, `${sceneId}-note-${i}`, start, end);
      });
    } else {
      // A transition may fire repeatedly. Give seek-back a stable starting color.
      for (const transition of v.transitions)
        animations.push(
          `tl.set('#${sceneId}-node-${transition.id}',{fill:'#3159dc'},0);`,
        );
      petriMarkings(v).forEach((marking, i) => {
        const id = `${sceneId}-mark-${i}`;
        svg += `<g id="${id}" opacity="${i === 0 ? 1 : 0}">`;
        v.places.forEach((p) => {
          const pos = point(p.id),
            count = marking[p.id];
          for (let k = 0; k < count; k++)
            svg += `<circle cx="${pos.x + (k - (count - 1) / 2) * 13}" cy="${pos.y}" r="7" fill="#087c69"/>`;
        });
        svg += "</g>";
        if (i > 0) {
          const step = v.steps[i - 1],
            t = at(step.cue);
          animations.push(
            `tl.to('#${sceneId}-mark-${i - 1}',{opacity:0,duration:.15},${t + 0.25});`,
          );
          reveal(id, t + 0.4);
          animations.push(
            `tl.fromTo('#${sceneId}-node-${step.fire}',{fill:'#3159dc'},{fill:'#ad5222',duration:.25,repeat:1,yoyo:true},${t});`,
          );
          note(
            step.note,
            `${sceneId}-note-${i}`,
            t,
            v.steps[i] ? at(v.steps[i].cue) : undefined,
          );
        }
      });
    }
    markup.unshift(
      `<svg class="diagram" viewBox="0 0 1600 480" aria-label="${v.type === "petri" ? "Petri net with computed markings" : "Directed graph with execution trace"}">${svg}</svg>`,
    );
  }
  return { html: markup.join("\n"), js: animations.join("\n") };
}
