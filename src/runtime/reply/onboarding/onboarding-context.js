"use strict";

const { chatKey } = require("./keys");

function createOnboardingVerificationContext(deps) {
  const {
    state,
    linkVerifyTtlMs,
    sendMessage,
    sendVerificationEmail,
    findUserByEmail,
    relinkUserToChat,
    formatDeliveryTime,
  } = deps;

  function currentState() {
    return typeof state === "function" ? state() : state;
  }

  return {
    linkVerifyTtlMs,
    pending: {
      get: (chatId) => {
        const stateRef = currentState();
        return stateRef.pendingLinkVerifications.get(chatKey(chatId)) || null;
      },
      set: (chatId, payload) => {
        const stateRef = currentState();
        stateRef.pendingLinkVerifications.set(chatKey(chatId), payload);
      },
      delete: (chatId) => {
        const stateRef = currentState();
        stateRef.pendingLinkVerifications.delete(chatKey(chatId));
      },
    },
    awaiting: {
      has: (chatId) => {
        const stateRef = currentState();
        return stateRef.awaitingEmail.has(chatId);
      },
      set: (chatId, enabled = true) => {
        const stateRef = currentState();
        if (enabled) stateRef.awaitingEmail.set(chatId, true);
        else stateRef.awaitingEmail.delete(chatId);
      },
      delete: (chatId) => {
        const stateRef = currentState();
        stateRef.awaitingEmail.delete(chatId);
      },
    },
    messaging: {
      send: sendMessage,
    },
    accounts: {
      sendVerificationEmail,
      findByEmail: findUserByEmail,
      relink: relinkUserToChat,
    },
    formatDeliveryTime,
  };
}

module.exports = {
  createOnboardingVerificationContext,
};
