import { test } from "node:test";
import assert from "node:assert/strict";
import { runPipeline } from "../src/lib/afya/pipeline";
import { STRINGS } from "../src/lib/afya/i18n";
import type { SituationResult } from "../src/lib/afya/types";

// Replay times inside the archive; nothing here may reach the network.
globalThis.fetch = (() => {
  throw new Error("network used in a test");
}) as typeof fetch;

const situations = new Map<string, Promise<SituationResult>>();
function situationAt(anchorIso: string) {
  if (!situations.has(anchorIso)) situations.set(anchorIso, runPipeline({ anchorIso }));
  return situations.get(anchorIso)!;
}

test("the contributors are the forecast's own terms and add up to the +3 h change", async () => {
  for (const anchorIso of ["2026-02-10T12:00:00Z", "2026-07-15T06:00:00Z", "2025-11-03T15:00:00Z"]) {
    const s = await situationAt(anchorIso);
    const f3h = s.forecast.find((f) => f.horizon === "3h")!;
    assert.deepEqual(
      s.contributors.map((c) => c.feature).sort(),
      ["departure_from_usual", "usual_daily_change"],
      anchorIso,
    );
    const total = s.contributors.reduce((sum, c) => sum + c.contribution_c!, 0);
    // forecast, current reading and contributions are each rounded
    assert.ok(Math.abs(total - (f3h.value - s.current.wbgt_c)) <= 0.11, `${anchorIso}: ${total} vs ${f3h.value - s.current.wbgt_c}`);
    for (const c of s.contributors) {
      const expected = c.contribution_c! > 0.05 ? "increasing" : c.contribution_c! < -0.05 ? "decreasing" : "stable";
      assert.equal(c.direction, expected);
    }
  }
});

test("every contributor the pipeline can name has a label in both languages", async () => {
  const s = await situationAt("2026-02-10T12:00:00Z");
  for (const c of s.contributors) {
    assert.ok(STRINGS.en[`contributor_${c.feature}`], c.feature);
    assert.ok(STRINGS.sw[`contributor_${c.feature}`], c.feature);
  }
});

test("the situation's state is the last settled one, with no history segment under an hour", async () => {
  for (const anchorIso of ["2026-02-10T12:00:00Z", "2026-07-15T06:00:00Z", "2025-11-03T15:00:00Z"]) {
    const s = await situationAt(anchorIso);
    const history = s.state_history_24h;
    assert.equal(s.state.state_id, history[history.length - 1].state_id, anchorIso);
    assert.equal(s.state.since, history[history.length - 1].start, anchorIso);
    history.slice(0, -1).forEach((seg) => {
      assert.ok(Date.parse(seg.end) - Date.parse(seg.start) >= 3600_000, `${anchorIso}: ${seg.start}-${seg.end}`);
    });
    const next = s.state.transition_likelihood!;
    assert.notEqual(next.state_id, s.state.state_id);
    assert.ok(next.typical_hours! > 0, anchorIso);
  }
});

test("at 15:00 on a hot afternoon the next state shown is Cooling, not Rapid Warming", async () => {
  const s = await situationAt("2026-02-10T12:00:00Z");
  assert.equal(s.state.state_id, 2);
  assert.equal(s.state.transition_likelihood!.state_id, 3);
});
