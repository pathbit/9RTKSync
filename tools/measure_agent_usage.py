#!/usr/bin/env python3
"""Mede o perfil de consumo real de um agente a partir do historico do Claude Code.

Le APENAS os campos numericos de `usage`, o `message.id` e o `timestamp`.
Nenhum conteudo de conversa e lido, agregado ou impresso.

Cuidado que muda o resultado: uma unica resposta da API costuma ser gravada em
VARIAS linhas `type: "assistant"` (texto + cada bloco de ferramenta), todas com
o mesmo `message.id` e o mesmo objeto `usage`. Contar linhas infla requisicoes e
tokens em ~2x. Aqui cada `message.id` conta uma vez, e o proprio script imprime
a razao linhas/ids para que esse fator nao precise ser afirmado sem medida.

O historico e um corpus VIVO: ele cresce a cada sessao, entao rodar sem recorte
da um resultado diferente a cada dia. Use `--until` para congelar a medicao num
instante e obter um numero reproduzivel bit a bit -- enquanto o Claude Code
mantiver os arquivos daquele periodo em disco.

`--since` fecha o outro lado da janela. Os dois juntos servem para calibrar o
`C_window`: recorte o periodo da jornada, leia o TOTAL GERAL impresso no fim e
divida pela fracao consumida na tela de uso do fornecedor.
"""

import argparse
import glob
import json
import os
import statistics
from datetime import datetime, timedelta, timezone

HISTORY_ROOT = os.path.expanduser("~/.claude/projects")
IDLE_GAP = timedelta(minutes=20)   # lacuna que encerra uma "hora ativa"
MIN_TURNS_PER_SESSION = 10         # sessao curta demais nao diz nada sobre ritmo
MIN_ACTIVE_SECONDS = 300


def parse_cutoff(text):
    """Converte o recorte ISO-8601 recebido na linha de comando.

    Os registros do historico sao lidos com fuso (o `Z` do timestamp vira
    `+00:00`), entao o recorte tambem precisa ter fuso: comparar um instante
    ingenuo com um instante com fuso levanta TypeError.
    """
    moment = datetime.fromisoformat(str(text).replace("Z", "+00:00"))
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment


def read_session(path, until=None, since=None):
    """Devolve os turnos unicos de um arquivo de sessao, ordenados no tempo.

    Devolve tambem quantas LINHAS foram aceitas para chegar a esses turnos --
    mesma populacao, mesmos filtros -- porque e a razao entre as duas contagens
    que mede a inflacao da duplicacao.
    """
    turns = {}
    lines_kept = 0
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as handle:
            for line in handle:
                if '"usage"' not in line:
                    continue
                try:
                    record = json.loads(line)
                except Exception:
                    continue
                if record.get("type") != "assistant":
                    continue
                message = record.get("message") or {}
                usage = message.get("usage") or {}
                if not isinstance(usage, dict):
                    continue
                fresh_input = usage.get("input_tokens") or 0
                cache_write = usage.get("cache_creation_input_tokens") or 0
                cache_read = usage.get("cache_read_input_tokens") or 0
                output = usage.get("output_tokens") or 0
                if fresh_input + cache_write + cache_read + output <= 0:
                    continue
                try:
                    when = datetime.fromisoformat(
                        str(record.get("timestamp")).replace("Z", "+00:00")
                    )
                except Exception:
                    continue
                # Recorte: tudo depois do instante congelado fica de fora, para
                # que a mesma linha de comando devolva o mesmo numero amanha.
                if until is not None and when > until:
                    continue
                if since is not None and when < since:
                    continue
                lines_kept += 1
                # Deduplicacao: uma resposta da API = um message.id, nao uma linha.
                # Entre as linhas que repetem o id, fica a de maior contagem: as
                # primeiras podem trazer `output_tokens` ainda parcial.
                message_id = message.get("id") or f"{path}:{when.isoformat()}"
                candidate = (when, fresh_input + cache_write, output, cache_read)
                previous = turns.get(message_id)
                if previous is None or sum(candidate[1:]) > sum(previous[1:]):
                    turns[message_id] = candidate
    except Exception:
        return [], 0
    return sorted(turns.values(), key=lambda t: t[0]), lines_kept


def active_seconds(turns):
    """Tempo em que o agente esteve de fato requisitando, ignorando pausas longas."""
    total = 0.0
    for previous, current in zip(turns, turns[1:]):
        delta = current[0] - previous[0]
        if timedelta(0) <= delta <= IDLE_GAP:
            total += delta.total_seconds()
    return total


def percentile(values, fraction):
    ordered = sorted(values)
    if not ordered:
        return float("nan")
    index = int(round(fraction * (len(ordered) - 1)))
    return ordered[max(0, min(len(ordered) - 1, index))]


parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
parser.add_argument(
    "--until",
    metavar="ISO8601",
    default=None,
    help="congela a medicao: ignora tudo com timestamp posterior a este instante. "
         "Precisa de fuso, por exemplo 2026-09-12T22:00:00Z. Sem ele a medicao "
         "varre o historico inteiro e muda a cada nova sessao.",
)
parser.add_argument(
    "--since",
    metavar="ISO8601",
    default=None,
    help="limite inferior da janela, mesmo formato do --until. Com os dois, a "
         "medicao cobre so o periodo pedido -- e o recorte que calibra C_window.",
)
args = parser.parse_args()
cutoff = parse_cutoff(args.until) if args.until else None
floor = parse_cutoff(args.since) if args.since else None

billable_input, output_tokens, cached_input, total_input = [], [], [], []
request_rates, session_spans = [], []
grand_billable = grand_output = grand_cached = grand_turns = grand_lines = 0

for session_path in glob.glob(os.path.join(HISTORY_ROOT, "**", "*.jsonl"), recursive=True):
    turns, lines_kept = read_session(session_path, cutoff, floor)
    if len(turns) < MIN_TURNS_PER_SESSION:
        continue
    elapsed = active_seconds(turns)
    if elapsed < MIN_ACTIVE_SECONDS:
        continue
    count = len(turns)
    billable_input.append(sum(t[1] for t in turns) / count)
    output_tokens.append(sum(t[2] for t in turns) / count)
    cached_input.append(sum(t[3] for t in turns) / count)
    total_input.append(sum(t[1] + t[3] for t in turns) / count)
    request_rates.append(count / (elapsed / 3600.0))
    session_spans.append((turns[0][0], turns[-1][0]))
    grand_billable += sum(t[1] for t in turns)
    grand_output += sum(t[2] for t in turns)
    grand_cached += sum(t[3] for t in turns)
    grand_turns += count
    grand_lines += lines_kept

print(f"recorte (--since)                           : {args.since or 'nenhum (desde o inicio)'}")
print(f"recorte (--until)                           : {args.until or 'nenhum (corpus vivo)'}")
print(f"sessoes analisadas                         : {len(request_rates)}")
print(f"linhas assistant com usage (antes do dedup) : {grand_lines}")
print(f"turnos unicos (dedup por message.id)        : {grand_turns}")
inflation = f"{grand_lines / grand_turns:.2f}x" if grand_turns else "n/a"
print(f"inflacao de contar linha em vez de id       : {inflation}")
print(f"T_in  entrada que conta p/ ITPM  mediana    : {statistics.median(billable_input):.0f}")
print(f"T_in  entrada que conta p/ ITPM  p90        : {percentile(billable_input, 0.90):.0f}")
print(f"T_out saida                      mediana    : {statistics.median(output_tokens):.0f}")
print(f"T_out saida                      p90        : {percentile(output_tokens, 0.90):.0f}")
print(f"T_cache leitura de cache         mediana    : {statistics.median(cached_input):.0f}")
print(f"T_tot entrada total (conta+cache) mediana   : {statistics.median(total_input):.0f}")
print(f"T_tot entrada total (conta+cache) p90       : {percentile(total_input, 0.90):.0f}")
print(f"R_h   requisicoes por hora ativa mediana    : {statistics.median(request_rates):.0f}")
print(f"R_h   requisicoes por hora ativa p90        : {percentile(request_rates, 0.90):.0f}")
total_all = grand_billable + grand_output + grand_cached
print(f"fracao de leitura de cache no total         : {grand_cached / total_all * 100:.1f}%")
print(f"razao entrada total / entrada que conta     : "
      f"{statistics.median(total_input) / statistics.median(billable_input):.1f}x")

# Concorrencia: quantas sessoes se sobrepoem no tempo. Numa maquina de um unico
# operador isto mede paralelismo de subagentes, nao concorrencia de time.
events = []
for start, end in session_spans:
    events.append((start, 1))
    events.append((end, -1))
events.sort()
open_sessions = peak = 0
for _, delta in events:
    open_sessions += delta
    peak = max(peak, open_sessions)
print(f"pico de sessoes simultaneas                 : {peak}")

# Soma bruta do periodo -- e ela, e nao a mediana, que calibra C_window:
# recorte a jornada com --since/--until, leia a fracao p consumida na tela de uso
# do fornecedor e faca C_window ~= TOTAL GERAL / p.
print()
print(f"TOTAL GERAL entrada total (conta+cache)     : {grand_billable + grand_cached}")
print(f"TOTAL GERAL saida                           : {grand_output}")
print(f"TOTAL GERAL token total do periodo          : "
      f"{grand_billable + grand_cached + grand_output}")
