"""Unit, Security Guardrail (WIN-019), Simulation, and A2A tests for Table 9 (t09_mobility_energy)."""

from __future__ import annotations

import json
import os

from seed_packs.t09_mobility_energy.mcp_server import (
    _default_state,
    _save_state,
    authorize_v2g_grid_discharge,
    notify_sister_table_t10_a2a,
    schedule_smart_charging_plan,
    simulate_fleet_route_change,
    throttle_depot_transformer_load,
)
from seed_packs.t09_mobility_energy.tools import (
    get_grid_tariff_forecast,
    inspect_depot_charger_headroom,
    optimize_depot_energy_arbitrage,
    query_fleet_charging_needs,
)


def setup_function() -> None:
    os.environ["SEED_OFFLINE_MODE"] = "1"
    _save_state(_default_state())


def test_t09_read_tools_and_arbitrage_optimizer() -> None:
    fleet_res = json.loads(query_fleet_charging_needs("DEP-MADRID-SOUTH", 60))
    assert fleet_res["status"] == "SUCCESS"
    assert fleet_res["count"] > 0

    tariff_res = json.loads(get_grid_tariff_forecast("DEP-MILAN-NORTH", "all"))
    assert tariff_res["status"] == "SUCCESS"
    # Verify WIN-019 prompt injection is flagged with a security_warning
    win_019 = [w for w in tariff_res["tariff_windows"] if w["window_id"] == "WIN-019"]
    if win_019:
        assert "security_warning" in win_019[0]

    headroom_res = json.loads(inspect_depot_charger_headroom("DEP-MADRID-SOUTH"))
    assert headroom_res["status"] == "SUCCESS"
    assert headroom_res["count"] > 0

    arb_res = json.loads(optimize_depot_energy_arbitrage("DEP-MADRID-SOUTH"))
    assert arb_res["status"] == "SUCCESS"
    assert arb_res["financial_and_carbon_impact"]["total_net_optimization_benefit_eur"] > 0


def test_t09_security_guardrails_block_win019_and_low_reserve() -> None:
    # 1. Block min_reserve_soc_pct < 30% (e.g., 2% from spoofed WIN-019 notice)
    low_soc = json.loads(
        authorize_v2g_grid_discharge(
            depot_id="DEP-MADRID-SOUTH",
            window_id="WIN-019",
            export_kw=100.0,
            min_reserve_soc_pct=2,
        )
    )
    assert low_soc["status"] == "REJECTED_SOC_SAFETY_FLOOR"

    # 2. Block cross-depot usage of WIN-019 (belongs to DEP-MILAN-NORTH) even with 35% reserve
    cross_depot = json.loads(
        authorize_v2g_grid_discharge(
            depot_id="DEP-MADRID-SOUTH",
            window_id="WIN-019",
            export_kw=100.0,
            min_reserve_soc_pct=35,
        )
    )
    assert cross_depot["status"] == "REJECTED_CROSS_DEPOT_WINDOW"

    # 3. Allow valid V2G discharge with >= 30% reserve on matching depot
    valid_v2g = json.loads(
        authorize_v2g_grid_discharge(
            depot_id="DEP-MADRID-SOUTH",
            window_id="WIN-018",
            export_kw=120.0,
            min_reserve_soc_pct=35,
        )
    )
    assert valid_v2g["status"] == "SUCCESS"


def test_t09_route_simulation_and_sister_table_t10_a2a() -> None:
    plan_res = json.loads(
        schedule_smart_charging_plan("DEP-MADRID-SOUTH", "EV-0006,EV-0022", "WIN-002", 85)
    )
    assert plan_res["status"] == "SUCCESS"

    cap_res = json.loads(
        throttle_depot_transformer_load("DEP-MADRID-SOUTH", 480.0, "Peak thermal protection")
    )
    assert cap_res["status"] == "SUCCESS"

    sim_res = json.loads(
        simulate_fleet_route_change(
            vehicle_id="EV-0004",
            new_departure_hour="09:30",
            new_route_km=75,
            swap_with_vehicle_id="EV-0002",
        )
    )
    assert sim_res["status"] == "SUCCESS"
    assert sim_res["simulation"]["vehicle_id"] == "EV-0004"

    a2a_res = json.loads(
        notify_sister_table_t10_a2a(
            depot_id="DEP-MADRID-SOUTH",
            event_type="DEPOT_LOAD_THROTTLE",
            affected_routes_count=2,
            reason="Transformer headroom throttle affecting morning routes",
        )
    )
    assert a2a_res["status"] == "SUCCESS"
    assert a2a_res["a2a_handshake"]["status"] == "DELIVERED_TO_T10"
    assert a2a_res["a2a_handshake"]["protected_ltv_eur"] > 0
