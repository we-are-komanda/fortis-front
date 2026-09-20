import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import * as api from "./asset-documents-api";
import { FortisApiError, FortisProtocolError } from "@/shared/lib/api-client";
import { setAuthenticatedIdentity, useSessionStore } from "@/shared/lib/session-state";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const document: api.AssetDocument = { id: "document-1", assetId: "asset-1", name: "source.txt", mimeType: "text/plain", sizeBytes: 9, revision: "1", checksum: "a".repeat(64), status: "ready", commercial: true, createdAt: "2026-09-20T00:00:00Z", updatedAt: "2026-09-20T00:00:00Z" };

test("upload sends actual File multipart without metadata storage keys or invented headers", async () => {
  const file = new File(["Synthetic"], "source.txt", { type: "text/plain" });
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/v1/assets/documents");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).has("content-type"), false);
    assert.ok(init?.body instanceof FormData);
    assert.deepEqual([...init.body.keys()], ["assetId", "file", "commercial"]);
    assert.equal(init.body.get("assetId"), "asset-1");
    assert.equal(init.body.get("commercial"), "true");
    assert.equal(await (init.body.get("file") as File).text(), "Synthetic");
    return Response.json(document, { status: 201 });
  };
  assert.deepEqual(await api.createAssetDocument({ assetId: "asset-1", file }), document);
});

test("client rejects oversized, empty and unsupported files before any request", async () => {
  globalThis.fetch = async () => { throw new Error("must not fetch"); };
  for (const file of [new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.pdf", { type: "application/pdf" }), new File([], "empty.txt", { type: "text/plain" }), new File(["<svg/>"], "image.svg", { type: "image/svg+xml" })]) {
    await assert.rejects(api.createAssetDocument({ assetId: "asset-1", file }), /10 МиБ|пуст|PDF/);
  }
});

test("exact 10 MiB allowed and all four allowlisted MIME types supported", () => {
  for (const type of ["application/pdf", "image/png", "image/jpeg", "text/plain"]) {
    assert.equal(api.validateAssetDocumentFile(new File([new Uint8Array(10 * 1024 * 1024)], "source", { type })), null);
  }
});

test("list validates consumed fields, parent scope and ready integrity metadata", async () => {
  for (const bad of [{ ...document, name: {} }, { ...document, assetId: "foreign" }, { ...document, checksum: null }, { ...document, status: "invented" }, { ...document, revision: 1 }]) {
    globalThis.fetch = async () => Response.json({ items: [bad], totalItems: 1 });
    await assert.rejects(api.listAssetDocuments("asset-1"), FortisProtocolError);
  }
  globalThis.fetch = async url => {
    assert.match(String(url), /assetId=asset-1&limit=50&offset=50/);
    return Response.json({ items: [{ ...document, downloadUrl: "https://external.invalid/private" }], totalItems: 51 });
  };
  assert.deepEqual(await api.listAssetDocuments("asset-1", { offset: 50 }), { items: [document], totalItems: 51 });
});

test("download returns authenticated blob from fixed route, ignoring external metadata URL", async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/v1/assets/documents/download?id=document-1&assetId=asset-1");
    assert.equal(init?.credentials, "same-origin");
    assert.equal(init?.cache, "no-store");
    return new Response("Synthetic", { headers: { "content-type": "text/plain" } });
  };
  const blob = await api.downloadAssetDocument(document);
  assert.equal(await blob.text(), "Synthetic");
});

test("download retains shared 401 invalidation and support request ID", async () => {
  setAuthenticatedIdentity("document-reader");
  globalThis.fetch = async () => Response.json({ code: "unauthenticated" }, { status: 401, headers: { "x-request-id": "doc-request" } });
  await assert.rejects(api.downloadAssetDocument(document), error => error instanceof FortisApiError && error.requestId === "doc-request");
  assert.equal(useSessionStore.getState().userId, null);
});

test("late binary response is rejected after account switch", async () => {
  setAuthenticatedIdentity("A");
  let finish!: (response: Response) => void;
  globalThis.fetch = () => new Promise(resolve => { finish = resolve; });
  const pending = api.downloadAssetDocument(document);
  setAuthenticatedIdentity("B");
  finish(new Response("Synthetic", { headers: { "content-type": "text/plain" } }));
  await assert.rejects(pending, { name: "AbortError" });
});

test("non-ready download fails closed without network and delete sends only ID", async () => {
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(url, "/api/v1/assets/documents/delete?id=document-1");
    assert.equal(init?.method, "DELETE");
    return Response.json({ status: "ok" });
  };
  await assert.rejects(api.downloadAssetDocument({ ...document, status: "quarantined" }));
  assert.equal(calls, 0);
  await api.deleteAssetDocument("document-1");
  assert.equal(calls, 1);
});

test("download rejects unexpected executable MIME or length but accepts text MIME charset", async () => {
  for (const [body, type] of [["Synthetic", "text/html"], ["short", "text/plain"]]) {
    globalThis.fetch = async () => new Response(body, { headers: { "content-type": type } });
    await assert.rejects(api.downloadAssetDocument(document), FortisProtocolError);
  }
  globalThis.fetch = async () => new Response("Synthetic", { headers: { "content-type": "text/plain; charset=utf-8" } });
  assert.equal(await (await api.downloadAssetDocument(document)).text(), "Synthetic");
});
