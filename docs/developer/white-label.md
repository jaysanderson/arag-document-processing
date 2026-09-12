# White-labelling

A partner can rebrand a deployment of Document Processing **by configuration alone** — no
fork, no rebuild, no code change. Set `BRAND_*` environment variables, drop a logo into a
directory, restart. Both the operator app (`/`) and the admin app (`/admin/`) read the
effective branding from `GET /api/v1/branding` before they paint.

## The branding keys

| Variable | Default | What it changes |
|---|---|---|
| `BRAND_PRODUCT_NAME` | `Document Processing` | The name at the top of the sidebar, and page titles |
| `BRAND_TAGLINE` | `Documents in, validated records out` | Small line under the name |
| `BRAND_LOGO_URL` | *(none — the name alone)* | Your mark above the name at the top of the sidebar, and on the admin sign-in card. The Progress Agentic RAG wordmark stays in the top band (see `BRAND_POWERED_BY`) |
| `BRAND_PRIMARY_COLOR` | platform brand colour | `--arag-brand-500/600/700` CSS variables |
| `BRAND_ACCENT_COLOR` | platform accent | `--arag-accent-400/500` |
| `BRAND_POWERED_BY` | `1` | `0` hides the "Built on Progress Agentic RAG" band and footer credit |
| `BRAND_FOOTER_TEXT` | `Open source · Apache-2.0` | Left-hand footer text |
| `BRAND_DOCS_URL` | `/api/v1/docs` | Where the header "API docs" button points |
| `BRAND_SUPPORT_URL` | *(none)* | Partner support link |

Colours accept any CSS colour (`#0b5cff`, `rgb(11,92,255)`, `rebeccapurple`). An
unparseable value is ignored rather than applied, so a typo cannot make the UI unreadable.

A worked example:

```bash
fly secrets set \
  BRAND_PRODUCT_NAME="Northwind DocFlow" \
  BRAND_TAGLINE="Claims intake, automated" \
  BRAND_LOGO_URL="/branding/logo.svg" \
  BRAND_PRIMARY_COLOR="#0b5cff" \
  BRAND_POWERED_BY=0 \
  BRAND_FOOTER_TEXT="© Northwind Insurance" \
  BRAND_SUPPORT_URL="https://support.northwind.example"
```

Locally, the same keys go in `.env` (see [`../../.env.example`](../../.env.example)).
**Put comments on their own line** — the `.env` parser treats everything after `=` as the
value, so `LOG_LEVEL=info  # a note` becomes the literal string `info  # a note`.

## Assets

`BRAND_LOGO_URL` may be an absolute URL (your CDN) or a path this service serves. Anything
in `DATA_DIR/branding/` is published at `/branding/`, so on Fly the logo lives on the data
volume and survives deploys:

```bash
fly ssh console -C "mkdir -p /data/branding"
fly sftp shell
# put ./logo.svg /data/branding/logo.svg
```

Requirements:

- **Format** — SVG preferred; PNG/WebP work. The header renders it at 26 px tall and scales
  the width, so give it room: a horizontal lockup around 4:1 reads best.
- **Transparency** — the header background is light; a transparent background avoids a box.
- **Size** — keep it under ~100 KB. It is fetched on every page load.
- **Favicon** — the kit's `/ui/favicon.svg` is the default; serve your own and change the
  `<link rel="icon">` in `public/index.html` and `admin/index.html` if you want it branded.

Only media, PDF, font, stylesheet and text types are served from that directory, and it is
read-only over HTTP — there is no upload endpoint for brand assets by design.

## Checking what is applied

`GET /api/v1/branding` is public and returns the effective values:

```console
$ curl -sS http://localhost:8080/api/v1/branding
{"productName":"Document Processing","tagline":"Documents in, validated records out",
 "logoUrl":"","primaryColor":"","accentColor":"","poweredBy":true,
 "footerText":"","docsUrl":"/api/v1/docs","supportUrl":""}
```

The admin app's **Branding** screen (`/admin/#/branding`) shows the same values with the
variable that sets each one, plus a live preview — and the same information, without an
admin token, is on the operator app's **Settings → Branding** tab — so an operator can see
what is in force without shell access.

## What branding does *not* change

Deliberately out of scope, because they are contracts rather than presentation:

- **The OpenAPI document** — `info.title` stays "Document Processing API". Clients and
  generated SDKs key off it; renaming it would break them on a rebrand.
- **Route paths, field names, `dip_*` search-configuration names** — all stable.
- **Log lines and metrics** — they identify the software, not the brand.

If you need the API itself renamed, that is a fork, not a configuration change — see
[`build-your-own.md`](build-your-own.md).

## Rebranding the documentation and the showcase

- **Docs** — this `docs/` tree says "Document Processing" throughout. Search and replace the
  product name, then re-run `make docs` so `api-reference.md` regenerates, and `make links`
  to confirm nothing broke.
- **Showcase** — set the `BRAND_*` variables in the Playwright web-server command in
  [`../../playwright.config.ts`](../../playwright.config.ts) and re-run `make showcase`; the
  recording then carries your branding. Update
  [`../../showcase/SCRIPT.md`](../../showcase/SCRIPT.md) narration to match.
- **Enablement** — [`../../enablement/`](../../enablement/) refers to the product by name in
  prose only; a find-and-replace is sufficient.

## Licence and trademark obligations

Document Processing is **Apache-2.0** ([`../../LICENSE`](../../LICENSE)). Rebranding is
expressly allowed, and `BRAND_POWERED_BY=0` is a supported configuration — but hiding the
credit does **not** remove the licence obligations:

1. **Keep the licence and notices.** You must retain `LICENSE`, the copyright notices and
   any `NOTICE` file in your distribution, including a hosted service you build from this
   source. Hiding an on-screen credit is a presentation choice; deleting the licence text
   is a breach.
2. **State significant changes.** Apache-2.0 §4(b) requires modified files to carry
   prominent notices that you changed them.
3. **No implied endorsement.** Apache-2.0 grants no trademark rights (§6). "Progress",
   "Progress Agentic RAG" and "Nuclia" are trademarks of Progress Software Corporation.
   You may state factually that your product is *built on* Progress Agentic RAG; you may
   not use the marks in your product name, logo, domain, or in any way suggesting Progress
   endorses or produces your product, without a separate trademark agreement.
4. **Your own marks are yours.** Nothing here asks you to license your brand to anyone.

When in doubt, keep `BRAND_POWERED_BY=1`: the credit is factual, costs nothing, and is what
most partners ship.

## Related

- [`build-your-own.md`](build-your-own.md) — forking and extending beyond configuration.
- [`../architecture/security-model.md`](../architecture/security-model.md) — the branding
  endpoint is public by design; what that does and does not expose.
- [`../product-marketing/partner-pitch.md`](../product-marketing/partner-pitch.md) — the
  commercial shape of a partner engagement.
