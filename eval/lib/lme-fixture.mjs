// A tiny made-up dataset in the LongMemEval file format, used only to test the runner without Gemini
// (`npm run eval:lme -- --check-with-sim`). It is NOT LongMemEval data and no result from it is reported.
//
// Format of one LongMemEval instance (as published with the benchmark):
//   question_id, question_type, question, answer, question_date,
//   haystack_session_ids[], haystack_dates[], haystack_sessions[][] of { role, content, has_answer? },
//   answer_session_ids[]
import { rng, hash, pick } from "./rng.mjs";

const CITIES = ["Pune", "Hyderabad", "Chennai", "Jaipur", "Kochi", "Indore"];
const FIRMS = ["Infosys", "Wipro", "Zoho", "Freshworks", "Flipkart", "Swiggy"];
const GAMES = ["chess", "carrom", "badminton", "cricket", "hockey"];

const turn = (role, content, has_answer) => (has_answer ? { role, content, has_answer: true } : { role, content });

export function makeFixture(n = 6, seed = 1) {
  const out = [];
  for (let q = 0; q < n; q++) {
    const r = rng(hash(`fixture|${seed}|${q}`));
    const kind = q % 2 === 0 ? "city" : "employer";
    const a = pick(kind === "city" ? CITIES : FIRMS, r);
    let b = pick(kind === "city" ? CITIES : FIRMS, r);
    if (b === a) b = (kind === "city" ? CITIES : FIRMS).find((x) => x !== a);
    const first = kind === "city" ? `I live in ${a}.` : `I work at ${a}.`;
    const second = kind === "city" ? `I have just moved to ${b}.` : `I now work at ${b}.`;
    const sessions = [];
    const ids = [];
    const dates = [];
    const add = (id, date, turns) => {
      ids.push(id);
      dates.push(date);
      sessions.push(turns);
    };
    add(`q${q}-s1`, "2023/03/02 (Thu) 09:10", [turn("user", first, true), turn("assistant", "Thanks, noted.")]);
    add(`q${q}-d1`, "2023/03/09 (Thu) 18:30", [turn("user", `I like ${pick(GAMES, r)}.`), turn("assistant", "Nice choice.")]);
    add(`q${q}-s2`, "2023/05/20 (Sat) 02:21", [turn("user", second, true), turn("assistant", "Good luck with the change.")]);
    add(`q${q}-d2`, "2023/05/27 (Sat) 11:00", [turn("user", `I like ${pick(GAMES, r)}.`), turn("assistant", "Sounds fun.")]);
    add(`q${q}-d3`, "2023/06/03 (Sat) 20:45", [turn("user", "What is the capital of France?"), turn("assistant", "Paris.")]);
    out.push({
      question_id: `fx${q}`,
      question_type: "knowledge-update",
      question: kind === "city" ? "Where do I live now?" : "Where do I work now?",
      answer: b,
      question_date: "2023/07/01 (Sat) 10:00",
      haystack_session_ids: ids,
      haystack_dates: dates,
      haystack_sessions: sessions,
      answer_session_ids: [`q${q}-s1`, `q${q}-s2`],
    });
  }
  return out;
}
