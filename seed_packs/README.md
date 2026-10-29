# AI Innovators Expedition — London 2026 Seed Packs (`t01`..`t10`)

Welcome to the **Seed Packs** catalog for the **AI Innovators Expedition — London (29–30 Oct 2026)**.

Each table (`Table 1` through `Table 10`) has a dedicated, self-contained **Seed Pack** (`t01_<slug>` .. `t10_<slug>`) that pairs a real-world enterprise scenario with:

1. **`pack.yaml`** — Declarative metadata, ADK system `instruction`, BigQuery dataset (`seed_t01`..`seed_t10`), GCS prefix (`seed/t01/`..`seed/t10/`), and MCP server module path.
2. **`data/*.csv` + `generate.py`** — 3 realistic, deterministic synthetic CSV datasets (60–150 rows per table) with realistic edge cases and an embedded adversarial / policy-trap row for the **Security & Guardrails Test Vector (Optional +1 Bonus)**.
3. **`load.py`** — Idempotent loader (`make seed PACK=tNN`) that creates the BigQuery dataset in **your** `GOOGLE_CLOUD_PROJECT` (`BQ_LOCATION`, default `EU`, `WRITE_TRUNCATE`) from the bundled `data/*.csv` files, and optionally copies the CSVs to a bucket you own (`SEED_BUCKET` or `STAGING_BUCKET`). It stops with a clear error if `GOOGLE_CLOUD_PROJECT` is not set.
4. **`tools.py`** — 3 ADK-ready BigQuery Function Tools (`TOOLS`) with full type annotations, docstrings and parameterized SQL (`@params`, never string-built values) against `GOOGLE_CLOUD_PROJECT`. If the project is unset, the dataset is missing or `SEED_OFFLINE_MODE=1`, they answer from the bundled CSVs and say so in `source: "local_csv_fallback"` plus a `fallback_reason` that tells you what to fix (usually `make seed PACK=tNN`).
5. **`mcp_server.py`** — FastMCP (`from mcp.server.fastmcp import FastMCP`) stdio server with 3 local, side-effect-free Mock Action APIs (`MCP_TOOLS`, re-exported as `ACTION_TOOLS`) and policy guardrails. Mock confirmations are kept in `seed_packs/<slug>/.state.json` (git-ignored), or in a temp-dir file when the pack folder is read-only (for example in Agent Runtime). Nothing real is ever called.
6. **`eval/golden.test.json`** — 5 realistic evaluation test cases in the official ADK `EvalSet` schema (`adk eval` / `make eval PACK=tNN`).
7. **`CHALLENGE_CARD.md`** — Printable one-page table brief with persona, minimum playable scope (~3.5h), stretch goal, Must-Haves, Bonus ideas (including a named sister Table for **A2A** handshakes), and a **Security & Guardrails Test Vector (Optional +1 Bonus)** with a defensive hint.

---

## Index of All 10 Table Seed Packs

| Table | Seed Pack Directory | Challenge Title | Tribe | BigQuery Dataset & Tables (`EU`) | BigQuery `TOOLS` (Read) | FastMCP `MCP_TOOLS` (Write/Action) | Sister Table (A2A) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | [`t01_campaign_orchestrator`](./t01_campaign_orchestrator/CHALLENGE_CARD.md) | **Autonomous Creative Campaign Orchestrator** | Creative AI & AdTech | `seed_t01` (`events_catalog`, `ad_variants`, `campaign_telemetry`) | `query_underperforming_campaigns`, `get_event_ad_variants`, `get_channel_roi_summary` | `place_ad_bid`, `create_localized_variant`, `pause_ad_variant` | `t02_dynamic_storefronts` |
| **2** | [`t02_dynamic_storefronts`](./t02_dynamic_storefronts/CHALLENGE_CARD.md) | **Visual Content Creator & Dynamic Storefronts** | Creative AI & AdTech | `seed_t02` (`products_catalog`, `audience_segments`, `storefront_experiments`) | `find_catalog_products`, `get_storefront_performance`, `get_audience_segments` | `publish_storefront_layout`, `queue_visual_asset_render`, `update_promo_banner` | `t01_campaign_orchestrator` |
| **3** | [`t03_catalog_discovery`](./t03_catalog_discovery/CHALLENGE_CARD.md) | **Conversational Catalog Discovery Assistant** | Content Intelligence | `seed_t03` (`marketplace_listings`, `protection_plans`, `search_sessions`) | `search_marketplace_listings`, `get_compatible_protection_plans`, `analyze_search_dropoffs` | `create_curated_shortlist`, `attach_protection_quote`, `flag_suspect_listing` | `t04_b2b_sourcing` |
| **4** | [`t04_b2b_sourcing`](./t04_b2b_sourcing/CHALLENGE_CARD.md) | **Dynamic B2B Integration & Sourcing Agent** | Content Intelligence | `seed_t04` (`suppliers`, `supplier_feeds_raw`, `sourcing_rfqs`) | `query_supplier_feeds`, `get_open_sourcing_rfqs`, `get_supplier_reliability` | `normalize_supplier_schema`, `issue_purchase_order`, `quarantine_supplier_feed` | `t03_catalog_discovery` |
| **5** | [`t05_financial_auditor`](./t05_financial_auditor/CHALLENGE_CARD.md) | **Autonomous B2B Financial Auditor & Reconciler** | FinTech & Analytics | `seed_t05` (`ledger_entries`, `supplier_invoices`, `treasury_policies`) | `find_unreconciled_invoices`, `detect_ledger_anomalies`, `get_treasury_policy` | `reconcile_invoice_to_ledger`, `hold_payment_for_audit`, `approve_verified_payout` | `t06_climate_risk` |
| **6** | [`t06_climate_risk`](./t06_climate_risk/CHALLENGE_CARD.md) | **Dynamic Climate & Regulatory Risk Assessor** | FinTech & Analytics | `seed_t06` (`insured_assets`, `climate_hazard_grids`, `historical_loss_claims`) | `query_exposed_assets`, `get_climate_hazard_projections`, `summarize_historical_claims` | `issue_renewal_quote_adjustment`, `trigger_loss_prevention_inspection`, `register_catastrophe_accumulation_alert` | `t05_financial_auditor` |
| **7** | [`t07_self_healing_ops`](./t07_self_healing_ops/CHALLENGE_CARD.md) | **Self-Healing Infrastructure & Security Copilot** | Cross-functional Ops & CX | `seed_t07` (`service_incidents`, `deployment_releases`, `slo_runbooks`) | `query_active_incidents`, `inspect_deployment_release`, `lookup_slo_runbook` | `execute_canary_rollback`, `scale_service_replicas`, `annotate_incident_timeline` | `t08_travel_concierge` |
| **8** | [`t08_travel_concierge`](./t08_travel_concierge/CHALLENGE_CARD.md) | **Hyper-Personalized Travel Concierge & Incident Management Agent** | Cross-functional Ops & CX | `seed_t08` (`disrupted_itineraries`, `rebooking_inventory`, `partner_hotels`) | `query_disrupted_passengers`, `search_rebooking_options`, `find_partner_hotels` | `rebook_passenger_segment`, `sync_hotel_late_checkin`, `issue_compensation_voucher` | `t07_self_healing_ops` |
| **9** | [`t09_mobility_energy`](./t09_mobility_energy/CHALLENGE_CARD.md) | **Smart Mobility & Energy Optimizer Agent** | Smart Mobility & UX | `seed_t09` (`ev_fleet_telemetry`, `grid_tariff_windows`, `depot_charger_capacity`) | `query_fleet_charging_needs`, `get_grid_tariff_forecast`, `inspect_depot_charger_headroom`, `optimize_depot_energy_arbitrage` | `schedule_smart_charging_plan`, `authorize_v2g_grid_discharge`, `throttle_depot_transformer_load`, `simulate_fleet_route_change`, `notify_sister_table_t10_a2a` | `t10_retention_matcher` |
| **10** | [`t10_retention_matcher`](./t10_retention_matcher/CHALLENGE_CARD.md) | **Predictive Retention & Resource Matcher** | Smart Mobility & UX | `seed_t10` (`subscriber_cohorts`, `retention_offer_catalog`, `intervention_outcomes`) | `query_at_risk_subscribers`, `find_matching_retention_offers`, `analyze_historical_save_rates` | `dispatch_retention_offer`, `schedule_onboarding_rescue_call`, `log_churn_prevention_decision` | `t09_mobility_energy` |

*(Plus [`t00_example`](./t00_example/) as a baseline reference implementation.)*

---

## Quickstart: Switching Your Starter Agent to Your Table's Seed Pack

### 1. Select Your Pack via `SEED_PACK`

Set `SEED_PACK` in your `.env` (or pass `PACK=tNN` to `make` targets). You can use either the short table prefix (`t01`..`t10`) or the full directory slug (`t08_travel_concierge`):

```bash
export GOOGLE_CLOUD_PROJECT="your-gcp-project-id"
export GOOGLE_CLOUD_LOCATION="global"
export GEMINI_MODEL="gemini-3.8-flash"
export GEMINI_IMAGE_MODEL="gemini-3.1-flash-image"
export SEED_PACK="t08_travel_concierge"   # or simply: export SEED_PACK="t08"
```

### 2. Seed Your Own GCP Project (supported path)

Every pack ships its synthetic data as `data/*.csv` inside this repo, so you do not need to download anything. Load it into BigQuery in your own project with the idempotent loader (safe to re-run):

```bash
make seed PACK=t08            # reads GOOGLE_CLOUD_PROJECT from .env
# Or directly, from the repo root:
GOOGLE_CLOUD_PROJECT=<your-project-id> .venv/bin/python -m seed_packs.t08_travel_concierge.load
```

> All datasets are 100% synthetic/fictional and are bundled in `seed_packs/tNN_<slug>/data/*.csv` — you do not need any external bucket: always seed your own project (`GOOGLE_CLOUD_PROJECT`).

### 3. Run Locally, Evaluate, and Validate All Packs

```bash
# Validate all 10 seed packs (YAML, CSV row counts, TOOLS signatures, MCP_TOOLS, EvalSet JSON, Challenge Cards)
.venv/bin/python seed_packs/check_packs.py

# Run the ADK evaluation suite against your pack's 5 golden cases
make eval PACK=t08_travel_concierge
```
