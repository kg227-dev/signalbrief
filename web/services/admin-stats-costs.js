function sumRuns(rows, key) {
  return rows.reduce((sum, row) => sum + (row[key] || 0), 0);
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
};
