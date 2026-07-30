import { describe, expect, it } from "vitest";
import { tokenize, buildMergedIndex } from "@/services/executors";

describe("tokenize — Unicode preservation", () => {
  it("preserves Vietnamese diacritics", () => {
    const tokens = tokenize("Kiểm tra bảo mật hệ thống");
    expect(tokens).toContain("kiểm");
    expect(tokens).toContain("bảo");
    expect(tokens).toContain("mật");
    expect(tokens).toContain("hệ");
    expect(tokens).toContain("thống");
  });

  it("preserves CJK characters", () => {
    const tokens = tokenize("安全 監査 system");
    expect(tokens).toContain("安全");
    expect(tokens).toContain("監査");
    expect(tokens).toContain("system");
  });

  it("splits on punctuation but keeps Unicode letters", () => {
    const tokens = tokenize("audit.run: kiểm-tra / parity.gate");
    expect(tokens).toContain("audit");
    expect(tokens).toContain("run");
    expect(tokens).toContain("kiểm");
    expect(tokens).toContain("tra");
    expect(tokens).toContain("parity");
    expect(tokens).toContain("gate");
  });

  it("drops single-char and stopword tokens", () => {
    const tokens = tokenize("a an the import export x");
    /* all stopwords or single chars → filtered out */
    expect(tokens).not.toContain("a");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("import");
    expect(tokens).not.toContain("x");
  });
});

describe("buildMergedIndex — scoped deletion of removed artifacts", () => {
  it("evicts postings for artifacts that were deleted from the audit between runs", () => {
    /* First run: audit A had artifacts 1 and 2. */
    const first = buildMergedIndex(
      null,
      [
        { id: 1, title: "alpha secret", path: "/a/alpha.json", content: "secret alpha" },
        { id: 2, title: "beta secret", path: "/a/beta.json", content: "secret beta" },
      ],
      "audit-A",
    );
    /* Token "secret" should map to both artifacts 1 and 2. */
    expect(first.postings["secret"].map((p) => p.artifactId).sort()).toEqual([1, 2]);
    expect(first.auditDocs["audit-A"]).toEqual([1, 2]);

    /* Second run: artifact 2 was DELETED from the audit; only artifact 1
       remains (plus a new artifact 3). Without scoped deletion the posting
       for artifact 2 would linger and search would return a deleted artifact. */
    const second = buildMergedIndex(
      first,
      [
        { id: 1, title: "alpha secret", path: "/a/alpha.json", content: "secret alpha" },
        { id: 3, title: "gamma secret", path: "/a/gamma.json", content: "secret gamma" },
      ],
      "audit-A",
    );
    const secretIds = second.postings["secret"].map((p) => p.artifactId).sort();
    expect(secretIds).toEqual([1, 3]);
    expect(secretIds).not.toContain(2);
    expect(second.docLengths[2]).toBeUndefined();
    expect(second.auditDocs["audit-A"]).toEqual([1, 3]);
  });

  it("preserves other audits' postings during a scoped reindex", () => {
    /* Global index has audit-A (artifact 1) and audit-B (artifact 2). */
    const base = buildMergedIndex(
      null,
      [{ id: 1, title: "alpha", path: "/a/alpha.json", content: "sharedtoken alpha" }],
      "audit-A",
    );
    const withB = buildMergedIndex(
      base,
      [{ id: 2, title: "beta", path: "/b/beta.json", content: "sharedtoken beta" }],
      "audit-B",
    );
    expect(withB.postings["sharedtoken"].map((p) => p.artifactId).sort()).toEqual([1, 2]);

    /* Reindex audit-A only — audit-B's posting must survive. */
    const reA = buildMergedIndex(
      withB,
      [{ id: 1, title: "alpha revised", path: "/a/alpha.json", content: "sharedtoken alpha" }],
      "audit-A",
    );
    const ids = reA.postings["sharedtoken"].map((p) => p.artifactId).sort();
    expect(ids).toEqual([1, 2]);
  });

  it("global reindex (auditId null) rebuilds from scratch without evicting by audit", () => {
    const base = buildMergedIndex(
      null,
      [{ id: 1, title: "x", path: "/a/x.json", content: "tok" }],
      "audit-A",
    );
    /* Global reindex passes auditId=null and a fresh row set. */
    const global = buildMergedIndex(
      base,
      [{ id: 9, title: "y", path: "/g/y.json", content: "tok" }],
      null,
    );
    expect(global.postings["tok"].map((p) => p.artifactId)).toEqual([9]);
    expect(global.lastScopedAudit).toBeNull();
  });

  it("records auditDocs membership so the next scoped run can evict deletions", () => {
    const a = buildMergedIndex(null, [{ id: 5, title: "t", path: "/p", content: "word" }], "audit-X");
    expect(a.auditDocs["audit-X"]).toEqual([5]);
    /* Simulate deletion: next run has no rows for audit-X. */
    const emptied = buildMergedIndex(a, [], "audit-X");
    expect(emptied.postings["word"]).toBeUndefined();
    expect(emptied.auditDocs["audit-X"]).toEqual([]);
  });
});
