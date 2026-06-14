export const LEXICON_ORIGIN = "https://lexicon.lazee.workers.dev";
export const LEXICON_API_BASE = `${LEXICON_ORIGIN}/api/v1`;

export const LEXICON_RELATION_KINDS = [
  "synonyms",
  "antonyms",
  "related",
  "broader",
  "narrower",
] as const;

export type LexiconRelationKind = (typeof LEXICON_RELATION_KINDS)[number];

export interface LexiconSense {
  pos: string;
  gloss: string;
  examples: string[];
}

export type LexiconThesaurus = Record<LexiconRelationKind, string[]>;

export interface LexiconEntry {
  word: string;
  ipa: string | null;
  senses: LexiconSense[];
  thesaurus: LexiconThesaurus;
  resolved_from: string | null;
}

export interface LexiconSearchResult {
  query: string;
  suggestions: string[];
}

export interface LexiconAbout {
  name: string;
  version: string;
  attributions: Array<{
    name: string;
    license: string;
    url: string;
  }>;
}

interface LexiconRequestOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

interface LexiconErrorBody {
  error?: string;
  suggestions?: unknown;
}

export class LexiconHttpError extends Error {
  status: number;
  suggestions: string[];

  constructor(status: number, message: string, suggestions: string[] = []) {
    super(message);
    this.name = "LexiconHttpError";
    this.status = status;
    this.suggestions = suggestions;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function readNullableString(value: unknown) {
  const text = readString(value);
  return text.length > 0 ? text : null;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const text = readString(item).replace(/\s+/g, " ");
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

export function emptyLexiconThesaurus(): LexiconThesaurus {
  return {
    synonyms: [],
    antonyms: [],
    related: [],
    broader: [],
    narrower: [],
  };
}

export function normalizeLexiconEntry(raw: unknown): LexiconEntry {
  if (!isRecord(raw)) throw new Error("Invalid lexicon entry response");

  const word = readString(raw.word);
  if (!word) throw new Error("Lexicon entry is missing a word");

  const senses = Array.isArray(raw.senses)
    ? raw.senses
        .filter(isRecord)
        .map(
          (sense): LexiconSense => ({
            pos: readString(sense.pos, "unknown"),
            gloss: readString(sense.gloss),
            examples: readStringArray(sense.examples),
          }),
        )
        .filter((sense) => sense.gloss.length > 0)
    : [];

  const thesaurus = emptyLexiconThesaurus();
  const rawThesaurus = isRecord(raw.thesaurus) ? raw.thesaurus : {};
  for (const kind of LEXICON_RELATION_KINDS) {
    thesaurus[kind] = readStringArray(rawThesaurus[kind]);
  }

  return {
    word,
    ipa: readNullableString(raw.ipa),
    senses,
    thesaurus,
    resolved_from: readNullableString(raw.resolved_from),
  };
}

export function normalizeLexiconSearch(raw: unknown): LexiconSearchResult {
  if (!isRecord(raw)) throw new Error("Invalid lexicon search response");
  return {
    query: readString(raw.query),
    suggestions: readStringArray(raw.suggestions),
  };
}

export function normalizeLexiconAbout(raw: unknown): LexiconAbout {
  if (!isRecord(raw)) throw new Error("Invalid lexicon about response");
  const attributions = Array.isArray(raw.attributions)
    ? raw.attributions
        .filter(isRecord)
        .map((item) => ({
          name: readString(item.name),
          license: readString(item.license),
          url: readString(item.url),
        }))
        .filter((item) => item.name && item.license && item.url)
    : [];

  return {
    name: readString(raw.name, "lexicon"),
    version: readString(raw.version),
    attributions,
  };
}

async function requestLexicon(
  path: string,
  options: LexiconRequestOptions = {},
) {
  const fetcher = options.fetchImpl ?? fetch;
  const response = await fetcher(`${LEXICON_API_BASE}${path}`, {
    signal: options.signal,
  });

  if (!response.ok) {
    let body: LexiconErrorBody = {};
    try {
      body = (await response.json()) as LexiconErrorBody;
    } catch {
      body = {};
    }
    throw new LexiconHttpError(
      response.status,
      readString(body.error, `Lexicon request failed (${response.status})`),
      readStringArray(body.suggestions),
    );
  }

  return response.json() as Promise<unknown>;
}

export async function fetchLexiconEntry(
  word: string,
  options?: LexiconRequestOptions,
) {
  const normalized = word.replace(/\s+/g, " ").trim();
  if (!normalized) throw new Error("Enter a word to look up");
  const raw = await requestLexicon(
    `/word/${encodeURIComponent(normalized)}`,
    options,
  );
  return normalizeLexiconEntry(raw);
}

export async function searchLexiconWords(
  query: string,
  limit = 8,
  options?: LexiconRequestOptions,
) {
  const normalized = query.replace(/\s+/g, " ").trim();
  if (!normalized) return { query: "", suggestions: [] };
  const safeLimit = Math.max(1, Math.min(25, Math.trunc(limit)));
  const raw = await requestLexicon(
    `/search?q=${encodeURIComponent(normalized)}&limit=${safeLimit}`,
    options,
  );
  return normalizeLexiconSearch(raw);
}

export async function fetchLexiconAbout(options?: LexiconRequestOptions) {
  const raw = await requestLexicon("/about", options);
  return normalizeLexiconAbout(raw);
}
