/* VoltMotion Copilot V2 — PWA + Voice Input + Generative UI Engine for Manager Javier Morales */

let dashboardData = null;
let selectedDepot = "ALL";
let mapFilter = "ALL";
let mapInstance = null;
let mapTileLayer = null;
let currentTileKey = "";
let markersLayer = null;
let routesLayer = null;
let highlightedVehicles = new Set();

// PWA Install Prompt
let deferredInstallPrompt = null;

// Voice Recognition & Synthesis
let recognition = null;
let isListening = false;
let ttsEnabled = true;

document.addEventListener("DOMContentLoaded", () => {
  initPWA();
  initMap();
  initVoiceRecognition();
  bindUIEvents();
  loadDashboard("ALL", true);
});

/* ==========================================================================
   1. PWA REGISTRATION & INSTALL FLOW
   ========================================================================== */
function initPWA() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
      console.warn("SW registration warning:", err);
    });
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const btn = document.getElementById("btn-install-pwa");
    if (btn) {
      btn.textContent = "📲 Instalar App Ahora";
    }
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    const btn = document.getElementById("btn-install-pwa");
    if (btn) {
      btn.textContent = "✓ App Instalada";
    }
  });
}

/* ==========================================================================
   2. LEAFLET MAP INITIALIZATION & RENDERING
   ========================================================================== */
function initMap() {
  mapInstance = L.map("fleet-map", {
    center: [43.5, 2.5],
    zoom: 5,
    zoomControl: true,
  });

  ensureMapTiles("cb1_4xp8_1_f18faceb5ce7f441f5b99c6a");
  routesLayer = L.layerGroup().addTo(mapInstance);
  markersLayer = L.layerGroup().addTo(mapInstance);
}

function ensureMapTiles(apiKey) {
  const key = apiKey || "cb1_4xp8_1_f18faceb5ce7f441f5b99c6a";
  if (mapTileLayer && currentTileKey === key) return;
  if (mapTileLayer) {
    mapInstance.removeLayer(mapTileLayer);
  }
  currentTileKey = key;
  const tileUrl = `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(key)}`;
  mapTileLayer = L.tileLayer(tileUrl, {
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    subdomains: "abcd",
    maxZoom: 19,
  }).addTo(mapInstance);
}

function renderMap() {
  if (!dashboardData || !mapInstance) return;
  routesLayer.clearLayers();
  markersLayer.clearLayers();

  const depots = dashboardData.depots || [];
  const fleet = dashboardData.fleet || [];

  // Filter counts
  const critCount = fleet.filter((v) => v.readiness === "CRITICAL_STRAND_RISK").length;
  const v2gCount = fleet.filter((v) => v.readiness === "V2G_READY" || v.readiness === "V2G_DISPATCHED").length;
  document.getElementById("count-all").textContent = fleet.length;
  document.getElementById("count-crit").textContent = critCount;
  document.getElementById("count-v2g").textContent = v2gCount;

  // Draw depots
  depots.forEach((dep) => {
    const circle = L.circleMarker([dep.lat, dep.lng], {
      radius: 11,
      color: "#60a5fa",
      weight: 2,
      fillColor: "#1d4ed8",
      fillOpacity: 0.85,
    });
    circle.bindPopup(`
      <div style="font-family:Inter,sans-serif;min-width:190px;color:#0f172a;">
        <strong style="font-size:13px;">🏢 ${dep.name}</strong><br/>
        <span style="font-size:11px;color:#475569;">Carga Transformador: <b>${dep.transformer.transformer_load_kw} / ${dep.transformer.transformer_limit_kw} kW</b></span><br/>
        <span style="font-size:11px;color:#dc2626;">EVs críticos: <b>${dep.critical_vehicles_count}</b></span> ·
        <span style="font-size:11px;color:#059669;">Ahorro: <b>€${dep.optimization.total_net_benefit_eur}</b></span><br/>
        <button onclick="window.askAgentForDepot('${dep.depot_id}')" style="margin-top:6px;width:100%;padding:5px 8px;background:#2563eb;color:#fff;border:none;border-radius:6px;font-weight:700;cursor:pointer;font-size:11px;">
          🎙️ Generar Planteamiento (${dep.city})
        </button>
      </div>
    `);
    circle.addTo(markersLayer);
  });

  // Draw filtered vehicles
  fleet.forEach((v) => {
    if (mapFilter === "CRITICAL" && v.readiness !== "CRITICAL_STRAND_RISK") return;
    if (mapFilter === "V2G" && v.readiness !== "V2G_READY" && v.readiness !== "V2G_DISPATCHED") return;

    let color = "#3b82f6";
    let radius = 6;
    if (v.is_modified || v.scheduled_plan) {
      color = "#8b5cf6";
      radius = 8;
    } else if (v.readiness === "CRITICAL_STRAND_RISK") {
      color = "#ef4444";
      radius = 8;
    } else if (v.readiness === "NEEDS_SMART_CHARGE") {
      color = "#f59e0b";
      radius = 6.5;
    } else if (v.readiness === "V2G_READY" || v.readiness === "V2G_DISPATCHED") {
      color = "#10b981";
      radius = 7;
    }

    if (highlightedVehicles.has(v.vehicle_id)) {
      radius = 10;
    }

    // Route line to destination
    if (v.dest_lat && v.dest_lng && (selectedDepot !== "ALL" || v.readiness === "CRITICAL_STRAND_RISK" || highlightedVehicles.has(v.vehicle_id))) {
      const line = L.polyline(
        [
          [v.lat, v.lng],
          [v.dest_lat, v.dest_lng],
        ],
        {
          color: color,
          weight: highlightedVehicles.has(v.vehicle_id) ? 2.5 : 1.3,
          opacity: highlightedVehicles.has(v.vehicle_id) ? 0.85 : 0.45,
          dashArray: v.readiness === "CRITICAL_STRAND_RISK" ? "5, 5" : null,
        }
      );
      line.addTo(routesLayer);
    }

    const marker = L.circleMarker([v.lat, v.lng], {
      radius,
      color: highlightedVehicles.has(v.vehicle_id) ? "#ffffff" : "#090e1a",
      weight: highlightedVehicles.has(v.vehicle_id) ? 2.5 : 1.2,
      fillColor: color,
      fillOpacity: 0.95,
    });

    marker.bindPopup(`
      <div style="font-family:Inter,sans-serif;min-width:205px;color:#0f172a;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong style="font-size:13px;">🚐 ${v.vehicle_id}</strong>
          <span style="font-size:11px;font-weight:800;padding:2px 6px;border-radius:4px;background:#e2e8f0;">SoC ${v.battery_soc_pct}%</span>
        </div>
        <div style="font-size:11px;color:#475569;margin-top:4px;">
          Tipo: <b>${v.vehicle_type}</b><br/>
          Salida: <b>${v.next_departure}</b> · Ruta: <b>${v.next_route_km} km</b> (${v.destination_label})<br/>
          Estado: <b>${v.readiness_label}</b>
        </div>
        <button onclick="window.askAgentForVehicle('${v.vehicle_id}', '${v.depot_id}')" style="margin-top:7px;width:100%;padding:6px 8px;background:#2563eb;color:#fff;border:none;border-radius:6px;font-weight:700;cursor:pointer;font-size:11px;">
          ⚡ Plantear Solución para ${v.vehicle_id}
        </button>
      </div>
    `);
    marker.addTo(markersLayer);
  });
}

window.askAgentForDepot = function (depotId) {
  selectDepotPill(depotId);
  submitVoiceOrTextQuery(`Plantea la solución operativa completa para ${depotId}: vehículos en riesgo de ruta, carga inteligente en valle y oportunidad V2G.`);
};

window.askAgentForVehicle = function (vehicleId, depotId) {
  selectDepotPill(depotId);
  submitVoiceOrTextQuery(`El vehículo ${vehicleId} en ${depotId} necesita solución para cubrir su ruta matutina. ¿Qué intercambio de ruta o carga inteligente propones?`);
};

/* ==========================================================================
   3. PRIORITY VEHICLES STRIP FOR MANAGER JAVIER
   ========================================================================== */
function renderPriorityStrip() {
  const container = document.getElementById("priority-vehicles-list");
  if (!container || !dashboardData) return;

  const fleet = dashboardData.fleet || [];
  const sorted = [...fleet].sort((a, b) => {
    const scoreA = a.readiness === "CRITICAL_STRAND_RISK" ? 0 : a.readiness === "NEEDS_SMART_CHARGE" ? 1 : 2;
    const scoreB = b.readiness === "CRITICAL_STRAND_RISK" ? 0 : b.readiness === "NEEDS_SMART_CHARGE" ? 1 : 2;
    if (scoreA !== scoreB) return scoreA - scoreB;
    return a.battery_soc_pct - b.battery_soc_pct;
  });

  const topItems = sorted.slice(0, 6);
  document.getElementById("priority-depot-label").textContent =
    selectedDepot === "ALL" ? "Top 6 Europa" : selectedDepot;

  container.innerHTML = topItems
    .map((v) => {
      const isCrit = v.readiness === "CRITICAL_STRAND_RISK";
      const isV2G = v.readiness === "V2G_READY" || v.readiness === "V2G_DISPATCHED";
      const socClass = v.battery_soc_pct < 35 ? "soc-low" : v.battery_soc_pct < 65 ? "soc-mid" : "soc-high";
      return `
        <div class="prio-ev-card ${isCrit ? "is-critical" : isV2G ? "is-v2g" : ""}">
          <div class="prio-top">
            <span class="prio-id mono">${v.vehicle_id}</span>
            <span class="prio-soc ${socClass}">${v.battery_soc_pct}% SoC</span>
          </div>
          <div class="prio-meta">
            <span>🕒 Salida ${v.next_departure}</span>
            <span>🛣️ ${v.next_route_km} km</span>
          </div>
          <div class="prio-meta">
            <span>📍 ${v.city}</span>
            <span>${v.is_modified ? "🟣 Optimizado" : isCrit ? "🔴 Riesgo" : "🟡 Carga Valle"}</span>
          </div>
          <button class="btn-prio-solve" onclick="window.askAgentForVehicle('${v.vehicle_id}', '${v.depot_id}')">
            ⚡ Plantear Solución IA
          </button>
        </div>
      `;
    })
    .join("");
}

/* ==========================================================================
   4. GENERATIVE UI ENGINE (DYNAMIC PLANTEAMIENTO & INTERACTIVE WIDGETS)
   ========================================================================== */
function renderGenerativeUI(genUi) {
  const canvas = document.getElementById("genui-canvas");
  if (!canvas || !genUi) return;

  // Highlight vehicles on map & zoom to target depot if applicable
  highlightedVehicles = new Set(genUi.highlight_vehicles || []);
  renderMap();
  if (genUi.depot_id && dashboardData && dashboardData.depots) {
    const dep = dashboardData.depots.find((d) => d.depot_id === genUi.depot_id);
    if (dep && mapInstance && selectedDepot !== "ALL") {
      mapInstance.flyTo([dep.lat, dep.lng], 11, { duration: 0.9 });
    }
  }

  const baCardsHtml = (genUi.kpis_before_after || [])
    .map(
      (k) => `
      <div class="ba-card">
        <div class="ba-label">${escapeHtml(k.label)}</div>
        <div class="ba-flow">
          <span class="ba-before">${escapeHtml(k.before)}</span>
          <span class="ba-arrow">→</span>
          <span class="ba-after">${escapeHtml(k.after)}</span>
        </div>
        <div class="ba-delta">✦ ${escapeHtml(k.delta)}</div>
      </div>
    `
    )
    .join("");

  const widgetsHtml = (genUi.widgets || []).map((w, idx) => renderGenUIWidget(w, idx)).join("");

  const toolsBadges = (genUi.tool_calls || [])
    .map((tc) => `<span class="badge-subtle mono">🔧 ${escapeHtml(tc.name)}</span>`)
    .join(" ");

  canvas.innerHTML = `
    <!-- EXECUTIVE PLANTEAMIENTO HERO CARD -->
    <div class="genui-hero-card">
      <div class="genui-top-row">
        <span class="genui-badge">${escapeHtml(genUi.badge || "⚡ PLANTEAMIENTO GENERATIVE UI")}</span>
        <span class="genui-query-pill" title="${escapeHtml(genUi.query || "")}">
          🎙️ "${escapeHtml(genUi.query || "Análisis operativo de turno")}"
        </span>
      </div>

      <h1 class="genui-title">${escapeHtml(genUi.title || "Planteamiento y Solución Operativa")}</h1>

      <div class="planteamiento-grid">
        <div class="planteamiento-box box-problem">
          <div class="box-label">⚠️ Diagnóstico del Problema</div>
          <div class="box-text">${escapeHtml(genUi.problem_statement || "")}</div>
        </div>
        <div class="planteamiento-box box-solution">
          <div class="box-label">✅ Solución Propuesta para Javier</div>
          <div class="box-text">${escapeHtml(genUi.proposed_solution || "")}</div>
        </div>
      </div>

      <div class="before-after-grid">
        ${baCardsHtml}
      </div>
    </div>

    <!-- DYNAMIC INTERACTIVE WIDGETS -->
    ${widgetsHtml}

    <!-- COLLAPSIBLE FULL ADK AGENT EXPLANATION & TOOL TRACE -->
    <details class="agent-tech-details">
      <summary>🤖 Ver Respuesta Detallada del Agente ADK y Herramientas Ejecutadas (${(genUi.tool_calls || []).length})</summary>
      <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">${toolsBadges || "<span class='badge-subtle'>Telemetría en vivo BigQuery seed_t09</span>"}</div>
      <div class="agent-tech-body">${escapeHtml(genUi.agent_markdown || "")}</div>
    </details>
  `;
}

function renderGenUIWidget(w, idx) {
  if (w.type === "SMART_TARIFF_SCHEDULE") {
    const slots = (w.tariffs || []).slice(0, 6);
    const barsHtml = slots
      .map((t) => {
        const isValley = t.price_eur_mwh <= 55;
        const isPeak = t.price_eur_mwh >= 165;
        return `
          <div class="tariff-slot-card ${isValley ? "is-valley" : isPeak ? "is-peak" : ""}">
            <div class="slot-hour mono">${escapeHtml(t.hour_Slot)}</div>
            <div class="slot-price">€${t.price_eur_mwh}</div>
            <div class="slot-tag">${isValley ? "🟢 VALLE" : isPeak ? "🔴 PUNTA" : "🟡 LLANO"}</div>
          </div>
        `;
      })
      .join("");

    return `
      <div class="genui-widget-card" id="widget-card-${idx}">
        <div class="widget-header">
          <div>
            <div class="widget-title">🔌 ${escapeHtml(w.title)}</div>
            <div class="widget-sub">${escapeHtml(w.subtitle)}</div>
          </div>
          <span class="badge-subtle mono">${escapeHtml(w.recommended_window)} · ${escapeHtml(w.recommended_hour)}</span>
        </div>

        <div class="tariff-bars-row">${barsHtml}</div>

        <div class="widget-controls-row">
          <div class="control-group">
            <label>Vehículos Prioritarios a Cargar</label>
            <input type="text" id="chg-vehicles-${idx}" value="${escapeHtml(w.vehicle_ids)}" class="mono" style="background:#090e1a;color:#fff;border:1px solid #26334d;padding:6px 10px;border-radius:8px;font-size:12px;" />
          </div>
          <div class="control-group">
            <label>Batería Objetivo: <span id="chg-soc-val-${idx}">85</span>% SoC</label>
            <input type="range" min="75" max="100" step="5" value="85" oninput="document.getElementById('chg-soc-val-${idx}').textContent=this.value" id="chg-soc-${idx}" />
          </div>
          <button class="btn-action-primary" onclick="window.execSmartChargeWidget(${idx}, '${w.depot_id}', '${w.recommended_window}')">
            ⚡ Aprobar y Programar Carga Valle
          </button>
        </div>
        <div id="widget-feedback-${idx}" class="hidden"></div>
      </div>
    `;
  }

  if (w.type === "ROUTE_RESCUE_CARDS") {
    const crit = w.critical_vehicle || {};
    const ready = w.healthy_vehicle || {};
    const critOptions = (w.critical_list || [crit])
      .map((v) => `<option value="${v.vehicle_id}">${v.vehicle_id} (${v.battery_soc_pct}% SoC · ${v.next_route_km} km @ ${v.next_departure})</option>`)
      .join("");
    const readyOptions = (w.healthy_list || [ready])
      .map((v) => `<option value="${v.vehicle_id}">${v.vehicle_id} (${v.battery_soc_pct}% SoC · ${v.next_route_km} km @ ${v.next_departure})</option>`)
      .join("");

    return `
      <div class="genui-widget-card" id="widget-card-${idx}">
        <div class="widget-header">
          <div>
            <div class="widget-title">🔄 ${escapeHtml(w.title)}</div>
            <div class="widget-sub">${escapeHtml(w.subtitle)}</div>
          </div>
          <span class="badge-subtle">Simulación en Tiempo Real</span>
        </div>

        <div class="swap-arena">
          <div class="swap-vehicle-box box-crit">
            <div style="font-size:11px;color:#f87171;font-weight:800;">🔴 VEHÍCULO EN RIESGO DE RUTA</div>
            <select id="swap-crit-${idx}" style="margin-top:6px;width:100%;background:#111827;color:#fff;border:1px solid #ef4444;padding:6px;border-radius:6px;font-size:12px;">
              ${critOptions}
            </select>
          </div>

          <div class="swap-icon-mid">⇄</div>

          <div class="swap-vehicle-box box-ready">
            <div style="font-size:11px;color:#34d399;font-weight:800;">🟢 VEHÍCULO CON BATERÍA ALTA</div>
            <select id="swap-ready-${idx}" style="margin-top:6px;width:100%;background:#111827;color:#fff;border:1px solid #10b981;padding:6px;border-radius:6px;font-size:12px;">
              ${readyOptions}
            </select>
          </div>
        </div>

        <div class="widget-controls-row">
          <div class="control-group">
            <label>Nueva Hora de Salida (Opcional)</label>
            <select id="swap-hour-${idx}">
              <option value="08:00">08:00 (Tras carga valle)</option>
              <option value="08:30" selected>08:30 (Recomendado)</option>
              <option value="09:00">09:00 (Margen extendido)</option>
            </select>
          </div>
          <button class="btn-action-primary" onclick="window.execRouteSwapWidget(${idx}, '${w.depot_id}')">
            🔄 Aplicar Intercambio de Ruta Ahora
          </button>
        </div>
        <div id="widget-feedback-${idx}" class="hidden"></div>
      </div>
    `;
  }

  if (w.type === "V2G_REVENUE_DISPATCH") {
    return `
      <div class="genui-widget-card" id="widget-card-${idx}">
        <div class="widget-header">
          <div>
            <div class="widget-title">🔋 ${escapeHtml(w.title)}</div>
            <div class="widget-sub">${escapeHtml(w.subtitle)}</div>
          </div>
          <span class="badge-subtle mono">${escapeHtml(w.window_id)} · €${w.price_eur_mwh}/MWh</span>
        </div>

        <div class="widget-controls-row">
          <div class="control-group">
            <label>Potencia a Exportar: <span id="v2g-kw-val-${idx}">${w.default_export_kw || 120}</span> kW</label>
            <input type="range" min="40" max="220" step="10" value="${w.default_export_kw || 120}" id="v2g-kw-${idx}" oninput="document.getElementById('v2g-kw-val-${idx}').textContent=this.value" />
          </div>
          <div class="control-group">
            <label>Suelo de Reserva Batería: <span id="v2g-soc-val-${idx}">${w.default_reserve_soc || 35}</span>% SoC (Mín. 30%)</label>
            <input type="range" min="30" max="55" step="5" value="${w.default_reserve_soc || 35}" id="v2g-soc-${idx}" oninput="document.getElementById('v2g-soc-val-${idx}').textContent=this.value" />
          </div>
          <button class="btn-action-primary" onclick="window.execV2GWidget(${idx}, '${w.depot_id}', '${w.window_id}')">
            🔋 Autorizar Venta V2G a la Red
          </button>
        </div>
        <div id="widget-feedback-${idx}" class="hidden"></div>
      </div>
    `;
  }

  if (w.type === "TRANSFORMER_LOAD_GUARD") {
    const baysHtml = (w.bays || [])
      .map(
        (b) => `
        <div class="tariff-slot-card ${b.thermal_status === "ONLINE" ? "is-valley" : "is-peak"}">
          <div class="slot-hour mono">${escapeHtml(b.charger_bay_id)}</div>
          <div class="slot-price">${b.active_load_kw} kW</div>
          <div class="slot-tag">${escapeHtml(b.thermal_status)}</div>
        </div>
      `
      )
      .join("");

    return `
      <div class="genui-widget-card" id="widget-card-${idx}">
        <div class="widget-header">
          <div>
            <div class="widget-title">⚡ ${escapeHtml(w.title)}</div>
            <div class="widget-sub">${escapeHtml(w.subtitle)}</div>
          </div>
          <span class="badge-subtle mono">${w.active_kw} / ${w.limit_kw} kW</span>
        </div>

        <div class="tariff-bars-row">${baysHtml}</div>

        <div class="widget-controls-row">
          <div class="control-group">
            <label>Límite de Seguridad del Transformador: <span id="tx-cap-val-${idx}">${w.recommended_cap_kw || 500}</span> kW</label>
            <input type="range" min="350" max="750" step="25" value="${w.recommended_cap_kw || 500}" id="tx-cap-${idx}" oninput="document.getElementById('tx-cap-val-${idx}').textContent=this.value" />
          </div>
          <button class="btn-action-primary" onclick="window.execTransformerCapWidget(${idx}, '${w.depot_id}')">
            🛡️ Aplicar Límite al Transformador
          </button>
        </div>
        <div id="widget-feedback-${idx}" class="hidden"></div>
      </div>
    `;
  }

  if (w.type === "REDTEAM_SECURITY_SHIELD") {
    return `
      <div class="genui-widget-card" id="widget-card-${idx}">
        <div class="widget-header">
          <div>
            <div class="widget-title">🛡️ ${escapeHtml(w.title)}</div>
            <div class="widget-sub">${escapeHtml(w.subtitle)}</div>
          </div>
          <span class="badge-subtle mono">WIN-019 · DEP-MILAN-NORTH</span>
        </div>

        <div style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.45);border-radius:10px;padding:10px 12px;font-size:12px;color:#fca5a5;">
          <strong>Payload Malicioso Detectado en BigQuery (<code>grid_operator_notice</code>):</strong><br/>
          <code class="mono">${escapeHtml(w.malicious_payload)}</code>
        </div>

        <div class="widget-controls-row">
          <div class="control-group">
            <label>Regla Determinista MCP: <strong>Rechazar siempre si Reserva &lt; 30% SoC</strong></label>
          </div>
          <button class="btn-action-primary" style="background:linear-gradient(135deg,#ef4444,#b91c1c);" onclick="window.execSecurityTestWidget(${idx})">
            🧪 Probar Bloqueo del Guardrail (min_reserve=2%)
          </button>
        </div>
        <div id="widget-feedback-${idx}" class="hidden"></div>
      </div>
    `;
  }

  if (w.type === "A2A_SISTER_TABLE_10") {
    return `
      <div class="genui-widget-card" id="widget-card-${idx}">
        <div class="widget-header">
          <div>
            <div class="widget-title">🤝 ${escapeHtml(w.title)}</div>
            <div class="widget-sub">${escapeHtml(w.subtitle)}</div>
          </div>
          <span class="badge-subtle mono">Tribe 3 · A2A Protocol</span>
        </div>

        <div class="widget-controls-row">
          <div class="control-group">
            <label>Rutas Afectadas a Notificar a Mesa 10: <span id="a2a-routes-val-${idx}">${w.affected_routes || 2}</span> rutas</label>
            <input type="range" min="1" max="5" step="1" value="${w.affected_routes || 2}" id="a2a-routes-${idx}" oninput="document.getElementById('a2a-routes-val-${idx}').textContent=this.value" />
          </div>
          <button class="btn-action-primary" onclick="window.execA2AWidget(${idx}, '${w.depot_id}')">
            📡 Emitir Alerta A2A a Mesa 10 Ahora
          </button>
        </div>
        <div id="widget-feedback-${idx}" class="hidden"></div>
      </div>
    `;
  }

  return "";
}

/* ==========================================================================
   5. INTERACTIVE GENERATIVE UI WIDGET ACTION HANDLERS
   ========================================================================== */
function showWidgetFeedback(idx, message, isRejected = false) {
  const box = document.getElementById(`widget-feedback-${idx}`);
  if (!box) return;
  box.className = `action-feedback-banner ${isRejected ? "is-rejected" : ""}`;
  box.innerHTML = message;
  box.classList.remove("hidden");
}

window.execSmartChargeWidget = async function (idx, depotId, windowId) {
  const vehInput = document.getElementById(`chg-vehicles-${idx}`);
  const socInput = document.getElementById(`chg-soc-${idx}`);
  const vehicle_ids = vehInput ? vehInput.value : "EV-0067,EV-0062";
  const target_soc_pct = socInput ? parseInt(socInput.value, 10) : 85;

  const res = await postDirectAction("schedule_charging", {
    depot_id: depotId,
    vehicle_ids,
    window_id: windowId || "WIN-002",
    target_soc_pct,
  });
  if (res && res.result) {
    const r = res.result;
    showWidgetFeedback(
      idx,
      `✅ <strong>Plan ${r.plan_id || "CHG"} PROGRAMADO:</strong> Vehículos <code>${vehicle_ids}</code> asignados a ventana valle <code>${windowId}</code> hasta <strong>${target_soc_pct}% SoC</strong>.`
    );
    speakText(`Plan de carga inteligente programado en ${depotId} hasta el ${target_soc_pct} por ciento.`);
  }
};

window.execRouteSwapWidget = async function (idx, depotId) {
  const critSel = document.getElementById(`swap-crit-${idx}`);
  const readySel = document.getElementById(`swap-ready-${idx}`);
  const hourSel = document.getElementById(`swap-hour-${idx}`);

  const vehicle_id = critSel ? critSel.value : "EV-0067";
  const swap_with_vehicle_id = readySel ? readySel.value : "EV-0002";
  const new_departure_hour = hourSel ? hourSel.value : "08:30";

  try {
    const resp = await fetch("/api/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vehicle_id,
        swap_with_vehicle_id,
        new_departure_hour,
        selected_depot: selectedDepot,
      }),
    });
    const data = await resp.json();
    if (data.dashboard) {
      applyDashboardUpdate(data.dashboard, false);
    }
    showWidgetFeedback(
      idx,
      `✅ <strong>Intercambio Aplicado en Vivo:</strong> <code>${vehicle_id}</code> ha intercambiado su ruta exigente con <code>${swap_with_vehicle_id}</code> y salida ajustada a <strong>${new_departure_hour}</strong>. ¡Riesgo eliminado en el mapa!`
    );
    speakText(`Ruta intercambiada con éxito entre ${vehicle_id} y ${swap_with_vehicle_id}.`);
  } catch (err) {
    showWidgetFeedback(idx, `⚠️ Error al aplicar cambio: ${err}`, true);
  }
};

window.execV2GWidget = async function (idx, depotId, windowId) {
  const kwEl = document.getElementById(`v2g-kw-${idx}`);
  const socEl = document.getElementById(`v2g-soc-${idx}`);
  const export_kw = kwEl ? parseFloat(kwEl.value) : 120;
  const min_reserve_soc_pct = socEl ? parseInt(socEl.value, 10) : 35;

  const res = await postDirectAction("authorize_v2g", {
    depot_id: depotId,
    window_id: windowId || "WIN-018",
    export_kw,
    min_reserve_soc_pct,
  });
  if (res && res.result) {
    const r = res.result;
    showWidgetFeedback(
      idx,
      `✅ <strong>Descarga V2G Autorizada (${r.dispatch_id || "V2G"}):</strong> Exportando <strong>${export_kw} kW</strong> en <code>${windowId}</code> con reserva protegida al <strong>${min_reserve_soc_pct}% SoC</strong>.`
    );
    speakText(`Exportación V2G de ${export_kw} kilovatios autorizada respetando el ${min_reserve_soc_pct} por ciento de batería.`);
  }
};

window.execTransformerCapWidget = async function (idx, depotId) {
  const capEl = document.getElementById(`tx-cap-${idx}`);
  const max_site_load_kw = capEl ? parseFloat(capEl.value) : 500;

  const res = await postDirectAction("throttle_transformer", {
    depot_id: depotId,
    max_site_load_kw,
    reason: "Tope preventivo aplicado por Javier Morales desde Generative UI",
  });
  if (res && res.result) {
    showWidgetFeedback(
      idx,
      `✅ <strong>Transformador Protegido:</strong> Límite máximo fijado en <strong>${max_site_load_kw} kW</strong> para <code>${depotId}</code>.`
    );
    speakText(`Transformador limitado a ${max_site_load_kw} kilovatios por seguridad.`);
  }
};

window.execSecurityTestWidget = async function (idx) {
  const res = await postDirectAction("authorize_v2g", {
    depot_id: "DEP-MILAN-NORTH",
    window_id: "WIN-019",
    export_kw: 150,
    min_reserve_soc_pct: 2,
  });
  if (res && res.result) {
    const r = res.result;
    showWidgetFeedback(
      idx,
      `🛡️ <strong>ATAQUE BLOQUEADO (${r.status}):</strong> ${escapeHtml(r.reason || "Rechazado por suelo de seguridad del 30% SoC.")}`,
      true
    );
    speakText("Prueba completada. El guardrail ha bloqueado la descarga al dos por ciento y ha protegido toda la flota.");
  }
};

window.execA2AWidget = async function (idx, depotId) {
  const routesEl = document.getElementById(`a2a-routes-${idx}`);
  const affected_routes_count = routesEl ? parseInt(routesEl.value, 10) : 2;

  const res = await postDirectAction("notify_t10_a2a", {
    depot_id: depotId,
    event_type: "DEPOT_LOAD_THROTTLE_OR_ROUTE_DELAY",
    affected_routes_count,
    reason: "Sincronización ejecutiva iniciada por Javier Morales (Table 9 -> Table 10)",
  });
  if (res && res.result) {
    const r = res.result;
    showWidgetFeedback(
      idx,
      `🤝 <strong>Handshake A2A Confirmado (${r.handshake_id || "A2A"}):</strong> Mesa 10 notificada para ${affected_routes_count} rutas en <code>${depotId}</code>. Bonos de retención activados.`
    );
    speakText(`Alerta enviada al agente de la Mesa diez para proteger ${affected_routes_count} rutas.`);
  }
};

async function postDirectAction(action_type, params) {
  const resp = await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action_type,
      params,
      selected_depot: selectedDepot,
    }),
  });
  const data = await resp.json();
  if (data.dashboard) {
    applyDashboardUpdate(data.dashboard, false);
  }
  return data;
}

/* ==========================================================================
   6. ALWAYS-ON VOICE RECOGNITION (MICROPHONE) & SPEECH SYNTHESIS
   ========================================================================== */
function initVoiceRecognition() {
  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) return;

  recognition = new SpeechRec();
  recognition.lang = "es-ES";
  recognition.continuous = false;
  recognition.interimResults = true;

  recognition.onstart = () => {
    isListening = true;
    updateMicButtonUI(true);
  };

  recognition.onresult = (event) => {
    let transcript = "";
    for (let i = 0; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    const input = document.getElementById("command-input");
    if (input) {
      input.value = transcript;
    }
  };

  recognition.onerror = (event) => {
    console.warn("Speech recognition warning:", event.error);
    isListening = false;
    updateMicButtonUI(false);
  };

  recognition.onend = () => {
    const wasListening = isListening;
    isListening = false;
    updateMicButtonUI(false);
    const input = document.getElementById("command-input");
    if (wasListening && input && input.value.trim().length > 2) {
      submitVoiceOrTextQuery(input.value.trim());
    }
  };
}

function toggleMicrophone() {
  if (!recognition) {
    const input = document.getElementById("command-input");
    if (input) {
      input.focus();
      input.placeholder = "Tu navegador no tiene Web Speech activo: pulsa una sugerencia arriba o escribe aquí...";
    }
    return;
  }

  if (isListening) {
    recognition.stop();
  } else {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    const input = document.getElementById("command-input");
    if (input) input.value = "";
    try {
      recognition.start();
    } catch (e) {
      console.warn(e);
    }
  }
}

function updateMicButtonUI(listening) {
  const btn = document.getElementById("btn-mic-always");
  const title = document.getElementById("mic-status-title");
  const sub = document.getElementById("mic-status-sub");
  const icon = document.getElementById("mic-icon");
  const wave = document.getElementById("live-voice-wave");

  if (!btn) return;
  if (listening) {
    btn.classList.add("is-listening");
    title.textContent = "Escuchando a Javier...";
    sub.textContent = "Habla ahora · Pulsa para enviar";
    icon.textContent = "🔴";
    if (wave) wave.classList.remove("hidden");
  } else {
    btn.classList.remove("is-listening");
    title.textContent = "Hablar con Agente";
    sub.textContent = "Pulsa y plantea tu problema";
    icon.textContent = "🎙️";
    if (wave) wave.classList.add("hidden");
  }
}

function speakText(text) {
  if (!ttsEnabled || !("speechSynthesis" in window) || !text) return;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "es-ES";
    utter.rate = 1.04;
    window.speechSynthesis.speak(utter);
  } catch (e) {
    console.warn("TTS warning:", e);
  }
}

/* ==========================================================================
   7. API CALLS & EVENT BINDINGS
   ========================================================================== */
async function loadDashboard(depotId = "ALL", renderInitialGenUI = false) {
  try {
    const resp = await fetch(`/api/dashboard?depot_id=${encodeURIComponent(depotId)}`);
    const data = await resp.json();
    applyDashboardUpdate(data, renderInitialGenUI);
  } catch (err) {
    console.error("Failed to load dashboard:", err);
  }
}

function applyDashboardUpdate(data, renderInitialGenUI = false) {
  dashboardData = data;
  if (data.map_api_key) {
    ensureMapTiles(data.map_api_key);
  }
  if (data.model) {
    document.getElementById("model-badge").textContent = data.model;
  }

  const k = data.kpis || {};
  document.getElementById("kpi-critical-risk").textContent = `${k.critical_strand_risk_count ?? 0} EVs`;
  document.getElementById("kpi-net-savings").textContent = `€${(k.total_net_benefit_eur ?? 0).toFixed(0)}`;
  const totalActions =
    (k.active_schedules_count || 0) +
    (k.active_v2g_count || 0) +
    (k.active_throttles_count || 0) +
    (k.a2a_handshakes_count || 0) +
    (k.modified_vehicles_count || 0);
  document.getElementById("kpi-active-actions").textContent = String(totalActions);

  renderMap();
  renderPriorityStrip();

  if (renderInitialGenUI && data.initial_generative_ui) {
    renderGenerativeUI(data.initial_generative_ui);
  }
}

async function submitVoiceOrTextQuery(messageText) {
  if (!messageText || !messageText.trim()) return;

  const loading = document.getElementById("genui-loading");
  const loadingTitle = document.getElementById("loading-title");
  if (loading) {
    loadingTitle.textContent = `Generando planteamiento visual para: "${messageText}"`;
    loading.classList.remove("hidden");
  }

  const input = document.getElementById("command-input");
  if (input) input.value = messageText;

  try {
    const resp = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: messageText,
        session_id: "javier-v2-pwa",
        depot_id: selectedDepot,
      }),
    });
    const data = await resp.json();
    if (data.dashboard) {
      applyDashboardUpdate(data.dashboard, false);
    }
    if (data.generative_ui) {
      renderGenerativeUI(data.generative_ui);
      if (data.generative_ui.voice_summary) {
        speakText(data.generative_ui.voice_summary);
      }
    }
    if (input) input.value = "";
  } catch (err) {
    console.error("Chat error:", err);
  } finally {
    if (loading) loading.classList.add("hidden");
  }
}

function selectDepotPill(depotId) {
  selectedDepot = depotId;
  document.querySelectorAll(".depot-pill").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.depot === depotId);
  });

  if (depotId === "ALL" && mapInstance) {
    mapInstance.flyTo([43.5, 2.5], 5, { duration: 0.8 });
  } else if (dashboardData && dashboardData.depots && mapInstance) {
    const dep = dashboardData.depots.find((d) => d.depot_id === depotId);
    if (dep) {
      mapInstance.flyTo([dep.lat, dep.lng], 11, { duration: 0.8 });
    }
  }
  loadDashboard(depotId, true);
}

function bindUIEvents() {
  // Depot selector pills
  document.querySelectorAll(".depot-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectDepotPill(btn.dataset.depot);
    });
  });

  // Map filter pills
  document.querySelectorAll(".filter-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      mapFilter = btn.dataset.filter;
      document.querySelectorAll(".filter-pill").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderMap();
    });
  });

  // Always-on Microphone button
  const micBtn = document.getElementById("btn-mic-always");
  if (micBtn) {
    micBtn.addEventListener("click", toggleMicrophone);
  }

  // Voice/Text Command Form
  const form = document.getElementById("voice-text-form");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = document.getElementById("command-input");
      if (input && input.value.trim()) {
        submitVoiceOrTextQuery(input.value.trim());
      }
    });
  }

  // Quick voice/text suggestion chips
  document.querySelectorAll(".suggest-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      submitVoiceOrTextQuery(chip.dataset.prompt);
    });
  });

  // TTS toggle
  const ttsBtn = document.getElementById("btn-tts-toggle");
  if (ttsBtn) {
    ttsBtn.addEventListener("click", () => {
      ttsEnabled = !ttsEnabled;
      ttsBtn.classList.toggle("active", ttsEnabled);
      ttsBtn.textContent = ttsEnabled ? "🔊 Voz ON" : "🔇 Voz OFF";
      if (!ttsEnabled && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    });
  }

  // Reset demo button
  const resetBtn = document.getElementById("btn-reset-state");
  if (resetBtn) {
    resetBtn.addEventListener("click", async () => {
      const resp = await fetch(`/api/reset?depot_id=${encodeURIComponent(selectedDepot)}`, {
        method: "POST",
      });
      const data = await resp.json();
      if (data.dashboard) {
        highlightedVehicles.clear();
        applyDashboardUpdate(data.dashboard, true);
      }
    });
  }

  // PWA Install button & modal
  const installBtn = document.getElementById("btn-install-pwa");
  const modal = document.getElementById("pwa-modal");
  const closeBtn = document.getElementById("btn-close-modal");
  const okBtn = document.getElementById("btn-modal-ok");

  if (installBtn) {
    installBtn.addEventListener("click", async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
      } else if (modal) {
        modal.classList.remove("hidden");
      }
    });
  }
  if (closeBtn && modal) {
    closeBtn.addEventListener("click", () => modal.classList.add("hidden"));
  }
  if (okBtn && modal) {
    okBtn.addEventListener("click", () => modal.classList.add("hidden"));
  }
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
