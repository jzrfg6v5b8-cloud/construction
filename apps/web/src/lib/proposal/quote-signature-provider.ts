import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type QuoteSignature = {
  provider: string;
  documentSha256: string;
  signatureId: string;
  signedBy: string;
  signedAt: string;
  verified: boolean;
  stampText?: string;
};

export interface QuoteSignatureProvider {
  sign(document: Uint8Array, context: { projectId: string; approvedBy: string }): Promise<QuoteSignature>;
}

export class DemoQuoteSignatureProvider implements QuoteSignatureProvider {
  async sign(document: Uint8Array): Promise<QuoteSignature> {
    const documentSha256 = createHash("sha256").update(document).digest("hex");
    return {
      provider: "local-demo",
      documentSha256,
      signatureId: `demo_${documentSha256.slice(0, 16)}`,
      signedBy: "未签署",
      signedAt: new Date().toISOString(),
      verified: false,
      stampText: "DEMO / 未签署",
    };
  }
}

type ExternalSignatureResponse = QuoteSignature & { callbackSignature: string };

export class ExternalQuoteSignatureProvider implements QuoteSignatureProvider {
  constructor(
    private readonly endpoint: string,
    private readonly secret: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    if (!endpoint || !secret) throw new Error("QUOTE_SIGNATURE_PROVIDER_NOT_CONFIGURED");
  }

  async sign(document: Uint8Array, context: { projectId: string; approvedBy: string }) {
    const documentSha256 = createHash("sha256").update(document).digest("hex");
    const body = JSON.stringify({ ...context, documentSha256 });
    const requestSignature = createHmac("sha256", this.secret).update(body).digest("hex");
    const response = await this.fetcher(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-signature": requestSignature },
      body,
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`QUOTE_SIGNATURE_FAILED:${response.status}`);
    const result = await response.json() as ExternalSignatureResponse;
    if (result.documentSha256 !== documentSha256 || !result.signatureId || !result.signedBy || !result.signedAt) {
      throw new Error("QUOTE_SIGNATURE_RESPONSE_INVALID");
    }
    const callbackPayload = [
      result.signatureId,
      result.documentSha256,
      result.signedBy,
      result.signedAt,
    ].join("|");
    const expected = createHmac("sha256", this.secret).update(callbackPayload).digest("hex");
    const provided = Buffer.from(result.callbackSignature ?? "");
    const expectedBytes = Buffer.from(expected);
    if (provided.length !== expectedBytes.length || !timingSafeEqual(provided, expectedBytes)) {
      throw new Error("QUOTE_SIGNATURE_VERIFICATION_FAILED");
    }
    return { ...result, provider: "external", verified: true };
  }
}

export function createQuoteSignatureProvider(environment = process.env.NODE_ENV): QuoteSignatureProvider {
  if (environment !== "production") return new DemoQuoteSignatureProvider();
  const endpoint = process.env.QUOTE_SIGNATURE_ENDPOINT;
  const secret = process.env.QUOTE_SIGNATURE_SECRET;
  if (!endpoint || !secret) throw new Error("QUOTE_SIGNATURE_PROVIDER_NOT_CONFIGURED");
  return new ExternalQuoteSignatureProvider(endpoint, secret);
}
