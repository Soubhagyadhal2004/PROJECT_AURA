Pilot status: 32 runs started (8 personas x 4 conditions); personas p07 and p08 failed with Gemini quota errors (HTTP 429, 126 turns).
The paper uses personas p01-p06 only (summary_clean6.json). To redo p07/p08 after the quota resets: remove their lines from done.jsonl, turns.jsonl and final_state.jsonl, then run eval\selection\e2e\run_pilot.bat again.
