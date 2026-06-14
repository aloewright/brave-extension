import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchLexiconEntry,
  LexiconHttpError,
  LEXICON_ORIGIN,
  LEXICON_RELATION_KINDS,
  searchLexiconWords,
  type LexiconEntry,
  type LexiconRelationKind,
  type LexiconSense,
} from "../../lib/lexicon-client";
import { openExternalLink } from "../../lib/open-url";
import { cx, LeoButton, LeoIcon, LeoTabButton } from "../../components/leo";

type LexiconMode = "dictionary" | "thesaurus";

interface StoredLexiconLookup {
  mode?: LexiconMode;
  word?: string;
}

type LoadState =
  | { kind: "idle" }
  | { kind: "loading"; word: string; previous: LexiconEntry | null }
  | { kind: "entry"; entry: LexiconEntry }
  | { kind: "missing"; word: string; suggestions: string[] }
  | { kind: "error"; word: string; message: string };

const LOOKUP_STORAGE_KEY = "lexicon.lookup.v1";
const LEGACY_DEFAULT_WORD = "serendipity";

const MODE_LABELS: Record<LexiconMode, string> = {
  dictionary: "Dictionary",
  thesaurus: "Thesaurus",
};

const RELATION_LABELS: Record<LexiconRelationKind, string> = {
  synonyms: "Synonyms",
  antonyms: "Antonyms",
  related: "Related",
  broader: "Broader",
  narrower: "Narrower",
};

function storageAvailable() {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

async function readStoredLookup(): Promise<StoredLexiconLookup | null> {
  if (!storageAvailable()) return null;
  const result = await chrome.storage.local.get(LOOKUP_STORAGE_KEY);
  const stored = result[LOOKUP_STORAGE_KEY] as StoredLexiconLookup | undefined;
  if (!stored || typeof stored !== "object") return null;
  return stored;
}

function writeStoredLookup(lookup: StoredLexiconLookup) {
  if (!storageAvailable()) return;
  void chrome.storage.local.set({ [LOOKUP_STORAGE_KEY]: lookup });
}

function normalizeQuery(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function isLexiconMode(value: unknown): value is LexiconMode {
  return value === "dictionary" || value === "thesaurus";
}

function lookupForStorage(word: string, mode: LexiconMode): StoredLexiconLookup {
  const storedWord = normalizeQuery(word);
  return storedWord ? { word: storedWord, mode } : { mode };
}

function groupSenses(senses: LexiconSense[]) {
  const groups = new Map<string, LexiconSense[]>();
  for (const sense of senses) {
    const pos = sense.pos || "unknown";
    groups.set(pos, [...(groups.get(pos) ?? []), sense]);
  }
  return [...groups.entries()].map(([pos, items]) => ({ pos, items }));
}

function hasThesaurus(entry: LexiconEntry) {
  return LEXICON_RELATION_KINDS.some(
    (kind) => entry.thesaurus[kind].length > 0,
  );
}

function EntryHeader({ entry }: { entry: LexiconEntry }) {
  return (
    <header className="mb-3 min-w-0 border-b border-border pb-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold leading-7 text-fg">
            {entry.word}
          </h2>
          {entry.ipa && (
            <p className="mt-0.5 truncate font-mono text-xs text-fg/45">
              /{entry.ipa}/
            </p>
          )}
        </div>
        <span className="shrink-0 rounded border border-border bg-accent/40 px-2 py-1 text-[10px] uppercase tracking-normal text-fg/45">
          Lexicon
        </span>
      </div>
      {entry.resolved_from && (
        <p className="mt-2 text-xs text-fg/45">
          Found via{" "}
          <span className="font-medium text-fg/70">{entry.resolved_from}</span>
        </p>
      )}
    </header>
  );
}

function DefinitionsPane({ entry }: { entry: LexiconEntry }) {
  const groups = useMemo(() => groupSenses(entry.senses), [entry.senses]);

  return (
    <section className="min-w-0 rounded border border-border bg-card/25 p-3">
      <div className="mb-3 flex items-center gap-2">
        <LeoIcon name="book-open" size={14} className="text-fg/45" />
        <h3 className="text-sm font-semibold text-fg">Dictionary</h3>
        <span className="ml-auto text-[11px] text-fg/35">
          {entry.senses.length} {entry.senses.length === 1 ? "sense" : "senses"}
        </span>
      </div>

      {groups.length === 0 ? (
        <p className="rounded border border-border bg-bg/30 p-3 text-xs text-fg/45">
          No definitions on file.
        </p>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <section key={group.pos} className="min-w-0">
              <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-normal text-fg/45">
                {group.pos}
              </h4>
              <ol className="space-y-2">
                {group.items.map((sense, index) => (
                  <li
                    key={`${group.pos}-${index}`}
                    className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 text-sm"
                  >
                    <span className="pt-0.5 text-right font-mono text-[11px] text-fg/35">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="break-words leading-5 text-fg/85">
                        {sense.gloss}
                      </p>
                      {sense.examples.map((example) => (
                        <p
                          key={example}
                          className="mt-1 border-l border-border pl-2 text-xs italic leading-5 text-fg/45"
                        >
                          {example}
                        </p>
                      ))}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function RelationChip({
  value,
  onLookup,
}: {
  value: string;
  onLookup: (word: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onLookup(value)}
      title={`Look up ${value}`}
      className="min-w-0 rounded border border-border bg-accent/50 px-2 py-1 text-left text-xs leading-4 text-fg/70 transition-colors hover:border-primary/40 hover:bg-primary/15 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <span className="block break-words">{value}</span>
    </button>
  );
}

function ThesaurusPane({
  entry,
  onLookup,
}: {
  entry: LexiconEntry;
  onLookup: (word: string) => void;
}) {
  const relationGroups = LEXICON_RELATION_KINDS.map((kind) => ({
    kind,
    label: RELATION_LABELS[kind],
    items: entry.thesaurus[kind],
  })).filter((group) => group.items.length > 0);

  return (
    <section className="min-w-0 rounded border border-border bg-card/25 p-3">
      <div className="mb-3 flex items-center gap-2">
        <LeoIcon name="search" size={14} className="text-fg/45" />
        <h3 className="text-sm font-semibold text-fg">Thesaurus</h3>
        <span className="ml-auto text-[11px] text-fg/35">
          {relationGroups.length} groups
        </span>
      </div>

      {relationGroups.length === 0 ? (
        <p className="rounded border border-border bg-bg/30 p-3 text-xs text-fg/45">
          No thesaurus relations on file.
        </p>
      ) : (
        <div className="space-y-4">
          {relationGroups.map((group) => (
            <section key={group.kind} className="min-w-0">
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-normal text-fg/45">
                {group.label}
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {group.items.slice(0, 48).map((item) => (
                  <RelationChip
                    key={`${group.kind}-${item}`}
                    value={item}
                    onLookup={onLookup}
                  />
                ))}
                {group.items.length > 48 && (
                  <span className="rounded border border-border px-2 py-1 text-xs text-fg/35">
                    +{group.items.length - 48} more
                  </span>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function StatusPanel({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "warning" | "error";
}) {
  return (
    <div
      className={cx(
        "rounded border p-3 text-xs leading-5",
        tone === "warning"
          ? "border-warning/30 bg-warning/10 text-warning"
          : tone === "error"
            ? "border-destructive/30 bg-destructive/10 text-destructive"
            : "border-border bg-card/25 text-fg/45",
      )}
    >
      {children}
    </div>
  );
}

export function LexiconSection() {
  const [word, setWord] = useState("");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<LexiconMode>("dictionary");
  const [hydrated, setHydrated] = useState(false);
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    readStoredLookup()
      .then((stored) => {
        if (cancelled) return;
        if (!stored) {
          setHydrated(true);
          return;
        }
        const storedWord = normalizeQuery(stored.word ?? "");
        if (storedWord && storedWord !== LEGACY_DEFAULT_WORD) {
          setWord(storedWord);
          setQuery(storedWord);
        }
        if (isLexiconMode(stored.mode)) setMode(stored.mode);
        setHydrated(true);
      })
      .catch(() => {
        if (!cancelled) setHydrated(true);
      })
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeStoredLookup(lookupForStorage(word, mode));
  }, [hydrated, word, mode]);

  useEffect(() => {
    const lookupWord = normalizeQuery(word);
    if (!lookupWord) return;

    const controller = new AbortController();
    setState((current) => ({
      kind: "loading",
      word: lookupWord,
      previous: current.kind === "entry" ? current.entry : null,
    }));

    fetchLexiconEntry(lookupWord, { signal: controller.signal })
      .then((entry) => {
        setState({ kind: "entry", entry });
        setQuery(entry.word);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof LexiconHttpError && err.status === 404) {
          setState({
            kind: "missing",
            word: lookupWord,
            suggestions: err.suggestions,
          });
          return;
        }
        setState({
          kind: "error",
          word: lookupWord,
          message: err instanceof Error ? err.message : String(err),
        });
      });

    return () => controller.abort();
  }, [word]);

  useEffect(() => {
    const value = normalizeQuery(query);
    if (value.length < 2) {
      setSuggestions([]);
      setSuggestionsOpen(false);
      setSuggestionsLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSuggestionsLoading(true);
      searchLexiconWords(value, 8, { signal: controller.signal })
        .then((result) => {
          if (controller.signal.aborted) return;
          setSuggestions(result.suggestions);
          setSuggestionsOpen(result.suggestions.length > 0);
        })
        .catch(() => {
          if (!controller.signal.aborted) setSuggestions([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSuggestionsLoading(false);
        });
    }, 120);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const runLookup = (nextWord: string) => {
    const normalized = normalizeQuery(nextWord);
    if (!normalized) return;
    setWord(normalized);
    setQuery(normalized);
    setSuggestionsOpen(false);
    inputRef.current?.blur();
  };

  const changeMode = (nextMode: LexiconMode) => {
    setMode(nextMode);
    writeStoredLookup(lookupForStorage(word, nextMode));
  };

  const submitLookup = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    runLookup(query);
  };

  const activeEntry =
    state.kind === "entry"
      ? state.entry
      : state.kind === "loading"
        ? state.previous
        : null;

  const panes = activeEntry
    ? [
        <DefinitionsPane key="dictionary" entry={activeEntry} />,
        <ThesaurusPane
          key="thesaurus"
          entry={activeEntry}
          onLookup={runLookup}
        />,
      ]
    : [];
  const orderedPanes =
    mode === "dictionary"
      ? panes
      : panes.length === 2
        ? [panes[1], panes[0]]
        : panes;

  return (
    <section
      className="flex h-full min-w-0 flex-col overflow-hidden"
      data-testid="lexicon-section"
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-fg">Lexicon</h1>
          <p className="truncate text-[11px] text-fg/45">
            {(activeEntry?.word ?? word) || "Dictionary and thesaurus"}
          </p>
        </div>
        <a
          href={LEXICON_ORIGIN}
          onClick={openExternalLink(LEXICON_ORIGIN)}
          title="Open hosted lexicon"
          className="grid h-8 w-8 shrink-0 place-items-center rounded text-fg/45 transition-colors hover:bg-accent hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <LeoIcon name="globe" size={15} />
        </a>
      </header>

      <div className="border-b border-border p-3">
        <form className="relative" role="search" onSubmit={submitLookup}>
          <label className="sr-only" htmlFor="lexicon-search">
            Look up a word
          </label>
          <div className="flex min-w-0 items-center gap-2">
            <input
              ref={inputRef}
              id="lexicon-search"
              type="search"
              value={query}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => setQuery(event.currentTarget.value)}
              onFocus={() => suggestions.length > 0 && setSuggestionsOpen(true)}
              placeholder="Look up a word"
              className="min-w-0 flex-1 rounded border border-input bg-bg px-3 py-2 text-sm text-fg outline-none transition-colors placeholder:text-fg/30 focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
            />
            <LeoButton
              type="submit"
              size="md"
              variant="primary"
              disabled={!normalizeQuery(query)}
            >
              <LeoIcon name="search" size={13} />
              Lookup
            </LeoButton>
          </div>

          {suggestionsOpen && (
            <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-52 overflow-y-auto rounded border border-border bg-popover p-1 shadow-lg">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => runLookup(suggestion)}
                  className="block w-full rounded px-2 py-1.5 text-left text-sm text-fg/75 hover:bg-accent hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  {suggestion}
                </button>
              ))}
              {suggestionsLoading && (
                <div className="px-2 py-1.5 text-xs text-fg/35">
                  Searching...
                </div>
              )}
            </div>
          )}
        </form>

        <div className="mt-3 flex border-b border-border">
          {(["dictionary", "thesaurus"] as const).map((item) => (
            <LeoTabButton
              key={item}
              dense
              active={mode === item}
              onClick={() => changeMode(item)}
              className="flex-1"
            >
              {MODE_LABELS[item]}
            </LeoTabButton>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {state.kind === "loading" && !activeEntry && (
          <StatusPanel>Looking up {state.word}...</StatusPanel>
        )}

        {state.kind === "idle" && (
          <StatusPanel>
            Search for a word to see dictionary and thesaurus entries.
          </StatusPanel>
        )}

        {state.kind === "missing" && (
          <div className="space-y-3">
            <StatusPanel tone="warning">
              {state.word} is not in the lexicon.
            </StatusPanel>
            {state.suggestions.length > 0 && (
              <section className="rounded border border-border bg-card/25 p-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-normal text-fg/45">
                  Suggestions
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {state.suggestions.map((suggestion) => (
                    <RelationChip
                      key={suggestion}
                      value={suggestion}
                      onLookup={runLookup}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {state.kind === "error" && (
          <StatusPanel tone="error">
            Could not reach the lexicon for {state.word}: {state.message}
          </StatusPanel>
        )}

        {activeEntry && (
          <div
            className={cx(
              "space-y-3",
              state.kind === "loading" && "opacity-60",
            )}
          >
            <EntryHeader entry={activeEntry} />
            {!hasThesaurus(activeEntry) && activeEntry.senses.length === 0 ? (
              <StatusPanel>
                No dictionary or thesaurus data on file.
              </StatusPanel>
            ) : (
              <div className="grid gap-3 xl:grid-cols-2">{orderedPanes}</div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
