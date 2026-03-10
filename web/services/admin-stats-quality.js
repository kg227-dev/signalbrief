function summarizeRosterQuality(roster) {
  const qualityUsers = roster.filter((user) => Number.isFinite(Number(user.dqs_current)));
  const qualityCurrentAvg = qualityUsers.length
    ? Number((qualityUsers.reduce((sum, user) => sum + Number(user.dqs_current || 0), 0) / qualityUsers.length).toFixed(2))
    : null;
  const quality7dAvg = qualityUsers.length
    ? Number((qualityUsers.reduce((sum, user) => sum + Number(user.dqs_7d_avg || user.dqs_current || 0), 0) / qualityUsers.length).toFixed(2))
    : null;
  const qualityImproving14d = qualityUsers.filter((user) => Number(user.dqs_14d_delta || 0) >= 5).length;
  const qualityAtRisk = qualityUsers.filter((user) => Number(user.dqs_current || 0) < 75).length;

  return {
    users_scored: qualityUsers.length,
    dqs_current_avg: qualityCurrentAvg,
    dqs_7d_avg: quality7dAvg,
    improving_14d: qualityImproving14d,
    at_risk: qualityAtRisk,
  };
}

module.exports = {
  summarizeRosterQuality,
};
