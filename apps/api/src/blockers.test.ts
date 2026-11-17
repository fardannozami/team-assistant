/** "No blocker" answers in their many shapes, and real blockers that look similar. */
import { describe, expect, test } from "bun:test";
import { isNoBlocker } from "@repo/shared";

describe("isNoBlocker", () => {
  test("bulleted, punctuated and emoji replies still mean no blocker", () => {
    for (const answer of ["- tidak ada", "tidak ada", "Tidak ada kendala.", "* gak ada blocker", "• aman kok", "aman 👍", "none", "-", "n/a", "tidak ada, aman"]) {
      expect([answer, isNoBlocker(answer)]).toEqual([answer, true]);
    }
  });

  test("real blockers are kept", () => {
    for (const answer of ["server down", "tidak ada akses ke server", "- deploy gagal", "no access to repo", "aman tapi lambat"]) {
      expect([answer, isNoBlocker(answer)]).toEqual([answer, false]);
    }
  });
});
