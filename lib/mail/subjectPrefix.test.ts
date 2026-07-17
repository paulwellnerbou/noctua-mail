import { describe, expect, it } from "bun:test";
import { prefixSubject, stripSubjectMarkers } from "./subjectPrefix";

describe("stripSubjectMarkers", () => {
  it("returns plain subjects unchanged", () => {
    expect(stripSubjectMarkers("Hello")).toBe("Hello");
  });

  it("strips a single Re: marker", () => {
    expect(stripSubjectMarkers("Re: Hello")).toBe("Hello");
  });

  it("strips stacked mixed-language markers", () => {
    expect(stripSubjectMarkers("Re: Aw: Re: Hello")).toBe("Hello");
    expect(stripSubjectMarkers("AW: WG: Fwd: Hello")).toBe("Hello");
  });

  it("strips markers with counters", () => {
    expect(stripSubjectMarkers("Re[2]: Hello")).toBe("Hello");
    expect(stripSubjectMarkers("AW(3): Hello")).toBe("Hello");
  });

  it("strips leading markers but not marker-like words in the subject", () => {
    expect(stripSubjectMarkers("Re: Regarding the review")).toBe("Regarding the review");
    expect(stripSubjectMarkers("Rescue mission")).toBe("Rescue mission");
  });

  it("handles empty and nullish input", () => {
    expect(stripSubjectMarkers("")).toBe("");
    expect(stripSubjectMarkers(null)).toBe("");
    expect(stripSubjectMarkers(undefined)).toBe("");
  });
});

describe("prefixSubject", () => {
  it("adds Re: prefix", () => {
    expect(prefixSubject("Re", "Hello")).toBe("Re: Hello");
  });

  it("does not double-add Re: prefix", () => {
    expect(prefixSubject("Re", "Re: Hello")).toBe("Re: Hello");
  });

  it("collapses accumulated reply chains to a single marker", () => {
    expect(prefixSubject("Re", "Re: Aw: Re: Hello")).toBe("Re: Hello");
    expect(prefixSubject("Re", "AW: Hello")).toBe("Re: Hello");
  });

  it("adds Fwd: prefix", () => {
    expect(prefixSubject("Fwd", "Hello")).toBe("Fwd: Hello");
  });

  it("does not double-add Fwd: prefix", () => {
    expect(prefixSubject("Fwd", "Fwd: Hello")).toBe("Fwd: Hello");
  });

  it("replaces a reply marker when forwarding", () => {
    expect(prefixSubject("Fwd", "Re: Hello")).toBe("Fwd: Hello");
  });

  it("normalizes lowercase markers", () => {
    expect(prefixSubject("Re", "re: Hello")).toBe("Re: Hello");
  });

  it("handles empty subject", () => {
    expect(prefixSubject("Re", "")).toBe("Re: (no subject)");
  });
});
