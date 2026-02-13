import { describe, expect, it } from "bun:test";
import {
  applyLinearModel,
  createDefaultLinearModel,
  createSeededLinearModel,
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

  it("does not derive keyword features from body text", () => {
    const parsed = makeParsed({
      subject: "Hello there",
      text: "Invoice receipt payment statement beleg facture fattura."
    });
    const features = extractLinearFeatures(parsed as any, new Map<string, any>());

    expect(features["kw:transactional:invoice"]).toBeUndefined();
    expect(features["kw:transactional:receipt"]).toBeUndefined();
    expect(features["kw:transactional:payment"]).toBeUndefined();
  });

  it("does not include synthetic bias feature in extracted features", () => {
    const parsed = makeParsed();
    const features = extractLinearFeatures(parsed as any, new Map<string, any>());
    expect(features["bias"]).toBeUndefined();
  });

  it("keeps list-mail newsletter confidence resilient after one notification feedback event", () => {
    const seededModel = createSeededLinearModel();

    const newsletterLikeHeaders = new Map<string, any>([
      ["List-Unsubscribe", "<https://example.com/unsubscribe>"],
      ["List-Unsubscribe-Post", "List-Unsubscribe=One-Click"],
      ["Precedence", "bulk"]
    ]);
    const newsletterLikeInput = {
      from: { value: [{ address: "hello@harmoniclass.com" }] },
      subject: "Paul, How a piece of metal became the voice of the blues.",
      attachments: []
    };
    const newsletterLikeFeatures = extractLinearFeatures(
      newsletterLikeInput as any,
      newsletterLikeHeaders
    );
    const before = applyLinearModel(
      { newsletter: 0, notification: 0, transactional: 0 },
      newsletterLikeFeatures,
      seededModel
    );
    expect(before.scores.newsletter).toBeGreaterThan(0.85);

    const feedbackHeaders = new Map<string, any>([
      ["List-Id", "engineering.example.com"],
      ["List-Unsubscribe", "<https://example.com/unsubscribe>"],
      ["In-Reply-To", "<thread-123@example.com>"],
      ["References", "<thread-123@example.com>"]
    ]);
    const feedbackInput = {
      from: { value: [{ address: "notifications@example.com" }] },
      subject: "Re: Issue update #123",
      attachments: []
    };
    const feedbackFeatures = extractLinearFeatures(feedbackInput as any, feedbackHeaders);

    const trained = trainLinearModelPositive(seededModel, feedbackFeatures, "notification");
    const after = applyLinearModel(
      { newsletter: 0, notification: 0, transactional: 0 },
      newsletterLikeFeatures,
      trained
    );

    expect(after.scores.newsletter).toBeGreaterThanOrEqual(0.7);
    expect(after.scores.newsletter).toBeGreaterThan(after.scores.notification);
  });
});
