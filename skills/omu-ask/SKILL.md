---
name: omu-ask
description: Route questions to AI providers including UiPath CLI
argument-hint: "<provider> <prompt>"
---

# Ask — Provider Router

Route a question to an AI provider. Includes `uipath` as a provider that routes through uipathcli.

## Providers

| Provider | Binary | Notes |
|----------|--------|-------|
| `claude` | `claude` | Claude Code (default) |
| `codex` | `codex` | OpenAI Codex |
| `gemini` | `gemini` | Google Gemini |
| `grok` | `grok` | xAI Grok |
| `cursor` | `cursor-agent` | Cursor |
| **`uipath`** | **`uip`** | **UiPath CLI — platform API calls** |

## Usage

```
/omu-ask claude "Review this workflow for best practices"
/omu-ask codex "Find security issues in the authentication module"
/omu-ask uipath "orchestrator jobs get --filter 'State eq Running'"
```

## UiPath Provider

The `uipath` provider interprets the prompt as a `uip` command:

```
omu ask uipath "orchestrator jobs get"
  → uip orchestrator jobs get

omu ask uipath "identity user get-users --query '[0].name'"
  → uip identity user get-users --query '[0].name'
```

### Role Mapping

`--agent-prompt` maps to UiPath skill commands:

| Role | Maps to |
|------|---------|
| rpa | `uip rpa` |
| agents | `uip codedagent` |
| platform | `uip or` |
| admin | `uip admin` |
| solution | `uip solution` |
| test | `uip tm` |
| maestro | `uip maestro` |
| ixp | `uip ixp` |
| insights | `uip insights` |

## Security

External providers are blocked if `disableExternalLLM` is set in config. Only `claude` is always allowed.
