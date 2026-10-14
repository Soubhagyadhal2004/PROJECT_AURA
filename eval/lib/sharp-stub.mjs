// Stand-in for the sharp image library. The evaluation only embeds text, so it is never called.
export default function sharp() {
  throw new Error("sharp is stubbed out in the evaluation harness (text-only runs)");
}
