# PxG Rotation Generator

Web app que gera a rotação ótima de lures para maximizar **boxes/hora** em PokexGames (PxG).

## Stack

- **Vite + React + TypeScript** em `pxg_app/`
- Pesados cálculos rodam em **Web Workers** (paralelismo por CPU core)
- Sem backend — 100% client-side, dados em `src/data/pokemon.json`
- localStorage persiste disk + pokémons selecionados

## Comandos

```bash
cd pxg_app
npm run dev       # dev server em http://localhost:5173
npx vite build    # produção
npx tsc --noEmit  # type check
```

## Estrutura

```
pxg_app/src/
├── data/
│   ├── pokemon.json        # Pokes + skills (power calibrado ou via fallback). Tem role, wiki, todo.
│   ├── pokemon_roster.json # Lista de pokes do jogo com clans/elements/role (fonte do role)
│   ├── mobs.json           # Mobs por hunt: types, group, hp, defFactor, todo
│   └── clans.json          # Bônus de atk/def por clã
├── types/index.ts          # Interfaces (Pokemon, Skill, Lure, RotationStep, DamageConfig, MobConfig, ...)
├── engine/
│   ├── cooldown.ts         # Fórmula de CD com disk, cooldowns de elixir
│   ├── scoring.ts          # Ordem ótima de skills, helpers (hasHarden, hasSilence, hasFrontal, hasHardCC)
│   ├── rotation.ts         # Barrel re-export de rotation/ submodules
│   ├── rotation/           # Split em submódulos:
│   │   ├── generate.ts     #   - Lure template generation (solo_device, solo_elixir, dupla, group)
│   │   ├── simulation.ts   #   - SimState/SimContext/SimStatePool, compileLures, applyLure, CD math
│   │   └── beam-search.ts  #   - findBestRotation, findBestForBag, evaluateCycle
│   ├── rotation.worker.ts  # Worker que processa chunks de bags
│   ├── rotationAsync.ts    # Orquestrador: distribui bags entre workers, junta resultado
│   ├── damage.ts           # Barrel re-export de damage/ submodules
│   ├── damage/             # Split em submódulos:
│   │   ├── fallback.ts     #   - BURST_POWER_BY_TIER_CC + resolveSkillPower
│   │   ├── mob.ts          #   - resolveMobConfig + hp/def hierarchy
│   │   ├── multipliers.ts  #   - TYPE_CHART + CLAN_ATK_BONUS (eff + clã)
│   │   ├── formula.ts      #   - X-Atk/X-Boost tables + computeSkillDamage + deriveSkillPower
│   │   └── lure.ts         #   - estimateLureDamagePerMob + lureFinalizesBox + estimatePokeSoloDamage
│   ├── damage.test.ts      # Testes de regressão vs dados reais (<0.1% erro)
│   └── beam-search.test.ts # Regression test pro bug wrap-check (81 b/h Magby/Pansear bag)
├── components/
│   ├── PokemonSelector.tsx / PokemonCard.tsx / SkillBadge.tsx
│   ├── DiskSelector.tsx
│   ├── DamageConfigPanel.tsx   # Player lvl, clã, hunt, mob alvo, held global do device
│   ├── PokeSetupEditor.tsx     # Boost e held por poke
│   ├── LureDamagePreview.tsx   # Estimativa de dano vs mob por lure
│   ├── RotationResult.tsx      # Tabela passo-a-passo
│   └── SkillTimeline.tsx       # Barra visual
├── hooks/
│   ├── useRotation.ts      # Hook async c/ loading + progresso (memoiza pool!)
│   └── useDamageConfig.ts  # Persiste config de dano no localStorage
└── App.tsx                 # Root + localStorage + botão "copiar dados"
```

## Mecânicas do jogo (LEIA ANTES DE MEXER NO ENGINE)

### Estrutura de lure

Um **lure** = 1 box a ser finalizada com **1 a 6 pokémons**.

**4 tipos:**
| Tipo | Composição | Finisher | Requisitos |
|---|---|---|---|
| `solo_device` | 1 pokémon T1H c/ CC | Device | Device atrelado a 1 poke só; starter offtank ou T1H-clã |
| `solo_elixir` | 1 pokémon não-T1H c/ CC, **sem frontal** | Swordsman Elixir (210s CD) | Hunt 300 sem restrição; 400+ só offtank |
| `dupla` | Starter c/ CC + 1 segundo | Sem item / +Swordsman / +Revive | Starter offtank/T1H-clã, ou consumível gate (só hunt 300) |
| `group` | Starter c/ CC + 2-5 extras (3-6 membros total) | Sem item / +Swordsman | Hunt 400+ típico; revive não gera aqui (OOM) |

UI label: "Elixir Atk" foi renomeado pra **"Swordsman Elixir"** (nome real do jogo). Internals (`usesElixirAtk`, `ELIXIR_ATK_COOLDOWN`) mantidos — só strings user-facing mudaram.

### Regras críticas

- **Starter OBRIGATORIAMENTE tem CC área (stun/silence área ou locked) E SEM skill frontal no kit**. Frontal não cobre os 6 mobs — mesmo como damage skill, frontal no starter deixa buracos na proteção. `hasHardCC` filtra o CC, `!hasFrontal` filtra o kit.
- **Members/second precisam ter CC** (stun/silence/locked, área OU frontal — `hasAnyCC`) pra reaplicar CC enquanto o starter's expira. Senão player morre no switch.
- **Exceção: finalizador (último poke da chain)** pode ser sem CC (ex: Sh.Donphan, Sh.Magby, Sh.Ninetales). Nada casta depois dele → reaplicação desnecessária. Engine aceita até **1** poke sem CC por group lure e coloca ele na última posição.
- **Second/extras NÃO podem ter wait mid-lure** — skills prontas no cast. Wait vai pro início.
- **Silence + Frontal cruzado é inválido** — se algum membro do lure tem silence, nenhum pode ter skill frontal.
- **Frontal não finaliza solo com elixir** — poke com frontal não pode ser `solo_elixir`. Pode ir em dupla/group **como finalizer** (não como starter).
- **Device é atribuído a 1 pokémon só** — algoritmo testa top-2 T1H+CC como candidatos + "sem device". Se user marca `hasDevice=true` em algum poke no PokeSetupEditor (qualquer tier), adiciona como **hint** à lista (não substitui os outros — engine ainda compara todos).
- **Device holder pode ser dupla/group starter** (só é excluído do role "second" pra evitar conflito com solo_device). `hasDevice=true` é aplicado via override em `findBestRotation`, então device bonus entra no dano de qualquer lure onde o holder casta.
- **Defesa do starter (mecânica Elixir Def REMOVIDA):**
  - Tem skill com `def: true` (Harden, Intimidate, Iron Defense, Coil, etc) → usa essa skill (grátis)
  - Não tem → depende do tier (T1H tanka sem; outros precisam via player-strength rule)
- **Player-strength rule:** se nenhuma lure de ≤3 membros finaliza a box, starter precisa ter `def:true` (T1H burst_dd sem Harden fica banido). Heurística do user: "a partir do momento que finaliza com 3 pokes, dá pra lurar com T1H".
- **Consumable-gate starter filter:** `canStarter(p) = isOfftank(p) || isT1HClan(p) || lure.usesElixirAtk || lure.reviveTier`. **Hunt 300:** consumível desbloqueia starter fraco. **Hunt 400+:** strict — só offtank/T1H-clã, mesmo com item.
- **Max 2 lures IDÊNTICAS consecutivas (forward only):** beam filter bloqueia `seq[i-2] === seq[i-1] === new`. **Wrap-check REMOVIDO** — sequências onde pos N→1→2 são idênticas (via wrap) são permitidas. Simulação garante feasibility via `waitForSkill` (CDs que não recuperam → idle crescente). Permite "Heatmor+A, Heatmor+B, Heatmor+C" (composição diferente) e rotações como "[ShR_D, Ramp_E, Gol+Hip_Du, Om+Tyr_Du, ShR_D, ShR_D]" onde wrap 5→6→1 tem 3 ShR_D consecutivas.
- **Starter type hard filter:** se `mob.bestStarterElements` populado e bag tem ≥1 poke matching, outros tipos ficam **proibidos como starter** (podem ser second/extra). Fallback se filter esvazia.
- **Starter score 3-tier** (em `compileLures`, multiplica beam score): `type ∈ (bestStarterElements ∩ user_clan_elements)` → 0.60; `type ∈ bestStarterElements` → 0.75; senão 1.00.
- **Stun > silence hard filter:** se bag tem stun-starter, silence-only filtrados. + silence score penalty 10% no beam.
- **Second/extras NÃO precisam de defesa** (entram brevemente).
- **Swordsman Elixir em dupla/group:** +70% aditivo no `helds` do **holder** (poke mais forte) por 8s. Shared CD 210s com solo_elixir. `Lure.elixirAtkHolderId` guarda o id.
- **Nightmare Revive:** reseta CDs de 1 poke na lure (target = `pickElixirHolder`, o mais forte). Kit castado 2×. Tiers: Normal ($10k, 300s CD) / Superior ($50k, 240s CD). Só gera em solo_device/solo_elixir/dupla (não em group — OOM).
- **Generator SEM cascading (FIX):** `generateLureTemplates` sempre com `includeDuplaElixir: true, includeGroup: true, allowElixirAtk` e `reviveTier`. Beam search recebe todas opções. Cascading greedy antigo escondia rotações de group superiores em bags com dupla+elixir potente.
- **`lureFinalizesBox` compara dmg vs `mob.hp` (NÃO hp×6)** — skills são area, hittam todos os 6 mobs simultaneamente; matar 1 = matar os 6.

### Cooldown de skills

**Modelo (validado com usuário):**
- **Ativo** (casting ou selecionado-idle "fora da ball"): `1 CD / 1s real` (selfCast)
- **Em bag** (qualquer tempo — kill time, wait de outros, lures de outros): `1 CD / (disk_mult × 1s real)` (bagTime × bagRate)

| Disk | Mult | bagRate | 50s base → real (100% em bag) |
|---|---|---|---|
| 0 (nenhum) | 1 | 1.0 | 50s |
| 1 | 8 | 0.125 | 400s |
| 2 | 6 | 0.167 | 300s |
| 3 | 4 | 0.25 | 200s |
| 4 | 3 | 0.333 | 150s |

**Ativo = 50s totais**. **Em bag = 50 × disk_mult segundos**.

**Durante wait (starter selecionado):**
- Starter: selfCast += wait (1:1)
- Outros em bag: bagTime += wait (disk rate)

**Durante kill time (10s após finisher):**
- TODOS os pokes em bag (inclusive starter da lure anterior)
- bagTime += 10 para todos

**Engine rastreia 2 totals por poke:**
- `selfCastTotal[pokeId]`: segundos ativo (casting ou selecionado-idle)
- `othersCastTotal[pokeId]`: segundos em bag (tempo total em bag desde que o jogo começou, aplicando disk rate)

Recovery = `selfCast_since_cast × 1 + bagTime_since_cast × bagRate`

**Validação com usuário:** 534 pokes/h com Disk 2, bag típica (Sh.Rampardos + 5 T2/T3 com CC) ≈ rotação manual reportada (~500 pokes/h) ✓

### Active time (CRÍTICO)

Só **1 pokémon ativo por vez**. Quando ele cast as skills/finisher, está ativo. Fora isso, em bag.

- **Ativo:** CD recupera 1:1 (rate = 1)
- **Em bag:** CD recupera rate = 1 + disk_bonus (rate > 1, mais rápido que ativo!)

**Por quê em bag é mais rápido?** No NW, o disk é um acelerador que só funciona quando o poke não está em campo. Então deixar o poke em bag (ex: durante outras lures) é MAIS eficiente pra recuperar CDs.

O engine rastreia `activeTotal[pokeId]` e `activeSnapshot` por skill cast. Recovery = `active × 1 + inactive × rate`. Ready quando recovery >= baseCD.

Fórmula derivada para o wait do starter antes da próxima lure:
```
required_elapsed = (baseCD + active_total × (rate - 1)) / rate
```

### Kill time (10s entre lures)

Após cada lure (finisher cast), passa-se **10s de kill time** — os 6 mobs da box morrem. Durante esses 10s:
- Nenhum poke está ativo (todos em bag)
- CDs recuperam em rate inativo (1 + disk_bonus)
- Engine avança `state.clock += 10` após cada lure

Esse kill time beneficia TODOS os pokes igualmente (starter do próximo lure, second, elixirs). Não há leeway especial — tudo é modelado explicitamente.

### Consumíveis

- **Swordsman Elixir (ex-Elixir Atk):** 210s fixo (não afetado pelo disk). Usado em solo_elixir, dupla+elixir, group+elixir. Buffa +70% aditivo no `helds` do holder (poke mais forte) por 8s — janela cobre casts do holder (~5s).
- **Nightmare Revive:** CD próprio (Normal 300s, Superior 240s), independente do disk. Cast de 1s. Reseta CDs de todas skills do target → kit 2×. Target = `pickElixirHolder(members)` (mais forte da lure). Revive + Elixir Atk coexistem (CDs independentes).
- **Elixir Def: REMOVIDO inteiro.** Mecânica descontinuada; starters sem harden/T1H são filtrados pela player-strength rule.
- Preços centralizados em `cooldown.ts`: ELIXIR_PRICE=500, REVIVE_PRICE={normal:10000, superior:50000}.

### Ordem de skills dentro de um pokémon

Definida em `getOptimalSkillOrder()`:
1. CC skill primeiro (stun/silence — proteção inicial)
2. Self-buffs em seguida (Harden, Hone Claws, Rollout)
3. "Buff next" logo antes da skill de maior dano
4. Restante em CD decrescente (libera CDs longas primeiro)
5. Se silence ativo → remove frontais

## Algoritmo de otimização

**Objetivo:** minimizar `tempo_total_ciclo / num_lures` (= maximizar boxes/hora).

**Método:** beam search
1. Gera lures via **cascading** (só tiers caros quando barato não finaliza): base → +duplaElixir → +group
2. Mantém top `beamWidth` sequências a cada passo (dynamic defaults: 120 pra pool ≤12, 80 ≤18, 40 pra 20+)
3. **Cheap scoring** — `sim.clock / steps.length` como score principal; `evaluateCycle` (2 ciclos steady-state) só no top-4 por step
4. Detecta período mínimo (`[A,B,C,A,B,C]` → `[A,B,C]`)
5. Limita `maxCycleLen` (12/10/8 por tamanho de pool)

**Performance (implementado):**
- `SimState` usa `Float64Array` (clone via memcpy); `SimContext` estático indexado
- `bagTimePerLureLowerBound` + sort ascending — bags promissoras rodam primeiro, worse puladas
- Pruning por dano máximo vs HP_mob (skip bags impossíveis)
- Workers paralelos via `navigator.hardwareConcurrency`

Para bags > 6 pokes: testa `C(n,6)` combinações distribuídas entre Web Workers.

## Módulo de dano (implementado em `engine/damage.ts`)

Valida se uma lure finaliza a box (`HP_mob × 6`) e filtra lures inviáveis. Testes em `damage.test.ts` confirmam <0.25% erro vs dados reais.

### Fórmula de dano (validada em combate real, 40+ amostras, <0.2% erro)

```
dmg = (player_lvl + 1.3 × boost + 150) × skill_power × (1 + Σ atk%) × clã × eff × def_mob
```

**`player_lvl` = nível BASE do char (NÃO soma NL bonus).** Validado empiricamente 2026-04-22 pt2 com char Orebound 369(+48) vs Volcanic 600(+0): predição com base 369 bate <0.4%, predição com efetivo 417 erra -7.3%. NL bonus só afeta HP/def, não damage. UI label: "Player lvl (base)". Calibrações antigas com chars NL=0 continuam válidas.

Modificador: `× 1.5` se skill anterior tem `buff: "next"` (Dragon Rage, Hone Claws, Focus Energy, Swords Dance, Sunny Day).

**Crítico**: `× 2.0` quando a skill crita (validado 2026-04-22 em Sh.Chandelure Mystical Fire: 31310 normal × 2.001 = 62660 observado). Standard Pokemon crit. Engine não modela crit rate — damage prediction é do hit normal, média real incorpora rate de crit (baixa por default, pode ser buffada por Focus Energy / Swords Dance que têm `buff: "next"` embutindo crit).

**Multi-hit skills**: muitas skills em PxG são multi-hit (batem N vezes por cast). O `power` armazenado é **total por cast** (soma de todos os hits). Exemplos observados:
- Shadow Claw (Gengar/Haunter): 5-6 hits
- Shadow Storm (Gengar): 2 hits
- Superpower (Hariyama/Lopunny): 9 hits
- Spin Swing (Lopunny): 4 hits
- Payback (Mightyena): 4 hits
- Barb Barrage (Qwilfish): 10 hits
- Mamaragan (Electabuzz): 5 hits
- Leafage (Tropius): 4 hits
- Hurricane (Pidgeot): 9 hits
- Ancient Power (Golem/**Shiny Rampardos**): 5 hits
- **Fake Out (Shiny Hariyama)**: 4 hits (descoberto 2026-04-24)
- **Whirlpool (Shiny Floatzel)**: 4 hits (2026-04-24)
- **Counter Shield (Shiny Floatzel)**: 8 hits (2026-04-24)
- **Sand Field / Sandstorm (Hippowdon Female)**: 3 hits (2026-04-24)

Calibração = soma todos os hits da skill. Os valores per-hit às vezes variam (ex: Shadow Storm 28k + 21k).

**Componentes:**
- `player_lvl`, `boost`, constante `+150` fixa, `skill_power` calibrado por (poke, skill)
- `Σ atk%`: aditivo (X-Atk T1=8% ... T8=31%, device=+19% equivalente T4)
- **X-Boost held**: contribui `2X` ao eff_boost (wiki: "dobro desse valor como bônus de ataque") — validado 2026-04-20
- `clã`: multiplicativo se skill é do tipo do clã (Orebound rock/ground=1.25, Volcanic fire=1.28, etc — ver `clans.json`)
- `eff`: chart padrão Pokémon (0×/0.5×/1×/2×). **PxG usa FULL DUAL-TYPE** — multiplica o efeito de cada tipo do defender. Ex: fighting vs Mawile [fairy, steel] = ×0.5 × ×2 = ×1 (neutro). Validado 2026-04-22. Pidgeot [normal, flying] vs rock = ×1 × ×2 = ×2 (igual ao antigo last-only por coincidência). Ver `computeEffectiveness`
- `def_mob`: multiplicador < 1, empírico por mob

**`skill_power` varia per-instância**, não por espécie: Fire Ball no Ninetales = 6.07, no Charizard = 13.77.

### Fallback por (tier, hasCC) para burst_dd + flat offtank

Quando `skill.power` é undefined, `resolveSkillPower(skill, poke)` usa `getDefaultSkillPower(poke)`. Budget do jogo é por slot:

| burst_dd \ has CC | CC | noCC | Amostras |
|---|---|---|---|
| T1H | 24.6 | 24.6 (proxy) | CC n=8 |
| T1C | 19.5 (proxy T2) | 17.5 | noCC n=1 |
| T2 | 19.5 | 23.1 | CC n=10, noCC n=3 |
| T3 | 18.0 | 19.2 | CC n=5, noCC n=4 |
| TR | 18.5 | 19.6 | CC n=3, noCC n=1 |
| TM | 15.0 | 15.0 | sem amostras |

**Offtank: flat 18.5 entre todos os tiers** (n=20, CV 9.1%).

**Insights validados (44 pokes calibrados):**
- `burst_dd CC` < `burst_dd noCC` na mesma tier — slot de CC "custa" ~15-20% do budget dos outros slots (T2: 19.5 vs 23.1; T3: 18.0 vs 19.2)
- `burst_dd` per-skill (CC bucket): T1H=24.6 > TR=18.5 ≈ T2/T3 ≈ 18-19.5 (TR bate T2/T3 apesar do "tier")
- `offensive_tank` **flat entre tiers** (~18.5 per skill, Σ ~75 com 4 skills)
- OTDD (over-time damage dealer) existe mas é foco de boss, não de lure — tratado como `burst_dd` sem distinção

### Defesas de mobs calibrados

**Hunt 400+** (range típico 0.55-0.70):
| Mob | Tipo | defFactor |
|---|---|---|
| Torkoal | fire | 0.55 |
| Shiftry | grass/dark | 0.55 |
| Pinsir | bug | 0.58 |
| Sandaconda | ground | 0.57 |
| Lycanroc | rock | 0.57 |
| Houndoom | dark/fire | 0.58 |
| Pidgeot | normal/flying | 0.59 |
| Lilligant | grass | 0.604 |
| Sudowoodo | rock | 0.613 |
| Chandelure | ghost/fire | 0.62 |
| Piloswine | ice/ground | 0.62 |
| Glalie | ice | 0.64 |
| Rampardos | rock | 0.643 |
| Tangela | grass | 0.681 |
| Dragonair | dragon | 0.68 |

**Hunt 300** (typical mais alto):
| Mob | Tipo | defFactor |
|---|---|---|
| Dratini | dragon | 0.80 |
| Magby | fire | 0.88 |
| Pansear | fire | 0.90 |
| Espurr | psy | 0.92 |

**Heurística HP/def**: mob com mais HP tem defFactor MAIOR (recebe mais dmg por hit) pra balancear time-to-kill. Descoberto 2026-04-24 validando com 2+ skills em 3 mobs Mixed Grass. Estimativa: `def_novo ≈ HP_novo × (def_cal / HP_cal)` pra mobs da mesma hunt.

Fallback `DEFAULT_MOB_DEF_FACTOR = 0.85` (média aproximada) pros demais mobs com `todo: "calibrate defense"`.

### Calibração

- Usuário cast skill 1× no dummy → app deriva `skill_power` via fórmula inversa (`deriveSkillPower`) → valor salvo em `pokemon.json` (campo `power` da skill)
- Pokes calibrados: 40+ pokes recalibrados com lvl 600 Volcanic (dummy neutro) em 2026-04-22
- **Pitfall de calibração:** quando o usuário cola "char X, boost Y, X-Atk Z" no topo, isso é do CHAR, não do poke testado. Cada poke tem seu próprio boost/held (ver memória `feedback_dummy_calibration_setup.md`)

**Campos de calibração em Pokemon/Skill:**
- `Pokemon.config` — setup usado na calibração (ex: "lvl 600, +70, XA8, Volcanic, sem device, neutro")
- `Pokemon.observacao` — nota informativa (ex: "Shadow Claw multi-hit 5x"), NÃO dispara ⚠️
- `Pokemon.todo` — ação pendente (ex: "RECALIBRAR", "calibrate skills"), DISPARA ⚠️ na UI
- `Skill.dano` — valor observado no dummy (input bruto antes de derivar power)
- `Skill.power` — skill_power derivado da fórmula inversa

**Log-based calibration tool** (PokeXGamesTools — repo separado):
- Arquivo `D:\git\PokeXGamesTools\src\SysMetricsWinDivert\bin\Debug\net9.0-windows\skill_summary_log.txt`
- Formato: `Poke:\n  Skill:\n    damage_value` (pode ter multiple hits per skill)
- Tracker misatribui labels — comum: dano de skill X aparece em bucket Y. Padrões:
  - "mova-se" é catch-all bucket pra skills com label não reconhecido pelo tracker
  - Skill single pode ter valor em outro bucket (ordem inversa revela)
  - Multi-hit skills mostram N valores consecutivos (~mesma magnitude)
  - Orphans `[orphan] X dmg @(...)` = hits não atribuídos
- Estratégia de desembaraço:
  1. Skills com múltiplos valores consistentes (~mesma magnitude) = multi-hit, somar
  2. Se bucket tem 2 valores muito diferentes, o menor pode ser skill diferente misatrib
  3. Validar com cálculo: `valor / denom ≈ power antigo` → confirma skill correta
  4. Se tracker confuso, pedir user pra castar em ordem inversa (muda misatrib pattern)
- Default `DEFAULT_POKE_SETUP` held = X-Attack T8 (+31%) — reflete uso comum em PxG

### UI de calibração

- `PokemonCard`: ⚠️ quando `pokemon.todo` existe (ação pendente)
- `DamageConfigPanel`: ⚠️/✓ nos mobs da dropdown + aviso "defesa aproximada" quando `defFactor` undefined
- Label do player lvl: "Player lvl (base)" — tooltip explica que é BASE do char (NL bonus NÃO afeta dano)
- Linguagem user-facing: "medido no jogo" (✓) vs "aproximado / estimado" (⚠️) — evitar "calibrado"

Contexto histórico na memória: `project_pxg_damage_formula.md`.

## Pitfalls conhecidos (não repetir)

- **NÃO** memoize o `pool` fora do hook — array novo a cada render → loop infinito no useEffect
- **NÃO** assumir que disk é a ÚNICA recuperação. O disk ADICIONA bônus sobre o 1:1 base quando o poke está em bag. Ativo recupera 1:1 apenas (disk não aplica).
- **NÃO** permita wait mid-lure — o wait tem que ir pro início
- **NÃO** crie duplas/group silence+frontal — filtrar antes da geração
- **NÃO** remover active time tracking do engine — é fundamental pra acurácia
- **NÃO** usar leeway (removido) — usar kill time explícito (`KILL_TIME = 10` após cada lure)
- **NÃO** chamar `resolveSkillPower` duas vezes por skill cast — passa via `opts.skillPower` pro `computeSkillDamage` (hot path do beam search)
- **NÃO** assumir boost/held do poke testado pelo setup listado no topo da mensagem de calibração — é do char. Cada poke tem seu próprio boost/held no ball
- **NÃO** usar `role === "offensive_tank"` como proxy pra `hasHarden` — use `p.skills.some(s => s.def === true)`. Se o offtank não tem skill com def:true no data, adicione (sem skill no kit a simulação não casta nada)
- **NÃO** marcar skill como `def:true` se for ofensiva — o flag é só pra self-buffs de defesa (Harden, Iron Defense, Coil, etc)
- **NÃO** assumir 1 ciclo no beam — skills de CD grande podem exigir evaluation em 2+ ciclos. `evaluateCycle` roda 2 cycles pra medir steady-state
- **NÃO** rodar `evaluateCycle` em todo candidato do beam — é caro. Use cheap score (`sim.clock/steps.length`) e só refine top-4
- **NÃO** misturar raw tpl com adjusted score no pruning — o worker mantém `bestRawTpl` separado pra comparar com bag bounds. `bestScore` (com `starterResistFactor`) é só pra ranking final. Misturar corta bags legítimamente melhores quando o factor < 1.
- **NÃO** assumir que `lure.usesDevice` é a única coisa que aplica device bonus — o holder tem `hasDevice=true` em todas as lures (override global em `findBestRotation`). Damage calc lê `setup.hasDevice` direto, NÃO tem branch "se lure.usesDevice".
- **NÃO** excluir device holder de duplas/groups como starter — só como second. Ele pode starterar qualquer tipo de lure, e o dano dele já ganha device bonus via setup override.
- **NÃO** short-circuitar `findBestForBag` pra só o user's designated device — é hint, não override. Engine compara null + top-T1H + user pick e escolhe o melhor.
- **NÃO** permitir member sem CC no meio da chain — player morre no switch. Use `hasAnyCC` pra filtrar. Máx 1 no-CC permitido, e só na última posição (finalizer).
- **NÃO** permitir starter com skill frontal no kit — frontal deixa buracos na proteção dos 6 mobs. Starter precisa `hasHardCC && !hasFrontal`.
- **NÃO** re-hidratar só `bestStarterElements` no migration — também pega `defFactor`, `hp`, `types` de mobs.json quando o nome bate (source of truth, user não edita no UI).
- **NÃO** cascading greedy em `generateLureTemplates` (base → +duplaElixir → +group parando no primeiro que finaliza). Sempre passar `includeDuplaElixir: true, includeGroup: true` — beam search escolhe melhor rotação por bph. Bag com dupla+elixir forte pode esconder rotação de group 3× melhor.
- **NÃO** marcar poke como uncalibrated via `pokemon.todo !== undefined` — campo `todo` agora é só informativo (ex: notes de burn-pollution). UI checa per-skill: `pokemon.skills.some((s) => s.power === undefined && s.buff === null)`.
- **NÃO** re-adicionar Elixir Def — mecânica foi REMOVIDA inteira (types, engine, UI). Player-strength rule já substitui (exige `def:true` quando bag fraca).
- **NÃO** tratar Flame Wheel como buff:self puro — ela tem damage + self-buff. Se user calibrou power, usar esse valor em `resolveSkillPower`.
- **NÃO** comparar bags entre workers por `bestIdle` — idle absoluto não é comparável entre rotações com número de lures diferente (4-lure/200s tem menos idle que 6-lure/280s com bph maior). Use `bestScore` (adjusted tpl) em `rotationAsync.ts`.
- **NÃO** gerar variantes revive em group lures — C(n,k) × elixir × revive explode o espaço e causa OOM em pools ≥10. Revive apenas solo_device/solo_elixir/dupla.
- **NÃO** re-introduzir `cycleHas3ConsecutiveIdentical` wrap-check. Bug: bloqueava rotações ótimas onde 3 idênticas apareciam via wrap (pos N→1→2). Beam forward filter (`if (seq[n-1] === seq[n-2]) skip c === seq[n-1]`) é suficiente — simulação valida feasibility via `waitForSkill`. Regression test em `beam-search.test.ts`.
- **NÃO** aplicar `DEFAULT_MOB_DEF_FACTOR=0.85` direto sem checar hunt tier — fallback agora é `huntAvgDefFactor(hunt, allMobs)` que faz média dos calibrados do MESMO tier. Hunt 300 → ~0.811; hunt 400+ → ~0.573.
- **NÃO** permitir starter fraco (T2/T3/TR burst_dd non-clã) em hunt 400+ mesmo com consumível — filtro strict aplica. Hunt 300 permite via elixir/revive gate.

## Dicas de UI

- Tema escuro (background `#1a1a2e`)
- Botão "Copiar dados" gera report textual (sem listar skills — foram retiradas)
- Timeline visual usa cores rotativas por lure
- localStorage keys: `pxg_disk_level`, `pxg_selected_ids`
