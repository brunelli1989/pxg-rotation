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
│   ├── rotation.ts         # Core: geração de lures + beam search + simulação com active time
│   ├── rotation.worker.ts  # Worker que processa chunks de bags
│   ├── rotationAsync.ts    # Orquestrador: distribui bags entre workers, junta resultado
│   ├── damage.ts           # Fórmula de dano, fallback por (tier, role), resolveSkillPower
│   └── damage.test.ts      # Testes de regressão vs dados reais (<0.25% erro)
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
| `solo_device` | 1 pokémon T1H c/ CC | Device | Device é atrelado a 1 poke só |
| `solo_elixir` | 1 pokémon T2/T3/TR c/ CC, **sem frontal** | Elixir Atk (210s shared CD) | Starter precisa def OU Elixir Def |
| `dupla` | Starter c/ CC + 1 segundo (opcional +elixir) | Sem item ou Elixir Atk | Starter precisa def OU Elixir Def |
| `group` | Starter c/ CC + 2-5 extras (3-6 membros total) | Sem item ou Elixir Atk | Hunt 400+ típico |

### Regras críticas

- **Starter OBRIGATORIAMENTE tem CC** (stun/silence area ou locked qualquer tipo). Pokémons sem CC válido só podem ser second/extra.
- **Stun/silence frontal NÃO vale como CC de starter** — não cobre os 6 mobs da box. Pode ser CC em second (conta pra `hasCC` mas não pra `hasHardCC`).
- **Second/extras NÃO podem ter wait mid-lure** — skills prontas no cast. Wait vai pro início.
- **Silence + Frontal cruzado é inválido** — se algum membro do lure tem silence, nenhum pode ter skill frontal.
- **Frontal não finaliza solo com elixir** — poke com frontal não pode ser `solo_elixir`. Pode ir em dupla/group.
- **Device é atribuído a 1 pokémon só** — algoritmo testa top-2 T1H+CC como candidatos + "sem device". Se user marca `hasDevice=true` em algum poke no PokeSetupEditor (qualquer tier), adiciona como **hint** à lista (não substitui os outros — engine ainda compara todos).
- **Device holder pode ser dupla/group starter** (só é excluído do role "second" pra evitar conflito com solo_device). `hasDevice=true` é aplicado via override em `findBestRotation`, então device bonus entra no dano de qualquer lure onde o holder casta.
- **Defesa do starter:**
  - Tem skill com `def: true` (Harden, Intimidate, Iron Defense, Coil, etc) → usa essa skill (grátis)
  - Não tem → gasta Elixir Def (210s shared CD)
  - **EXCEÇÃO:** T1H+device não precisa de defesa
- **Player-strength rule:** se nenhuma lure de ≤3 membros finaliza a box, starter precisa ter `def:true` (T1H burst_dd sem Harden fica banido). Heurística do user: "a partir do momento que finaliza com 3 pokes, dá pra lurar com T1H".
- **Starter type hard filter:** se `mob.bestStarterElements` populado e bag tem ≥1 poke matching, outros tipos ficam **proibidos como starter** (podem ser second/extra). Fallback se filter esvazia.
- **Starter score 3-tier** (em `compileLures`, multiplica beam score): `type ∈ (bestStarterElements ∩ user_clan_elements)` → 0.60; `type ∈ bestStarterElements` → 0.75; senão 1.00.
- **Second/extras NÃO precisam de defesa** (entram brevemente).
- **Elixir atk em dupla/group:** +70% aditivo no `helds` do **holder** (poke mais forte) por 8s. Shared CD 210s com solo_elixir. `Lure.elixirAtkHolderId` guarda o id.
- **Cascading generator:** `generateLureTemplates` produz em 3 tiers — base (solo+dupla), +duplaElixir, +group. `findBestRotation` só adiciona os tiers caros quando o tier anterior não finaliza (economia de bags).
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

### Elixirs

- **Elixir Atk:** 210s fixo (não afetado pelo disk). Usado em solo_elixir, dupla+elixir, group+elixir. Buffa +70% aditivo no `helds` do holder (poke mais forte) por 8s — janela cobre casts do holder (~5s).
- **Elixir Def:** 210s fixo. Usado por starter sem skill `def:true` que não seja T1H+device.
- Cooldowns **independentes** entre si.

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

Modificador: `× 1.5` se skill anterior tem `buff: "next"` (Dragon Rage, Hone Claws, Focus Energy, Swords Dance, Sunny Day).

**Componentes:**
- `player_lvl`, `boost`, constante `+150` fixa, `skill_power` calibrado por (poke, skill)
- `Σ atk%`: aditivo (X-Atk T1=8% ... T8=31%, device=+19% equivalente T4)
- `clã`: multiplicativo se skill é do tipo do clã (Orebound rock/ground=1.25, Volcanic fire=1.28, etc — ver `clans.json`)
- `eff`: chart padrão Pokémon (0×/0.5×/1×/2×). PxG usa regra custom pra tipo duplo em `computeEffectiveness`
- `def_mob`: multiplicador < 1, empírico por mob

**`skill_power` varia per-instância**, não por espécie: Fire Ball no Ninetales = 6.07, no Charizard = 13.77.

### Fallback por (tier, role)

Quando `skill.power` é undefined, `resolveSkillPower(skill, poke)` usa `DEFAULT_POWER_BY_TIER_ROLE`. Valores derivados empiricamente:

| Tier \ Role | burst_dd | offensive_tank |
|---|---|---|
| T1H | 24.7 | 19.4 |
| T1C | 23.5 (uncalibrated) | 19.4 |
| T2 | 22.5 | 19.4 |
| T3 | 21.5 | 19.4 |
| TM | 15.0 | 19.4 |
| TR | 18.4 | — |

**Insights validados:**
- `burst_dd` **escala por tier** (T1H ~118 Σ → T2 ~92 → T3 ~85 Σ raw por poke, spread <3.5% dentro do cluster)
- `offensive_tank` **flat entre tiers** (Sh.Golem T2 ≈ Omastar T3 ≈ 77 Σ raw)
- OTDD (over-time damage dealer) existe mas é foco de boss, não de lure — tratado como `burst_dd` sem distinção

### Defesas de mobs calibrados

| Mob | Tipo | defFactor |
|---|---|---|
| Pinsir | bug | 0.58 (bem tanky) |
| Dragonair | dragon | 0.68 (outlier) |
| Dratini | dragon | 0.80 |
| Magby | fire | 0.88 |
| Pansear | fire | 0.90 |
| Espurr | psy | 0.92 |

Fallback `DEFAULT_MOB_DEF_FACTOR = 0.85` (média aproximada) pros demais mobs com `todo: "calibrate defense"`.

### Calibração

- Usuário cast skill 1× no dummy → app deriva `skill_power` via fórmula inversa (`deriveSkillPower`) → valor salvo em `pokemon.json` (campo `power` da skill)
- Pokes calibrados: 13 (5 T1H burst_dd, 3 T2 burst_dd, 3 T3 burst_dd, 1 T2 offensive_tank, 1 T3 offensive_tank)
- **Pitfall de calibração:** quando o usuário cola "char X, boost Y, X-Atk Z" no topo, isso é do CHAR, não do poke testado. Cada poke tem seu próprio boost/held (ver memória `feedback_dummy_calibration_setup.md`)

### UI de calibração

- `PokemonCard`: ⚠️ quando `pokemon.todo` existe (skill power sem calibração)
- `DamageConfigPanel`: ⚠️/✓ nos mobs da dropdown + aviso "defesa aproximada" quando `defFactor` undefined
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
- **NÃO** marcar skill como `def:true` se for ofensiva — o flag é só pra self-buffs que substituem Elixir Def
- **NÃO** assumir 1 ciclo no beam — skills de CD grande podem exigir evaluation em 2+ ciclos. `evaluateCycle` roda 2 cycles pra medir steady-state
- **NÃO** rodar `evaluateCycle` em todo candidato do beam — é caro. Use cheap score (`sim.clock/steps.length`) e só refine top-4
- **NÃO** misturar raw tpl com adjusted score no pruning — o worker mantém `bestRawTpl` separado pra comparar com bag bounds. `bestScore` (com `starterResistFactor`) é só pra ranking final. Misturar corta bags legítimamente melhores quando o factor < 1.
- **NÃO** assumir que `lure.usesDevice` é a única coisa que aplica device bonus — o holder tem `hasDevice=true` em todas as lures (override global em `findBestRotation`). Damage calc lê `setup.hasDevice` direto, NÃO tem branch "se lure.usesDevice".
- **NÃO** excluir device holder de duplas/groups como starter — só como second. Ele pode starterar qualquer tipo de lure, e o dano dele já ganha device bonus via setup override.
- **NÃO** short-circuitar `findBestForBag` pra só o user's designated device — é hint, não override. Engine compara null + top-T1H + user pick e escolhe o melhor.

## Dicas de UI

- Tema escuro (background `#1a1a2e`)
- Botão "Copiar dados" gera report textual (sem listar skills — foram retiradas)
- Timeline visual usa cores rotativas por lure
- localStorage keys: `pxg_disk_level`, `pxg_selected_ids`
