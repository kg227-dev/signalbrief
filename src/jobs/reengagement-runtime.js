#!/usr/bin/env node
"use strict";

const fs = require("fs");
const { createStore, USER_STATUS } = require("../platform/store");
const {
  sendReengagementDay4Email,
  sendReengagementDay8Email,
  sendAutoPauseConfirmationEmail,
} = require("../platform/mailer");

const reengagementStore = createStore();
const { initStore, allUsers, writeUser } = reengagementStore;

const LOG_FILE = "/tmp/signalbrief-reengagement.log";
const DAY_MS = 24 * 60 * 60 * 1000;

let storeInitialized = false;
function ensureStoreInitialized() {
  if (storeInitialized) return;
  initStore();
  storeInitialized = true;
}

function reengagementLog(message) {
  const line = `[${new Date().toISOString()}] [reengagement] ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, `${line}\n`);
  } catch (err) {
    const reason = err && err.message ? err.message : String(err || "unknown error");
    process.stderr.write(`[reengagement] log write failed: ${reason}\n`);
  }
}

function blankReengagementState() {
  return {
    day4_sent_at: null,
    day8_sent_at: null,
    auto_paused_at: null,
    reactivated_at: null,
  };
}

function normalizeReengagementState(raw) {
  return { ...blankReengagementState(), ...(raw && typeof raw === "object" ? raw : {}) };
}

function daysSince(iso, nowMs) {
  const ts = Date.parse(String(iso || ""));
  if (!Number.isFinite(ts)) return null;
  return Math.floor((nowMs - ts) / DAY_MS);
}

function userFirstName(user) {
  if (user && user.name) return String(user.name).trim().split(/\s+/)[0] || "there";
  if (user && user.email) return String(user.email).split("@")[0] || "there";
  return "there";
}

async function handleDay4(user, state, nowIso) {
  ensureStoreInitialized();
  const result = await sendReengagementDay4Email(user);
  if (!result || result.ok !== true) {
    throw new Error(`send failed (${result && result.via ? result.via : "unknown"})`);
  }
  const updated = {
    ...user,
    reengagement_state: {
      ...state,
      day4_sent_at: nowIso,
    },
    last_updated: nowIso,
  };
  writeUser(user.chatId, updated);
  reengagementLog(`day4 email sent to ${user.email || user.chatId} (${userFirstName(user)})`);
}

async function handleDay8(user, state, nowIso) {
  ensureStoreInitialized();
  const result = await sendReengagementDay8Email(user);
  if (!result || result.ok !== true) {
    throw new Error(`send failed (${result && result.via ? result.via : "unknown"})`);
  }
  const updated = {
    ...user,
    reengagement_state: {
      ...state,
      day8_sent_at: nowIso,
    },
    last_updated: nowIso,
  };
  writeUser(user.chatId, updated);
  reengagementLog(`day8 email sent to ${user.email || user.chatId} (${userFirstName(user)})`);
}

async function handleAutoPause(user, state, nowIso) {
  ensureStoreInitialized();
  const updated = {
    ...user,
    status: USER_STATUS.PAUSED,
    preferences: {
      ...(user.preferences || {}),
      email_enabled: false,
    },
    reengagement_state: {
      ...state,
      auto_paused_at: nowIso,
    },
    last_updated: nowIso,
  };
  writeUser(user.chatId, updated);
  sendAutoPauseConfirmationEmail(updated).catch((err) => {
    reengagementLog(`auto-pause email failed for ${updated.email || updated.chatId}: ${err.message}`);
  });
  reengagementLog(`auto-paused ${updated.email || updated.chatId}`);
}

async function main() {
  ensureStoreInitialized();
  const now = new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const users = allUsers().filter((u) =>
    String(u?.status || USER_STATUS.ACTIVE) === USER_STATUS.ACTIVE
    && ((u?.preferences || {}).email_enabled !== false)
  );

  let processed = 0;
  for (const user of users) {
    try {
      const joinedDays = daysSince(user.joined_at, nowMs);
      if (joinedDays == null || joinedDays < 3) continue;
      if (Number(user.digests_received || 0) < 2) continue;

      const baselineIso = user.last_email_open_at || user.last_digest_at || user.joined_at;
      const daysSinceLastOpen = daysSince(baselineIso, nowMs);
      if (daysSinceLastOpen == null) continue;

      const state = normalizeReengagementState(user.reengagement_state);

      if (daysSinceLastOpen >= 4 && !state.day4_sent_at) {
        await handleDay4(user, state, nowIso);
        processed++;
        continue;
      }
      if (daysSinceLastOpen >= 8 && state.day4_sent_at && !state.day8_sent_at) {
        await handleDay8(user, state, nowIso);
        processed++;
        continue;
      }
      if (daysSinceLastOpen >= 11 && state.day8_sent_at && !state.auto_paused_at) {
        await handleAutoPause(user, state, nowIso);
        processed++;
        continue;
      }
    } catch (err) {
      reengagementLog(`error for ${user.email || user.chatId}: ${err.message}`);
    }
  }

  reengagementLog(`run complete (${processed} action${processed === 1 ? "" : "s"})`);
}

if (require.main === module) {
  main().catch((err) => {
    reengagementLog(`fatal: ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  ensureStoreInitialized,
  log: reengagementLog,
  blankReengagementState,
  normalizeReengagementState,
  daysSince,
  userFirstName,
  handleDay4,
  handleDay8,
  handleAutoPause,
  main,
};
