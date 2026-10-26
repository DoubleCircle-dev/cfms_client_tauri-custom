import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  nextCustomIteration,
  versionBuildNumber,
} from "./client-version.mjs";

describe("custom version iteration", () => {
  it("starts at 01 and follows the highest matching local tag", () => {
    assert.equal(nextCustomIteration("0.55.1", []), 1);
    assert.equal(
      nextCustomIteration("0.55.1", [
        "v0.55.1-custom-01",
        "v0.55.1-custom-03",
        "v0.55.2-custom-09",
        "v0.55.1-custom-alpha",
      ]),
      4,
    );
  });

  it("requires a plain base version and stops after 99", () => {
    assert.throws(
      () => nextCustomIteration("0.55.1-beta.1", []),
      /plain major\.minor\.patch/,
    );
    assert.throws(
      () => nextCustomIteration("0.55.1", ["v0.55.1-custom-99"]),
      /iteration limit reached/,
    );
  });

  it("adds the two-digit custom iteration to the existing build number", () => {
    assert.equal(versionBuildNumber("0.55.1"), 55_001);
    assert.equal(versionBuildNumber("0.55.1-custom-01"), 55_002);
    assert.equal(versionBuildNumber("0.55.1-custom-09"), 55_010);
    assert.equal(versionBuildNumber("0.55.2-custom-01"), 55_003);
    assert.throws(
      () => versionBuildNumber("0.55.1-custom-00"),
      /between 01 and 99/,
    );
  });
});
