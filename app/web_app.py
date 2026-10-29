"""VoltMotion Mobility — Table 9 E2E Command Center & Digital Twin Web Application.

Provides:
- Interactive European Fleet & Depot GIS Digital Twin data (`/api/dashboard`)
- Live Google ADK Agent Copilot chat with real-time tool-call tracing (`/api/chat`)
- Interactive What-If Fleet & Route Simulator (`/api/simulate`)
- Direct Operational Action & Red-Team Security Test triggers (`/api/action`)
- State Reset for repeatable hackathon live demos (`/api/reset`)
"""

from __future__ import annotations

import csv
import hashlib
import json
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from google.adk.runners import InMemoryRunner
from google.genai import types
from pydantic import BaseModel

ROOT_DIR = Path(__file__).resolve().parents[1]
load_dotenv(ROOT_DIR / ".env", override=False)

from app.agent import root_agent  # noqa: E402
from seed_packs.t09_mobility_energy.mcp_server import (  # noqa: E402
    VEHICLE_SPECS,
    _default_state,
    _load_state,
    _save_state,
    authorize_v2g_grid_discharge,
    notify_sister_table_t10_a2a,
    schedule_smart_charging_plan,
    simulate_fleet_route_change,
    throttle_depot_transformer_load,
)
from seed_packs.t09_mobility_energy.tools import (  # noqa: E402
    optimize_depot_energy_arbitrage,
)

STATIC_DIR = Path(__file__).resolve().parent / "static"
T09_DATA_DIR = ROOT_DIR / "seed_packs" / "t09_mobility_energy" / "data"
T10_DATA_DIR = ROOT_DIR / "seed_packs" / "t10_retention_matcher" / "data"

DEPOT_METADATA: dict[str, dict[str, Any]] = {
    "DEP-MADRID-SOUTH": {
        "depot_id": "DEP-MADRID-SOUTH",
        "name": "Madrid South Logistics Hub",
        "city": "Madrid",
        "country": "ES",
        "lat": 40.3650,
        "lng": -3.6950,
        "timezone": "CET",
        "grid_zone": "ES_IBERIA_OMIE",
        "destinations": [
            {"label": "Mercamadrid Hub", "lat": 40.3612, "lng": -3.6565},
            {"label": "Getafe Industrial", "lat": 40.3082, "lng": -3.7327},
            {"label": "Coslada Cargo Port", "lat": 40.4258, "lng": -3.5415},
            {"label": "Alcobendas Tech Corridor", "lat": 40.5475, "lng": -3.6420},
            {"label": "Toledo Logistics Ring", "lat": 40.1850, "lng": -3.8200},
        ],
    },
    "DEP-BARCELONA-PORT": {
        "depot_id": "DEP-BARCELONA-PORT",
        "name": "Barcelona Port Zona Franca",
        "city": "Barcelona",
        "country": "ES",
        "lat": 41.3350,
        "lng": 2.1380,
        "timezone": "CET",
        "grid_zone": "ES_IBERIA_OMIE",
        "destinations": [
            {"label": "El Prat Cargo Terminal", "lat": 41.2974, "lng": 2.0833},
            {"label": "Martorell Auto Hub", "lat": 41.4789, "lng": 1.9247},
            {"label": "Badalona Urban North", "lat": 41.4502, "lng": 2.2474},
            {"label": "Sabadell Parc", "lat": 41.5463, "lng": 2.1086},
        ],
    },
    "DEP-MILAN-NORTH": {
        "depot_id": "DEP-MILAN-NORTH",
        "name": "Milan North Intermodal Depot",
        "city": "Milan",
        "country": "IT",
        "lat": 45.5230,
        "lng": 9.2120,
        "timezone": "CET",
        "grid_zone": "IT_NORD_PUN",
        "destinations": [
            {"label": "Malpensa Cargo City", "lat": 45.6301, "lng": 8.7255},
            {"label": "Monza Brianza Hub", "lat": 45.5845, "lng": 9.2744},
            {"label": "Bergamo East Corridor", "lat": 45.6760, "lng": 9.6700},
            {"label": "Piacenza South Gate", "lat": 45.0526, "lng": 9.6930},
        ],
    },
    "DEP-LONDON-EAST": {
        "depot_id": "DEP-LONDON-EAST",
        "name": "London East Docklands Hub",
        "city": "London",
        "country": "UK",
        "lat": 51.5150,
        "lng": 0.0650,
        "timezone": "GMT",
        "grid_zone": "UK_NATIONAL_GRID",
        "destinations": [
            {"label": "Canary Wharf Express", "lat": 51.5054, "lng": -0.0235},
            {"label": "Tilbury Port Terminal", "lat": 51.4610, "lng": 0.3600},
            {"label": "Stratford Olympic Hub", "lat": 51.5430, "lng": -0.0090},
            {"label": "Heathrow West Cargo", "lat": 51.4700, "lng": -0.4543},
        ],
    },
    "DEP-AMSTERDAM-WEST": {
        "depot_id": "DEP-AMSTERDAM-WEST",
        "name": "Amsterdam Westpoort Smart Grid Hub",
        "city": "Amsterdam",
        "country": "NL",
        "lat": 52.3980,
        "lng": 4.7890,
        "timezone": "CET",
        "grid_zone": "NL_TENNET",
        "destinations": [
            {"label": "Schiphol Freight Sector", "lat": 52.3105, "lng": 4.7683},
            {"label": "Haarlem Distribution", "lat": 52.3874, "lng": 4.6462},
            {"label": "Utrecht Central Ring", "lat": 52.0907, "lng": 5.1214},
            {"label": "Zaandam North Port", "lat": 52.4388, "lng": 4.8260},
        ],
    },
}


def _read_csv(path: Path) -> list[dict[str, Any]]:
    with path.open(newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def _hours_until_departure(dep_str: str) -> float:
    try:
        parts = str(dep_str).strip().split(":")
        h = int(parts[0])
        m = int(parts[1]) if len(parts) > 1 else 0
        dep_float = h + m / 60.0
        if dep_float >= 20.0:
            return round(max(0.5, dep_float - 20.0), 1)
        return round((24.0 - 20.0) + dep_float, 1)
    except Exception:
        return 8.0


def _vehicle_coordinates(vehicle_id: str, depot_id: str, plugged_in: bool) -> dict[str, Any]:
    meta = DEPOT_METADATA.get(depot_id, DEPOT_METADATA["DEP-MADRID-SOUTH"])
    digest = hashlib.sha256(f"{vehicle_id}:{depot_id}".encode()).hexdigest()
    u1 = (int(digest[:8], 16) / 0xFFFFFFFF) - 0.5
    u2 = (int(digest[8:16], 16) / 0xFFFFFFFF) - 0.5
    dests = meta["destinations"]
    dest = dests[int(digest[16:20], 16) % len(dests)]

    if plugged_in:
        lat = round(meta["lat"] + u1 * 0.025, 5)
        lng = round(meta["lng"] + u2 * 0.032, 5)
    else:
        progress = 0.35 + (int(digest[20:24], 16) / 0xFFFF) * 0.45
        lat = round(meta["lat"] + (dest["lat"] - meta["lat"]) * progress + u1 * 0.01, 5)
        lng = round(meta["lng"] + (dest["lng"] - meta["lng"]) * progress + u2 * 0.01, 5)

    return {
        "lat": lat,
        "lng": lng,
        "depot_lat": meta["lat"],
        "depot_lng": meta["lng"],
        "dest_lat": dest["lat"],
        "dest_lng": dest["lng"],
        "dest_label": dest["label"],
    }


def _build_dashboard_payload(selected_depot: str = "ALL") -> dict[str, Any]:
    state = _load_state()
    overrides = state.get("fleet_overrides", {})

    scheduled_map: dict[str, dict[str, Any]] = {}
    for plan in state.get("charging_schedules", []):
        for vid in plan.get("vehicle_ids", []):
            scheduled_map[vid] = plan

    v2g_depots = {d.get("depot_id"): d for d in state.get("v2g_dispatches", [])}
    throttle_map = {t.get("depot_id"): t for t in state.get("load_caps", [])}

    raw_fleet = _read_csv(T09_DATA_DIR / "ev_fleet_telemetry.csv")
    raw_tariffs = _read_csv(T09_DATA_DIR / "grid_tariff_windows.csv")
    raw_bays = _read_csv(T09_DATA_DIR / "depot_charger_capacity.csv")

    bays_by_depot: dict[str, list[dict[str, Any]]] = {}
    for b in raw_bays:
        bays_by_depot.setdefault(b["depot_id"], []).append(b)

    fleet_enriched: list[dict[str, Any]] = []
    for idx, row in enumerate(raw_fleet):
        vid = row["vehicle_id"]
        ovr = overrides.get(vid, {})
        depot_id = ovr.get("depot_id") or row["depot_id"]
        if selected_depot != "ALL" and depot_id != selected_depot:
            continue

        v_type = row["vehicle_type"]
        spec = VEHICLE_SPECS.get(v_type, VEHICLE_SPECS["Electric_Delivery_Van"])
        cap_kwh = float(spec["battery_kwh"])
        max_kw = float(spec["max_charge_kw"])
        cur_soc = float(ovr.get("battery_soc_pct", row["battery_soc_pct"]))
        tgt_soc = float(ovr.get("target_soc_pct", row["target_soc_pct"]))
        route_km = int(ovr.get("next_route_km", row["next_route_km"]))
        dep_hour = str(ovr.get("next_route_departure_hour", row["next_route_departure_hour"]))
        plugged = str(row["plug_status"]).upper() == "PLUGGED_IN"
        v2g_cap = str(row["v2g_capable"]).lower() == "true"

        route_kwh = round(route_km * spec["kwh_per_km"], 1)
        min_safe_soc = min(95.0, round((route_kwh / cap_kwh) * 100.0 + 15.0, 1))
        effective_tgt_soc = max(tgt_soc, min_safe_soc)
        energy_needed_kwh = round(max(0.0, (effective_tgt_soc - cur_soc) / 100.0 * cap_kwh), 1)
        min_charge_hours = round(energy_needed_kwh / max(max_kw, 1.0), 2)
        hrs_until_dep = _hours_until_departure(dep_hour)
        hr_int = int(dep_hour.split(":")[0]) if ":" in dep_hour else 7

        v2g_exportable_kwh = (
            round(max(0.0, (cur_soc - 35.0) / 100.0 * cap_kwh * 0.5), 1)
            if (plugged and v2g_cap and cur_soc >= 60.0)
            else 0.0
        )

        depot_bays = bays_by_depot.get(depot_id, [])
        assigned_bay = (
            depot_bays[idx % len(depot_bays)]["charger_bay_id"]
            if (plugged and depot_bays)
            else "EN-ROUTE"
        )

        if not plugged:
            readiness = "EN_ROUTE"
        elif vid in scheduled_map:
            readiness = "SCHEDULED_SMART_CHARGE"
        elif depot_id in v2g_depots and v2g_cap and cur_soc >= 60.0:
            readiness = "V2G_DISPATCHED"
        elif cur_soc < min_safe_soc and hr_int <= 7:
            readiness = "CRITICAL_STRAND_RISK"
        elif cur_soc < tgt_soc:
            readiness = "NEEDS_SMART_CHARGE"
        elif v2g_cap and cur_soc >= 60.0:
            readiness = "V2G_READY"
        else:
            readiness = "ROUTE_READY"

        coords = _vehicle_coordinates(vid, depot_id, plugged)
        fleet_enriched.append(
            {
                "vehicle_id": vid,
                "depot_id": depot_id,
                "original_depot_id": row["depot_id"],
                "vehicle_class": v_type,
                "battery_capacity_kwh": cap_kwh,
                "current_soc_pct": cur_soc,
                "target_soc_pct": tgt_soc,
                "min_safe_soc_pct": min_safe_soc,
                "next_route_departure_hour": dep_hour,
                "next_route_km": route_km,
                "charger_bay_id": assigned_bay,
                "max_charge_kw": max_kw,
                "v2g_capable": v2g_cap,
                "plugged_in": plugged,
                "energy_needed_kwh": energy_needed_kwh,
                "min_charge_hours": min_charge_hours,
                "hours_until_departure": hrs_until_dep,
                "v2g_exportable_kwh": v2g_exportable_kwh,
                "readiness": readiness,
                "is_modified": bool(ovr),
                "override_details": ovr,
                "active_schedule": scheduled_map.get(vid),
                "active_v2g": v2g_depots.get(depot_id) if (v2g_cap and cur_soc >= 60.0) else None,
                **coords,
            }
        )

    fleet_enriched.sort(
        key=lambda v: (
            0 if v["readiness"] == "CRITICAL_STRAND_RISK" else 1,
            v["current_soc_pct"],
        )
    )

    tariffs_enriched: list[dict[str, Any]] = []
    for t in raw_tariffs:
        if selected_depot != "ALL" and t["depot_id"] != selected_depot:
            continue
        notice = str(t.get("grid_operator_notice", ""))
        hour_short = str(t["hour_utc"]).split("T")[-1][:5] if "T" in str(t["hour_utc"]) else str(t["hour_utc"])
        tariffs_enriched.append(
            {
                "window_id": t["window_id"],
                "depot_id": t["depot_id"],
                "grid_zone": t["grid_zone"],
                "hour_utc": hour_short,
                "tariff_tier": t["tariff_tier"],
                "price_eur_per_mwh": float(t["price_eur_per_mwh"]),
                "carbon_intensity_gco2_kwh": int(t["carbon_intensity_g_co2_kwh"]),
                "v2g_export_bonus_eur_mwh": float(t["v2g_export_bonus_eur_mwh"]),
                "grid_operator_notice": notice,
                "is_adversarial": "OVERRIDE" in notice.upper(),
            }
        )
    tariffs_enriched.sort(key=lambda r: (r["depot_id"], r["hour_utc"]))

    bays_enriched: list[dict[str, Any]] = []
    for b in raw_bays:
        if selected_depot != "ALL" and b["depot_id"] != selected_depot:
            continue
        max_p = float(b["max_power_kw"])
        act_p = float(b["active_load_kw"])
        tx_headroom = float(b["transformer_headroom_kw"])
        bays_enriched.append(
            {
                "charger_bay_id": b["charger_bay_id"],
                "depot_id": b["depot_id"],
                "max_power_kw": max_p,
                "current_load_kw": act_p,
                "headroom_kw": round(max(0.0, max_p - act_p), 1),
                "transformer_headroom_kw": tx_headroom,
                "thermal_status": b["operational_status"],
            }
        )

    depot_summaries: list[dict[str, Any]] = []
    target_depots = (
        list(DEPOT_METADATA.keys())
        if selected_depot == "ALL"
        else [selected_depot]
    )
    total_net_benefit = 0.0
    total_co2_saved = 0.0
    total_energy_needed = 0.0
    total_v2g_revenue = 0.0

    for dep_id in target_depots:
        arb_raw = json.loads(optimize_depot_energy_arbitrage(depot_id=dep_id))
        meta = DEPOT_METADATA.get(dep_id, {})
        fin = arb_raw.get("financial_and_carbon_impact", {})
        tx_sum = arb_raw.get("transformer_summary", {})

        net_b = float(fin.get("total_net_optimization_benefit_eur", 0.0))
        co2_s = float(fin.get("co2_avoided_kg", 0.0))
        chg_kwh = float(fin.get("total_charge_needed_kwh", 0.0))
        v2g_rev = float(fin.get("v2g_arbitrage_revenue_eur", 0.0))

        total_net_benefit += net_b
        total_co2_saved += co2_s
        total_energy_needed += chg_kwh
        total_v2g_revenue += v2g_rev

        act_kw = float(tx_sum.get("total_active_load_kw", 0.0))
        head_kw = float(tx_sum.get("total_headroom_kw", 1.0))

        depot_summaries.append(
            {
                **meta,
                "optimization": {
                    "total_net_benefit_eur": net_b,
                    "co2_avoided_kg": co2_s,
                    "total_energy_needed_kwh": chg_kwh,
                    "v2g_export_revenue_eur": v2g_rev,
                    "smart_charging_savings_eur": float(fin.get("smart_charging_savings_eur", 0.0)),
                },
                "transformer": {
                    "transformer_load_kw": act_kw,
                    "transformer_headroom_kw": head_kw,
                    "transformer_limit_kw": round(act_kw + head_kw, 1),
                    "derated_thermal_bays": len(tx_sum.get("derated_thermal_bays", [])),
                },
                "active_throttle": throttle_map.get(dep_id),
                "critical_vehicles_count": len(arb_raw.get("critical_strand_risk_vehicles", [])),
                "v2g_candidates_count": len(arb_raw.get("v2g_ready_vehicles", [])),
            }
        )

    t10_subscribers_by_country: dict[str, int] = {}
    t10_csv = T10_DATA_DIR / "subscriber_cohorts.csv"
    if t10_csv.exists():
        for s in _read_csv(t10_csv):
            if float(s.get("churn_probability", 0)) >= 0.65:
                c = s.get("country", "EU")
                t10_subscribers_by_country[c] = t10_subscribers_by_country.get(c, 0) + 1

    kpis = {
        "selected_depot": selected_depot,
        "total_vehicles": len(fleet_enriched),
        "plugged_in_vehicles": sum(1 for v in fleet_enriched if v["plugged_in"]),
        "critical_strand_risk_count": sum(
            1 for v in fleet_enriched if v["readiness"] == "CRITICAL_STRAND_RISK"
        ),
        "needs_smart_charge_count": sum(
            1
            for v in fleet_enriched
            if v["readiness"] in ("CRITICAL_STRAND_RISK", "NEEDS_SMART_CHARGE")
        ),
        "v2g_ready_count": sum(
            1 for v in fleet_enriched if v["readiness"] in ("V2G_READY", "V2G_DISPATCHED")
        ),
        "modified_vehicles_count": sum(1 for v in fleet_enriched if v["is_modified"]),
        "total_energy_needed_kwh": round(total_energy_needed, 1),
        "total_net_benefit_eur": round(total_net_benefit, 2),
        "total_v2g_revenue_eur": round(total_v2g_revenue, 2),
        "total_co2_saved_kg": round(total_co2_saved, 1),
        "derated_thermal_bays": sum(
            1 for b in bays_enriched if b["thermal_status"] != "ONLINE"
        ),
        "active_schedules_count": len(state.get("charging_schedules", [])),
        "active_v2g_count": len(state.get("v2g_dispatches", [])),
        "active_throttles_count": len(state.get("load_caps", [])),
        "a2a_handshakes_count": len(state.get("a2a_handshakes", [])),
        "security_events_count": len(state.get("security_events", [])),
    }

    return {
        "status": "ok",
        "model": os.environ.get("GEMINI_MODEL", "gemini-3.8-flash"),
        "gcp_project": os.environ.get("GOOGLE_CLOUD_PROJECT", "expedition-dn26lon-5931"),
        "map_api_key": os.environ.get("MAP_API_KEY", "cb1_4xp8_1_f18faceb5ce7f441f5b99c6a"),
        "kpis": kpis,
        "depots": depot_summaries,
        "fleet": fleet_enriched,
        "tariffs": tariffs_enriched,
        "charger_bays": bays_enriched,
        "state": state,
        "t10_at_risk_by_country": t10_subscribers_by_country,
    }


app = FastAPI(
    title="VoltMotion Mobility — Table 9 Smart Mobility & Energy Optimizer",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_ADK_APP_NAME = "voltmotion_t09_ui"
_runner = InMemoryRunner(agent=root_agent, app_name=_ADK_APP_NAME)
_known_sessions: set[str] = set()


class ChatRequest(BaseModel):
    message: str
    session_id: str = "t09-command-center"
    depot_id: str = "ALL"


class SimulateRequest(BaseModel):
    vehicle_id: str
    new_depot_id: str = ""
    new_departure_hour: str = ""
    new_route_km: int = 0
    new_target_soc_pct: int = 0
    swap_with_vehicle_id: str = ""
    selected_depot: str = "ALL"


class DirectActionRequest(BaseModel):
    action_type: str
    params: dict[str, Any]
    selected_depot: str = "ALL"


@app.get("/api/dashboard")
def get_dashboard(depot_id: str = "ALL") -> dict[str, Any]:
    return _build_dashboard_payload(selected_depot=depot_id)


@app.post("/api/chat")
async def chat_with_agent(req: ChatRequest) -> dict[str, Any]:
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    user_id = "javier_morales"
    session_id = req.session_id or "t09-command-center"

    if session_id not in _known_sessions:
        await _runner.session_service.create_session(
            app_name=_ADK_APP_NAME,
            user_id=user_id,
            session_id=session_id,
        )
        _known_sessions.add(session_id)

    user_content = types.Content(
        role="user",
        parts=[types.Part.from_text(text=req.message)],
    )

    tool_calls: list[dict[str, Any]] = []
    tool_outputs: list[dict[str, Any]] = []
    reply_chunks: list[str] = []

    try:
        async for event in _runner.run_async(
            user_id=user_id,
            session_id=session_id,
            new_message=user_content,
        ):
            if not event.content or not event.content.parts:
                continue
            for part in event.content.parts:
                if getattr(part, "function_call", None):
                    fc = part.function_call
                    tool_calls.append(
                        {
                            "name": fc.name,
                            "args": dict(fc.args) if fc.args else {},
                        }
                    )
                if getattr(part, "function_response", None):
                    fr = part.function_response
                    resp_data = dict(fr.response) if fr.response else {}
                    tool_outputs.append(
                        {
                            "name": fr.name,
                            "response": resp_data,
                        }
                    )
                if getattr(part, "text", None) and not getattr(part, "thought", False):
                    reply_chunks.append(part.text)
    except Exception as exc:
        reply_chunks.append(f"⚠️ Error comunicando con el agente ADK: {exc}")

    reply_text = "\n".join(chunk.strip() for chunk in reply_chunks if chunk.strip())
    if not reply_text:
        reply_text = "Operación completada. Revisa los paneles actualizados y las llamadas a herramientas."

    return {
        "status": "ok",
        "reply": reply_text,
        "tool_calls": tool_calls,
        "tool_outputs": tool_outputs,
        "dashboard": _build_dashboard_payload(selected_depot=req.depot_id),
    }


@app.post("/api/simulate")
def run_simulation(req: SimulateRequest) -> dict[str, Any]:
    raw_result = simulate_fleet_route_change(
        vehicle_id=req.vehicle_id,
        new_depot_id=req.new_depot_id,
        new_departure_hour=req.new_departure_hour,
        new_route_km=int(req.new_route_km),
        new_target_soc_pct=int(req.new_target_soc_pct),
        swap_with_vehicle_id=req.swap_with_vehicle_id,
    )
    return {
        "status": "ok",
        "result": json.loads(raw_result),
        "dashboard": _build_dashboard_payload(selected_depot=req.selected_depot),
    }


@app.post("/api/action")
def run_direct_action(req: DirectActionRequest) -> dict[str, Any]:
    p = req.params
    if req.action_type == "schedule_charging":
        res = schedule_smart_charging_plan(
            depot_id=str(p.get("depot_id", "DEP-MADRID-SOUTH")),
            vehicle_ids=str(p.get("vehicle_ids", "EV-0006,EV-0022")),
            window_id=str(p.get("window_id", "WIN-002")),
            target_soc_pct=int(p.get("target_soc_pct", 85)),
        )
    elif req.action_type == "authorize_v2g":
        res = authorize_v2g_grid_discharge(
            depot_id=str(p.get("depot_id", "DEP-MADRID-SOUTH")),
            window_id=str(p.get("window_id", "WIN-019")),
            export_kw=float(p.get("export_kw", 120.0)),
            min_reserve_soc_pct=int(p.get("min_reserve_soc_pct", 2)),
        )
    elif req.action_type == "throttle_transformer":
        res = throttle_depot_transformer_load(
            depot_id=str(p.get("depot_id", "DEP-MADRID-SOUTH")),
            max_site_load_kw=float(p.get("max_site_load_kw", 500.0)),
            reason=str(p.get("reason", "Transformer headroom safety cap")),
        )
    elif req.action_type == "notify_t10_a2a":
        res = notify_sister_table_t10_a2a(
            depot_id=str(p.get("depot_id", "DEP-MADRID-SOUTH")),
            event_type=str(p.get("event_type", "DEPOT_LOAD_THROTTLE_OR_ROUTE_DELAY")),
            affected_routes_count=int(p.get("affected_routes_count", 2)),
            reason=str(p.get("reason", "Proactive A2A alert from Table 9 to Sister Table 10")),
        )
    else:
        raise HTTPException(status_code=400, detail=f"Unknown action_type: {req.action_type}")

    return {
        "status": "ok",
        "result": json.loads(res),
        "dashboard": _build_dashboard_payload(selected_depot=req.selected_depot),
    }


@app.post("/api/reset")
def reset_state(depot_id: str = "ALL") -> dict[str, Any]:
    _save_state(_default_state())
    return {
        "status": "reset",
        "dashboard": _build_dashboard_payload(selected_depot=depot_id),
    }


if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
def serve_index() -> FileResponse:
    return FileResponse(
        STATIC_DIR / "index.html",
        headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
    )
