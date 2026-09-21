import { test } from "node:test";
import assert from "node:assert/strict";
import { CHORDS_STATIONS, CONDUIT_INSTRUMENT_ID, chordsWindowUrl, findChordsStation } from "../src/lib/afya/sources";

const PORTAL = "https://3d-fewsnet.icdp.ucar.edu";

test("Conduit@Empathy1 leads the allowlist and no id appears twice", () => {
  assert.deepEqual(CHORDS_STATIONS[0], { id: CONDUIT_INSTRUMENT_ID, name: "Conduit@Empathy1" });
  const ids = CHORDS_STATIONS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("every allowlisted id finds its own station", () => {
  for (const station of CHORDS_STATIONS) assert.deepEqual(findChordsStation(String(station.id)), station);
});

test("an id off the allowlist, or written any other way, is refused", () => {
  for (const value of ["", "0", "999", "-61", "061", " 61", "61 ", "61.0", "6.1e1", "0x3d", "abc", "61/../1"]) {
    assert.equal(findChordsStation(value), null, JSON.stringify(value));
  }
});

test("the window URL names the instrument and the window in milliseconds", () => {
  assert.equal(chordsWindowUrl(10, 1_000, 2_000, ""), `${PORTAL}/instruments/10/live?start=1000&end=2000`);
  assert.equal(chordsWindowUrl(61, 1_000, 2_000, ""), `${PORTAL}/instruments/61/live?start=1000&end=2000`);
});

test("CHORDS_LIVE_URL replaces the Conduit@Empathy1 feed and no other", () => {
  const override = "https://mirror.example.org/instruments/61/live";
  assert.equal(chordsWindowUrl(61, 1_000, 2_000, override), `${override}?start=1000&end=2000`);
  assert.equal(chordsWindowUrl(39, 1_000, 2_000, override), `${PORTAL}/instruments/39/live?start=1000&end=2000`);
});
