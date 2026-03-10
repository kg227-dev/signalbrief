function blankReengagementState() {
  return {
    day4_sent_at: null,
    day8_sent_at: null,
    auto_paused_at: null,
    reactivated_at: null,
  };
}

function resetReengagementState(user, opts = {}) {
  const preserveAutoPaused = !!opts.preserveAutoPaused;
  const previous = user && typeof user.reengagement_state === "object" ? user.reengagement_state : {};
  const next = blankReengagementState();
  if (preserveAutoPaused && previous.auto_paused_at) next.auto_paused_at = previous.auto_paused_at;
  return next;
}

module.exports = {
  blankReengagementState,
  resetReengagementState,
};
