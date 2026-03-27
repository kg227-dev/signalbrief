function sumRuns(rows, key) {
  return rows.reduce((sum, row) => sum + (row[key] || 0), 0);
}

const DEFAULT_ALLOWED_DAYS = Object.freeze([1, 2, 3, 4, 5]);

function buildUtcCalendarDate(year, month, day, offsetDays = 0) {
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) + Number(offsetDays || 0)));
}

function formatUtcDateKey(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildEtDateKeyFromParts(parts, offsetDays = 0) {
  const date = buildUtcCalendarDate(parts.year, parts.month, parts.day, offsetDays);
  return formatUtcDateKey(date);
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeAllowedDays(days) {
  if (!Array.isArray(days) || days.length === 0) return DEFAULT_ALLOWED_DAYS.slice();
  return [...new Set(days.map((day) => Number(day)).filter((day) => Number.isFinite(day) && day >= 0 && day <= 6))];
}

function normalizeDeliveryTimeRaw(deliveryTime) {
  const [hourRaw, minuteRaw] = String(deliveryTime || "07:00").split(":").map(Number);
  const hour = Number.isFinite(hourRaw) ? hourRaw : 7;
  const minute = Number.isFinite(minuteRaw) ? minuteRaw : 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function fallbackEstimateDigestCost({ topics, customKeywords, itemCount }) {
  const standardCalls = Array.isArray(topics) ? topics.length : 0;
  const customCalls = (Array.isArray(customKeywords) ? customKeywords.length : 0) * 3;
  const perplexityCost = (standardCalls + customCalls) * 0.005;
  const estInputTokens = 2500 + (Number(itemCount || 5) * 300);
  const estOutputTokens = Number(itemCount || 5) * 250;
  const claudeCost = (estInputTokens / 1_000_000 * 0.80) + (estOutputTokens / 1_000_000 * 4.00);
  return {
    totalUsd: parseFloat((perplexityCost + claudeCost).toFixed(5)),
  };
}

function filterRunsWithinEtWindow(runs, startDateKey, endDateKey) {
  return (Array.isArray(runs) ? runs : []).filter((run) => {
    const dateKey = String(run?.date || "").trim();
    return !!dateKey && dateKey >= startDateKey && dateKey <= endDateKey;
  });
}

function buildTrailingWindowCostSummary(runs, { nowParts, days = 7 } = {}) {
  const parts = nowParts && typeof nowParts === "object" ? nowParts : null;
  if (!parts || !Number.isFinite(Number(parts.year))) {
    return {
      days,
      start_date_et: null,
      end_date_et: null,
      runs: [],
      total_cost: 0,
      scheduled_cost: 0,
      on_demand_cost: 0,
      scheduled_runs: 0,
      on_demand_runs: 0,
      deliveries: 0,
    };
  }

  const normalizedDays = Math.max(1, Number(days || 7));
  const endDateKey = buildEtDateKeyFromParts(parts, 0);
  const startDateKey = buildEtDateKeyFromParts(parts, -(normalizedDays - 1));
  const windowRuns = filterRunsWithinEtWindow(runs, startDateKey, endDateKey);
  const scheduledRuns = windowRuns.filter((run) => !run.on_demand);
  const onDemandRuns = windowRuns.filter((run) => !!run.on_demand);

  return {
    days: normalizedDays,
    start_date_et: startDateKey,
    end_date_et: endDateKey,
    runs: windowRuns,
    total_cost: parseFloat(sumRuns(windowRuns, "total_cost_usd").toFixed(4)),
    scheduled_cost: parseFloat(sumRuns(scheduledRuns, "total_cost_usd").toFixed(4)),
    on_demand_cost: parseFloat(sumRuns(onDemandRuns, "total_cost_usd").toFixed(4)),
    scheduled_runs: scheduledRuns.length,
    on_demand_runs: onDemandRuns.length,
    deliveries: sumRuns(windowRuns, "users_served"),
  };
}

function buildProjectedRunSlots(roster, { nowParts, days = 7 } = {}) {
  const parts = nowParts && typeof nowParts === "object" ? nowParts : null;
  if (!parts || !Number.isFinite(Number(parts.year))) return [];

  const nowMinutes = (Number(parts.hour || 0) * 60) + Number(parts.minute || 0);
  const slots = new Map();
  const normalizedDays = Math.max(1, Number(days || 7));

  for (const user of (Array.isArray(roster) ? roster : [])) {
    if (String(user?.status || "").toLowerCase().trim() !== "active") continue;
    const allowedDays = normalizeAllowedDays(user?.days_of_week);
    const deliveryTimeRaw = normalizeDeliveryTimeRaw(user?.delivery_time_raw);
    const [hour, minute] = deliveryTimeRaw.split(":").map(Number);
    const deliveryMinutes = (hour * 60) + minute;

    for (let offset = 0; offset < normalizedDays; offset += 1) {
      const date = buildUtcCalendarDate(parts.year, parts.month, parts.day, offset);
      const dow = date.getUTCDay();
      if (!allowedDays.includes(dow)) continue;
      if (offset === 0 && deliveryMinutes <= nowMinutes) continue;

      const dateKey = formatUtcDateKey(date);
      const slotKey = `${dateKey}|${deliveryTimeRaw}`;
      if (!slots.has(slotKey)) {
        slots.set(slotKey, {
          key: slotKey,
          date_et: dateKey,
          delivery_time_raw: deliveryTimeRaw,
          users: [],
        });
      }
      slots.get(slotKey).users.push(user);
    }
  }

  return [...slots.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function buildProjectedWindowCostSummary({
  roster,
  nowParts,
  config,
  estimateSandboxCost,
  days = 7,
} = {}) {
  const slots = buildProjectedRunSlots(roster, { nowParts, days });
  const configTopics = Array.isArray(config?.topics) ? config.topics : [];
  const standardTopics = configTopics.map((topic) => topic?.tag).filter(Boolean);
  const estimator = typeof estimateSandboxCost === "function"
    ? estimateSandboxCost
    : fallbackEstimateDigestCost;

  let totalCost = 0;
  let projectedDeliveries = 0;

  const projectedRuns = slots.map((slot) => {
    const users = Array.isArray(slot.users) ? slot.users : [];
    const customKeywords = [];
    const itemCount = 5;
    const estimate = estimator({
      topics: standardTopics,
      customKeywords,
      itemCount,
    }) || { totalUsd: 0 };
    const estimatedCost = toFiniteNumber(estimate.totalUsd, 0);
    totalCost += estimatedCost;
    projectedDeliveries += users.length;
    return {
      ...slot,
      user_count: users.length,
      item_count: itemCount,
      custom_keywords: customKeywords,
      estimated_cost_usd: parseFloat(estimatedCost.toFixed(5)),
    };
  });

  return {
    days: Math.max(1, Number(days || 7)),
    scheduled_runs: projectedRuns.length,
    projected_deliveries: projectedDeliveries,
    active_users: (Array.isArray(roster) ? roster : []).filter((user) => String(user?.status || "").toLowerCase().trim() === "active").length,
    total_cost: parseFloat(totalCost.toFixed(4)),
    projected_runs: projectedRuns,
  };
}

function buildMonthRunSummary(runs, monthPrefix) {
  const monthRuns = runs.filter((row) => String(row?.date || "").startsWith(monthPrefix));
  const monthDeliveries = sumRuns(monthRuns, "users_served");
  const monthUniqueUsersLog = new Set();
  for (const run of monthRuns) {
    for (const userRow of (Array.isArray(run?.per_user) ? run.per_user : [])) {
      if (userRow && userRow.id) monthUniqueUsersLog.add(String(userRow.id));
    }
  }
  return {
    monthRuns,
    monthDeliveries,
    monthUniqueUsersLogSize: monthUniqueUsersLog.size,
  };
}

function buildPerUserCostRollup(runs) {
  const userMap = {};
  for (const run of runs) {
    const usersServed = run.users_served || 1;
    for (const userRow of (Array.isArray(run?.per_user) ? run.per_user : [])) {
      if (!userMap[userRow.id]) userMap[userRow.id] = { id: userRow.id, runs: 0, total_cost: 0 };
      userMap[userRow.id].runs++;
      userMap[userRow.id].total_cost += (run.total_cost_usd || 0) / usersServed;
    }
  }
  return Object.values(userMap)
    .map((row) => ({ ...row, total_cost: parseFloat(row.total_cost.toFixed(5)) }))
    .sort((a, b) => b.total_cost - a.total_cost);
}

module.exports = {
  sumRuns,
  buildMonthRunSummary,
  buildPerUserCostRollup,
  buildTrailingWindowCostSummary,
  buildProjectedWindowCostSummary,
};
