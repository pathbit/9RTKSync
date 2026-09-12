# Multiple sessions on one account: where the traffic comes from

*(Versão em português ao final.)*

Providers let one account hold several concurrent sessions. What causes trouble
is not the number of sessions — it is **how they look from the outside**. When a
gateway fans many accounts out through a single machine, every one of those
accounts shows the same source address, and the pattern is what draws attention.

This page documents what **9Router** already gives you to control that, and what
the synchronizer shows about it. Every field below was read from the running
`decolua/9router` image and from its source — `src/lib/network/connectionProxy.js`
and `open-sse/utils/proxyFetch.js`. Nothing here is a claim about any provider's
policy, which we cannot verify and do not restate.

---

## What 9Router models

The egress endpoints live in the **`proxyPools`** table and the binding lives
**inside the connection**, under `providerSpecificData`:

| Field | What it does |
| --- | --- |
| `proxyPoolId` | Which pool this connection egresses through. The literal `"__none__"` means *explicitly disabled*. |
| `connectionProxyEnabled` | The legacy per-connection switch. |
| `connectionProxyUrl` | The legacy per-connection address, used when no pool resolves. |
| `connectionNoProxy` | Hosts to reach directly, bypassing the proxy. |

### How the address is actually chosen

`resolveConnectionProxyConfig()` decides, in this order:

1. **`proxyPoolId` set and the pool is usable** — the pool row must have
   `isActive === true` *and* a non-empty `proxyUrl`. The pool's URL wins.
2. **Otherwise it falls back to the legacy fields** on the connection
   (`connectionProxyEnabled` + `connectionProxyUrl`).
3. **Otherwise no proxy at all** — the request leaves through the host's own
   address.

Two consequences worth knowing before you rely on this:

> **A pool that is inactive, deleted or has an empty `proxyUrl` does not raise
> an error.** The connection silently falls back to the legacy fields, and if
> those are empty, that account goes back to sharing the host's address. Binding
> a pool is not enough — the pool has to be usable.

> **Pools of type `vercel`, `cloudflare` or `deno` are not HTTP proxies.** They
> are relays applied by rewriting the base URL, and the resolver deliberately
> returns `connectionProxyEnabled: false` for them, exposing the address as
> `vercelRelayUrl` instead. It takes precedence over the proxy path at request
> time.

### `strictProxy`: the difference between isolation and best effort

Each pool carries a `strictProxy` flag, and it decides what happens when the
proxy fails:

- **`strictProxy: true`** — the request fails: `Proxy required but failed`.
- **`strictProxy` unset or false** — `proxyFetch` logs a warning and **retries
  the request directly**, without the proxy.

That fallback is the one that undoes the whole arrangement: the account you
isolated goes out through the host's address at the first network hiccup, and
the only trace is a `console.warn` in the gateway log. **If the point of the
binding is to keep accounts apart, set `strictProxy` on the pool.**

### How to set it up

Through 9Router's own screens and API — the synchronizer never writes here:

1. Register each egress as a pool, with its `proxyUrl` and `isActive` on.
2. Set `strictProxy` on the pool, unless you would rather leak than fail.
3. On the connection, set `providerSpecificData.proxyPoolId` to that pool.
4. Give each account its **own** pool. Two accounts on one pool share an
   address, which is the situation you are trying to leave.

Verification, without leaving the box:

```sql
SELECT c.name AS account,
       CASE
         WHEN COALESCE(NULLIF(json_extract(c.data,'$.providerSpecificData.proxyPoolId'),''),'__none__') = '__none__'
           THEN CASE WHEN json_extract(c.data,'$.providerSpecificData.connectionProxyEnabled') = 1
                      AND NULLIF(json_extract(c.data,'$.providerSpecificData.connectionProxyUrl'),'') IS NOT NULL
                     THEN 'legacy (URL on the connection)'
                     ELSE 'SHARED (leaves through the host)' END
         WHEN p.id IS NULL   THEN 'pool missing -> SHARED'
         WHEN p.isActive = 0 THEN 'pool inactive -> falls back to legacy'
         WHEN NULLIF(json_extract(p.data,'$.proxyUrl'),'') IS NULL
                             THEN 'pool has no URL -> falls back to legacy'
         ELSE 'bound'
       END AS situation
FROM providerConnections c
LEFT JOIN proxyPools p
       ON p.id = json_extract(c.data,'$.providerSpecificData.proxyPoolId')
ORDER BY c.name;
```

Every row reading `SHARED` leaves through the same address as the others.

---

## What the synchronizer shows

The panel surfaces the binding **read-only**, per connection:

- **own egress** — the account has its own pool, and the panel names it;
- **shares the gateway address with N accounts** — no usable binding. The
  warning only appears from the **second** such account onwards: one account
  alone is the only owner of that address, and there is nothing to flag;
- **egress unknown** — the installation predates the proxy fields.

The synchronizer never creates, edits or deletes a pool or a binding. It reads,
and it tells you what it found. Ownership of the routing stays with the gateway,
the only component that can actually apply it to a request.

---

## The sibling gateway, for comparison

[OminiRTkSync](https://github.com/pathbit/OminiRTkSync) documents the same idea
for OmniRoute, which stores it differently: a `proxy_registry` of endpoints,
a `proxy_assignments` table binding them by `scope` (`global`, `provider`,
`account`) and a `proxy_scope_rotation` row per scope. There, a single proxy at
`scope='account'` pins that account's address. Same principle, different
storage — see that repository's copy of this page.

---

## Tailscale, and what it does and does not solve

Tailscale is one way to *obtain* egress addresses; it is not a replacement for
the binding above.

- An **exit node** gives the gateway host one stable outbound address — the
  node's. Useful when you want a known, stable address instead of whatever your
  ISP hands out. But it is **one address for the whole host**: with several
  accounts on one gateway, they all still share it. An exit node alone does not
  separate accounts.
- **Several exit nodes** do separate them, but only if each account is bound to
  a different one — and the binding is exactly the `proxyPoolId` above.
  Tailscale supplies the addresses; 9Router decides which account uses which.
- `--advertise-exit-node` plus `--exit-node` are per-host settings. To route
  per-account you still need one HTTP/SOCKS endpoint per node, registered as its
  own pool like any other egress.

The same holds for any provider of addresses — a VPS, a residential proxy, a
second uplink. The part that separates accounts is the per-account binding, not
the technology that produced the address.

### Reasonable defaults

- One egress per account when several accounts of the same provider live on one
  gateway.
- `strictProxy` on, so a failing proxy fails loudly instead of leaking.
- Prefer **stability over rotation** for a named account: an account whose
  address changes every few minutes looks less like a person, not more.
- Keep egress and account in the same region when the provider is
  region-sensitive.

---

# Em português

Provedores aceitam mais de uma sessão ativa por conta. O que costuma dar
problema não é a quantidade de sessões, e sim **como elas aparecem de fora**:
quando um gateway distribui várias contas por uma única máquina, todas saem pelo
mesmo endereço, e é esse padrão que chama atenção.

Esta página documenta o que o **9Router** já oferece para controlar isso e o que
o sincronizador mostra a respeito. Cada campo foi lido da imagem
`decolua/9router` em execução e do seu código — `src/lib/network/connectionProxy.js`
e `open-sse/utils/proxyFetch.js`. Não há aqui nenhuma afirmação sobre política de
fornecedor, que não temos como verificar.

## O que o 9Router modela

As saídas ficam na tabela **`proxyPools`** e o vínculo vive **dentro da
conexão**, em `providerSpecificData`:

| Campo | Para que serve |
| --- | --- |
| `proxyPoolId` | Por qual pool a conexão sai. O literal `"__none__"` significa *desativado explicitamente*. |
| `connectionProxyEnabled` | O interruptor legado, por conexão. |
| `connectionProxyUrl` | O endereço legado, usado quando nenhum pool resolve. |
| `connectionNoProxy` | Destinos a alcançar direto, sem passar pelo proxy. |

### Como o endereço é escolhido de fato

O `resolveConnectionProxyConfig()` decide nesta ordem:

1. **`proxyPoolId` definido e pool utilizável** — a linha do pool precisa ter
   `isActive === true` **e** um `proxyUrl` não vazio. Vence a URL do pool.
2. **Senão, cai nos campos legados** da conexão (`connectionProxyEnabled` +
   `connectionProxyUrl`).
3. **Senão, sem proxy nenhum** — a requisição sai pelo endereço do próprio host.

Duas consequências que vale conhecer antes de confiar nisso:

> **Um pool inativo, apagado ou com `proxyUrl` vazio não gera erro.** A conexão
> cai silenciosamente para os campos legados e, se eles estiverem vazios, aquela
> conta volta a dividir o endereço do host. Vincular um pool não basta — ele
> precisa estar utilizável.

> **Pools do tipo `vercel`, `cloudflare` ou `deno` não são proxy HTTP.** São
> relays aplicados por reescrita da URL base, e o resolvedor devolve
> deliberadamente `connectionProxyEnabled: false` para eles, expondo o endereço
> como `vercelRelayUrl`. Na hora do envio, o relay tem precedência sobre o
> caminho de proxy.

### `strictProxy`: a diferença entre isolamento e melhor esforço

Cada pool carrega a bandeira `strictProxy`, e ela decide o que acontece quando o
proxy falha:

- **`strictProxy: true`** — a requisição falha: `Proxy required but failed`.
- **`strictProxy` ausente ou falso** — o `proxyFetch` registra um aviso e
  **refaz a requisição direto**, sem o proxy.

Essa queda para conexão direta é o que desfaz o arranjo inteiro: a conta que
você isolou sai pelo endereço do host no primeiro soluço de rede, e o único
rastro é um `console.warn` no log do gateway. **Se o propósito do vínculo é
manter as contas separadas, ligue `strictProxy` no pool.**

### Como configurar

Pelas telas e pela API do próprio 9Router; o sincronizador não escreve nada
disso:

1. Cadastre cada saída como um pool, com `proxyUrl` preenchido e `isActive`.
2. Ligue `strictProxy` no pool, a menos que prefira vazar a falhar.
3. Na conexão, aponte `providerSpecificData.proxyPoolId` para esse pool.
4. Dê a cada conta o **seu próprio** pool. Duas contas no mesmo pool dividem
   endereço, que é justamente a situação da qual se quer sair.

A consulta de verificação está na seção em inglês, acima — vale igual.

## O que o painel mostra

Somente leitura, por conexão: **saída própria** (com o nome do pool), **divide o
endereço do gateway com N contas** (sem vínculo utilizável — e o aviso só
aparece a partir da segunda conta nessa situação, porque uma sozinha é a única
dona daquele endereço) ou **saída desconhecida** (instalação anterior aos campos
de proxy). O sincronizador nunca cria, edita nem apaga pool ou vínculo — quem
manda no roteamento é o gateway, o único que consegue de fato aplicá-lo a uma
requisição.

## O gateway irmão, para comparação

O [OminiRTkSync](https://github.com/pathbit/OminiRTkSync) documenta a mesma
ideia para o OmniRoute, que a guarda de outro jeito: um `proxy_registry` de
endereços, uma tabela `proxy_assignments` que os vincula por `scope` (`global`,
`provider`, `account`) e uma linha de `proxy_scope_rotation` por escopo. Lá, um
único proxy em `scope='account'` fixa o endereço daquela conta. Mesmo princípio,
armazenamento diferente.

## Tailscale: o que resolve e o que não resolve

- Um **exit node** dá ao host do gateway um endereço de saída estável — o do
  nó. É útil para ter um endereço conhecido em vez do que o provedor de internet
  entregar. Mas é **um endereço para o host inteiro**: com várias contas no
  mesmo gateway, todas continuam compartilhando. Exit node sozinho não separa
  contas.
- **Vários exit nodes** separam, desde que cada conta esteja vinculada a um
  deles — e o vínculo é exatamente o `proxyPoolId` acima. O Tailscale fornece os
  endereços; o 9Router decide qual conta usa qual.
- Para rotear por conta você ainda precisa de um endpoint HTTP/SOCKS por nó,
  cadastrado como pool próprio, como qualquer outra saída.

Vale o mesmo para qualquer origem de endereços — um VPS, um proxy residencial,
um segundo link. O que separa contas é o vínculo por conta, não a tecnologia que
produziu o endereço.

**Padrões razoáveis:** uma saída por conta quando várias contas do mesmo
provedor dividem um gateway; `strictProxy` ligado, para que um proxy com
problema falhe alto em vez de vazar; preferir **estabilidade a rotação** para
conta nomeada; e manter saída e conta na mesma região quando o provedor for
sensível a isso.
