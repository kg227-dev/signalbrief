#!/usr/bin/env node
"use strict";

/**
 * One-shot script to create the 10 canary users for the
 * reduced-scope MVP reliability validation, then pause
 * all non-canary active users.
 *
 * Safe to re-run: skips emails that already exist.
 */

const { initStore, readUser, writeUser, allUsers, generateToken } = require("../src/runtime/store-core-runtime");
const { normalizeUserRecord } = require("../src/runtime/user-contract-runtime");

initStore();

const CANARY_ROSTER = [
  { slot: "T1", email: "kushgulati29+sb-t1-healthcare@gmail.com",     name: "Canary T1 Healthcare",    topics: ["HEALTHCARE"],                                       depth: "headline_plus_why" },
  { slot: "T2", email: "kushgulati29+sb-t2-lifesciences@gmail.com",   name: "Canary T2 Life Sciences", topics: ["LIFE SCIENCES"],                                     depth: "headline_plus_why" },
  { slot: "T3", email: "kushgulati29+sb-t3-technology@gmail.com",     name: "Canary T3 Technology",    topics: ["TECHNOLOGY"],                                        depth: "headline_plus_why" },
  { slot: "T4", email: "kushgulati29+sb-t4-energy@gmail.com",         name: "Canary T4 Energy",        topics: ["ENERGY"],                                            depth: "headline_plus_why" },
  { slot: "T5", email: "kushgulati29+sb-t5-finserv@gmail.com",        name: "Canary T5 FinServ",       topics: ["FINANCIAL SERVICES"],                                depth: "headline_plus_why" },
  { slot: "T6", email: "kushgulati29+sb-t6-consumer@gmail.com",       name: "Canary T6 Consumer",      topics: ["CONSUMER & RETAIL"],                                 depth: "headline_plus_why" },
  { slot: "T7", email: "kushgulati29+sb-t7-industrials@gmail.com",    name: "Canary T7 Industrials",   topics: ["INDUSTRIALS"],                                       depth: "headline_plus_why" },
  { slot: "M1", email: "kushgulati29+sb-m1-scan@gmail.com",           name: "Canary M1 Scan",          topics: ["HEALTHCARE", "TECHNOLOGY", "FINANCIAL SERVICES"],     depth: "headline_only" },
  { slot: "M2", email: "kushgulati29+sb-m2-brief@gmail.com",          name: "Canary M2 Brief",         topics: ["LIFE SCIENCES", "ENERGY", "INDUSTRIALS"],            depth: "headline_plus_oneliner" },
  { slot: "M3", email: "kushgulati29+sb-m3-deep@gmail.com",           name: "Canary M3 Deep",          topics: ["CONSUMER & RETAIL", "FINANCIAL SERVICES", "INDUSTRIALS"], depth: "headline_plus_why" },
];

const DELIVERY_TIME = "07:00";
const TIMEZONE = "America/New_York";

// --- Create canary users ---

const existingUsers = allUsers();
const existingEmails = new Set(existingUsers.map((u) => (u.email || "").toLowerCase().trim()));
const canaryEmails = new Set(CANARY_ROSTER.map((r) => r.email.toLowerCase()));
const createdChatIds = [];

for (const entry of CANARY_ROSTER) {
  const emailNorm = entry.email.toLowerCase().trim();
  if (existingEmails.has(emailNorm)) {
    const existing = existingUsers.find((u) => (u.email || "").toLowerCase().trim() === emailNorm);
    console.log(`[canary] SKIP ${entry.slot} ${emailNorm} — already exists (chatId=${existing.chatId}, status=${existing.status})`);
    createdChatIds.push(existing.chatId);
    continue;
  }

  const chatId = `email-${Date.now()}`;
  const nowIso = new Date().toISOString();
  const user = normalizeUserRecord({
    chatId,
    name: entry.name,
    email: emailNorm,
    topics: entry.topics,
    status: "active",
    token: generateToken(),
    joined_at: nowIso,
    last_updated: nowIso,
    digests_received: 0,
    digest_dates: [],
    last_digest_items: [],
    preferences: {
      depth: entry.depth,
      delivery_time: DELIVERY_TIME,
      frequency: "daily_all",
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      timezone: TIMEZONE,
      email_enabled: true,
    },
  }, { chatId });

  writeUser(chatId, user);
  createdChatIds.push(chatId);
  console.log(`[canary] CREATED ${entry.slot} ${emailNorm} → chatId=${chatId} topics=[${entry.topics.join(", ")}] depth=${entry.depth}`);

  // small delay to ensure unique chatId timestamps
  const start = Date.now();
  while (Date.now() - start < 5) { /* spin */ }
}

// --- Pause non-canary active users ---

const allCurrent = allUsers();
let pausedCount = 0;
for (const user of allCurrent) {
  const emailNorm = (user.email || "").toLowerCase().trim();
  if (canaryEmails.has(emailNorm)) continue;
  if (user.status === "paused" || user.status === "unsubscribed") {
    console.log(`[pause] SKIP ${emailNorm} — already ${user.status}`);
    continue;
  }
  user.status = "paused";
  user.last_updated = new Date().toISOString();
  writeUser(user.chatId, user);
  console.log(`[pause] PAUSED ${emailNorm} (chatId=${user.chatId})`);
  pausedCount++;
}

console.log(`\n[summary] ${createdChatIds.length} canary users ready, ${pausedCount} non-canary user(s) paused`);
