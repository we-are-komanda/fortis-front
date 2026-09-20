import { FortisProtocolError, isRecord, readJson } from "@/shared/lib/api-client";

export type DemoRequestInput = {
  name: string;
  organization: string;
  email: string;
  comment: string;
  consent: boolean;
  consentVersion: string;
};
export type DemoRequestConfiguration = { enabled: false } | { enabled: true; consentVersion: string; consentText: string };
export type DemoRequestAccepted = { requestId: string; status: "received" };

export async function getDemoRequestConfiguration(): Promise<DemoRequestConfiguration> {
  const data = await readJson<unknown>("/api/public/demo-requests", { sessionBound: false });
  if (!isRecord(data) || typeof data.enabled !== "boolean" || (data.enabled &&
      (typeof data.consentVersion !== "string" || !data.consentVersion || typeof data.consentText !== "string" || !data.consentText))) throw new FortisProtocolError();
  return data as DemoRequestConfiguration;
}

export async function sendDemoRequest(input: DemoRequestInput, idempotencyKey: string): Promise<DemoRequestAccepted> {
  const result = await readJson<unknown>("/api/public/demo-requests", {
    sessionBound: false,
    method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify(input),
  });
  if (!isRecord(result) || result.status !== "received" || typeof result.requestId !== "string" || !result.requestId) throw new FortisProtocolError();
  return result as DemoRequestAccepted;
}
