import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  nextCustomIteration,
  versionBuildNumber,
} from "./client-version.mjs";

describe("custom version iteration", () => {
  it("starts at 0.1 and follows the highest matching local tag", () => {
    assert.equal(nextCustomIteration("0.55.1", []), "0.1");
    assert.equal(
      nextCustomIteration("0.55.1", [
        "v0.55.1-custom-0.1",
        "v0.55.1-custom-0.3",
        "v0.55.2-custom-0.9",
        "v0.55.1-custom-alpha",
      ]),
      "0.4",
    );
    assert.equal(
      nextCustomIteration("0.55.1", ["v0.55.1-custom-0.99"]),
      "1.0",
    );
  });

  it("requires a plain base version and stops at 9.99", () => {
    assert.throws(
      () => nextCustomIteration("0.55.1-beta.1", []),
      /plain major\.minor\.patch/,
    );
    assert.throws(
      () => nextCustomIteration("0.55.1", ["v0.55.1-custom-9.99"]),
      /iteration limit reached/,
    );
  });

  it("adds the custom iteration index to the existing build number", () => {
    assert.equal(versionBuildNumber("0.55.1"), 55_001);
    assert.equal(versionBuildNumber("0.55.1-custom-0.1"), 55_002);
    assert.equal(versionBuildNumber("0.55.1-custom-0.9"), 55_010);
    assert.equal(versionBuildNumber("0.55.1-custom-1.0"), 55_101);
    assert.throws(
      () => versionBuildNumber("0.55.1-custom-0.0"),
      /between 0\.1 and 9\.99/,
    );
  });
});
