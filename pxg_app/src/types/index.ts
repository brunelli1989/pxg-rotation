export type SkillType = "area" | "frontal";
export type CCType = "stun" | "silence" | "locked";
export type BuffType = "self" | "next";
export type Tier = "T1H" | "T1C" | "T2" | "T3" | "TR" | "TM";

export type PokemonElement =
  | "normal" | "fire" | "water" | "electric" | "grass" | "ice"
  | "fighting" | "poison" | "ground" | "flying" | "psychic" | "bug"
  | "rock" | "ghost" | "dragon" | "dark" | "steel" | "fairy";

export type ClanName =
  | "volcanic" | "raibolt" | "orebound" | "naturia" | "gardestrike"
  | "ironhard" | "wingeon" | "psycraft" | "seavell" | "malefic";

export type PokemonRole = "offensive_tank" | "burst_dd";

export interface Clan {
  name: ClanName;
  displayName: string;
  bonuses: { element: PokemonElement; atk: number; def: number }[];
}

export interface RosterPokemon {
  id: string;
  name: string;
  tier: Tier;
  clans: ClanName[];
  role: PokemonRole;
  elements: PokemonElement[];
}
export type DiskLevel = 0 | 1 | 2 | 3 | 4;

export interface Skill {
  name: string;
  cooldown: number;
  type: SkillType;
  cc: CCType | null;
  buff: BuffType | null;
  /** true quando a skill é de defesa (Harden, Intimidate, Iron Defense, etc) e dispensa
   *  Elixir Def pro starter do lure */
  def?: boolean;
  element?: PokemonElement; // opcional; se omitido, clã/effectiveness não se aplicam
  power?: number; // skill_power "clean" (sem clã embutido); calibrado via cast no dummy
}

export interface Pokemon {
  id: string;
  name: string;
  tier: Tier;
  role?: PokemonRole;
  wiki?: string;
  todo?: string;
  skills: Skill[];
  /** Elementos defensivos do poke (do roster). Usado pra calcular resistência
   *  do starter contra ataques do mob. Ausência = neutro (factor 1.0). */
  elements?: PokemonElement[];
}

export type LureType = "solo_device" | "solo_elixir" | "dupla" | "group";

export interface LureMember {
  poke: Pokemon;
  skills: Skill[];
}

export interface Lure {
  type: LureType;
  starter: Pokemon;
  second: Pokemon | null;
  starterSkills: Skill[];
  secondSkills: Skill[];
  /** Membros adicionais além de starter/second (group lure 3-6 pokes). Vazio em solo/dupla. */
  extraMembers: LureMember[];
  starterUsesHarden: boolean;
  usesElixirAtk: boolean;
  usesDevice: boolean;
  /** ID do poke que usa o elixir atk (buff +70% nas skills dele por 8s). Null se usesElixirAtk=false. */
  elixirAtkHolderId: string | null;
  /** Tier do revive usado na lure (null se sem revive). Revive reseta CDs do target e ele
   *  casta o kit 2 vezes. Cost de 1s extra pra cast do item. */
  reviveTier: "normal" | "superior" | null;
  /** ID do poke revivido (tipicamente o mais forte da lure). Null se reviveTier=null. */
  revivePokemonId: string | null;
}

export interface RotationStep {
  lure: Lure;
  timeStart: number;
  timeEnd: number;
  idleBefore: number;
  idleMidLure: number;
}

export interface RotationResult {
  steps: RotationStep[];
  totalTime: number;
  totalIdle: number;
  cycleNumber: number;
  selectedIds: string[];
  devicePokemonId: string | null;
}

// =========================================================
// Damage module types
// =========================================================

export type HuntLevel = "300" | "400+";
export type XAtkTier = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type HeldKind = "none" | "x-attack" | "x-boost" | "x-critical" | "x-defense";
export interface HeldItem {
  kind: HeldKind;
  tier: XAtkTier;
}

// Alias pra compatibilidade com código antigo
export type DeviceHeldKind = HeldKind;
export type DeviceHeld = HeldItem;

export interface PokeSetup {
  boost: number;
  held: HeldItem; // X-Held do slot principal do poke (X-Atk, X-Boost, ou nenhum)
  hasDevice: boolean; // device atribuído a este poke (só 1 poke por vez)
}

export interface MobConfig {
  name: string;
  types: PokemonElement[]; // 1 ou 2 tipos; effectiveness é produto
  hp: number;
  defFactor?: number; // undefined = usa DEFAULT_MOB_DEF_FACTOR no engine
  /** Elementos que tankam bem como starter nessa hunt (dados empíricos do jogo).
   *  Starters com qualquer desses tipos ganham preferência no beam. Undefined = sem preferência. */
  bestStarterElements?: PokemonElement[];
}

export interface MobEntry {
  name: string;
  types: PokemonElement[]; // 1 ou 2 tipos
  hunt: HuntLevel;
  group: string; // mobs no mesmo group farmam juntos (mesma task)
  hp?: number;
  defFactor?: number;
  todo?: string;
  /** Elementos que tankam bem nessa hunt — copiado pra MobConfig quando selecionado */
  bestStarterElements?: PokemonElement[];
  /** URL da página da hunt no wiki do PxG */
  wiki?: string;
  /** Elementos que causam dano efetivo no mob (ofensivo — pra tua skill atacar mais forte) */
  effectiveElements?: PokemonElement[];
  /** Observações da seção Efetividades do wiki (passivas, exceções) */
  effectivenessNotes?: string;
}

export interface DamageConfig {
  playerLvl: number;
  clan: ClanName | null;
  hunt: HuntLevel;
  mob: MobConfig;
  device: DeviceHeld; // global: held que está no device (compartilhado entre pokes)
  pokeSetups: Record<string, PokeSetup>; // keyed by pokeId
  skillCalibrations: Record<string, number>; // keyed by "pokeId:skillName", value = skill_power
  /** Permite uso de Elixir Atk nas lures (solo_elixir, dupla+elixir, group+elixir).
   *  Não afeta Elixir Def. Default true. */
  useElixirAtk?: boolean;
  /** Revive disponível: "none" = não usa, "normal" = Nightmare Revive ($10k, 5min),
   *  "superior" = Superior Nightmare Revive ($50k, 4min). Default "none". */
  revive?: "none" | "normal" | "superior";
}
