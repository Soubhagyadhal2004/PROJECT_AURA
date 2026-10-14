// Scoring for memories written by a real model, whose wording differs from the scenario sentences.
// A memory is matched to facts by the VALUES it mentions ("Pune", "Swift", "6 am", "oat milk"), using the
// persona's slots. Example: "The user relocated to Hyderabad from Pune." mentions the current city -> true.
import { SLOT, SLOTS, DISTRACTORS, isFiller } from "./scenarios.mjs";

// other ways a model may write a value
const ALIASES = {
  coffee: { black: ["black coffee", "black"], "with oat milk": ["oat milk"], "with extra sugar": ["extra sugar"], "as a cappuccino": ["cappuccino"] },
  gym: { "6 am": ["6 am", "6am", "6:00 am", "6 a.m."], "7 am": ["7 am", "7am", "7:00 am", "7 a.m."], "6 pm": ["6 pm", "6pm", "6:00 pm", "6 p.m.", "18:00"], "8 pm": ["8 pm", "8pm", "8:00 pm", "8 p.m.", "20:00"] },
  birthday: {
    "12 March": ["12 march", "march 12", "12th march", "march 12th", "12th of march"],
    "3 July": ["3 july", "july 3", "3rd july", "july 3rd", "3rd of july"],
    "21 September": ["21 september", "september 21", "21st september", "september 21st", "21st of september"],
    "8 December": ["8 december", "december 8", "8th december", "december 8th", "8th of december"],
  },
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pattern = (alts) => new RegExp(`(^|[^\\p{L}\\p{N}])(${alts.map(esc).join("|")})(?=$|[^\\p{L}\\p{N}])`, "iu");

const MATCHERS = [];
for (const s of SLOTS) for (const v of s.values) MATCHERS.push({ slot: s.key, value: v, re: pattern(ALIASES[s.key]?.[v] || [v]) });
for (const d of DISTRACTORS) MATCHERS.push({ slot: d.slot, value: d.value, distractor: true, re: pattern([d.value]) });

/** Every (slot, value) a memory sentence mentions. */
export function mentions(content) {
  return MATCHERS.filter((m) => m.re.test(content));
}

const trueNow = (m, gold) => !m.distractor && m.slot && gold.state.get(m.slot) === m.value;
const saidBefore = (m, gold) => !m.distractor && m.slot && (gold.stated.get(m.slot) || new Set()).has(m.value);

// Wording a real model uses (found in the first Gemini run, 13 Oct 2026):
//  - facts about people in the user's life ("The user's friend Rohan bought a Thar.") are legitimate memories;
//  - hypotheticals kept as hypotheticals ("If the user had a cat, they would name her Luna.") are noise,
//    not a false belief about the user;
//  - a fact that ended can be recorded as such ("The user finished leading project Lotus and is between
//    projects."), which is correct when the user retired that fact (not when they asked to forget it).
const THIRD_PARTY = /\b(friend|cousin|brother|colleague|neighbou?r|uncle|aunt|mother|father|mom|dad|wife|husband|partner)\b/i;
const HYPOTHETICAL = /\b(if|would|hypothetical(ly)?)\b/i;
const ENDED = /\b(no longer|anymore|finished|wrapped up|between projects|stopped|quit|sold|gave up|given up|passed away|died|unemployed|not working|formerly|used to|previously)\b/i;

/**
 * true | ended (correct record that a fact stopped being true) | stale | false |
 * third-party (about someone else; allowed) | hypothetical (noise) | other (mentions no known value)
 */
export function classify(content, gold) {
  const ms = mentions(content);
  if (!ms.length) return "other";
  const own = ms.filter((m) => !m.distractor);
  if (!own.length) {
    if (THIRD_PARTY.test(content)) return "third-party";
    if (HYPOTHETICAL.test(content)) return "hypothetical";
    return "false";
  }
  if (own.some((m) => trueNow(m, gold))) return "true";
  const retired = (m) => gold.state.get(m.slot) == null && !gold.forgotten.some((f) => f.slot === m.slot && f.value === m.value);
  if (ENDED.test(content) && own.some((m) => saidBefore(m, gold) && retired(m))) return "ended";
  if (own.some((m) => saidBefore(m, gold))) return "stale";
  return "false";
}

const GOOD = new Set(["true", "ended"]);

export const looseJudge = {
  addIsCorrect: (content, gold) => GOOD.has(classify(content, gold)) || classify(content, gold) === "third-party",
  proposalIsCorrect(p, gold) {
    const target = p.current?.content || "";
    if (p.action === "update") {
      if (GOOD.has(classify(target, gold))) return false; // never replace a fact that is still true
      const oldSlots = new Set(mentions(target).map((m) => m.slot));
      const newM = mentions(p.content || "").filter((m) => trueNow(m, gold));
      // the new value of the same fact, or a note that the fact ended
      return newM.some((n) => oldSlots.has(n.slot)) || (classify(p.content || "", gold) === "ended" && mentions(p.content || "").some((m) => oldSlots.has(m.slot)));
    }
    if (p.action === "retire") return classify(target, gold) !== "true" && !isFiller(target);
    if (p.action === "forget") return mentions(target).some((m) => gold.forgotten.some((f) => f.slot === m.slot && f.value === m.value));
    return false;
  },
};

/** Final-state score for model-written memories (the counterpart of harness.score). */
export function looseScore(env, gold) {
  const rows = env.db.prepare("SELECT id, content, status FROM memories").all();
  const active = rows.filter((r) => r.status === "active" && !isFiller(r.content));
  const goldPairs = [...gold.state].filter(([, v]) => v != null);
  const correct = goldPairs.filter(([k, v]) => active.some((r) => mentions(r.content).some((m) => m.slot === k && m.value === v))).length;
  const cls = active.map((r) => classify(r.content, gold));
  const n = (c) => cls.filter((x) => x === c).length;
  // third-party facts are allowed and not counted; hypotheticals count as errors (they are not facts about the user)
  const scored = n("true") + n("ended") + n("stale") + n("false") + n("hypothetical");
  const precision = scored ? (n("true") + n("ended")) / scored : 1;
  const recall = goldPairs.length ? correct / goldPairs.length : 1;
  const fillerLost = rows.filter((r) => isFiller(r.content) && r.status !== "active").length;
  let forgetMemResidual = 0;
  for (const f of gold.forgotten) if (rows.some((r) => mentions(r.content).some((m) => m.slot === f.slot && m.value === f.value))) forgetMemResidual++;
  return {
    goldFacts: goldPairs.length,
    activeFacts: active.length,
    correct,
    trueMem: n("true"),
    endedMem: n("ended"),
    stale: n("stale"),
    falseMem: n("false"),
    hypotheticalMem: n("hypothetical"),
    thirdPartyMem: n("third-party"),
    otherMem: n("other"),
    fillerLost,
    forgets: gold.forgotten.length,
    forgetMemResidual,
    precision,
    recall,
    f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
  };
}

export { SLOT };
