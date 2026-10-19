import type { Draft } from 'immer';
import {
  CHAT_EVERYONE,
  CHAT_MAX_LINES,
  CHAT_TO_DM,
  newId,
  nowIso,
  PARTY_VIEW,
  type ChatLine,
  type Encounter,
  type PlayerFeatures,
} from '@/core/model';
import type { PlayerChatLine } from './protocol';

/** The name DM lines carry. */
export const DM_NAME = 'DM';

/**
 * Whether `view` may read `line`: never the party view; a line to everyone reaches every character view, a
 * player's whisper only the view that wrote it, a DM whisper only the view it went to. The DM reads all lines.
 */
export function chatVisibleTo(line: ChatLine, view: string): boolean {
  const reaches =
    line.to === CHAT_EVERYONE || (line.to === CHAT_TO_DM ? line.from === view : line.from === null && line.to === view);
  return view !== PARTY_VIEW && reaches;
}

export function chatLine(
  from: string | null,
  name: string,
  to: string,
  kind: ChatLine['kind'],
  text: string,
): ChatLine {
  return { id: newId(), at: nowIso(), from, name, to, kind, text };
}

/** Adds `line`; the oldest lines drop off once the encounter keeps `CHAT_MAX_LINES`. */
export function appendChat(encounter: Draft<Encounter>, line: ChatLine): void {
  encounter.chat.push(line);
  if (encounter.chat.length > CHAT_MAX_LINES) {
    // One whole-field patch, which the remote DM mirror applies as is.
    encounter.chat = encounter.chat.slice(-CHAT_MAX_LINES);
  }
}

/** The lines `view` gets: said lines while the campaign has chat, shared rolls while it lets players share. */
export function playerChatLines(lines: readonly ChatLine[], view: string, features: PlayerFeatures): PlayerChatLine[] {
  return lines
    .filter((line) => chatVisibleTo(line, view) && (line.kind === 'say' ? features.chat : features.sharedRolls))
    .map((line) => ({
      id: line.id,
      at: line.at,
      by: line.name,
      kind: line.kind,
      text: line.text,
      whisper: line.to !== CHAT_EVERYONE,
    }));
}
