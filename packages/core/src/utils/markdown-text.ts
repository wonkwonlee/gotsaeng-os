const ALIASED_WIKI_LINK_PATTERN = /\[\[[^\]|]+\|([^\]]+)\]\]/g;
const WIKI_LINK_PATTERN = /\[\[([^\]]+)\]\]/g;
// Tolerate one level of literal/nested parens in the URL (e.g. Wikipedia links
// like .../Foo_(bar)) so the trailing ")" does not leak into the text.
const INLINE_LINK_PATTERN = /\[([^\]]+)\]\((?:[^()]|\([^()]*\))*\)/g;

/**
 * Replaces wiki links and inline Markdown links with their display text.
 * Shared by every text-cleanup path so a fix here cannot land in one copy only.
 */
export function stripLinkSyntax(text: string): string {
  return text
    .replace(ALIASED_WIKI_LINK_PATTERN, "$1")
    .replace(WIKI_LINK_PATTERN, "$1")
    .replace(INLINE_LINK_PATTERN, "$1");
}
