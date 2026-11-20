import { z } from "zod";

const id = z.string().regex(/^[a-z][a-z0-9-]{0,35}$/);
const text = z.string().trim().min(1);
const cueRef = z.object({ cue: id }).strict();
const node = z
  .object({
    id,
    label: text.max(22),
    x: z.number().min(5).max(95),
    y: z.number().min(8).max(90),
  })
  .strict();
const edge = z
  .object({ id, from: id, to: id, label: z.string().max(24).optional() })
  .strict();
const visual = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("equations"),
      steps: z
        .array(cueRef.extend({ tex: text.max(180), note: text.max(90) }))
        .min(1)
        .max(4),
    })
    .strict(),
  z
    .object({
      type: z.literal("cards"),
      steps: z
        .array(cueRef.extend({ title: text.max(55), body: text.max(150) }))
        .min(1)
        .max(4),
    })
    .strict(),
  z
    .object({
      type: z.literal("code"),
      lines: z.array(z.string().max(75)).min(1).max(11),
      steps: z
        .array(
          cueRef.extend({ line: z.number().int().min(1), note: text.max(110) }),
        )
        .min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("graph"),
      nodes: z.array(node).min(1).max(9),
      edges: z.array(edge).max(18),
      steps: z
        .array(
          cueRef.extend({ node: id, edge: id.optional(), note: text.max(100) }),
        )
        .min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("plot"),
      xLabel: text.max(35),
      yLabel: text.max(35),
      series: z
        .array(
          z
            .object({
              name: text.max(25),
              points: z
                .array(z.tuple([z.number().finite(), z.number().finite()]))
                .min(2)
                .max(60),
              cue: id,
            })
            .strict(),
        )
        .min(1)
        .max(3),
    })
    .strict(),
  z
    .object({
      type: z.literal("petri"),
      places: z
        .array(node.extend({ tokens: z.number().int().min(0).max(5) }))
        .min(1)
        .max(7),
      transitions: z.array(node).min(1).max(5),
      arcs: z
        .array(z.object({ from: id, to: id }).strict())
        .min(1)
        .max(20),
      steps: z
        .array(cueRef.extend({ fire: id, note: text.max(100) }))
        .min(1)
        .max(8),
    })
    .strict(),
]);

export const lessonSchema = z
  .object({
    version: z.literal(1),
    title: text.max(85),
    goal: text.max(240),
    mode: z.enum(["cramming", "fully cooked", "chill", "bird"]),
    sources: z
      .array(
        z
          .object({ id, title: text.max(150), location: text.max(250) })
          .strict(),
      )
      .min(1),
    narration: z
      .object({
        voice: text.default("am_michael"),
        speed: z.number().min(0.7).max(1.3).default(1),
        language: text.default("en-us"),
      })
      .strict()
      .default({}),
    scenes: z
      .array(
        z
          .object({
            id,
            title: text.max(65),
            kind: z.enum([
              "concept",
              "example",
              "mistake",
              "practice",
              "recap",
            ]),
            sources: z.array(id).min(1),
            cues: z
              .array(
                z
                  .object({
                    id,
                    text: text.max(240),
                    spoken: text.max(600).optional(),
                    audio: text.optional(),
                    pauseAfter: z.number().min(0).max(15).default(0),
                  })
                  .strict(),
              )
              .min(1)
              .max(24),
            visual,
            check: z
              .object({ question: text, answer: text })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();
export type Lesson = z.infer<typeof lessonSchema>;
export type Visual = Lesson["scenes"][number]["visual"];
export type Petri = Extract<Visual, { type: "petri" }>;

function unique(values: string[], what: string) {
  if (new Set(values).size !== values.length)
    throw new Error(`Duplicate ${what}`);
}

/** Derive markings instead of accepting potentially incorrect token snapshots. */
export function petriMarkings(v: Petri): Record<string, number>[] {
  let marking = Object.fromEntries(v.places.map((p) => [p.id, p.tokens]));
  const result = [{ ...marking }];
  for (const step of v.steps) {
    const inputs = v.arcs.filter((a) => a.to === step.fire);
    if (inputs.some((a) => marking[a.from] < 1))
      throw new Error(`Transition ${step.fire} is not enabled at ${step.cue}`);
    marking = { ...marking };
    inputs.forEach((a) => marking[a.from]--);
    v.arcs.filter((a) => a.from === step.fire).forEach((a) => marking[a.to]++);
    if (Object.values(marking).some((n) => n > 5))
      throw new Error(
        "Split a marking with more than five tokens into a simpler illustration",
      );
    result.push(marking);
  }
  return result;
}

export function parseLesson(input: unknown): Lesson {
  const lesson = lessonSchema.parse(input);
  unique(
    lesson.sources.map((s) => s.id),
    "source IDs",
  );
  unique(
    lesson.scenes.map((s) => s.id),
    "scene IDs",
  );
  for (const scene of lesson.scenes) {
    unique(
      scene.cues.map((c) => c.id),
      "cue IDs",
    );
    for (const source of scene.sources)
      if (!lesson.sources.some((s) => s.id === source))
        throw new Error(`Unknown source ${source}`);
    const v = scene.visual;
    const references = v.type === "plot" ? v.series : v.steps;
    let previous = -1;
    for (const step of references) {
      const index = scene.cues.findIndex((c) => c.id === step.cue);
      if (index < 0) throw new Error(`Unknown cue ${step.cue} in ${scene.id}`);
      if (index < previous)
        throw new Error(`Visual cues must be chronological in ${scene.id}`);
      previous = index;
    }
    if (v.type === "code" && v.steps.some((s) => s.line > v.lines.length))
      throw new Error("Code highlight points beyond the last line");
    if (v.type === "graph") {
      unique(
        v.nodes.map((n) => n.id),
        "graph nodes",
      );
      unique(
        v.edges.map((e) => e.id),
        "graph edges",
      );
      for (const e of v.edges)
        if (![e.from, e.to].every((id) => v.nodes.some((n) => n.id === id)))
          throw new Error(`Unknown endpoint on edge ${e.id}`);
      for (const s of v.steps)
        if (
          !v.nodes.some((n) => n.id === s.node) ||
          (s.edge && !v.edges.some((e) => e.id === s.edge))
        )
          throw new Error("Unknown trace node or edge");
    }
    if (v.type === "petri") {
      unique(
        [...v.places, ...v.transitions].map((n) => n.id),
        "Petri nodes",
      );
      unique(
        v.arcs.map((a) => `${a.from}/${a.to}`),
        "Petri arcs",
      );
      for (const a of v.arcs) {
        const valid =
          (v.places.some((p) => p.id === a.from) &&
            v.transitions.some((t) => t.id === a.to)) ||
          (v.transitions.some((t) => t.id === a.from) &&
            v.places.some((p) => p.id === a.to));
        if (!valid)
          throw new Error(
            "Petri arcs must join an existing place and transition",
          );
      }
      for (const s of v.steps)
        if (!v.transitions.some((t) => t.id === s.fire))
          throw new Error(`Unknown transition ${s.fire}`);
      petriMarkings(v);
    }
  }
  return lesson;
}
