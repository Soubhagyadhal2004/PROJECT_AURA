// The tab icon gets a green dot while AURA is listening or recording a meeting.
const state = { voice: false, recording: false };

function apply() {
  const live = state.voice || state.recording;
  const link = document.querySelector<HTMLLinkElement>("link#favicon");
  if (!link) return;
  const href = `${process.env.PUBLIC_URL || ""}/${live ? "favicon-live.png" : "favicon.png"}`;
  if (!link.href.endsWith(href)) link.href = href;
}

export function setFaviconState(patch: Partial<typeof state>) {
  Object.assign(state, patch);
  apply();
}
