import { Entity, Index, Column, PrimaryColumn, JoinColumn, OneToOne } from 'typeorm/browser';
import { Platform } from 'react-native';
import { forEach, flatMap, filter, keys, map, min, omit, find, sortBy, indexOf, sumBy } from 'lodash';
import { removeDiacriticalMarks } from 'remove-diacritical-marks'
import { t } from 'ttag';

import { SortType, SORT_BY_COST, SORT_BY_CYCLE, SORT_BY_ENCOUNTER_SET, SORT_BY_FACTION, SORT_BY_FACTION_PACK, SORT_BY_FACTION_XP, SORT_BY_FACTION_XP_TYPE_COST, SORT_BY_PACK, SORT_BY_TITLE, SORT_BY_TYPE, TraumaAndCardData } from '@actions/types';
import { BASIC_SKILLS, RANDOM_BASIC_WEAKNESS, type FactionCodeType, type TypeCodeType, SkillCodeType, BODY_OF_A_YITHIAN } from '@app_constants';
import DeckRequirement from './DeckRequirement';
import DeckOption from './DeckOption';
import { QuerySort } from '../sqlite/types';
import { CoreCardTextFragment, SingleCardFragment } from '@generated/graphql/apollo-schema';
import CustomizationOption, { CustomizationChoice } from './CustomizationOption';
import { processAdvancedChoice } from '@lib/parseDeck';

const SICKENING_REALITY_CARDS = new Set(['03065b', '03066b', '03067b', '03068b', '03069b'])
const SERPENTS_OF_YIG = '04014';
const USES_REGEX = /.*Uses\s*\([0-9]+(\s\[per_investigator\])?\s(.+)\)\..*/
const BONDED_REGEX = /.*Bonded\s*\((.+?)\)\..*/;
const SEAL_REGEX = /.*Seal \(.+\)\..*/;
const HEALS_HORROR_REGEX = /[Hh]eals? (that much )?((((\d+)|(all)|(X total)) )?damage (from that asset )?(and|or) )?(((\d+)|(all)|(X total)) )?horror/;
const HEALS_DAMAGE_REGEX = /[Hh]eals? (that much )?((((\d+)|(all)|(X total)) )?horror (from that asset )?(and|or) )?(((\d+)|(all)|(X total)) )?damage/;
const SEARCH_REGEX = /["“”‹›«»〞〝〟„＂❝❞‘’❛❜‛',‚❮❯\(\)\-\.…]/g;

export function searchNormalize(text: string, lang: string) {
  if (!text) {
    return '';
  }
  const r = text.toLocaleLowerCase(lang).replace(SEARCH_REGEX, '');
  try {
    if (Platform.OS === 'ios') {
      return removeDiacriticalMarks(r);
    }
    return r;
  } catch (e) {
    console.log(e);
    return r;
  }
}

export const CARD_NUM_COLUMNS = 130;
function arkham_num(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return '-';
  }
  if (value < 0) {
    return 'X';
  }
  return `${value}`;
}

const REPRINT_CARDS: {
  [code: string]: string[] | undefined;
} = {
  '01017': ['nat'],
  '01023': ['nat'],
  '01025': ['nat'],
  '02186': ['har'],
  '02020': ['har'],
  '01039': ['har'],
  '01044': ['win'],
  '03030': ['win'],
  '04107': ['win'],
  '04232': ['win'],
  '03194': ['win'],
  '01053': ['win'],
  '02029': ['jac'],
  '03034': ['jac'],
  '02190': ['jac'],
  '02153': ['jac'],
  '04032': ['jac'],

  '07004': ['bob'],
  '07005': ['tdg'],
  '02003': ['hoth'],
  '05001': ['tftbw'],
  '08004': ['iotv'],
};

const FEMININE_INVESTIGATORS = new Set([
  '01002', // Daisy Walker
  '01004', // Agnes Baker
  '01005', // Wendy Adams
  '02001', // Zoey Samaras
  '02003', // Jenny Barnes
  '03002', // Mihn Thi Phan
  '03003', // Sefina Rousseau
  '03004', // Akachi Onyele
  '03006', // Lola Hayes
  '04002', // Ursula Downs
  '05001', // Carolyn Fern
  '05004', // Diana
  '05005', // Rita
  '05006', // Marie
  '06002', // Mandy Thompson
  '06005', // Patrice
  '07001', // Sister Mary
  '07002', // Amanda Sharpe
  '07003', // Trish
  '08001', // Daniella
  '08020', // Lily Chen
  '60301', // Wini
  '60401', // Jacqueline
  '60501', // Stella
  '05046', // Gavriella Mizrah
  '05049', // Penny White
  '98001', // Alt-Jenny
  '98019', // Gloria
  '98010', // Alt-Carolyn
  '99001', // Old Marie
]);

const HEADER_SELECT = {
  [SORT_BY_FACTION]: 'c.sort_by_faction as headerId, c.sort_by_faction_header as headerTitle',
  [SORT_BY_FACTION_PACK]: 'c.sort_by_faction_pack as headerId, c.sort_by_faction_pack_header as headerTitle',
  [SORT_BY_FACTION_XP]: 'c.sort_by_faction_xp as headerId, c.sort_by_faction_xp_header as headerTitle',
  [SORT_BY_FACTION_XP_TYPE_COST]: 'c.sort_by_faction_xp as headerId, c.sort_by_faction_xp_header as headerTitle',
  [SORT_BY_COST]: 'c.cost as headerId, c.sort_by_cost_header as headerTitle',
  [SORT_BY_PACK]: 'c.sort_by_pack as headerId, c.pack_name as headerTitle',
  [SORT_BY_ENCOUNTER_SET]: 'c.encounter_code as headerId, c.sort_by_encounter_set_header as headerTitle',
  [SORT_BY_TITLE]: '"0" as headerId',
  [SORT_BY_TYPE]: 'c.sort_by_type as headerId, c.sort_by_type_header as headerTitle',
  [SORT_BY_CYCLE]: 'c.sort_by_cycle as headerId, c.cycle_name as headerTitle',
};

export class PartialCard {
  public id: string;
  public code: string;
  public renderName: string;
  public renderSubName?: string;

  public headerId: string;
  public headerTitle: string;
  public pack_code: string;
  public reprint_pack_codes?: string[];
  public spoiler?: boolean;

  constructor(
    id: string,
    code: string,
    renderName: string,
    headerId: string,
    headerTitle: string,
    pack_code: string,
    reprint_pack_codes?: string[],
    renderSubName?: string,
    spoiler?: boolean,
  ) {
    this.id = id;
    this.code = code;
    this.renderName = renderName;
    this.headerId = headerId;
    this.headerTitle = headerTitle;
    this.pack_code = pack_code;
    this.reprint_pack_codes = reprint_pack_codes;
    this.renderSubName = renderSubName;
    this.spoiler = spoiler;
  }

  public static selectStatement(sort?: SortType): string {
    const parts: string[] = [
      `c.id as id`,
      `c.code as code`,
      `c.renderName as renderName`,
      `c.renderSubname as renderSubname`,
      `c.pack_code as pack_code`,
      `c.reprint_pack_codes as reprint_pack_codes`,
      `c.spoiler as spoiler`,
      HEADER_SELECT[sort || SORT_BY_TYPE],
    ];
    return parts.join(', ');
  }

  public static fromRaw(raw: any, sort?: SortType): PartialCard | undefined {
    if (raw.id !== null && raw.code !== null && raw.renderName !== null && raw.pack_code !== null) {
      return new PartialCard(
        raw.id,
        raw.code,
        raw.renderName,
        (raw.headerId === null || raw.headerId === undefined) ? 'null' : `${raw.headerId}`,
        sort === SORT_BY_TITLE ? t`All Cards` : raw.headerTitle,
        raw.pack_code,
        raw.reprint_pack_codes ? raw.reprint_pack_codes.split(',') : undefined,
        raw.renderSubname,
        !!raw.spoiler
      );
    }
    return undefined;
  }
}

@Entity('card')
@Index('code_taboo', ['code', 'taboo_set_id'], { unique: true })
@Index('player_cards', ['browse_visible'])
@Index('sort_type', ['browse_visible', 'taboo_set_id', 'sort_by_type', 'renderName', 'xp'])
@Index('sort_faction', ['browse_visible', 'taboo_set_id', 'sort_by_faction', 'renderName', 'xp'])
@Index('sort_faction_pack', ['browse_visible', 'taboo_set_id', 'sort_by_faction_pack', 'code'])
@Index('sort_faction_xp', ['browse_visible', 'taboo_set_id', 'sort_by_faction_xp', 'renderName'])
@Index('sort_cost', ['browse_visible', 'taboo_set_id', 'cost', 'renderName', 'xp'])
@Index('sort_pack', ['browse_visible', 'taboo_set_id', 'sort_by_pack', 'position'])
@Index('sort_pack_encounter', ['browse_visible', 'taboo_set_id', 'sort_by_pack', 'encounter_code', 'encounter_position'])
@Index('sort_name_xp', ['browse_visible', 'taboo_set_id', 'renderName', 'xp'])
@Index('sort_cycle_xp', ['browse_visible', 'taboo_set_id', 'sort_by_cycle'])
@Index('encounter_query_index', ['browse_visible', 'taboo_set_id', 'encounter_code'])
@Index('type_code', ['type_code'])
export default class Card {
  @PrimaryColumn('text')
  public id!: string;

  @Index('code')
  @Column('text')
  public code!: string;

  @Column('text')
  public name!: string;

  @Index('real_name')
  @Column('text')
  public real_name!: string;

  @Index()
  @Column('text')
  public renderName!: string;

  @Column('text', { nullable: true })
  public duplicate_of_code?: string;

  @Column('simple-array', { nullable: true })
  public reprint_pack_codes?: string[];

  @Column('text')
  public type_code!: TypeCodeType;

  @Column('text', { nullable: true })
  public alternate_of_code?: string;

  @Column('text', { nullable: true })
  public alternate_required_code?: string;

  @Column('integer', { nullable: true })
  public taboo_set_id?: number;

  @Column('boolean', { nullable: true })
  public taboo_placeholder?: boolean;

  @Column('text', { nullable: true })
  public taboo_text_change?: string;

  @Index('pack_code')
  @Column('text')
  public pack_code!: string;

  @Column('text', { nullable: true })
  public pack_name?: string;

  @Column('text')
  public type_name!: string;

  @Column('text', { nullable: true })
  public subtype_code?: 'basicweakness' | 'weakness';

  @Column('text', { nullable: true })
  public subtype_name?: string;

  @Column('text', { nullable: true })
  public slot?: string;

  @Column('text', { nullable: true })
  public real_slot?: string;

  @Index('faction_code')
  @Column('text', { nullable: true })
  public faction_code?: FactionCodeType;

  @Column('text', { nullable: true })
  public faction_name?: string;

  @Column('text', { nullable: true })
  public faction2_code?: FactionCodeType;

  @Column('text', { nullable: true })
  public faction2_name?: string;

  @Column('text', { nullable: true })
  public faction3_code?: FactionCodeType;

  @Column('text', { nullable: true })
  public faction3_name?: string;

  @Column('integer', { nullable: true })
  public position?: number;

  @Column('integer', { nullable: true })
  public enemy_damage?: number;

  @Column('integer', { nullable: true })
  public enemy_horror?: number;

  @Column('integer', { nullable: true })
  public enemy_fight?: number;

  @Column('integer', { nullable: true })
  public enemy_evade?: number;

  @Index('encounter_code')
  @Column('text', { nullable: true })
  public encounter_code?: string;

  @Column('text', { nullable: true })
  public encounter_name?: string;

  @Column('integer', { nullable: true })
  public encounter_position?: number;

  @Column('integer', { nullable: true })
  public encounter_size?: number;

  @Column('boolean', { nullable: true })
  public exceptional?: boolean;

  @Index('xp')
  @Column('integer', { nullable: true })
  public xp?: number;

  @Column('integer', { nullable: true })
  public extra_xp?: number;

  @Column('integer', { nullable: true })
  public victory?: number;

  @Column('integer', { nullable: true })
  public vengeance?: number;

  @Column('text', { nullable: true })
  public renderSubname?: string;

  @Column('text', { nullable: true })
  public subname?: string;

  @Column('text', { nullable: true })
  public firstName?: string;

  @Column('text', { nullable: true })
  public illustrator?: string;

  @Column('text', { nullable: true })
  public text?: string;

  @Column('text', { nullable: true })
  public flavor?: string;

  @Column('integer', { nullable: true })
  public cost?: number;
  @Column('text', { nullable: true })
  public real_text?: string;
  @Column('text', { nullable: true })
  public back_name?: string;
  @Column('text', { nullable: true })
  public back_text?: string;
  @Column('text', { nullable: true })
  public back_flavor?: string;
  @Column('integer', { nullable: true })
  public quantity?: number;
  @Column('boolean', { nullable: true })
  public spoiler?: boolean;
  @Column('boolean', { nullable: true })
  public advanced?: boolean;
  @Column('integer', { nullable: true })
  public stage?: number; // Act/Agenda deck
  @Column('integer', { nullable: true })
  public clues?: number;
  @Column('integer', { nullable: true })
  public shroud?: number;
  @Column('boolean', { nullable: true })
  public clues_fixed?: boolean;
  @Column('integer', { nullable: true })
  public doom?: number;
  @Column('integer', { nullable: true })
  public health?: number;
  @Column('boolean', { nullable: true })
  public health_per_investigator?: boolean;
  @Column('integer', { nullable: true })
  public sanity?: number;

  @Column('text', { select: false })
  public s_search_name!: string;
  @Column('text', { select: false })
  public s_search_name_back!: string;
  @Column('text', { select: false })
  public s_search_game?: string;
  @Column('text', { select: false })
  public s_search_game_back?: string;
  @Column('text', { select: false })
  public s_search_flavor?: string;
  @Column('text', { select: false })
  public s_search_flavor_back?: string;

  @Column('text', { select: false })
  public s_search_real_name!: string;
  @Column('text', { select: false })
  public s_search_real_name_back!: string;
  @Column('text', { select: false })
  public s_search_real_game?: string;

  @Index('deck_limit')
  @Column('integer', { nullable: true })
  public deck_limit?: number;
  @Column('text', { nullable: true })
  public traits?: string;
  @Column('text', { nullable: true })
  public real_traits?: string;
  @Column('boolean', { nullable: true })
  public is_unique?: boolean;
  @Column('boolean', { nullable: true })
  public exile?: boolean;
  @Column('boolean', { nullable: true })
  public hidden?: boolean;
  @Column('boolean', { nullable: true })
  public myriad?: boolean;
  @Column('boolean', { nullable: true })
  public permanent?: boolean;
  @Column('boolean', { nullable: true })
  public double_sided?: boolean;
  @Column('text', { nullable: true })
  public url?: string;
  @Column('text', { nullable: true })
  public octgn_id?: string;
  @Column('text', { nullable: true })
  public imagesrc?: string;
  @Column('text', { nullable: true })
  public backimagesrc?: string;
  @Column('integer', { nullable: true })
  public skill_willpower?: number;
  @Column('integer', { nullable: true })
  public skill_intellect?: number;
  @Column('integer', { nullable: true })
  public skill_combat?: number;
  @Column('integer', { nullable: true })
  public skill_agility?: number;
  @Column('integer', { nullable: true })
  public skill_wild?: number;

  // Effective skills (add wilds to them)
  @Column('integer', { nullable: true, select: false })
  public eskill_willpower?: number;
  @Column('integer', { nullable: true, select: false })
  public eskill_intellect?: number;
  @Column('integer', { nullable: true, select: false })
  public eskill_combat?: number;
  @Column('integer', { nullable: true, select: false })
  public eskill_agility?: number;
  @Column('text', { nullable: true, select: false })
  public linked_to_code?: string;
  @Column('text', { nullable: true, select: false })
  public linked_to_name?: string;

  @Column('simple-array', { nullable: true })
  public restrictions_all_investigators?: string[];
  @Column('text', { nullable: true })
  public restrictions_investigator?: string;

  @Column('simple-json', { nullable: true })
  public deck_requirements?: DeckRequirement;
  @Column('simple-json', { nullable: true })
  public deck_options?: DeckOption[];

  @Column('simple-json', { nullable: true })
  public customization_options?: CustomizationOption[];

  @OneToOne(() => Card, { cascade: true, eager: true })
  @Index()
  @JoinColumn({ name: 'linked_card_id' })
  public linked_card?: Card;

  @Column('boolean', { nullable: true, select: false })
  public back_linked?: boolean;

  // Derived data.
  @Column('boolean', { nullable: true })
  public altArtInvestigator?: boolean;
  @Column('text', { nullable: true })
  public cycle_name?: string;
  @Column('text', { nullable: true })
  public cycle_code?: string;
  @Column('boolean', { nullable: true })
  public has_restrictions?: boolean;
  @Column('boolean', { nullable: true })
  public has_upgrades?: boolean;
  @Column('text', { nullable: true })
  public traits_normalized?: string;
  @Column('text', { nullable: true })
  public real_traits_normalized?: string;
  @Column('text', { nullable: true, select: false })
  public slots_normalized?: string;
  @Column('text', { nullable: true })
  public real_slots_normalized?: string;
  @Column('boolean', { nullable: true })
  public removable_slot?: boolean;

  @Column('text', { nullable: true })
  public uses?: string;
  @Column('text', { nullable: true })
  public bonded_name?: string;
  @Column('boolean', { nullable: true })
  public bonded_from?: boolean;

  @Column('boolean', { nullable: true })
  public seal?: boolean;
  @Column('boolean', { nullable: true })
  public heals_horror?: boolean;
  @Column('boolean', { nullable: true })
  public heals_damage?: boolean;

  @Column('integer', { nullable: true, select: false })
  public sort_by_type?: number;
  @Column('text', { nullable: true, select: false })
  public sort_by_type_header?: string;
  @Column('integer', { nullable: true, select: false })
  public sort_by_faction?: number;
  @Column('text', { nullable: true, select: false })
  public sort_by_faction_header?: string;
  @Column('integer', { nullable: true, select: false })
  public sort_by_faction_pack?: number;
  @Column('text', { nullable: true, select: false })
  public sort_by_faction_pack_header?: string;
  @Column('integer', { nullable: true, select: false })
  public sort_by_faction_xp?: number;
  @Column('text', { nullable: true, select: false })
  public sort_by_faction_xp_header?: string;
  @Column('text', { nullable: true, select: false })
  public sort_by_cost_header?: string;
  @Column('text', { nullable: true, select: false })
  public sort_by_encounter_set_header?: string;
  @Column('integer', { nullable: true, select: false })
  public sort_by_pack?: number;
  @Column('integer', { nullable: true, select: false })
  public sort_by_cycle?: number;

  @Column('integer', { nullable: true, select: false })
  public browse_visible!: number;

  @Column('boolean')
  public mythos_card!: boolean;

  public static ELIDED_FIELDS = [
    'c.slots_normalized',
    'c.back_linked',
    'c.eskill_willpower',
    'c.eskill_intellect',
    'c.eskill_combat',
    'c.eskill_agility',
    'c.linked_to_code',
    'c.linked_to_name',
    'c.sort_by_type',
    'c.sort_by_type_header',
    'c.sort_by_faction',
    'c.sort_by_faction_header',
    'c.sort_by_faction_pack',
    'c.sort_by_faction_pack_header',
    'c.sort_by_faction_xp',
    'c.sort_by_faction_xp_header',
    'c.sort_by_cost_header',
    'c.sort_by_encounter_set_header',
    'c.sort_by_pack',
    'c.browse_visible',
    'c.s_search_name',
    'c.s_search_name_back',
    'c.s_search_game',
    'c.s_search_game_back',
    'c.s_search_flavor',
    'c.s_search_flavor_back',
    'c.s_search_real_name',
    'c.s_search_real_name_back',
    'c.s_search_real_game',
  ];

  public clone(): Card {
    const card = new Card();
    forEach(Object.keys(this), key => {
      // @ts-ignore ts7053
      card[key] = this[key];
    });
    return card;
  }

  public customizationChoice(index: number, xp: number, choice: string | undefined, cards: CardsMap): CustomizationChoice | undefined {
    if (!this.customization_options) {
      return undefined;
    }
    const option = this.customization_options[index];
    if (!option) {
      return undefined;
    }
    return processAdvancedChoice({
      option,
      xp_spent: xp,
      xp_locked: 0,
      unlocked: option.xp === xp,
      editable: true,
    }, choice, option, cards);
  }

  public withCustomizations(listSeperator: string, customizations: CustomizationChoice[] | undefined, location: string): Card {
    if (!this.customization_options) {
      return this;
    }
    if (!customizations || !find(customizations, c => c.xp_spent || c.unlocked)) {
      return this;
    }
    const card = this.clone();
    const xp_spent = sumBy(customizations, c => c.xp_spent);
    card.xp = Math.floor((xp_spent + 1) / 2.0);
    const unlocked = sortBy(filter(customizations, c => c.unlocked), c => c.option.index);
    const lines = (card.text || '').split('\n');

    const text_edits: string[] = [];
    forEach(unlocked, (change) => {
      const option = change.option;
      if (option.health) {
        card.health = (card.health || 0) + option.health;
      }
      if (option.sanity) {
        card.sanity = (card.sanity || 0) + option.sanity;
      }
      if (option.deck_limit) {
        card.deck_limit = option.deck_limit;
      }
      if (option.real_slot) {
        card.real_slot = option.real_slot;
      }
      if (option.cost) {
        card.cost = (card.cost || 0) + option.cost;
      }
      if (option.real_traits) {
        card.real_traits = option.real_traits;
      }
      let text_edit = option.text_edit || '';
      if (option.text_change && option.choice) {
        switch (change.type) {
          case 'choose_trait': {
            const traits = (change.choice.map(x => `[[${x}]]`).join(listSeperator) || '');
            text_edit = traits ? text_edit.replace('_____', `<u>${traits}</u>`) : text_edit;
            break;
          }
          case 'choose_card':
            const cardNames = change.cards.map(card => card.name).join(listSeperator)
            text_edit = cardNames ? `${text_edit} <u>${cardNames}</u>` : text_edit;
            break;
        }
      }
      text_edits.push(text_edit);
      if (option.text_change && text_edit) {
        const position = option.position || 0;
        if (option.choice !== 'choose_card') {
          switch (option.text_change) {
            case 'trait':
              card.traits = text_edit;
              break;
            case 'insert':
              // Delayed execution
              break;
            case 'replace':
              lines[position] = text_edit;
              break;
            case 'append':
              lines.push(text_edit);
              break;
          }
        }
      }
      if (option.choice) {
        switch(change.type) {
          case 'remove_slot': {
            if (card.real_slot) {
              card.real_slot = flatMap(card.real_slot.split('.'), (slot, index) => {
                if (index === change.choice) {
                  return [];
                }
                return slot.trim();
              }).join('. ');
            }
            if (card.slot) {
              card.slot = flatMap(card.slot.split('.'), (slot, index) => {
                if (index === change.choice) {
                  return [];
                }
                return slot.trim();
              }).join('. ');
            }
          }
        }
      }
    });
    const final_lines: string[] = [];
    forEach(unlocked, ({ option }, idx) => {
      const text_edit = text_edits[idx];
      if (option.text_change === 'insert' && option.position === -1 && text_edit) {
        final_lines.push(text_edit);
      }
    });

    forEach(lines, (line, idx) => {
      final_lines.push(line);
      forEach(unlocked, ({ option }, unlockedIdx) => {
        const text_edit = text_edits[unlockedIdx];
        if (option.text_change === 'insert' && option.position === idx && text_edit) {
          final_lines.push(text_edit);
        }
      });
    });
    card.text = final_lines.join('\n');
    return card;
  }

  public cardName(): string {
    return this.subname ? t`${this.name} <i>(${this.subname})</i>` : this.name;
  }

  public custom(): boolean {
    return this.code.startsWith('z');
  }

  public grammarGenderMasculine(): boolean {
    return !FEMININE_INVESTIGATORS.has(this.code);
  }

  public enemyFight(): string {
    return arkham_num(this.enemy_fight);
  }
  public enemyEvade(): string {
    return arkham_num(this.enemy_evade);
  }
  public enemyHealth(): string {
    return arkham_num(this.health);
  }

  public matchesOption(option: DeckOption): boolean {
    if (option.type_code) {
      if (!find(option.type_code, type_code => this.type_code === type_code)) {
        return false;
      }
    }
    if (option.trait) {
      if (!find(option.trait, trait => !!this.real_traits && this.real_traits.toLowerCase().indexOf(trait.toLowerCase()) !== -1)) {
        return false;
      }
    }
    return true;
  }

  public imageUri(): string | undefined {
    if (!this.imagesrc) {
      return undefined;
    }
    const baseUri = this.custom() ? 'https://img.arkhamcards.com' : 'https://arkhamdb.com';
    const uri = `${baseUri}${this.imagesrc}`;
    return uri;
  }
  public backImageUri(): string | undefined {
    if (!this.backimagesrc) {
      return undefined;
    }
    const baseUri = this.custom() ? 'https://img.arkhamcards.com' : 'https://arkhamdb.com';
    return `${baseUri}${this.backimagesrc}`;
  }

  isBasicWeakness(): boolean {
    return this.type_code !== 'scenario' &&
      this.subtype_code === 'basicweakness';
  }

  factionPackSortHeader() {
    return `${Card.factionSortHeader(this)} - ${this.cycle_name}`;
  }

  factionCode(): FactionCodeType {
    return this.faction_code || 'neutral';
  }

  factionCodes(): FactionCodeType[] {
    return [
      this.faction_code || 'neutral',
      ...(this.faction2_code ? [this.faction2_code] : []),
      ...(this.faction3_code ? [this.faction3_code] : []),
    ];
  }

  getHealth(traumaData: TraumaAndCardData | undefined) {
    if (!traumaData) {
      return this.health || 0;
    }
    const isYithian = !!(traumaData.storyAssets && find(traumaData.storyAssets, code => code === BODY_OF_A_YITHIAN));
    return isYithian ? 7 : (this.health || 0);
  }

  getSanity(traumaData: TraumaAndCardData | undefined) {
    if (!traumaData) {
      return this.sanity || 0;
    }
    const isYithian = !!(traumaData.storyAssets && find(traumaData.storyAssets, code => code === BODY_OF_A_YITHIAN));
    return isYithian ? 7 : (this.sanity || 0);
  }

  killed(traumaData: TraumaAndCardData | undefined) {
    if (!traumaData) {
      return false;
    }
    if (traumaData.killed) {
      return true;
    }
    return this.getHealth(traumaData) <= (traumaData.physical || 0);
  }

  insane(traumaData: TraumaAndCardData | undefined) {
    if (!traumaData) {
      return false;
    }
    if (traumaData.insane) {
      return true;
    }
    return this.getSanity(traumaData) <= (traumaData.mental || 0);
  }

  eliminated(traumaData: TraumaAndCardData | undefined) {
    return this.killed(traumaData) || this.insane(traumaData);
  }

  hasTrauma(traumaData: TraumaAndCardData | undefined) {
    return this.eliminated(traumaData) || (traumaData && (
      (traumaData.physical || 0) > 0 ||
      (traumaData.mental || 0) > 0
    ));
  }

  traumaString(listSeperator: string, traumaData: TraumaAndCardData | undefined) {
    if (!traumaData) {
      return t`None`;
    }
    const parts = [];
    if (this.killed(traumaData)) {
      return t`Killed`;
    }
    if (this.insane(traumaData)) {
      return t`Insane`;
    }
    if (traumaData.physical && traumaData.physical !== 0) {
      parts.push(t`${traumaData.physical} Physical`);
    }
    if (traumaData.mental && traumaData.mental !== 0) {
      parts.push(t`${traumaData.mental} Mental`);
    }
    if (!parts.length) {
      return t`None`;
    }
    return parts.join(listSeperator);
  }

  realCost(linked?: boolean) {
    if (this.type_code !== 'asset' && this.type_code !== 'event') {
      return null;
    }
    if (
      this.code === '02010' ||
      this.code === '03238' ||
      this.cost === -2
    ) {
      return 'X';
    }
    if (this.permanent ||
      this.double_sided ||
      linked ||
      this.cost === null
    ) {
      return '-';
    }
    return `${this.cost}`;
  }

  costString(linked?: boolean) {
    const actualCost = this.realCost(linked);
    if (actualCost === null) {
      return '';
    }
    return t`Cost: ${actualCost}`;
  }

  skillCount(skill: SkillCodeType): number {
    switch (skill) {
      case 'willpower': return this.skill_willpower || 0;
      case 'intellect': return this.skill_intellect || 0;
      case 'combat': return this.skill_combat || 0;
      case 'agility': return this.skill_agility || 0;
      case 'wild': return this.skill_wild || 0;
      default: {
        /* eslint-disable @typescript-eslint/no-unused-vars */
        const _exhaustiveCheck: never = skill;
        return 0;
      }
    }
  }

  investigatorSelectOptions(): DeckOption[] {
    if (this.type_code === 'investigator' && this.deck_options) {
      return filter(this.deck_options, option => {
        return !!(option.faction_select && option.faction_select.length > 0) ||
          !!(option.deck_size_select && option.deck_size_select.length > 0) ||
          !!(option.option_select && option.option_select.length > 0);
      });
    }
    return [];
  }

  collectionQuantity(packInCollection: { [pack_code: string]: boolean | undefined }, ignore_collection: boolean): number {
    if (this.pack_code === 'core') {
      if (packInCollection.core || ignore_collection) {
        return (this.quantity || 0) * 2;
      }
      const reprintPacks = this.reprint_pack_codes || REPRINT_CARDS[this.code];
      if (reprintPacks && find(reprintPacks, pack => !!packInCollection[pack])) {
        return (this.quantity || 0) * 2;
      }
    }
    return this.quantity || 0;
  }

  collectionDeckLimit(packInCollection: { [pack_code: string]: boolean | undefined }, ignore_collection: boolean): number {
    if (ignore_collection) {
      return this.deck_limit || 0;
    }
    if (this.pack_code !== 'core' || packInCollection.core) {
      return this.deck_limit || 0;
    }
    const reprintPacks = this.reprint_pack_codes || REPRINT_CARDS[this.code];
    if (reprintPacks && find(reprintPacks, pack => !!packInCollection[pack])) {
      return this.deck_limit || 0;
    }
    return Math.min(this.quantity || 0, this.deck_limit || 0);
  }

  static parseRestrictions(json?: {
    investigator?: {
      [key: string]: string;
    };
  }): Partial<Card> | undefined {
    if (json && json.investigator && keys(json.investigator).length) {
      const investigators = keys(json.investigator);
      const mainInvestigator = min(investigators);
      return {
        restrictions_all_investigators: investigators,
        restrictions_investigator: mainInvestigator,
      };
    }
    return undefined;
  }

  static basicFactions() {
    return [t`Guardian`, t`Seeker`, t`Rogue`, t`Mystic`, t`Survivor`];
  }

  static factionHeaderOrder() {
    const factions = Card.basicFactions();
    const triples: string[] = [];
    const doubles: string[] = [];
    forEach(factions, (f1, idx1) => {
      forEach(factions, (f2, idx2) => {
        if (idx1 < idx2) {
          forEach(factions, (f3, idx3) => {
            if (idx1 < idx2 && idx2 < idx3) {
              triples.push(`${f1} / ${f2} / ${f3}`)
            }
          });
          doubles.push(`${f1} / ${f2}`)
        }
      });
    })
    return [
      ...factions,
      t`Neutral`,
      ...doubles,
      ...triples,
      t`Basic Weakness`,
      t`Signature Weakness`,
      t`Weakness`,
      t`Mythos`,
    ];
  }

  static factionCodeToName(code: string, defaultName: string) {
    switch(code) {
      case 'guardian':
        return t`Guardian`;
      case 'rogue':
        return t`Rogue`;
      case 'mystic':
        return t`Mystic`;
      case 'seeker':
        return t`Seeker`;
      case 'survivor':
        return t`Survivor`;
      case 'neutral':
        return t`Neutral`;
      default:
        return defaultName;
    }
  }

  static factionSortHeader(json: any) {
    if (json.spoiler) {
      return t`Mythos`;
    }
    switch(json.subtype_code) {
      case 'basicweakness':
        return t`Basic Weakness`;
      case 'weakness':
        if (json.restrictions || json.has_restrictions) {
          return t`Signature Weakness`;
        }
        return t`Weakness`;
      default: {
        if (!json.faction_code || !json.faction_name) {
          return t`Unknown`;
        }
        if (json.faction2_code && json.faction2_name) {
          const factions = Card.basicFactions();
          const faction1 = Card.factionCodeToName(json.faction_code, json.faction_name);
          const faction2 = Card.factionCodeToName(json.faction2_code, json.faction2_name);
          if (json.faction3_code && json.faction3_name) {
            const faction3 = Card.factionCodeToName(json.faction3_code, json.faction3_name);
            const [f1, f2, f3] = sortBy([faction1, faction2, faction3], x => indexOf(factions, x))
            return `${f1} / ${f2} / ${f3}`;
          }
          const [f1, f2] = sortBy([faction1, faction2], x => indexOf(factions, x));
          return `${f1} / ${f2}`;
        }
        return Card.factionCodeToName(json.faction_code, json.faction_name);
      }
    }
  }

  static basicTypeHeaderOrder() {
    return [
      t`Investigator`,
      t`Asset`,
      t`Event`,
      t`Skill`,
      t`Basic Weakness`,
      t`Signature Weakness`,
      t`Weakness`,
      t`Scenario`,
      t`Story`,
    ];
  }


  static typeHeaderOrder() {
    return [
      t`Investigator`,
      t`Asset: Hand`,
      t`Asset: Hand x2`,
      t`Asset: Accessory`,
      t`Asset: Ally`,
      t`Asset: Arcane`,
      t`Asset: Arcane x2`,
      t`Asset: Body`,
      t`Asset: Permanent`,
      t`Asset: Tarot`,
      t`Asset: Ally. Arcane`,
      t`Asset: Body. Arcane`,
      t`Asset: Hand. Arcane`,
      t`Asset: Hand x2. Arcane`,
      t`Asset: Body. Hand x2`,
      t`Asset: Other`,
      t`Event`,
      t`Skill`,
      t`Basic Weakness`,
      t`Signature Weakness`,
      t`Weakness`,
      t`Scenario`,
      t`Story`,
    ];
  }

  static typeSortHeader(json: any, basic?: boolean): string {
    if (json.hidden && json.linked_card) {
      return Card.typeSortHeader(json.linked_card, basic);
    }
    switch(json.subtype_code) {
      case 'basicweakness':
        return t`Basic Weakness`;
      case 'weakness':
        if (json.spoiler) {
          return t`Story`;
        }
        if (json.restrictions || json.has_restrictions) {
          return t`Signature Weakness`;
        }
        return t`Weakness`;
      default:
        switch(json.type_code) {
          case 'asset':
            if (json.spoiler || json.encounter_code) {
              return t`Story`;
            }
            if (basic) {
              return t`Asset`;
            }
            if (json.permanent || json.double_sided) {
              return t`Asset: Permanent`;
            }
            switch(json.real_slot) {
              case 'Hand':
                return t`Asset: Hand`;
              case 'Hand x2':
                return t`Asset: Hand x2`;
              case 'Accessory':
                return t`Asset: Accessory`;
              case 'Ally':
                return t`Asset: Ally`;
              case 'Arcane':
                return t`Asset: Arcane`;
              case 'Arcane x2':
                return t`Asset: Arcane x2`;
              case 'Body':
                return t`Asset: Body`;
              case 'Tarot':
                return t`Asset: Tarot`;
              case 'Body. Arcane':
                return t`Asset: Body. Arcane`;
              case 'Body. Hand x2':
                return t`Asset: Body. Hand x2`;
              case 'Hand. Arcane':
                return t`Asset: Hand. Arcane`;
              case 'Hand x2. Arcane':
                return t`Asset: Hand x2. Arcane`;
              case 'Ally. Arcane':
                return t`Asset: Ally. Arcane`;
              default:
                return t`Asset: Other`;
            }
          case 'event':
            if (json.spoiler) {
              return t`Story`;
            }
            return t`Event`;
          case 'skill':
            if (json.spoiler) {
              return t`Story`;
            }
            return t`Skill`;
          case 'investigator':
            if (json.spoiler) {
              return t`Story`;
            }
            return t`Investigator`;
          default:
            return t`Scenario`;
        }
    }
  }

  private static gqlToJson(
    card: SingleCardFragment & {
      translations: CoreCardTextFragment[];
      linked_card?: null | (SingleCardFragment & {
        translations: CoreCardTextFragment[];
      });
    },
    encounterSets: { [code: string]: string | undefined },
    packs: {
      [pack_code: string]: {
        name: string;
        position: number;
        cycle_name: string;
        cycle_position: number;
      };
    },
    cardTypeNames: {
      [type_code: string]: string
    },
    subTypeName: {
      [type_code: string]: string
    },
    factionNames: {
      [faction_code: string]: string
    }
  ) {
    const OMIT_FIELDS = ['__typename', 'real_pack_name', 'real_flavor', 'real_customization_text', 'real_taboo_text_change', 'real_customization_text'];
    const json: any = card.translations.length ? {
      ...omit(card, OMIT_FIELDS),
      ...omit(card.translations[0], '__typename'),
    } : {
      ...omit(card, OMIT_FIELDS),
      flavor: card.real_flavor,
      name: card.real_name,
      slot: card.real_slot,
      subname: card.real_subname,
      text: card.real_text,
      traits: card.real_traits,
      back_flavor: card.real_back_flavor,
      back_name: card.real_back_name,
      back_text: card.real_back_text,
      customization_text: card.real_customization_text,
      customization_change: card.real_customization_change,
      taboo_text_change: card.real_taboo_text_change,
    };
    json.encounter_name = card.encounter_code ? (encounterSets[card.encounter_code] || card.real_encounter_set_name) : undefined;
    json.pack_name = packs[card.pack_code]?.name || card.real_pack_name;
    json.cycle_name = packs[card.pack_code]?.cycle_name;
    json.extra_xp = json.taboo_xp;

    json.type_name = cardTypeNames[card.type_code];
    json.faction_name = factionNames[card.faction_code];
    if (card.subtype_code) {
      json.subtype_name = subTypeName[card.subtype_code];
    }
    return json;
  }

  static fromGraphQl(
    card: SingleCardFragment & {
      translations: CoreCardTextFragment[];
      linked_card?: null | (SingleCardFragment & {
        translations: CoreCardTextFragment[];
      });
    },
    lang: string,
    encounterSets: { [code: string]: string | undefined },
    packs: {
      [pack_code: string]: {
        name: string;
        position: number;
        cycle_position: number;
        cycle_name: string;
      };
    },
    cycles: {
      [cycle_code: string]: {
        name: string;
        position: number;
      };
    },
    types: {
      [type_code: string]: string
    },
    subtypes: {
      [type_code: string]: string
    },
    factions: {
      [faction_code: string]: string
    }
  ) {
    const json = Card.gqlToJson(card, encounterSets, packs, types, subtypes, factions);
    if (card.linked_card) {
      json.linked_card = Card.gqlToJson(card.linked_card, encounterSets, packs, types, subtypes, factions);
      json.linked_to_code = json.linked_card.id;
      json.linked_to_name = json.linked_card.real_name;
    }
    return Card.fromJson(json, packs, cycles, lang);
  }

  static fromJson(
    json: any,
    packsByCode: {
      [pack_code: string]: {
        position: number;
        cycle_position: number;
      };
    },
    cycleNames: {
      [cycle_code: string]: {
        name?: string;
        code?: string;
      };
    },
    lang: string
  ): Card {
    if (json.code === '02041') {
      json.subtype_code = null;
      json.subtype_name = null;
    }
    const deck_requirements = json.deck_requirements ?
      DeckRequirement.parse(json.deck_requirements) :
      null;
    const deck_options = json.deck_options ?
      DeckOption.parseList(typeof json.deck_options === 'string' ? JSON.parse(json.deck_options) : json.deck_options) :
      [];

    const wild = json.skill_wild || 0;
    const eskills: any = {};
    if (json.type_code !== 'investigator' && wild > 0) {
      forEach(BASIC_SKILLS, skill => {
        const value = json[`skill_${skill}`] || 0;
        if (value > 0) {
          eskills[`eskill_${skill}`] = value + wild;
        }
      });
    }

    const name = json.name.replace('', '');
    let renderName = name;
    let renderSubname = json.subname;
    if (json.type_code === 'act' && json.stage) {
      renderSubname = t`Act ${json.stage}`;
    } else if (json.type_code === 'agenda' && json.stage) {
      renderSubname = t`Agenda ${json.stage}`;
    } else if (json.type_code === 'scenario') {
      renderSubname = t`Scenario`;
    }
    const linked_card = json.linked_card && json.code !== '86024' ?
      Card.fromJson(json.linked_card, packsByCode, cycleNames, lang) :
      null;
    if (linked_card) {
      linked_card.back_linked = true;
      if (json.hidden && !linked_card.hidden) {
        renderName = linked_card.name;
        if (linked_card.type_code === 'act' && linked_card.stage) {
          renderSubname = t`Act ${linked_card.stage}`;
        } else if (linked_card.type_code === 'agenda' && linked_card.stage) {
          renderSubname = t`Agenda ${linked_card.stage}`;
        } else {
          renderSubname = linked_card.subname;
        }
      }
    }
    const customization_options = CustomizationOption.parseAll(json);
    const removable_slot = !!find(customization_options, option => option.choice === 'remove_slot');
    const real_traits = find(customization_options, t => !!t.real_traits)?.real_traits || json.real_traits;
    const real_traits_normalized = real_traits ? map(
      filter(
        map(real_traits.split('.'), trait => trait.toLowerCase().trim()),
        trait => trait),
      trait => `#${trait}#`).join(',') : null;
    const traits_normalized = json.traits ? map(
      filter(
        map(json.traits.split('.'), trait => trait.toLowerCase().trim()),
        trait => trait),
      trait => `#${trait}#`).join(',') : null;
    const real_slot = json.real_slot || json.slot;
    const real_slots_normalized = real_slot ? map(
      filter(
        map(real_slot.split('.'), s => s.toLowerCase().trim()),
        s => !!s
      ),
      slot => `#${slot}#`
    ).join(',') : null;
    const slot = json.slot || null;
    const slots_normalized = json.slot ? map(
      filter(
        map(json.slot.split('.'), s => s.toLowerCase().trim()),
        s => !!s
      ),
      s => `#${s}#`).join(',') : null;


    const restrictions = Card.parseRestrictions(json.restrictions);
    const uses_match = json.code === '08062' ?
      ['foo', 'bar', 'charges'] :
      (json.real_text && json.real_text.match(USES_REGEX));
    const usesRaw = uses_match ? uses_match[2].toLowerCase() : null;
    const uses = usesRaw === 'charge' ? 'charges' : usesRaw;

    const bonded_match = json.real_text && json.real_text.match(BONDED_REGEX);
    const bonded_name = bonded_match ? bonded_match[1] : null;

    const seal_match = json.real_text && json.real_text.match(SEAL_REGEX);
    const seal = !!seal_match || json.code === SERPENTS_OF_YIG;

    const heals_horror_match = !!(json.real_text && json.real_text.match(HEALS_HORROR_REGEX)) ||
      !!customization_options?.find(option => !!option.real_text && option.real_text.match(HEALS_HORROR_REGEX));
    const heals_horror = heals_horror_match ? true : null;
    const heals_damage_match = !!(json.real_text && json.real_text.match(HEALS_DAMAGE_REGEX)) ||
      !!customization_options?.find(option => !!option.real_text && option.real_text.match(HEALS_DAMAGE_REGEX));
    const heals_damage = heals_damage_match ? true : null;
    const myriad = !!json.real_text && json.real_text.indexOf('Myriad.') !== -1;
    const advanced = !!json.real_text && json.real_text.indexOf('Advanced.') !== -1;

    const sort_by_type_header = Card.typeSortHeader(json);
    const sort_by_type = Card.typeHeaderOrder().indexOf(sort_by_type_header);
    const sort_by_faction_header = Card.factionSortHeader(json);
    const sort_by_faction = Card.factionHeaderOrder().indexOf(sort_by_faction_header);
    const pack = packsByCode[json.pack_code] || null;
    const cycle_position = pack?.cycle_position || 0;
    const sort_by_faction_pack = sort_by_faction * 10000 + (cycle_position * 20) + (cycle_position >= 50 ? pack.position : 0);
    const sort_by_faction_pack_header = `${sort_by_faction_header} - ${json.pack_name}`;

    const basic_type_header = Card.typeSortHeader(json, true);
    const sort_by_faction_xp = (sort_by_faction * 1000) + (typeof json.xp === 'number' ? json.xp : 6) * 100 + Card.basicTypeHeaderOrder().indexOf(basic_type_header);
    const sort_by_faction_xp_header = typeof json.xp === 'number' ?
      `${sort_by_faction_header} (${json.xp}) - ${basic_type_header}` :
      `${sort_by_faction_header} - ${basic_type_header}`;

    const sort_by_pack = pack ? (pack.cycle_position * 100 + pack.position) : -1;
    const sort_by_cycle = (pack ? pack.cycle_position : 100) * 1000 + sort_by_faction * 100 + sort_by_type;
    const sort_by_cost_header = (json.cost === null || json.cost === undefined) ? t`Cost: None` : t`Cost: ${json.cost}`;
    const sort_by_encounter_set_header = json.encounter_name ||
      (linked_card && linked_card.encounter_name) ||
      t`N/A`;
    const cycle_pack = pack ? cycleNames[pack.cycle_position] : null;
    const spoiler = !!(json.spoiler || (linked_card && linked_card.spoiler));
    const enemy_horror = json.type_code === 'enemy' ? (json.enemy_horror || 0) : null;
    const enemy_damage = json.type_code === 'enemy' ? (json.enemy_damage || 0) : null;
    const firstName = json.type_code === 'investigator' && json.name.indexOf(' ') !== -1 ?
      json.name.substring(0, json.name.indexOf(' ')).replace(/"/g, '') :
      json.name;

    const altArtInvestigator =
      !!json.alternate_of_code ||
      json.code === '98001' || // Jenny
      json.code === '98004' || // Roland
      json.code === '98010' || // Carolyn
      json.code === '98013' || // Silas
      json.code === '98016' || // Dexter
      json.code === '98007' || // Norman
      json.code === '99001'; // PROMO Marie

    const alternate_of_code = json.alternate_of_code && json.duplicate_of_code && json.alternate_of_code === json.duplicate_of_code ? undefined : json.alternate_of_code;

    const s_search_name = searchNormalize(filter([renderName, renderSubname], x => !!x).join(' '), lang);
    const s_search_name_back = searchNormalize(filter([name, json.subname, json.back_name], x => !!x).join(' '), lang);
    const s_search_game = searchNormalize(filter([json.text, json.traits], x => !!x).join(' '), lang);
    const s_search_game_back = ((json.back_text && searchNormalize(json.back_text, lang)) || '');
    const s_search_flavor = ((json.flavor && searchNormalize(json.flavor, lang)) || '');
    const s_search_flavor_back = ((json.back_flavor && searchNormalize(json.back_flavor, lang)) || '');

    const s_search_real_name = searchNormalize(filter([json.real_name, json.real_subname], x => !!x).join(' '), 'en');
    const s_search_real_name_back = searchNormalize(filter([json.real_name, json.real_subname], x => !!x).join(' '), 'en');
    const s_search_real_game = searchNormalize(filter([json.real_text, real_traits], x => !!x).join(' '), 'en');
    let result = {
      ...omit(json, ['customization_options', 'customization_text', 'deck_options', 'deck_requirements', 'alternate_of_code']),
      ...eskills,
      alternate_of_code,
      id: json.code,
      tabooSetId: null,
      s_search_name,
      s_search_name_back,
      s_search_game,
      s_search_game_back,
      s_search_flavor,
      s_search_flavor_back,
      s_search_real_name,
      s_search_real_name_back,
      s_search_real_game,
      name,
      firstName,
      renderName,
      renderSubname,
      deck_requirements,
      deck_options,
      linked_card,
      spoiler,
      traits_normalized,
      customization_options,
      real_traits_normalized,
      real_slot,
      real_slots_normalized,
      slot,
      slots_normalized,
      uses,
      bonded_name,
      cycle_name: (cycle_pack && cycle_pack.name) || json.pack_name,
      cycle_code: cycle_pack && cycle_pack.code || json.pack_code,
      has_restrictions: !!restrictions && !!restrictions.restrictions_investigator,
      ...restrictions,
      seal,
      myriad,
      removable_slot,
      advanced,
      heals_horror,
      heals_damage,
      sort_by_type,
      sort_by_faction,
      sort_by_faction_pack,
      sort_by_faction_xp,
      sort_by_pack,
      enemy_horror,
      enemy_damage,
      altArtInvestigator,
      sort_by_cost_header,
      sort_by_type_header,
      sort_by_faction_header,
      sort_by_encounter_set_header,
      sort_by_faction_pack_header,
      sort_by_faction_xp_header,
      sort_by_cycle,
    };
    result.browse_visible = 0;
    if (result.code.startsWith('z')) {
      result.browse_visible += 16;
    }
    if (result.code === RANDOM_BASIC_WEAKNESS || result.code === BODY_OF_A_YITHIAN) {
      result.browse_visible += 3;
    } else if ((!result.altArtInvestigator && !result.back_linked && !result.hidden)) {
      if (result.encounter_code) {
        // It's an encounter card.
        result.browse_visible += 2;
      }
      if (result.deck_limit > 0 || result.bonded_name) {
        // It goes in a deck.
        result.browse_visible += 1;
      }
    } else if (result.altArtInvestigator) {
      result.browse_visible += 4;
    }
    if (result.duplicate_of_code) {
      result.browse_visible += 8;
    }
    result.mythos_card = !!result.encounter_code || !!result.linked_card?.encounter_code;
    result.spoiler = result.spoiler || (result.linked_card && result.linked_card.spoiler);
    return result;
  }

  static placeholderTabooCard(
    tabooId: number,
    card: Card
  ): Card {
    const result: Card = { ...card } as Card;
    result.id = `${tabooId}-${card.code}`;
    result.taboo_set_id = tabooId;
    result.taboo_placeholder = true;
    return result;
  }

  static fromTabooCardJson(
    tabooId: number,
    json: any,
    card: Card
  ): Card {
    const code: string = card.code;
    const result: Card = { ...card } as Card;
    result.id = `${tabooId}-${code}`;
    result.taboo_set_id = tabooId;
    result.taboo_placeholder = false;

    if (json.xp) {
      result.extra_xp = json.xp;
    }
    if (json.text) {
      result.taboo_text_change = json.text;
    }
    if (json.exceptional !== undefined) {
      result.exceptional = json.exceptional;
      if (json.exceptional) {
        result.deck_limit = 1;
      }
    }
    if (json.deck_limit !== undefined) {
      result.deck_limit = json.deck_limit;
    }
    if (json.deck_options) {
      result.deck_options = DeckOption.parseList(json.deck_options);
    }
    if (json.deck_requirements) {
      result.deck_requirements = DeckRequirement.parse(json.deck_requirements);
    }
    return result;
  }

  static querySort(sortIgnoreQuotes: boolean, sort?: SortType): QuerySort[] {
    switch(sort) {
      case SORT_BY_FACTION:
        return [
          { s: 'c.sort_by_faction', direction: 'ASC' },
          { s: sortIgnoreQuotes ? 'c.s_search_name' : 'c.renderName', direction: 'ASC' },
          { s: 'c.xp', direction: 'ASC' },
        ];
      case SORT_BY_FACTION_PACK:
        return [
          { s: 'c.sort_by_faction_pack', direction: 'ASC' },
          { s: 'c.code', direction: 'ASC' },
        ];
      case SORT_BY_FACTION_XP:
        return [
          { s: 'c.sort_by_faction_xp', direction: 'ASC' },
          { s: sortIgnoreQuotes ? 'c.s_search_name' : 'c.renderName', direction: 'ASC' },
          { s: 'c.code', direction: 'ASC' },
        ];
      case SORT_BY_FACTION_XP_TYPE_COST:
        return [
          { s: 'c.sort_by_faction_xp', direction: 'ASC' },
          { s: 'c.cost', direction: 'ASC' },
          { s: sortIgnoreQuotes ? 'c.s_search_name' : 'c.renderName', direction: 'ASC' },
        ];
      case SORT_BY_COST:
        return [
          { s: 'c.cost', direction: 'ASC' },
          { s: sortIgnoreQuotes ? 'c.s_search_name' : 'c.renderName', direction: 'ASC' },
          { s: 'c.xp', direction: 'ASC' },
        ];
      case SORT_BY_PACK:
        return [
          { s: 'c.sort_by_pack', direction: 'ASC' },
          { s: 'c.position', direction: 'ASC' },
        ];
      case SORT_BY_ENCOUNTER_SET:
        return [
          { s: 'c.sort_by_pack', direction: 'ASC' },
          { s: 'c.encounter_code', direction: 'ASC' },
          { s: 'c.encounter_position', direction: 'ASC' },
        ];
      case SORT_BY_TITLE:
        return [
          { s: sortIgnoreQuotes ? 'c.s_search_name' : 'c.renderName', direction: 'ASC' },
          { s: 'c.xp', direction: 'ASC' },
        ];
      case SORT_BY_TYPE:
      default:
        return [
          { s: 'c.sort_by_type', direction: 'ASC' },
          { s: sortIgnoreQuotes ? 'c.s_search_name' : 'c.renderName', direction: 'ASC' },
          { s: 'c.xp', direction: 'ASC' },
        ];
    }
  }
}

export function cardInCollection(card: Card | PartialCard, packInCollection: { [pack_code: string]: boolean | undefined }): boolean {
  if (packInCollection[card.pack_code]) {
    return true;
  }
  const reprintPacks = card.reprint_pack_codes || REPRINT_CARDS[card.code];
  if (!reprintPacks) {
    return false;
  }
  return !!find(reprintPacks, pack => !!packInCollection[pack]);
}

export type CardKey = keyof Card;

export interface CardsMap {
  [code: string]: Card | undefined;
}
