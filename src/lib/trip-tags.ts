/** The longest tag, in characters. The tag field and the store both use it. */
export const MAX_TAG_LENGTH = 40;

/** A tag as it is saved and shown: trimmed, each run of spaces one space, and in one Unicode form. */
export function cleanTagName(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/g, " ");
}

/** Which tag a name is. Names that differ only in letter case, spacing or Unicode form are the same tag. */
export function tagKey(name: string): string {
  return cleanTagName(name).toLowerCase();
}

/** Why a trip can't take a tag it already has, naming the tag as the trip has it. */
export function alreadyTagged(name: string): string {
  return `This trip is already tagged “${name}”.`;
}

/** Whether a trip's tags include every one of `selected`, compared as the same tag. */
export function hasEveryTag(tags: readonly string[], selected: readonly string[]): boolean {
  const keys = new Set(tags.map(tagKey));
  return selected.every((tag) => keys.has(tagKey(tag)));
}
