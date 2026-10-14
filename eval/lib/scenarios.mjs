// Synthetic multi-session dialogues with known ground truth.
//
// A persona has 8 of the 12 "slots" below (city, employer, ...). Over 5 sessions the user states facts,
// later changes some (update), says some are no longer true (retire), asks AURA to forget some, repeats
// some (reconfirm), and says things that must NOT become memories (distractors: hypotheticals, questions,
// assistant suggestions, facts about other people). Every user turn carries the event that produced it,
// so the true memory state is known after every turn.
//
// All sentences are written by the authors of this evaluation (no real user data).
import { rng, hash, pick, shuffle } from "./rng.mjs";

const fill = (tpl, v) => tpl.replaceAll("{v}", v);

export const SLOTS = [
  {
    key: "city", label: "where I live", category: "personal",
    values: ["Pune", "Hyderabad", "Kolkata", "Jaipur", "Chennai", "Indore", "Bhubaneswar", "Lucknow"],
    add: "I live in {v}.", update: "I've just moved to {v}.", retire: null,
    fact: "The user lives in {v}.",
    queries: ["Which city am I based in?", "Where is home for me these days?"],
  },
  {
    key: "employer", label: "my job", category: "work",
    values: ["Infosys", "Wipro", "Zoho", "Freshworks", "Razorpay", "Flipkart", "Swiggy"],
    add: "I work at {v}.", update: "I quit my old job and joined {v}.", retire: "I've left my job and I'm not working right now.",
    fact: "The user works at {v}.",
    queries: ["Which company do I work for?", "Who is my current employer?"],
  },
  {
    key: "pet", label: "my dog", category: "personal",
    values: ["Bruno", "Simba", "Coco", "Leo", "Mithu", "Tiger"],
    add: "My dog is called {v}.", update: "Correction, my dog's name is actually {v}.", retire: "Sadly my dog passed away last month.",
    fact: "The user's dog is named {v}.",
    queries: ["What's my dog's name?", "What did I name my dog?"],
  },
  {
    key: "sister", label: "my sister", category: "people",
    values: ["Priya", "Ananya", "Sneha", "Kavya", "Ritu", "Meera"],
    add: "My sister's name is {v}.", update: null, retire: null,
    fact: "The user's sister is named {v}.",
    queries: ["What is my sister called?", "What's my sister's name?"],
  },
  {
    key: "diet", label: "my diet", category: "preference",
    values: ["vegetarian", "vegan", "eggetarian", "pescatarian"],
    add: "I'm {v}.", update: "I've changed my diet, I'm {v} now.", retire: null,
    fact: "The user is {v}.",
    queries: ["What kind of diet do I follow?", "Do I have any food restrictions?"],
  },
  {
    key: "gym", label: "my gym routine", category: "personal",
    values: ["6 am", "7 am", "6 pm", "8 pm"],
    add: "I go to the gym at {v} every day.", update: "I moved my gym time to {v}.", retire: "I stopped going to the gym.",
    fact: "The user goes to the gym at {v} every day.",
    queries: ["When do I usually work out?", "What time is my gym session?"],
  },
  {
    key: "language", label: "the language I'm learning", category: "personal",
    values: ["Japanese", "German", "French", "Spanish", "Korean"],
    add: "I'm learning {v}.", update: "I dropped that and started learning {v} instead.", retire: "I gave up learning languages for now.",
    fact: "The user is learning {v}.",
    queries: ["Which language am I studying?", "What language am I learning at the moment?"],
  },
  {
    key: "car", label: "my car", category: "personal",
    values: ["Nexon", "Swift", "Creta", "Baleno", "Seltos"],
    add: "I drive a {v}.", update: "I sold my old car and bought a {v}.", retire: "I sold my car, I don't have one anymore.",
    fact: "The user drives a {v}.",
    queries: ["What car do I drive?", "Which car do I own?"],
  },
  {
    key: "project", label: "my project at work", category: "work",
    values: ["Orion", "Falcon", "Lotus", "Nimbus", "Atlas"],
    add: "I'm leading a project called {v} at work.", update: "I've been moved to a new project called {v}.",
    retire: "My project wrapped up last week, I'm between projects.",
    fact: "The user is leading a project called {v}.",
    queries: ["What project am I working on?", "Which project do I lead at work?"],
  },
  {
    key: "coffee", label: "how I take my coffee", category: "preference",
    values: ["black", "with oat milk", "with extra sugar", "as a cappuccino"],
    add: "I take my coffee {v}.", update: "These days I take my coffee {v}.", retire: "I've quit coffee completely.",
    fact: "The user takes their coffee {v}.",
    queries: ["How do I like my coffee?", "What's my usual coffee order?"],
  },
  {
    key: "hobby", label: "my hobby", category: "preference",
    values: ["chess", "badminton", "painting", "guitar", "cycling"],
    add: "My main hobby is {v}.", update: "My new main hobby is {v}.", retire: null,
    fact: "The user's main hobby is {v}.",
    queries: ["What do I do for fun?", "What's my favourite hobby?"],
  },
  {
    key: "birthday", label: "my birthday", category: "personal",
    values: ["12 March", "3 July", "21 September", "8 December"],
    add: "My birthday is on {v}.", update: null, retire: null,
    fact: "The user's birthday is on {v}.",
    queries: ["When is my birthday?", "What date is my birthday?"],
  },
];
export const SLOT = Object.fromEntries(SLOTS.map((s) => [s.key, s]));
export const factOf = (slotKey, v) => fill(SLOT[slotKey].fact, v);

// Statements that must not become memories. falseFact/falseValue describe the wrong memory an extractor
// could create from them (used to inject errors in simulation and to score real runs).
export const DISTRACTORS = [
  { kind: "hypothetical", user: "If I ever moved to Goa, I'd spend every evening on the beach.", slot: "city", value: "Goa", falseFact: "The user lives in Goa." },
  { kind: "question", user: "What's the weather like in Shimla today?", slot: "city", value: "Shimla", falseFact: "The user lives in Shimla." },
  { kind: "assistant-suggestion", assistantFirst: "Since you enjoy languages, you could try Italian next.", user: "Hmm, maybe, I'll think about it.", slot: "language", value: "Italian", falseFact: "The user is learning Italian." },
  { kind: "third-party", user: "My friend Rohan just bought a Thar, it looks great.", slot: "car", value: "Thar", falseFact: "The user drives a Thar." },
  { kind: "third-party", user: "My cousin works at Google in Zurich.", slot: "employer", value: "Google", falseFact: "The user works at Google." },
  { kind: "hypothetical", user: "If I had a cat I would call her Luna.", slot: "pet", value: "Luna", falseFact: "The user has a cat named Luna." },
  { kind: "one-off", user: "Can you set a timer for ten minutes?", slot: null, value: "timer", falseFact: "The user set a timer for ten minutes." },
  { kind: "general-knowledge", user: "Is it true that octopuses have three hearts?", slot: "hobby", value: "marine biology", falseFact: "The user's main hobby is marine biology." },
];

const REPLIES = ["Got it.", "Okay, noted.", "Thanks for telling me.", "Understood.", "Sure."];

// Unrelated true facts that fill the memory store, as months of earlier use would.
// Several are deliberately close to the persona facts (friends' cities, cuisines), as real stores are.
function buildFillerPool() {
  const names = ["Rohan", "Aditya", "Vikram", "Neha", "Pooja", "Arjun", "Ishaan", "Tanvi", "Kabir", "Riya", "Siddharth", "Aisha"];
  const cities = ["Mumbai", "Delhi", "Surat", "Nagpur", "Mysuru", "Kochi", "Patna", "Ranchi", "Guwahati", "Dehradun"];
  const out = [];
  for (const t of ["Chennai Super Kings", "Mumbai Indians", "Royal Challengers Bengaluru", "Kolkata Knight Riders", "Rajasthan Royals", "Delhi Capitals", "Punjab Kings", "Gujarat Titans"])
    out.push(`The user's favourite cricket team is ${t}.`);
  for (const n of names) for (const c of cities) out.push(`The user's friend ${n} lives in ${c}.`);
  for (const p of ["Japan", "Iceland", "Ladakh", "Bali", "Norway", "Peru", "Kenya", "Vietnam", "Scotland", "New Zealand"])
    out.push(`The user wants to visit ${p} someday.`);
  for (const m of ["Interstellar", "3 Idiots", "Lagaan", "Dune", "Inception", "Swades", "Oppenheimer", "Dangal", "Arrival", "Piku"])
    out.push(`The user recently watched ${m}.`);
  for (const n of names) for (const t of ["payments", "search", "mobile", "data", "security", "design", "QA", "infra"])
    out.push(`The user's colleague ${n} handles the ${t} team.`);
  for (const d of ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]) out.push(`The user has a haircut booked for ${d}.`);
  for (const b of ["Sapiens", "Atomic Habits", "The Alchemist", "Wings of Fire", "Ikigai", "Deep Work", "The Guide", "Malgudi Days", "Educated"])
    out.push(`The user is reading ${b}.`);
  for (const l of ["ThinkPad", "MacBook Air", "Dell XPS", "HP Spectre", "Asus Zenbook", "Acer Swift"]) out.push(`The user's laptop is a ${l}.`);
  for (const s of ["window", "aisle"]) out.push(`The user prefers ${s} seats on flights.`);
  for (const c of ["Bengali", "Punjabi", "Kerala", "Chettinad", "Gujarati", "Thai", "Mexican", "Lebanese"]) out.push(`The user's favourite cuisine is ${c}.`);
  for (const f of ["Barcelona", "Arsenal", "Liverpool", "Bayern Munich", "Real Madrid", "Juventus"]) out.push(`The user supports ${f} in football.`);
  for (const a of ["A. R. Rahman", "Arijit Singh", "Shreya Ghoshal", "Coldplay", "Prateek Kuhad", "Kishore Kumar"]) out.push(`The user's favourite singer is ${a}.`);
  for (const n of names) for (const a of ["parrot", "rabbit", "tortoise", "labrador"]) out.push(`The user's neighbour ${n} has a ${a}.`);
  for (const i of ["a standing desk", "new headphones", "a smartwatch", "a bicycle", "an air purifier", "a coffee grinder", "running shoes"])
    out.push(`The user bought ${i} last month.`);
  for (const r of ["uncle", "aunt", "grandmother", "cousin"]) for (const c of cities) out.push(`The user's ${r} lives in ${c}.`);
  return out;
}
export const FILLER_POOL = buildFillerPool();
const FILLER_SET = new Set(FILLER_POOL);

/** A deterministic sample of n filler facts. */
export function fillerSample(n, seedStr) {
  if (n > FILLER_POOL.length) throw new Error(`filler pool has only ${FILLER_POOL.length} facts`);
  return shuffle(FILLER_POOL, rng(hash(`filler|${seedStr}`))).slice(0, n);
}

// content -> { slot, value, distractor? } for every sentence the simulation can write
export const FACT_INDEX = new Map();
for (const s of SLOTS) for (const v of s.values) FACT_INDEX.set(factOf(s.key, v), { slot: s.key, value: v });
for (const d of DISTRACTORS) FACT_INDEX.set(d.falseFact, { slot: d.slot, value: d.value, distractor: true });

export const isFiller = (content) => FILLER_SET.has(content);

// ---- ground truth --------------------------------------------------------------------------------

export function newGold() {
  return { state: new Map(), stated: new Map(), forgotten: [] };
}

export function applyEvent(gold, ev) {
  const said = (k, v) => {
    if (!gold.stated.has(k)) gold.stated.set(k, new Set());
    gold.stated.get(k).add(v);
  };
  if (ev.type === "add") {
    gold.state.set(ev.slot, ev.value);
    said(ev.slot, ev.value);
  } else if (ev.type === "update") {
    gold.state.set(ev.slot, ev.to);
    said(ev.slot, ev.to);
  } else if (ev.type === "retire") {
    gold.state.set(ev.slot, null);
  } else if (ev.type === "forget") {
    gold.forgotten.push({ slot: ev.slot, value: ev.from });
    gold.state.set(ev.slot, null);
  }
}

/** Is this exact memory sentence true right now? (fillers are always true) */
export function isTrue(content, gold) {
  if (isFiller(content)) return true;
  const info = FACT_INDEX.get(content);
  if (!info || info.distractor) return false;
  return gold.state.get(info.slot) === info.value;
}

/** The facts that should be active right now (persona facts only). */
export function goldFacts(gold) {
  const out = [];
  for (const [k, v] of gold.state) if (v != null) out.push(factOf(k, v));
  return out;
}

// ---- personas ------------------------------------------------------------------------------------

/**
 * sessions: [[turn, ...], ...]; turn = { event, user, assistantFirst, assistant }.
 * event types: add | update | retire | forget | reconfirm | distractor
 */
export function makePersona(seed, idx, { nSlots = 8, nSessions = 5 } = {}) {
  const r = rng(hash(`persona|${seed}|${idx}`));
  const slots = shuffle(SLOTS, r).slice(0, nSlots);
  const gold = newGold();
  const distractors = shuffle(DISTRACTORS, r);
  let dIdx = 0;

  const fresh = (slot) => {
    const used = gold.stated.get(slot.key) || new Set();
    const opts = slot.values.filter((v) => !used.has(v));
    return opts.length ? pick(opts, r) : null;
  };
  const reply = () => pick(REPLIES, r);
  const mk = (event, user, assistantFirst = null) => {
    applyEvent(gold, event);
    return { event, user, assistantFirst, assistant: reply() };
  };
  const add = (slot) => {
    const v = fresh(slot);
    return mk({ type: "add", slot: slot.key, value: v }, fill(slot.add, v));
  };
  const reconfirm = (slot) => {
    const v = gold.state.get(slot.key);
    const s = fill(slot.add, v);
    return mk({ type: "reconfirm", slot: slot.key, value: v }, `Like I said, ${s[0].toLowerCase()}${s.slice(1)}`);
  };
  const distractor = () => {
    const d = distractors[dIdx++ % distractors.length];
    return mk({ type: "distractor", kind: d.kind, slot: d.slot, value: d.value, falseFact: d.falseFact }, d.user, d.assistantFirst || null);
  };
  const change = (slot) => {
    const cur = gold.state.get(slot.key);
    if (cur == null) {
      const v = fresh(slot);
      return v ? add(slot) : null; // re-introduce a slot that was retired or forgotten
    }
    const roll = r();
    const nv = fresh(slot);
    if (roll < 0.55 && slot.update && nv) return mk({ type: "update", slot: slot.key, from: cur, to: nv }, fill(slot.update, nv));
    if (roll < 0.8 && slot.retire) return mk({ type: "retire", slot: slot.key, from: cur }, slot.retire);
    if (roll < 0.9 || (!slot.update && !slot.retire)) return mk({ type: "forget", slot: slot.key, from: cur }, `Please forget what I told you about ${slot.label}.`);
    if (slot.update && nv) return mk({ type: "update", slot: slot.key, from: cur, to: nv }, fill(slot.update, nv));
    return mk({ type: "retire", slot: slot.key, from: cur }, slot.retire);
  };

  // Turns are generated in the order they are spoken, so the ground truth is replayed correctly.
  const sessions = [];
  // session 1: four facts
  sessions.push(slots.slice(0, 4).map(add));
  // session 2: the other four, one repeated fact and one distractor, in random order
  {
    const plan = shuffle(["a4", "a5", "a6", "a7", "re", "d"], r);
    sessions.push(
      plan.map((p) =>
        p === "re" ? reconfirm(pick(slots.slice(0, 4).filter((s) => gold.state.get(s.key) != null), r)) : p === "d" ? distractor() : add(slots[Number(p[1])])
      )
    );
  }
  // later sessions: two changes, one distractor, sometimes a repeated fact
  for (let s = 2; s < nSessions; s++) {
    const plan = shuffle(["c", "c", "d", ...(r() < 0.5 ? ["re"] : [])], r);
    const touched = new Set();
    const turns = [];
    for (const p of plan) {
      if (p === "d") turns.push(distractor());
      else if (p === "re") {
        const opts = slots.filter((x) => gold.state.get(x.key) != null && !touched.has(x.key));
        if (opts.length) turns.push(reconfirm(pick(opts, r)));
      } else {
        const opts = slots.filter((x) => !touched.has(x.key));
        for (const slot of shuffle(opts, r)) {
          const t = change(slot);
          if (t) {
            touched.add(slot.key);
            turns.push(t);
            break;
          }
        }
      }
    }
    sessions.push(turns);
  }
  return { id: `${seed}-${idx}`, seed, idx, slots: slots.map((s) => s.key), sessions, finalGold: gold };
}

/**
 * Adds "restate" turns: with probability p, a fact that was UPDATED in one session is repeated by the user at the
 * start of the next session ("Like I said, I live in Hyderabad."). Real users do repeat themselves; this is what
 * lets a change that was missed or turned down earlier come up again. The ground truth is unchanged (a restate does
 * not change any fact). Deterministic for a given persona and seedStr. p = 0 returns the persona untouched.
 */
export function withRestates(persona, p, seedStr = "") {
  if (!p) return persona;
  const r = rng(hash(`restate|${persona.id}|${seedStr}`));
  const state = new Map();
  const apply = (ev) => {
    if (ev.type === "add") state.set(ev.slot, ev.value);
    else if (ev.type === "update") state.set(ev.slot, ev.to);
    else if (ev.type === "retire" || ev.type === "forget") state.set(ev.slot, null);
  };
  const sessions = [];
  let pending = [];
  let restates = 0;
  for (const turns of persona.sessions) {
    const extra = [];
    for (const key of new Set(pending)) {
      const v = state.get(key);
      if (v == null || r() >= p) continue;
      const s = fill(SLOT[key].add, v);
      extra.push({ event: { type: "reconfirm", slot: key, value: v, restate: true }, user: `Like I said, ${s[0].toLowerCase()}${s.slice(1)}`, assistantFirst: null, assistant: "Got it." });
      restates++;
    }
    sessions.push([...extra, ...turns]);
    pending = [];
    for (const t of turns) {
      apply(t.event);
      if (t.event.type === "update") pending.push(t.event.slot);
    }
  }
  return { ...persona, sessions, restates };
}
