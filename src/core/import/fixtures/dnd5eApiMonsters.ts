import { z } from 'zod';
import { dnd5eMonsterSchema, type Dnd5eMonster } from '../dnd5eApi';
import monsters from './dnd5e-api-monsters.json';

/**
 * D&D 5e API monster documents (SRD 5.1, CC-BY-4.0) for tests and tools: the sample campaign's monsters plus
 * ones with legendary actions, spellcasting, forms and special armor class.
 */
export const FIXTURE_MONSTERS: Dnd5eMonster[] = z.array(dnd5eMonsterSchema).parse(monsters);
