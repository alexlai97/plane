import { test } from "node:test";
import assert from "node:assert/strict";
import { getFileMetaDataForUpload } from "../../packages/services/src/file/helper.ts";

test("known text files upload even when browser MIME is empty", async () => {
  await Promise.all(
    [
      ["md", "text/markdown"],
      ["markdown", "text/markdown"],
      ["txt", "text/plain"],
      ["csv", "text/csv"],
      ["json", "application/json"],
    ].map(async ([extension, mime]) => {
      const meta = await getFileMetaDataForUpload(
        new File(["中文内容\n|进度|成果|"], `进展.${extension}`, { type: "" })
      );
      assert.equal(meta.type, mime);
    })
  );
});
test("binary content cannot masquerade as a text attachment", async () => {
  assert.equal((await getFileMetaDataForUpload(new File([new Uint8Array([0, 1, 2, 3])], "fake.md"))).type, "");
});
test("unknown extensions and dangerous double extensions stay rejected", async () => {
  await Promise.all(
    ["unknown.bin", "payload.exe.md", ".env"].map(async (name) => {
      assert.equal((await getFileMetaDataForUpload(new File(["hello"], name))).type, "");
    })
  );
});
test("binary signature takes precedence over a misleading filename", async () => {
  assert.equal((await getFileMetaDataForUpload(new File(["%PDF-1.7\n"], "fake.md"))).type, "application/pdf");
});
