#!/usr/bin/env python3
"""Resolve a formula de dimensionamento com os numeros medidos e arbitrados.

Entradas medidas -- instantaneo congelado, reproduzivel pelo comando abaixo
nesta maquina, enquanto o Claude Code guardar os arquivos daquele periodo:

    python3 tools/measure_agent_usage.py --until 2026-09-13T02:00:00Z

Entradas ARBITRADAS, nao medidas: `CONCURRENCY` e `SLACK`. Nao ha medicao por
tras delas -- sao valores escolhidos aqui para variar e mostrar a sensibilidade
da formula. Este script nao e fonte desses dois numeros; e o lugar onde eles
foram arbitrados. Meca os seus.
"""

import math

# --- medido: perfil de UMA sessao ativa de agente (recorte de 2026-09-13T02:00Z) ---
PROFILES = {
    "mediana": {"rate_per_hour": 206, "billable_input": 3914, "output": 723, "total_input": 88442},
    "p90": {"rate_per_hour": 342, "billable_input": 7668, "output": 1351, "total_input": 205437},
}

# --- publicado: teto por tier da API, linhas Opus 5 / Sonnet 5 ---
# FONTE: https://platform.claude.com/docs/en/api/rate-limits - lido em 2026-09-12.
# Repare que isto e teto POR MINUTO (RPM/ITPM/OTPM), nao capacidade de janela:
# na API a pergunta e se a rajada estoura o limite por minuto, e nao quanto cabe
# num periodo de reset. Alem disso o ITPM da API ignora leitura de cache, o que
# o medidor de uma assinatura Pro/Max nao faz -- por isso as duas metades deste
# script usam unidades diferentes de proposito.
API_TIERS = {
    "Start": {"rpm": 1_000, "itpm": 2_000_000, "otpm": 400_000},
    "Build": {"rpm": 5_000, "itpm": 5_000_000, "otpm": 1_000_000},
    "Scale": {"rpm": 10_000, "itpm": 10_000_000, "otpm": 2_000_000},
}

TEAM_SIZES = [3, 12, 40]
# ARBITRADO, nao medido: nao existe medicao de concorrencia por tras destes
# valores. Estao aqui para mostrar a sensibilidade da formula, e por isso sao
# tres. Quem citar este script como fonte de `c` esta citando um palpite.
CONCURRENCY = [0.4, 0.6, 1.0]
# ARBITRADO: folga operacional, decisao de quem opera, nao resultado de medicao.
SLACK = 0.30
# PUBLICADO: janela de reset de 5 h da Anthropic.
# FONTE: https://support.claude.com/en/articles/11049741-what-is-the-max-plan
WINDOW_HOURS = 5


def burst_demand(team_size, concurrency, profile, slack=SLACK):
    """Demanda por minuto: e o teto que estoura primeiro."""
    simultaneous = team_size * concurrency
    rpm = simultaneous * profile["rate_per_hour"] / 60 * (1 + slack)
    return simultaneous, rpm, rpm * profile["billable_input"], rpm * profile["output"]


def smallest_tier(rpm, itpm, otpm):
    for name, tier in API_TIERS.items():
        if rpm <= tier["rpm"] and itpm <= tier["itpm"] and otpm <= tier["otpm"]:
            return name
    return "acima de Scale"


print("### CAMINHO DE API (LiteLLM) - teto publicado, resolve numericamente")
for label, profile in PROFILES.items():
    print(f"\nperfil {label}: R_h={profile['rate_per_hour']} req/h, "
          f"T_in={profile['billable_input']} tok/req, T_out={profile['output']} tok/req, "
          f"folga={SLACK:.0%}")
    print(f"{'devs':>5} {'c':>5} {'U_sim':>6} {'RPM':>7} {'ITPM':>10} {'OTPM':>9}  tier minimo")
    for size in TEAM_SIZES:
        for factor in CONCURRENCY:
            simultaneous, rpm, itpm, otpm = burst_demand(size, factor, profile)
            print(f"{size:>5} {factor:>5.1f} {simultaneous:>6.1f} {rpm:>7.0f} "
                  f"{itpm:>10,.0f} {otpm:>9,.0f}  {smallest_tier(rpm, itpm, otpm)}")

print("\n\n### CAMINHO DE ASSINATURA (9Router/OmniRoute) - C_janela e [A MEDIR]")
print("A unidade aqui e TOKEN TOTAL (entrada cacheada inclusa): o medidor da")
print("assinatura nao publica o que conta, e a calibracao de Settings > Usage")
print("so pode ser feita contra o total trafegado.\n")
print("D_total = U_sim * R_h * (T_tot + T_out) * W_h * (1 + F)")
for label, profile in PROFILES.items():
    for size in TEAM_SIZES:
        factor = 0.6
        simultaneous = size * factor
        demand = (simultaneous * profile["rate_per_hour"]
                  * (profile["total_input"] + profile["output"])
                  * WINDOW_HOURS * (1 + SLACK))
        print(f"perfil {label:>7} | {size:>2} devs | c=0.6 | U_sim={simultaneous:4.1f} | "
              f"W={WINDOW_HOURS}h | D = {demand:,.0f} tokens -> L = ceil(D / C_janela)")

print("\n\n### folga da rajada contra UMA licenca de API no tier Start (1000 rpm)")
for size in TEAM_SIZES:
    _, rpm, _, _ = burst_demand(size, 0.6, PROFILES["mediana"])
    print(f"{size:>2} devs, c=0.6 -> pico exigido {rpm:6.0f} rpm; "
          f"Start cobre {math.floor(1000 / rpm)}x a demanda")
