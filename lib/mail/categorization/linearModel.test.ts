import { describe, expect, it } from "bun:test";
import {
  applyLinearModel,
  createDefaultLinearModel,
  extractLinearFeatures,
  trainLinearModelPositive
} from "./linearModel";

function makeParsed(overrides?: Partial<any>) {
  return {
    from: { value: [{ address: "ticketnews@service.example.invalid" }] },
    subject: "Tickets jetzt exklusiv!",
    text: "Aktuelle Informationen zu Veranstaltungen.",
    attachments: [],
    ...overrides
  };
}

describe("categorization linear model", () => {
  it("extracts list/unsubscribe feature signals from folded list headers", () => {
    const parsed = makeParsed();
    const headers = new Map<string, any>([
      [
        "list",
        {
          id: "<abcd.service.example.invalid>",
          unsubscribe: ["https://service.example.invalid/unsubscribe/abc"]
        }
      ]
    ]);

    const features = extractLinearFeatures(parsed as any, headers);
    expect(features["has:list_header"]).toBe(1);
    expect(features["has:list_unsubscribe"]).toBe(1);
  });

  it("online training increases score for selected category", () => {
    const parsed = makeParsed({
      from: { value: [{ address: "noreply@billing.example.invalid" }] },
      subject: "Invoice 123456789"
    });
    const headers = new Map<string, any>();
    const features = extractLinearFeatures(parsed as any, headers);

    const model = createDefaultLinearModel();
    const before = applyLinearModel(
      { newsletter: 0, notification: 0, transactional: 0 },
      features,
      model
    );

    const trained = trainLinearModelPositive(model, features, "transactional");
    const after = applyLinearModel(
      { newsletter: 0, notification: 0, transactional: 0 },
      features,
      trained
    );

    expect(after.scores.transactional).toBeGreaterThan(before.scores.transactional);
  });
});
