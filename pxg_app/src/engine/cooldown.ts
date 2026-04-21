import type { DiskLevel } from "../types";

// Disk rates: 1s CD recovered per X seconds of real time when pokemon is in bag
// AND another pokemon is actively casting. During kill time/wait (no one casting), no recovery.
const DISK_MULT: Record<DiskLevel, number> = {
  0: 1, // open world (no disk): 1 CD per 1s real
  1: 8,
  2: 6,
  3: 4,
  4: 3,
};

// Rate when poke is in bag and ANOTHER poke is casting
export function bagRate(diskLevel: DiskLevel): number {
  return 1 / DISK_MULT[diskLevel];
}

// Rate when poke is actively casting its own skills: base 1:1
export const ACTIVE_RATE = 1;

// Elixirs: fixed 210s real time, not affected by disk
export const ELIXIR_ATK_COOLDOWN = 210;
export const ELIXIR_PRICE = 500;

// Nightmare Revive: reseta CDs de todas as skills de 1 poke na lure.
// CD independente do disk. Cast time de 1s. Preço do Superior é placeholder.
export type ReviveOption = "none" | "normal" | "superior";
export const REVIVE_COOLDOWN: Record<Exclude<ReviveOption, "none">, number> = {
  normal: 300,
  superior: 240,
};
export const REVIVE_PRICE: Record<Exclude<ReviveOption, "none">, number> = {
  normal: 10_000,
  superior: 50_000,
};
