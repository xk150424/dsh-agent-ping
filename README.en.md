# dsh-agent-ping

Cross-session **@** for DeepSeek Harness — let one session call another.
**The user approves first; then the message is delivered — waking the target if it is asleep.**

> Sessions can @ each other on their own. Before this, the only way to get a
> message across was for a human to switch over, copy and paste. This plugin
> opens a channel instead. After the user nods, the message goes straight into
> the other session. If that session is offline, it is woken first.

[简体中文](README.md) · [Handover notes](HANDOVER.md)

---

## What it looks like

In the **callee's** conversation, a card floats above the composer:

```
from  RE-MK  to  FR-FL            +2 queued
─────────────────────────────────────────
Take a look at line 380 of index.js —
is that `target` argument still needed?

                    [ later ]   [ ✕ ]   [ ✓ ]
```

- **Allow** — delivered, the card disappears
- **Deny** — dropped, the caller learns the outcome
- **Later** — neither approved nor denied; moved to the back of the queue

Cards are **per-session**: the card appears wherever the caller is currently
talking, so the user never has to switch over to click it.

---

## Install

**Not published to npm — install straight from GitHub.** Requires
**DSH 0.2.0-rc.1 or newer; older versions are untested, and 0.1.7 is currently
known to work.** Plain JavaScript — **no build step**, no runtime dependencies.

```sh
dsh plugin --profile <your-profile> add github:xk150424/dsh-agent-ping
```

### DSH Desktop

Sidebar → **Plugins → Add plugin**, and paste the argument that follows `add`:

```
github:xk150424/dsh-agent-ping
```

> **Profile name**: CLI users are usually on `web`. The `desktop` profile is
> owned by the Electron app and the CLI refuses to manage it — desktop users
> should use the GUI path above.
>
> You can also paste this repository's URL into DSH and let it install the plugin
> for you.
>
> **After installing**: either restart DSH or refresh the page. If you are
> **replacing** an already installed version, the DSH process must be restarted.

---

## Usage

The plugin exposes two tools to the model:

| Tool | Purpose |
|---|---|
| `who_can_i_call` | Lists callable sessions: the live ones, plus any known-but-**asleep (wakeable)** ones |
| `call_agent` | Calls a session. **Raises an approval card for you first** — nothing is sent until you allow it |

Roughly what the model does:

```
who_can_i_call                      → see who is around
call_agent { target: "FR-FL",
             message: "take a look at line 380 of index.js" }
```

**The approval card is the only gate.** The plugin will not go around it — not
by acting first and reporting later, and not by waking a session quietly.

---

## Queue semantics

Several requests can be pending at once. The rules are fixed:

- The card shows **only the newest one**
- The badge `+N queued` means `N = queue length − 1`; it does not change while
  the total is unchanged
- **"Later" moves the current card to the front of the queue** (i.e. off the
  display slot) so an older one surfaces. It is never approved, denied, or lost
- **Allow / Deny remove exactly one entry, by id** — nobody else in the queue is touched

---

## How it works

```
        ┌──────────── callee's session (Web GUI) ───────────┐
        │  conversation.input.dock  ──  approval card       │
        └───────────────────────▲───────────────────────────┘
                                │  GET  /agent-ping/state
                                │  POST /agent-ping/answer
        ┌───────────────────────┴───────────────────────────┐
        │              Host half (index.js)                 │
        │  two tools: call_agent / who_can_i_call           │
        │  pending queue · answer routes · identity · wake  │
        └───────────────────────▲───────────────────────────┘
                                │ followup(createUserMessage(…))
                       another session (live or asleep)
```

**Delivery** uses `agent.followup(...)` (deliver **and** wake), not `inject`
(deliver only).

**Waking has exactly one correct path**: `ctx.sessionController.resolveAgent(sessionId)`.
It fills in both `agentOptions` (where `{{model}}` comes from) and `setup`
(where the preset and tools come from). Calling `ctx.agents.resume` directly
produces a miserable failure mode — **the session wakes, but the turn it wakes
into cannot assemble itself.**

**"Woken" is only claimed after it was measured.** Before waking, the plugin
checks `ctx.agents.get(id)`: if it resolves, the session was already live and
only its title was unrecognised — so no wake is reported. `resolveAgent` returns
success in that case too, and that return value lies.

**Identity resolution** goes: the workspace's own registry → the session title →
the roster. The roster (name → session id) is accumulated by the plugin on each
tool call — **it is the only way to wake an offline session**, so a name that
has never been alive on this machine cannot be woken.

---

## Known limitations

- **Local only.** It moves messages between sessions of the same DSH instance;
  it is not a network service.
- **A human has to click.** That is the design, not a defect — a later version
  may change this, depending on what the author needs.
- **Waking depends on the roster.** The roster is accumulated from previous
  calls; a brand-new name that is currently offline cannot be reached.
- **No read receipt.** Delivery can be confirmed, comprehension cannot.

### Not yet verified (honest bookkeeping)

- The branch where `resolveAgent` hits a session that is **live but whose title
  cannot be resolved** — inference, not observation. If it happens, the receipt
  reads: `（名册按 id 命中：他其实活着，只是标题一时认不出来）`.
- What a `resolveAgent` failure looks like when the session has not been
  persisted, or its working directory is missing — the error is passed through
  verbatim, but this has never been exercised.

---

## Development

| File | Role | Cost of a change |
|---|---|---|
| `index.js` | Host half: tools, routes, queue, wake | **restart DSH** |
| `client.js` | Client half: card, animation, badge, receipt | **refresh the page** |
| `package.json` | Package manifest and `dsh` fields | **restart DSH** |
| `cordis.patch.yml` | Inserts one row into the profile | **restart DSH** |
| `HANDOVER.md` | Handover notes: the traps, and how to test | — |

```js
// Mind these when editing:
window.__ModuleLoader__.load({
  id: 'dsh-agent-ping',          // must equal the package name
  factory(require) { … }         // all side effects go inside the factory
});
```

> ⚠ `package.json`'s `exports` **must include `"./package.json"`**. Without it
> the client half **fails to load silently** — no error, the card just never appears.
>
> ⚠ The `name:` in `cordis.patch.yml` **must equal the package name**, or Node
> cannot resolve the code.

---

## License

[MIT](LICENSE)
