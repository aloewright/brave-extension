import { describe, expect, it } from "vitest";
import {
  fetchLexiconEntry,
  LexiconHttpError,
  normalizeLexiconEntry,
  searchLexiconWords,
} from "../src/lib/lexicon-client";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("lexicon client", () => {
  it("normalizes dictionary and thesaurus data from the worker", () => {
    const entry = normalizeLexiconEntry({
      word: "serendipity",
      ipa: " ser-en-DIP-ity ",
      senses: [
        {
          pos: "noun",
          gloss: " good luck in making unexpected discoveries ",
          examples: [" happy accident "],
        },
        { pos: "noun", gloss: "", examples: ["ignored"] },
      ],
      thesaurus: {
        synonyms: ["chance", "chance", " discovery "],
        related: ["serendipitous"],
      },
      resolved_from: "",
    });

    expect(entry.word).toBe("serendipity");
    expect(entry.ipa).toBe("ser-en-DIP-ity");
    expect(entry.senses).toEqual([
      {
        pos: "noun",
        gloss: "good luck in making unexpected discoveries",
        examples: ["happy accident"],
      },
    ]);
    expect(entry.thesaurus.synonyms).toEqual(["chance", "discovery"]);
    expect(entry.thesaurus.related).toEqual(["serendipitous"]);
    expect(entry.thesaurus.antonyms).toEqual([]);
    expect(entry.resolved_from).toBeNull();
  });

  it("looks up encoded words through the Cloudflare worker API", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      calls.push(String(input));
      return jsonResponse({
        word: "happy chance",
        ipa: null,
        senses: [{ pos: "noun", gloss: "a fortunate accident", examples: [] }],
        thesaurus: { synonyms: ["break"] },
        resolved_from: null,
      });
    };

    const entry = await fetchLexiconEntry(" happy chance ", { fetchImpl });

    expect(calls).toEqual([
      "https://lexicon.lazee.workers.dev/api/v1/word/happy%20chance",
    ]);
    expect(entry.word).toBe("happy chance");
    expect(entry.senses[0]?.gloss).toBe("a fortunate accident");
    expect(entry.thesaurus.synonyms).toEqual(["break"]);
  });

  it("exposes missing-word suggestions from 404 responses", async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse(
        { error: "not found", suggestions: ["sere", "serf"] },
        { status: 404 },
      );

    await expect(fetchLexiconEntry("ser", { fetchImpl })).rejects.toMatchObject(
      {
        status: 404,
        suggestions: ["sere", "serf"],
      } satisfies Partial<LexiconHttpError>,
    );
  });

  it("searches suggestions with a bounded limit", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      calls.push(String(input));
      return jsonResponse({ query: "ser", suggestions: ["Serb", "sere"] });
    };

    const result = await searchLexiconWords(" ser ", 99, { fetchImpl });

    expect(calls).toEqual([
      "https://lexicon.lazee.workers.dev/api/v1/search?q=ser&limit=25",
    ]);
    expect(result).toEqual({ query: "ser", suggestions: ["Serb", "sere"] });
  });
});
