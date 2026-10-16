// Synthetic test set for the candidate-selection study. Seeded and deterministic.
// Independent of the persona set used by the earlier simulations (eval/lib): new slots, values, distractors
// and phrasings, including a held-out set of change messages that contain none of AURA's change-cue words.

export function rng(seed) {
  // mulberry32
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
function pickTwo(r, xs) {
  const a = pick(r, xs);
  let b = pick(r, xs);
  while (b === a) b = pick(r, xs);
  return [a, b];
}

// Copied from server/memory.mjs (CHANGE_CUE). tests/testset.test.mjs checks the copy is exact.
export const CHANGE_CUE =
  /\b(moved|relocated|now|no longer|anymore|any more|stopped|quit|gave up|given up|sold|bought|switched|changed|instead|used to|finished|left|resigned|passed away|died|forget|delete|correction|actually|new|just)\b/i;

// ---- persona slots -------------------------------------------------------------------------------
// fact(v): stored memory text. upd / ret / fgt: update / retire / forget phrasings, each with a "cue" family
// (contains a CHANGE_CUE word) and a "free" family (contains none). {old} and {new} are filled in.
export const SLOTS = [
  {
    slot: "city", category: "personal",
    values: ["Pune", "Kolkata", "Hyderabad", "Chennai", "Jaipur", "Indore", "Kochi", "Bhopal", "Nagpur", "Lucknow", "Surat", "Mysuru"],
    fact: (v) => `The user lives in ${v}.`,
    upd: {
      cue: ["I moved to {new} last month.", "I have relocated to {new}."],
      free: ["These days I live in {new}.", "Home for me is {new} at present."],
    },
  },
  {
    slot: "employer", category: "work",
    values: ["Swiggy", "Infosys", "Zomato", "Flipkart", "Wipro", "Razorpay", "Zoho", "Freshworks", "Meesho", "Nykaa", "Dream11", "Cred"],
    fact: (v) => `The user works at ${v}.`,
    upd: {
      cue: ["I switched jobs and work at {new} now.", "I left {old} and joined {new}."],
      free: ["I joined {new} last month as an engineer.", "My employer is {new} these days."],
    },
    ret: {
      cue: ["I quit my job last week.", "I resigned from {old}."],
      free: ["I am between jobs at the moment.", "I don't have a job at present."],
    },
  },
  {
    slot: "dog", category: "personal",
    values: ["Mithu", "Bruno", "Sheru", "Tommy", "Coco", "Simba", "Rocky", "Leo", "Bholu", "Kalu", "Oreo", "Toffee"],
    fact: (v) => `The user's dog is named ${v}.`,
    upd: {
      cue: ["We changed our dog's name to {new}.", "Our dog is called {new} now."],
      free: ["Our dog answers to {new} these days.", "We call our dog {new} at present."],
    },
    fgt: {
      cue: ["Please forget my dog's name.", "Delete what you know about my dog."],
      free: ["Please erase my dog's name from your records.", "Remove my dog's name from what you remember about me."],
    },
  },
  {
    slot: "sister_city", category: "people",
    values: ["Delhi", "Mumbai", "Bengaluru", "Goa", "Ranchi", "Patna", "Shimla", "Dehradun", "Guwahati", "Udaipur", "Agra", "Vizag"],
    fact: (v) => `The user's sister lives in ${v}.`,
    upd: {
      cue: ["My sister moved to {new}.", "My sister lives in {new} now."],
      free: ["My sister is based in {new} these days.", "My sister has settled in {new}."],
    },
  },
  {
    slot: "diet", category: "preference",
    values: ["vegetarian", "vegan", "pescatarian", "eggetarian", "keto", "gluten-free"],
    fact: (v) => `The user follows a ${v} diet.`,
    upd: {
      cue: ["I switched to a {new} diet.", "I am {new} now."],
      free: ["I follow a {new} diet these days.", "My diet is {new} at present."],
    },
    ret: {
      cue: ["I am no longer on any special diet.", "I gave up my {old} diet."],
      free: ["I eat everything these days, no diet rules.", "I don't follow any diet at present."],
    },
  },
  {
    slot: "gym", category: "personal",
    values: ["5 am", "6 am", "7 am", "8 am", "5 pm", "6 pm", "7 pm", "8 pm"],
    fact: (v) => `The user goes to the gym at ${v} every day.`,
    upd: {
      cue: ["I go to the gym at {new} now.", "I changed my gym time to {new}."],
      free: ["My gym slot is {new} these days.", "I work out at {new} on weekdays."],
    },
    ret: {
      cue: ["I stopped going to the gym.", "I quit the gym."],
      free: ["I don't go to the gym these days.", "Gym is not part of my routine at present."],
    },
  },
  {
    slot: "language", category: "personal",
    values: ["Spanish", "French", "German", "Japanese", "Korean", "Italian", "Mandarin", "Russian", "Arabic", "Portuguese"],
    fact: (v) => `The user is learning ${v}.`,
    upd: {
      cue: ["I switched to learning {new}.", "I am learning {new} now."],
      free: ["I am learning {new} at the moment.", "My language class these days is {new}."],
    },
    ret: {
      cue: ["I gave up learning {old}.", "I stopped my {old} classes."],
      free: ["I am not learning any language at present.", "I dropped my {old} classes."],
    },
  },
  {
    slot: "car", category: "personal",
    values: ["Seltos", "Swift", "Creta", "Nexon", "Baleno", "Venue", "Verna", "Brezza", "Altroz", "Punch", "Thar", "Kushaq"],
    fact: (v) => `The user drives a ${v}.`,
    upd: {
      cue: ["I sold my old car and bought a {new}.", "I switched to a {new}."],
      free: ["My car is a {new} these days.", "I drive a {new} at present."],
    },
    ret: {
      cue: ["I sold my car.", "I no longer own a car."],
      free: ["I don't own a car at present.", "I take the metro everywhere, there is no car at home."],
    },
  },
  {
    slot: "project", category: "work",
    values: ["Lotus", "Falcon", "Orion", "Nimbus", "Zephyr", "Atlas", "Cobalt", "Quartz", "Helix", "Vega", "Titan", "Comet"],
    fact: (v) => `The user is leading a project called ${v} at work.`,
    upd: {
      cue: ["I am now leading a project called {new}.", "I switched to the {new} project at work."],
      free: ["At work I lead the {new} project these days.", "My project at the office is {new} at present."],
    },
    ret: {
      cue: ["I finished the {old} project.", "The {old} project is done and I am not leading anything now."],
      free: ["The {old} project is over and I am between projects.", "I wrapped up {old} and have no project at present."],
    },
  },
  {
    slot: "coffee", category: "preference",
    values: ["cappuccino", "latte", "espresso", "americano", "filter coffee", "mocha", "flat white", "cold brew"],
    fact: (v) => `The user takes their coffee as a ${v}.`,
    upd: {
      cue: ["I switched to {new}.", "I drink {new} now."],
      free: ["These days my coffee order is a {new}.", "I prefer a {new} at present."],
    },
  },
  {
    slot: "hobby", category: "personal",
    values: ["chess", "painting", "cycling", "photography", "gardening", "swimming", "guitar", "badminton", "pottery", "trekking"],
    fact: (v) => `The user's main hobby is ${v}.`,
    upd: {
      cue: ["My main hobby is {new} now.", "I switched from {old} to {new}."],
      free: ["These days I spend my free time on {new}.", "Weekends are for {new} at present."],
    },
    ret: {
      cue: ["I gave up {old}.", "I stopped doing {old}."],
      free: ["I don't have time for {old} these days.", "I am not into {old} any longer."],
    },
  },
  {
    slot: "birthday", category: "personal",
    values: ["3 March", "12 April", "21 September", "5 June", "18 August", "29 November", "9 January", "14 July"],
    fact: (v) => `The user's birthday is on ${v}.`,
    fgt: {
      cue: ["Please forget my birthday.", "Delete my birthday from memory."],
      free: ["Please erase my birthday from your records.", "Remove my birthday from what you remember about me."],
    },
  },
];

// Unrelated sentences for mixed turns. None contains a CHANGE_CUE word (checked by a test).
export const FILLERS = [
  "The weather was lovely today.",
  "I had dosa for dinner.",
  "Work was busy this week.",
  "Can you suggest a good book?",
  "My phone battery drains fast.",
  "The traffic was terrible this morning.",
  "I watched a cricket match yesterday.",
  "Remind me to call the bank.",
  "The rain did not stop all afternoon.",
  "I am a bit tired today.",
  "The cafe near my office was crowded.",
  "Tell me a fun fact about space.",
];

// ---- distractors ----------------------------------------------------------------------------------
const NAMES = ["Rohan", "Aarav", "Vikram", "Neha", "Kiran", "Sanjay", "Pallavi", "Arjun", "Divya", "Manish", "Shreya", "Rahul", "Lakshmi", "Farhan", "Gita", "Harsh", "Irfan", "Jaya", "Kunal", "Leela", "Mohit", "Nandini", "Omkar", "Preeti", "Ravi", "Sunita", "Tarun", "Uma", "Varun", "Yash"];
const RELS = ["friend", "colleague", "cousin", "neighbour", "classmate", "uncle", "aunt", "manager"];
const D_CITIES = ["Delhi", "Mumbai", "Bengaluru", "Goa", "Ranchi", "Patna", "Shimla", "Dehradun", "Guwahati", "Udaipur", "Agra", "Vizag", "Pune", "Kolkata", "Hyderabad", "Chennai", "Jaipur", "Indore", "Kochi", "Bhopal", "Nagpur", "Lucknow", "Surat", "Mysuru", "Amritsar", "Varanasi", "Madurai", "Raipur", "Siliguri", "Nashik"];
const D_COMPANIES = ["Swiggy", "Infosys", "Zomato", "Flipkart", "Wipro", "Razorpay", "Zoho", "Freshworks", "Meesho", "Nykaa", "Dream11", "Cred", "TCS", "HCL", "Ola", "Paytm", "Accenture", "Deloitte", "Amazon", "Myntra"];
const D_CARS = ["Seltos", "Swift", "Creta", "Nexon", "Baleno", "Venue", "Verna", "Brezza", "Altroz", "Punch", "Thar", "Kushaq", "Innova", "Ertiga", "Scorpio"];
const D_PETS = ["Mithu", "Bruno", "Sheru", "Tommy", "Coco", "Simba", "Rocky", "Leo", "Bholu", "Kalu", "Oreo", "Toffee", "Pepper", "Ginger", "Snowy"];
const D_LANGS = ["Spanish", "French", "German", "Japanese", "Korean", "Italian", "Mandarin", "Russian", "Arabic", "Portuguese", "Tamil", "Bengali"];
const D_HOBBIES = ["chess", "painting", "cycling", "photography", "gardening", "swimming", "guitar", "badminton", "pottery", "trekking", "baking", "yoga", "dancing", "carrom"];
const D_COFFEE = ["cappuccino", "latte", "espresso", "americano", "filter coffee", "mocha", "flat white", "cold brew", "masala chai", "green tea"];

// similar: same relation as a persona slot, but about someone else
const SIMILAR = [
  (r) => { const v = pick(r, D_CITIES); return { text: `The user's ${pick(r, RELS)} ${pick(r, NAMES)} lives in ${v}.`, values: [v] }; },
  (r) => { const v = pick(r, D_COMPANIES); return { text: `The user's ${pick(r, RELS)} ${pick(r, NAMES)} works at ${v}.`, values: [v] }; },
  (r) => { const v = pick(r, D_CARS); return { text: `The user's ${pick(r, RELS)} ${pick(r, NAMES)} drives a ${v}.`, values: [v] }; },
  (r) => { const v = pick(r, D_PETS); return { text: `The user's ${pick(r, RELS)} ${pick(r, NAMES)} has a dog named ${v}.`, values: [v] }; },
  (r) => { const v = pick(r, D_LANGS); return { text: `The user's ${pick(r, RELS)} ${pick(r, NAMES)} is learning ${v}.`, values: [v] }; },
  (r) => { const v = pick(r, D_HOBBIES); return { text: `The user's ${pick(r, RELS)} ${pick(r, NAMES)} enjoys ${v}.`, values: [v] }; },
  (r) => { const v = pick(r, D_COFFEE); return { text: `The user's ${pick(r, RELS)} ${pick(r, NAMES)} drinks ${v} every morning.`, values: [v] }; },
  (r) => { const v = pick(r, D_CITIES); return { text: `The user visited ${v} on a work trip.`, values: [v] }; },
];

const FILMS = ["Lagaan", "Dangal", "Swades", "Queen", "Piku", "Barfi", "Zindagi Na Milegi Dobara", "Andhadhun", "Kahaani", "Masaan", "Udaan", "Talvar", "Tumbbad", "Gully Boy", "Article 15"];
const FOODS = ["biryani", "pav bhaji", "idli", "chole bhature", "momos", "pani puri", "dhokla", "rajma chawal", "misal pav", "appam", "litti chokha", "poha"];
const BOOKS = ["The White Tiger", "Train to Pakistan", "The God of Small Things", "Malgudi Days", "Wings of Fire", "The Guide", "Gitanjali", "Midnight's Children", "Sapiens", "Atomic Habits"];
const TEAMS = ["Mumbai Indians", "Chennai Super Kings", "Kolkata Knight Riders", "Rajasthan Royals", "Sunrisers Hyderabad", "Delhi Capitals", "Punjab Kings", "Gujarat Titans"];
const ITEMS = ["a laptop", "a standing desk", "noise-cancelling headphones", "a bicycle", "an air purifier", "a tablet", "a camera lens", "a smartwatch", "a bookshelf", "running shoes"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHOWS = ["Panchayat", "Kota Factory", "Scam 1992", "Paatal Lok", "Gullak", "Aspirants", "Rocket Boys", "Mirzapur"];
const PLACES = ["Ladakh", "Coorg", "Munnar", "Hampi", "Rishikesh", "Ooty", "Gokarna", "Spiti", "Pondicherry", "Kutch", "Darjeeling", "Andaman"];
const GENERIC = [
  (r) => ({ text: `The user watched ${pick(r, FILMS)} last weekend.`, values: [] }),
  (r) => ({ text: `The user likes ${pick(r, FOODS)}.`, values: [] }),
  (r) => ({ text: `The user is reading ${pick(r, BOOKS)}.`, values: [] }),
  (r) => ({ text: `The user supports ${pick(r, TEAMS)} in the IPL.`, values: [] }),
  (r) => ({ text: `The user plans to buy ${pick(r, ITEMS)} in ${pick(r, MONTHS)}.`, values: [] }),
  (r) => ({ text: `The user has a dentist appointment on ${1 + Math.floor(r() * 28)} ${pick(r, MONTHS)}.`, values: [] }),
  (r) => ({ text: `The user is watching the series ${pick(r, SHOWS)}.`, values: [] }),
  (r) => ({ text: `The user wants to travel to ${pick(r, PLACES)} in ${pick(r, MONTHS)}.`, values: [] }),
  (r) => ({ text: `The user prefers ${pick(r, ["window", "aisle"])} seats on flights.`, values: [] }),
  (r) => ({ text: `The user's ${pick(r, RELS)} ${pick(r, NAMES)} has a birthday in ${pick(r, MONTHS)}.`, values: [] }),
  (r) => ({ text: `The user paid the electricity bill for ${pick(r, MONTHS)}.`, values: [] }),
  (r) => ({ text: `The user recommended ${pick(r, BOOKS)} to ${pick(r, NAMES)}.`, values: [] }),
  (r) => ({ text: `The user cooked ${pick(r, FOODS)} for ${pick(r, NAMES)}.`, values: [] }),
  (r) => ({ text: `The user is saving money for ${pick(r, ITEMS)}.`, values: [] }),
  (r) => ({ text: `The user's ${pick(r, RELS)} ${pick(r, NAMES)} recommended the series ${pick(r, SHOWS)}.`, values: [] }),
];

// ---- builder --------------------------------------------------------------------------------------
const fill = (s, o, n) => s.replaceAll("{old}", o).replaceAll("{new}", n);
const words = (s) => String(s).toLowerCase();

export function buildPersona(seed, { maxDistractors = 350, similarShare = 0.3 } = {}) {
  const r = rng(seed * 7919 + 17);
  const pid = `p${String(seed).padStart(2, "0")}`;
  const facts = SLOTS.map((s) => {
    const [cur, nxt] = pickTwo(r, s.values);
    return { slot: s.slot, category: s.category, value: cur, newValue: nxt, text: s.fact(cur) };
  });
  // values that must not appear in distractors (current and new values of this persona)
  const banned = new Set(facts.flatMap((f) => [f.value, f.newValue]).map(words));
  const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bannedRe = new RegExp(`\\b(${[...banned].map(esc).join("|")})\\b`, "i");
  const seen = new Set(facts.map((f) => f.text));
  const distractors = [];
  let guard = 0;
  while (distractors.length < maxDistractors && guard++ < 100000) {
    const sim = r() < similarShare;
    const d = (sim ? pick(r, SIMILAR) : pick(r, GENERIC))(r);
    if (seen.has(d.text)) continue;
    if (d.values.some((v) => banned.has(words(v)))) continue;
    if (bannedRe.test(d.text)) continue; // e.g. a generic sentence that happens to name the persona's city
    seen.add(d.text);
    distractors.push({ text: d.text, kind: sim ? "similar" : "generic" });
  }
  // events
  const events = [];
  let n = 0;
  const add = (f, kind, form, tmpl, context) => {
    const change = fill(tmpl, f.value, f.newValue);
    let text = change;
    let position = "only";
    if (context === "mixed") {
      const [a, b] = pickTwo(r, FILLERS);
      const at = Math.floor(r() * 3);
      position = ["first", "middle", "last"][at];
      const parts = [a, b];
      parts.splice(at, 0, change);
      text = parts.join(" ");
    }
    events.push({
      id: `${pid}-e${String(++n).padStart(3, "0")}`,
      persona: pid,
      slot: f.slot,
      kind,
      form,
      context,
      position,
      text,
      changeSentence: change,
      oldValue: f.value,
      newValue: kind === "update" ? f.newValue : null,
      cue: CHANGE_CUE.test(text),
    });
  };
  for (const f of facts) {
    const s = SLOTS.find((x) => x.slot === f.slot);
    for (const [kind, key] of [["update", "upd"], ["retire", "ret"], ["forget", "fgt"]]) {
      if (!s[key]) continue;
      for (const form of ["cue", "free"]) {
        const tmpl = pick(r, s[key][form]);
        for (const context of ["single", "mixed"]) add(f, kind, form, tmpl, context);
      }
    }
  }
  return { id: pid, seed, facts, distractors, events };
}

export function buildTestset({ personas = 40, seedStart = 1, maxDistractors = 350, similarShare = 0.3 } = {}) {
  const out = [];
  for (let i = 0; i < personas; i++) out.push(buildPersona(seedStart + i, { maxDistractors, similarShare }));
  return { version: 1, personas: out };
}
