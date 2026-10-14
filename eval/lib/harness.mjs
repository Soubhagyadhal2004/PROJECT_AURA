// Runs one persona through AURA's real memory pipeline (extraction -> operations -> review) and scores
// the final memory store against the ground truth.
//
// Policies (how memory changes are handled):
//   append  : only "add" is ever applied (no updates, no retirements, no deletions)
//   auto    : every operation is applied immediately          (AURA with "ask before changes" off)
//   gate    : changes to existing memories wait for the user   (AURA default: confirmMemoryChanges on)
//   gateAll : like gate, and new facts are confirmed too       (emulated in the harness: AURA has no such setting)
//
// The extractor is either simulated (known error rates, see makeSimExtractor) or the real Gemini model
// wrapped by the same policy logic. The simulated user approves correct proposals and turns down wrong
// ones, but makes a mistake with probability u.
import { rng, hash, pick } from "./rng.mjs";
import { SLOT, FACT_INDEX, factOf, isTrue, isFiller, newGold, applyEvent, goldFacts, fillerSample } from "./scenarios.mjs";

export const POLICIES = ["append", "auto", "gate", "gateAll"];
const DAY = 86400000;

// "[12] (personal) The user lives in Pune." lines of the extraction prompt
export function parseCandidates(prompt) {
  const out = [];
  const re = /^\[(\d+)\] \((\w+)\) (.*)$/gm;
  let m;
  while ((m = re.exec(prompt))) out.push({ id: Number(m[1]), category: m[2], content: m[3] });
  return out;
}

/**
 * The simulated extractor: returns the operations a correct model would return for the current turn,
 * then injects errors at rate e:
 *   miss            : the correct operation is dropped                     (prob e per fact-bearing turn)
 *   spurious add    : a distractor becomes a false memory                  (prob e per distractor turn)
 *   wrong change    : a TRUE memory shown to the model is retired or overwritten with a false value
 *                                                                          (prob e per non-distractor turn)
 * A correct model can only reference memories it was shown (the candidates in the prompt); when the
 * memory to change is not among them it does what a real model would: it adds the new fact.
 */
export function makeSimExtractor(run) {
  return (args) => {
    if (!/maintain the long-term memory/.test(args.system || "")) throw new Error("unexpected model call in the simulation");
    const { turn, gold, e, r } = run.ctx;
    const ev = turn.event;
    const cands = parseCandidates(args.prompt);
    const idOf = new Map(cands.map((c) => [c.content, c.id]));
    const ops = [];
    const slot = ev.slot ? SLOT[ev.slot] : null;
    const miss = r() < e; // drawn on every turn, in a fixed order, so all policies see the same errors
    const spurious = r() < e;
    const wrong = r() < e;
    const wrongKind = r();
    const victimRoll = r();
    const corruptRoll = r();

    if (ev.type === "add" && !miss) ops.push({ action: "add", content: factOf(ev.slot, ev.value), category: slot.category });
    if (ev.type === "update" && !miss) {
      const id = idOf.get(factOf(ev.slot, ev.from));
      ops.push(id ? { action: "update", memory_id: id, content: factOf(ev.slot, ev.to), category: slot.category } : { action: "add", content: factOf(ev.slot, ev.to), category: slot.category });
    }
    if ((ev.type === "retire" || ev.type === "forget") && !miss) {
      const id = idOf.get(factOf(ev.slot, ev.from));
      if (id) ops.push({ action: ev.type, memory_id: id });
    }
    if (ev.type === "reconfirm" && !idOf.has(factOf(ev.slot, ev.value))) {
      // with restateUpdates, a correct model that is shown the older, no-longer-true value of the same fact updates it
      const stale = run.restateUpdates
        ? cands.find((c) => {
            const i = FACT_INDEX.get(c.content);
            return i && !i.distractor && i.slot === ev.slot && i.value !== ev.value && !isTrue(c.content, gold);
          })
        : null;
      ops.push(stale ? { action: "update", memory_id: stale.id, content: factOf(ev.slot, ev.value), category: slot.category } : { action: "add", content: factOf(ev.slot, ev.value), category: slot.category });
    }
    if (ev.type === "distractor" && spurious) ops.push({ action: "add", content: ev.falseFact, category: "other" });

    if (ev.type !== "distractor" && wrong) {
      const victims = cands.filter((c) => isTrue(c.content, gold) && FACT_INDEX.get(c.content)?.slot !== ev.slot);
      if (victims.length) {
        const v = victims[Math.floor(victimRoll * victims.length)];
        const info = FACT_INDEX.get(v.content);
        let corrupted = null;
        if (info) {
          const unsaid = SLOT[info.slot].values.filter((x) => !(gold.stated.get(info.slot) || new Set()).has(x));
          if (unsaid.length) corrupted = factOf(info.slot, unsaid[Math.floor(corruptRoll * unsaid.length)]);
        }
        const op = wrongKind < 0.5 && corrupted ? { action: "update", memory_id: v.id, content: corrupted, category: info.slot ? SLOT[info.slot].category : "other" } : { action: "retire", memory_id: v.id };
        ops.push(op);
        run.injected.add(`${op.action}:${v.id}`);
        run.counts.injectedWrongChanges++;
      }
    }
    if (miss && ["add", "update", "retire", "forget"].includes(ev.type)) run.counts.injectedMisses++;
    if (ev.type === "distractor" && spurious) run.counts.injectedSpurious++;
    return { operations: ops };
  };
}

/** Wraps an extractor with the policy-specific handling of its output. */
export function withPolicy(run, extractor) {
  return async (args, realGenerateJSON) => {
    const out = await extractor(args, realGenerateJSON);
    let ops = Array.isArray(out?.operations) ? out.operations : [];
    run.counts.opsReturned += ops.length;
    if (run.policy === "append") ops = ops.filter((o) => o.action === "add");
    if (run.policy === "gateAll") {
      const kept = [];
      for (const o of ops) {
        if (o.action !== "add") {
          kept.push(o);
          continue;
        }
        run.counts.prompts++;
        run.counts.addPrompts++;
        const correct = run.judge.addIsCorrect(o.content, run.ctx.gold);
        if (userAccepts(run, correct)) kept.push(o);
        tally(run, correct, userAcceptsLast(run));
        run.decisions.push({ action: "add", content: o.content, judgedCorrect: correct, accepted: userAcceptsLast(run) });
      }
      ops = kept;
    }
    return { ...out, operations: ops };
  };
}

function userAccepts(run, correct) {
  const slip = run.userR() < run.u;
  run._last = correct ? !slip : slip;
  return run._last;
}
const userAcceptsLast = (run) => run._last;

function tally(run, correct, accepted) {
  if (correct && accepted) run.counts.correctAccepted++;
  else if (correct && !accepted) run.counts.correctRejected++;
  else if (!correct && accepted) run.counts.wrongAccepted++;
  else run.counts.wrongRejected++;
}

// Ground-truth judgements for the simulation (exact sentences are known).
export const exactJudge = {
  addIsCorrect: (content, gold) => isTrue(content, gold),
  proposalIsCorrect(p, gold) {
    const target = p.current?.content || "";
    const ti = FACT_INDEX.get(target);
    if (p.action === "update") {
      const ni = FACT_INDEX.get(p.content || "");
      return isTrue(p.content, gold) && !isTrue(target, gold) && !!ti && !!ni && ti.slot === ni.slot;
    }
    if (p.action === "retire") return !isTrue(target, gold);
    if (p.action === "forget") return !!ti && gold.forgotten.some((f) => f.slot === ti.slot && f.value === ti.value);
    return false;
  },
};

function newCounts() {
  return {
    userTurns: 0, extractions: 0, opsReturned: 0, prompts: 0, addPrompts: 0, changePrompts: 0,
    correctAccepted: 0, correctRejected: 0, wrongAccepted: 0, wrongRejected: 0,
    injectedWrongChanges: 0, injectedMisses: 0, injectedSpurious: 0, wrongChangesApplied: 0,
    candidateMissesOnChange: 0, changeTurns: 0, extractionErrors: 0,
  };
}

async function insertFiller(env, content, t) {
  const emb = await env.models.embedText(content);
  env.db
    .prepare("INSERT INTO memories(content, category, status, source, embedding, created_at, updated_at) VALUES (?, 'other', 'active', 'manual', ?, ?, ?)")
    .run(content, env.f32ToBlob(emb), t, t);
}

/**
 * Runs one persona under one policy. Returns per-persona metrics.
 * opts: { policy, e, u, fillerInitial, fillerPerGap, extractor: "sim" | "real", judge }
 */
export async function runPersona(env, persona, opts) {
  const { policy, e = 0, u = 0, fillerInitial = 30, fillerPerGap = 10 } = opts;
  env.reset();
  env.saveSettings({ autoMemory: true, confirmMemoryChanges: policy === "gate" || policy === "gateAll" });

  const run = {
    policy, e, u, persona,
    ctx: null,
    counts: newCounts(),
    injected: new Set(),
    judge: opts.judge || exactJudge,
    userR: rng(hash(`user|${persona.id}|${policy}|${e}|${u}`)),
    restateUpdates: !!opts.restateUpdates,
    decisions: [], // every review card: what was proposed and what the simulated user decided
  };
  // opts.extractorFn(args, realGenerateJSON, run) lets a runner wrap the real model (e.g. to pace requests)
  const base = opts.extractorFn
    ? (args, realGen) => opts.extractorFn(args, realGen, run)
    : opts.extractor === "real"
      ? (args, realGen) => realGen(args)
      : makeSimExtractor(run);
  env.gem.setHandler(withPolicy(run, base));

  // instrumentation: which applied/accepted operations were injected wrong changes
  const onApplied = (a) => {
    for (const x of a.applied || []) {
      const id = x.op === "update" ? x.replaced : x.id;
      if ((x.op === "update" || x.op === "retire" || x.op === "forget") && run.injected.has(`${x.op}:${id}`)) run.counts.wrongChangesApplied++;
    }
  };
  const onDecision = (d) => {
    if (d.decision === "accepted" && run.injected.has(`${d.action}:${d.memoryId}`)) run.counts.wrongChangesApplied++;
  };
  env.mem.memoryEvents.on("applied", onApplied);
  env.mem.memoryEvents.on("decision", onDecision);

  try {
    const fillers = fillerSample(fillerInitial + fillerPerGap * (persona.sessions.length - 1), `${persona.id}`);
    let fi = 0;
    const t0 = Date.now() - 90 * DAY;
    for (; fi < fillerInitial; fi++) await insertFiller(env, fillers[fi], t0 + fi * 60000);

    const gold = newGold();
    for (let s = 0; s < persona.sessions.length; s++) {
      // other conversations happened between sessions: more (recent) memories
      if (s > 0) for (let k = 0; k < fillerPerGap; k++, fi++) await insertFiller(env, fillers[fi], Date.now());
      const t = Date.now();
      const convId = Number(env.db.prepare("INSERT INTO conversations(started_at, updated_at) VALUES (?, ?)").run(t, t).lastInsertRowid);
      const msg = env.db.prepare("INSERT INTO messages(conversation_id, role, modality, text, created_at) VALUES (?, ?, 'text', ?, ?)");

      for (let i = 0; i < persona.sessions[s].length; i++) {
        const turn = persona.sessions[s][i];
        applyEvent(gold, turn.event);
        if (turn.assistantFirst) msg.run(convId, "assistant", turn.assistantFirst, Date.now());
        msg.run(convId, "user", turn.user, Date.now());
        msg.run(convId, "assistant", turn.assistant, Date.now());
        run.counts.userTurns++;
        run.ctx = { turn, gold, e, r: rng(hash(`turn|${persona.id}|${s}|${i}|${e}`)) };

        // reachability: was the memory this turn changes among the memories shown to the model?
        if (["update", "retire", "forget"].includes(turn.event.type)) run.counts.changeTurns++;
        const onExtraction = (x) => {
          if (!["update", "retire", "forget"].includes(turn.event.type)) return;
          const target = factOf(turn.event.slot, turn.event.from);
          const row = env.db.prepare("SELECT id FROM memories WHERE content = ? AND status = 'active'").get(target);
          if (row && !x.candidateIds.includes(row.id)) run.counts.candidateMissesOnChange++;
        };
        env.mem.memoryEvents.once("extraction", onExtraction);
        try {
          await env.mem.extractFromConversation(convId);
        } catch (err) {
          // like the app: a failed extraction is retried with the next message (extracted_upto did not move)
          run.counts.extractionErrors++;
          run.lastError = String(err?.message || err);
          if (run.counts.extractionErrors <= 2) console.log(`  extraction error: ${run.lastError}`);
          if (opts.stopOnError) throw err;
        }
        env.mem.memoryEvents.off("extraction", onExtraction);
        run.counts.extractions++;
      }

      // end of session: the user goes through the cards waiting for an OK
      if (policy === "gate" || policy === "gateAll") {
        for (const p of env.mem.listProposals()) {
          run.counts.prompts++;
          run.counts.changePrompts++;
          const correct = run.judge.proposalIsCorrect(p, gold);
          const accepted = userAccepts(run, correct);
          if (accepted) await env.mem.acceptProposal(p.id);
          else env.mem.rejectProposal(p.id);
          tally(run, correct, accepted);
          run.decisions.push({ session: s + 1, action: p.action, current: p.current?.content || null, content: p.content || null, judgedCorrect: correct, accepted });
        }
      }
    }
    if (opts.onFinish) opts.onFinish(env, gold, run);
    return { ...(opts.scorer || score)(env, gold, run), ...run.counts };
  } finally {
    env.mem.memoryEvents.off("applied", onApplied);
    env.mem.memoryEvents.off("decision", onDecision);
    env.gem.setHandler(null);
  }
}

/** Compares the final memory store with the ground truth. */
export function score(env, gold, run) {
  const rows = env.db.prepare("SELECT id, content, status FROM memories").all();
  const active = rows.filter((r) => r.status === "active" && !isFiller(r.content));
  const activeSet = new Set(active.map((r) => r.content));
  const G = goldFacts(gold);
  const correct = G.filter((f) => activeSet.has(f)).length;
  let stale = 0;
  let falseMem = 0;
  for (const r of active) {
    if (isTrue(r.content, gold)) continue;
    const info = FACT_INDEX.get(r.content);
    const wasSaid = info && !info.distractor && (gold.stated.get(info.slot) || new Set()).has(info.value);
    if (wasSaid) stale++;
    else falseMem++;
  }
  const missing = G.filter((f) => !activeSet.has(f));
  const destroyed = missing.filter((f) => rows.some((r) => r.content === f && r.status !== "active")).length;
  const fillerRows = rows.filter((r) => isFiller(r.content));
  const fillerLost = fillerRows.filter((r) => r.status !== "active").length;
  // forgetting: is the forgotten value still stored anywhere?
  let forgetMemResidual = 0;
  let forgetTextResidual = 0;
  for (const f of gold.forgotten) {
    const fact = factOf(f.slot, f.value);
    if (rows.some((r) => r.content === fact)) forgetMemResidual++;
    const n = env.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE text LIKE ?").get(`%${f.value}%`).n;
    if (n > 0) forgetTextResidual++;
  }
  const nActive = active.length;
  const precision = nActive ? correct / nActive : 1;
  const recall = G.length ? correct / G.length : 1;
  return {
    goldFacts: G.length,
    activeFacts: nActive,
    correct,
    stale,
    falseMem,
    missing: missing.length,
    destroyed,
    fillerLost,
    forgets: gold.forgotten.length,
    forgetMemResidual,
    forgetTextResidual,
    precision,
    recall,
    f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    exactState: correct === G.length && nActive === correct && fillerLost === 0 ? 1 : 0,
  };
}

export { pick };
