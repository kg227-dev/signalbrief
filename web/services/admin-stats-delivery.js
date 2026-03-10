const {
  buildWindow,
  expectedScheduledCount,
  deliveredScheduledCount,
  getLastSuccessfulScheduledRun,
  getNextExpectedActiveDelivery,
  minutesUntilEtKey,
  formatCountdown,
  formatMissedTrendLabel,
} = require("./admin-stats-delivery-runtime");

function buildDeliveryReliabilitySnapshot({ runs, roster, parseEtNowParts }) {
  const activeRoster = roster.filter((user) => user.status === "active");
  const activeEmailSet = new Set(
    activeRoster
      .map((user) => String(user.email || "").toLowerCase().trim())
      .filter(Boolean)
  );
  const nowEt = parseEtNowParts();
  const currentWindow = buildWindow(nowEt, -7, -1);
  const previousWindow = buildWindow(nowEt, -14, -8);

  const expectedCurrent7d = expectedScheduledCount(currentWindow, activeRoster);
  const deliveredCurrent7d = deliveredScheduledCount(currentWindow, runs, activeEmailSet);
  const expectedPrevious7d = expectedScheduledCount(previousWindow, activeRoster);
  const deliveredPrevious7d = deliveredScheduledCount(previousWindow, runs, activeEmailSet);
  const missedCurrent7d = Math.max(0, expectedCurrent7d - deliveredCurrent7d);
  const missedPrevious7d = Math.max(0, expectedPrevious7d - deliveredPrevious7d);
  const missedDelta7d = missedCurrent7d - missedPrevious7d;
  const successRate7d = expectedCurrent7d > 0
    ? Number(((deliveredCurrent7d / expectedCurrent7d) * 100).toFixed(1))
    : 100;
  const missedTrendLabel = formatMissedTrendLabel(missedDelta7d);
  const lastSuccessfulScheduledRun = getLastSuccessfulScheduledRun(runs);
  const nextExpectedActiveDelivery = getNextExpectedActiveDelivery(activeRoster);

  const nextExpectedCountdownMinutes = nextExpectedActiveDelivery
    ? minutesUntilEtKey(nextExpectedActiveDelivery.next_delivery_key, nowEt)
    : null;

  return {
    success_rate_7d: successRate7d,
    delivered_7d: deliveredCurrent7d,
    expected_7d: expectedCurrent7d,
    missed_current_7d: missedCurrent7d,
    missed_previous_7d: missedPrevious7d,
    missed_delta_7d: missedDelta7d,
    missed_trend_label: missedTrendLabel,
    last_successful_scheduled_run: lastSuccessfulScheduledRun
      ? (lastSuccessfulScheduledRun.run_at_et || lastSuccessfulScheduledRun.run_at || null)
      : null,
    next_expected_delivery_et: nextExpectedActiveDelivery?.next_delivery_et || null,
    next_expected_countdown: formatCountdown(nextExpectedCountdownMinutes),
    next_expected_countdown_minutes: nextExpectedCountdownMinutes,
  };
}

module.exports = {
  buildDeliveryReliabilitySnapshot,
};
