# Single sign-on: signing in through an identity provider

*(Versão em português ao final.)*

The panel has always had two doors, and single sign-on adds a third way of
*creating a session* — not a third kind of session. The cookie handed out at the
end of the federated flow is byte for byte the one the local form hands out
today, signed by the same per-process secret in
[`src/nine_rtksync/sessao.py`](https://github.com/pathbit/9RTKSync/blob/master/src/nine_rtksync/sessao.py).

> **It is optional, and it starts off.** With nothing configured the panel
> behaves exactly as it does today: the sign-in screen is the same, and the
> `/sso/` routes answer 404 like any route that does not exist.

---

## What is implemented, and what is not

| | Status |
|---|---|
| OIDC sign-in (discovery, PKCE, code exchange, userinfo, allowlist) | **Implemented**, no external dependency |
| SAML2 configuration tab | **Shown, disabled**, with the reason on screen |
| SAML2 sign-in (assertion validation) | **Not implemented** — needs `python3-saml`, see the last section |
| Federated sign-out (single logout) | **Out of scope** |

The honest reason for the split: SAML2 signs over exclusive canonicalisation
1.0, and the standard library's `canonicalize` implements a different algorithm;
there is no RSA verification in the standard library; and defending against a
signed assertion moved elsewhere in the document tree requires the code that
checks the signature to also check that the validated element is the one that
was read. That is library work, and the library is not in the image. Shipping a
hand-rolled version of it would be worse than shipping nothing, because a
wrongly canonicalised signature check is one relaxation away from accepting a
forged assertion.

---

## The rule, end to end

1. The sign-in screen keeps the local user-and-password form. It never
   disappears — if the identity provider is down, nobody would get in.
2. When single sign-on is configured **and** the provider's discovery document
   answers, the screen also draws a **link** (never a form: the panel's own
   content policy declares `form-action 'self'`, and a form pointing outside is
   blocked by the browser with no visible error).
3. Clicking it sends the browser to the provider with PKCE, `state` and `nonce`.
   The three values are signed into a short-lived cookie that lives for ten
   minutes, is scoped to the `/sso/` path, and is consumed on the way back.
4. On the return, before any session is created, the panel checks, stopping at
   the first failure: the state cookie's signature; `state`; the presence of the
   authorization code; the code exchange at the provider; then `iss`, `aud`,
   `azp`, `exp`, `iat` and `nonce` of the identity token; then the subject read
   from the user-information endpoint against the one in the token; then
   `email_verified`; then the allowlist.
5. Only then is the session cookie issued, for the principal `sso:<e-mail>`.
6. Every failure shows **one** message. Telling apart "wrong state" from "e-mail
   not allowed" tells an attacker how far they got; the detail goes to the
   internal log, which never carries the code or any token.

---

## Configuring it against Google (a worked example)

**Before anything**: single sign-on needs a **fixed public address**. A quick
tunnel gets a new address on every start, and the return address you registered
at the provider stops matching the moment it changes — every sign-in then fails
with a provider-side error you cannot fix from here. Use a named tunnel or
Tailscale. See [Remote Access](Remote-Access).

1. **In the Google Cloud console**, create an OAuth client of type *Web
   application*.
2. Add the **authorised redirect URI**. The panel shows the exact string to copy
   under the Settings button once you fill in the public address; it is your
   public address followed by `/sso/oidc/callback`. One character of difference
   and Google refuses the exchange.
3. Copy the client ID and the client secret.
4. **In the panel**, sign in locally and open **Settings** in the header bar.
5. Fill in, on the OIDC tab:
   - *Identity provider*: OIDC
   - *Public panel address*: your fixed address, scheme and host only
   - *Issuer*: `https://accounts.google.com`
   - *Client ID* and *Client secret*
   - *Allowed domains*: your company domain — **this is mandatory**. Without it,
     "sign in with Google" means every Google account on the planet can sign in
     to your panel.
6. Type your **current panel password** and save. The password is required on
   top of the session on purpose: whoever steals an eight-hour session cookie
   must not be able to point the panel at an identity provider of their own and
   put themselves on the allowlist.
7. Sign out and check that the sign-in screen now shows both the local form and
   the provider button.

Any provider that publishes a discovery document works the same way — Microsoft
Entra, Okta, Authentik, Keycloak. Two notes from the checks above: the issuer
must match the `issuer` field of the discovery document character for character,
and providers that omit `email_verified` will not pass, because a panel that
reads live credentials should not trust an unconfirmed e-mail address.

### Where the secret lives

The client secret **never** goes into the preferences database, and a page load
never sends it back to the browser — the screen says only that a value is
stored, and offers a field to replace it. Saving with that field empty keeps the
current value.

Two places, in order of precedence:

1. `OIDC_CLIENT_SECRET` in the environment. When it is set, the environment is
   the source of truth and the screen locks the field — the same rule
   `DASHBOARD_PASSWORD` already follows.
2. A file named `.sso_client_secret`, created with mode `0600` next to the
   recovery credential, inside the data directory (`DATA_DIR`, or the directory
   of the gateway database).

If neither exists, single sign-on does not turn on. It does not turn on quietly
without a secret, which would put a button on the sign-in screen leading to a
generic failure.

---

## When the provider goes down

Nothing here traps you outside the panel. In increasing order of bluntness:

1. **The local form never leaves the screen.** Your panel user and password
   still work, always.
2. **The recovery credential still works.** See [Authentication](Authentication).
3. **The non-HTML door is untouched.** `curl`, cron and monitoring keep signing
   in with Basic Auth, which never goes through single sign-on.
4. **The button disappears on its own.** The sign-in screen asks the provider
   for its discovery document; when that fails the button is simply not drawn,
   and the failure is remembered for a minute so a dead provider cannot make
   every sign-in screen wait for a timeout.
5. **The emergency switch**: set `SSO_DISABLED=1` in the environment and bring
   the container back up. It beats the database without touching it, so nothing
   you configured is lost when you take the variable back out.
6. **From the screen**: open Settings, set the provider to *Disabled*, type the
   panel password, save.

One thing that looks like a bug and is not: signing out clears the **local**
cookie only. Your session at the identity provider is still open, so clicking
the provider button again comes back in without asking for a password. Federated
sign-out is not implemented.

---

## The routes

| Route | Who calls it | Session required |
|---|---|---|
| `/sso/oidc/iniciar` | the browser, from the sign-in screen | no — it is the session it exists to create |
| `/sso/oidc/callback` | the browser, coming back from the provider | no — same reason |
| `/acoes/sso` | the settings screen | yes, **plus the current panel password** |

The two public ones go through the same per-address attempt ceiling as the
sign-in form, answer 404 while single sign-on is not configured and enabled, and
are declared with their reason in `tests/test_nada_sem_login.py`, which is the
guard that refuses any new route escaping the session requirement.

Two details that are decisions, not accidents:

- The return address sent to the provider is always built from the configured
  public address, **never** from the request's `Host` header. `Host` is chosen
  by whoever is calling, and deriving the return address from it is the
  definition of an open redirect.
- The callback answers **200 with a small page that refreshes to `/`**, not a
  302. A redirect chain that started on another site does not carry a
  `SameSite=Strict` cookie on the next hop, so a 302 would land the operator on
  the sign-in screen holding a perfectly valid session. No parameter of the
  return is ever used as the destination; it is always `/`.

---

## What the SAML2 phase needs

The configuration tab is already drawn and translated, and it stays disabled
until the library is in the image. Adding it means changing the Dockerfile of
all three panels — which is why it is a separate phase:

```
RUN apk add --no-cache libxml2 libxslt xmlsec && \
    apk add --no-cache --virtual .build gcc musl-dev libxml2-dev libxslt-dev xmlsec-dev pkgconfig && \
    pip install --no-cache-dir --no-binary lxml,xmlsec python3-saml && \
    apk del .build
```

Building the two extensions from source is not optional: the published wheels of
`lxml` and `xmlsec` embed different versions of the same XML library, and the
mismatch surfaces at runtime, not at install time. The extra is already declared
as `saml` in `pyproject.toml`, so `pip install .[saml]` is enough outside Docker.

---

# Em português

O painel sempre teve duas portas, e a entrada federada acrescenta uma terceira
forma de **criar uma sessão** — não uma terceira espécie de sessão. O cookie
entregue no fim do fluxo é exatamente o que o formulário local entrega hoje,
assinado pelo mesmo segredo de processo de `sessao.py`.

> **É opcional, e nasce desligada.** Sem configuração o painel funciona
> exatamente como hoje: a tela de entrada é a mesma, e as rotas `/sso/`
> respondem 404 como qualquer rota que não existe.

## O que está pronto, e o que não está

| | Situação |
|---|---|
| Entrada por OIDC (descoberta, PKCE, troca do código, perfil, lista de permissão) | **Pronta**, sem dependência externa |
| Aba de configuração SAML2 | **Aparece, desabilitada**, com o motivo na tela |
| Entrada por SAML2 (validação da asserção) | **Não implementada** — exige `python3-saml` |
| Saída federada (logout no provedor) | **Fora de escopo** |

O motivo honesto da divisão: a assinatura do SAML2 é sobre canonicalização
exclusiva 1.0, e o `canonicalize` da biblioteca padrão implementa outro
algoritmo; não há verificação RSA na biblioteca padrão; e defender-se de uma
asserção assinada deslocada dentro da árvore exige que quem confere a assinatura
confira também que o elemento validado é o mesmo que foi lido. Isso é trabalho
de biblioteca, e a biblioteca não está na imagem. Entregar uma versão artesanal
disso seria pior que não entregar nada: uma canonicalização errada está a uma
"correção" de distância de aceitar uma asserção forjada.

## A regra, de ponta a ponta

1. A tela de entrada mantém o formulário local de usuário e senha. Ele nunca
   sai — se o provedor de identidade cair, ninguém entraria.
2. Quando há configuração completa **e** o documento de descoberta responde, a
   tela também desenha um **link** (nunca um formulário: a política de conteúdo
   do painel declara `form-action 'self'`, e um formulário apontando para fora é
   bloqueado pelo navegador sem erro visível).
3. O clique manda o navegador ao provedor com PKCE, `state` e `nonce`. Os três
   viajam assinados num cookie de dez minutos, preso ao caminho `/sso/` e
   consumido na volta.
4. Na volta, antes de qualquer sessão, o painel confere, parando na primeira
   falha: a assinatura do cookie de estado; o `state`; a presença do código; a
   troca do código no provedor; `iss`, `aud`, `azp`, `exp`, `iat` e `nonce` do
   token de identidade; o identificador de conta lido do perfil contra o do
   token; o `email_verified`; e a lista de permissão.
5. Só então o cookie de sessão é emitido, para `sso:<e-mail>`.
6. Toda falha exibe **uma** frase. Distinguir "state errado" de "e-mail fora da
   lista" conta ao atacante até onde ele chegou; o detalhe vai para o log
   interno, que nunca carrega o código nem token nenhum.

## Configurando no Google (exemplo completo)

**Antes de tudo**: a entrada federada exige um **endereço público fixo**. O túnel
rápido troca de endereço a cada subida, e o endereço de retorno cadastrado no
provedor deixa de bater no instante em que isso acontece. Use túnel nomeado ou
Tailscale — veja [Remote Access](Remote-Access).

1. **No console do Google Cloud**, crie um cliente OAuth do tipo *aplicação web*.
2. Cadastre o **endereço de retorno autorizado**. O painel mostra a linha exata
   para copiar, no botão Configurações, assim que você preenche o endereço
   público; é o seu endereço seguido de `/sso/oidc/callback`. Um caractere de
   diferença e o Google recusa a troca.
3. Copie o identificador e o segredo do cliente.
4. **No painel**, entre com a senha local e abra **Configurações**, na barra do
   cabeçalho.
5. Preencha, na aba OIDC:
   - *Provedor de identidade*: OIDC
   - *Endereço público do painel*: o seu endereço fixo, só esquema e host
   - *Emissor*: `https://accounts.google.com`
   - *Identificador* e *segredo do cliente*
   - *Domínios autorizados*: o domínio da sua empresa — **isto é obrigatório**.
     Sem ele, "entrar com o Google" significa que toda conta Google do planeta
     entra no seu painel.
6. Digite a **senha atual do painel** e salve. Ela é exigida além da sessão de
   propósito: quem rouba um cookie de oito horas não pode com isso apontar o
   painel a um provedor próprio e se pôr na lista de permissão.
7. Saia e confira que a tela de entrada agora mostra o formulário local **e** o
   botão do provedor.

Qualquer provedor que publique documento de descoberta funciona igual — Entra,
Okta, Authentik, Keycloak. Dois avisos vindos das conferências acima: o emissor
tem de bater caractere a caractere com o campo `issuer` do documento, e provedor
que não envia `email_verified` não passa, porque um painel que lê credenciais não
deve confiar num e-mail não confirmado.

### Onde mora o segredo

O segredo do cliente **nunca** vai para o banco de preferências, e nenhuma
renderização o devolve ao navegador — a tela diz apenas que existe um valor
guardado, e oferece um campo para substituí-lo. Salvar com esse campo em branco
mantém o valor atual.

Dois lugares, nesta ordem de precedência:

1. `OIDC_CLIENT_SECRET` no ambiente. Definida, o ambiente é a fonte da verdade e
   a tela trava o campo — a mesma regra que `DASHBOARD_PASSWORD` já segue.
2. Um arquivo `.sso_client_secret`, criado com modo `0600` ao lado da credencial
   de recuperação, dentro do diretório de dados (`DATA_DIR`, ou o diretório do
   banco do gateway).

Sem nenhum dos dois, o SSO não liga. Ele não liga em silêncio sem segredo, o que
poria um botão na tela levando a uma falha genérica.

## Quando o provedor cai

Nada aqui tranca você do lado de fora. Em ordem crescente de contundência:

1. **O formulário local nunca sai da tela.** O seu usuário e senha continuam
   valendo, sempre.
2. **A credencial de recuperação continua valendo.** Veja [Authentication](Authentication).
3. **A porta não-HTML está intocada.** `curl`, cron e monitoramento continuam
   entrando por Basic Auth, que nunca passa pelo SSO.
4. **O botão some sozinho.** A tela pergunta ao provedor pelo documento de
   descoberta; quando isso falha o botão simplesmente não é desenhado, e a falha
   fica memorizada por um minuto para que um provedor morto não faça cada tela de
   entrada esperar o tempo limite.
5. **O interruptor de emergência**: `SSO_DISABLED=1` no ambiente e suba o
   container de novo. Ele vence o banco sem tocar nele, então nada do que você
   configurou se perde quando a variável sair.
6. **Pela tela**: abra Configurações, ponha o provedor em *Desligado*, digite a
   senha do painel e salve.

Uma coisa que parece defeito e não é: "Sair" apaga só o cookie **local**. A sua
sessão no provedor continua de pé, então clicar de novo no botão volta sem pedir
senha. A saída federada não está implementada.

## As rotas

| Rota | Quem chama | Exige sessão |
|---|---|---|
| `/sso/oidc/iniciar` | o navegador, pela tela de entrada | não — é a sessão que ela existe para criar |
| `/sso/oidc/callback` | o navegador, voltando do provedor | não — mesmo motivo |
| `/acoes/sso` | a tela de configuração | sim, **e ainda a senha atual do painel** |

As duas públicas passam pelo mesmo teto de tentativas por endereço do formulário
de entrada, respondem 404 enquanto o SSO não estiver configurado e ligado, e
estão declaradas com o motivo em `tests/test_nada_sem_login.py`, que é a guarda
que recusa qualquer rota nova escapando da exigência de sessão.

Dois detalhes que são decisão, e não acaso:

- O endereço de retorno enviado ao provedor nasce sempre do endereço público
  configurado, **nunca** do cabeçalho `Host` da requisição. O `Host` é escolhido
  por quem chama, e derivar dali o endereço de retorno é a definição de
  redirecionamento aberto.
- A volta responde **200 com uma página que recarrega para `/`**, e não um 302.
  Uma cadeia de redirecionamento iniciada em outro site não carrega o cookie
  `SameSite=Strict` no salto seguinte, então o 302 deixaria o operador na tela de
  entrada com uma sessão perfeitamente válida no bolso. Nenhum parâmetro da volta
  vira destino; ele é sempre `/`.

## O que a fase do SAML2 exige

A aba de configuração já está desenhada e traduzida, e fica desabilitada até a
biblioteca entrar na imagem. Pô-la lá significa mudar o Dockerfile dos três
painéis — e é por isso que é uma fase separada. O bloco está na versão em inglês,
logo acima. Compilar as duas extensões a partir do fonte não é opcional: os
pacotes prontos de `lxml` e de `xmlsec` embutem versões diferentes da mesma
biblioteca de XML, e o desencontro aparece em tempo de execução, não na
instalação. O extra já está declarado como `saml` no `pyproject.toml`.
