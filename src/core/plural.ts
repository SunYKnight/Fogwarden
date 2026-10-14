/** "1 goblin", "3 goblins"; irregular plurals pass `plural` ("1 enemy", "2 enemies"). */
export function countOf(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
