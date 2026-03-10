const runtime = require("./onboarding-service-runtime");

function assertFunction(deps, key) {
  if (typeof deps[key] !== "function") {
    throw new TypeError(`createOnboardingService requires function dependency: ${key}`);
  }
}

function assertState(deps) {
  const stateValue = deps.state;
  if (typeof stateValue === "function") return;
  if (!stateValue || typeof stateValue !== "object") {
    throw new TypeError("createOnboardingService requires a state object or state() accessor");
  }
  const pending = stateValue.pendingLinkVerifications;
  const awaiting = stateValue.awaitingEmail;
  if (!(pending instanceof Map) || !(awaiting instanceof Map)) {
    throw new TypeError(
      "createOnboardingService state requires pendingLinkVerifications and awaitingEmail Map instances"
    );
  }
}

function validateOnboardingServiceDeps(deps) {
  if (!deps || typeof deps !== "object") {
    throw new TypeError("createOnboardingService requires a dependency object");
  }

  assertState(deps);
  assertFunction(deps, "sendMessage");
  assertFunction(deps, "sendVerificationEmail");
  assertFunction(deps, "findUserByEmail");
  assertFunction(deps, "relinkUserToChat");
  assertFunction(deps, "formatDeliveryTime");
}

function createOnboardingService(deps) {
  validateOnboardingServiceDeps(deps);
  return runtime.createOnboardingService(deps);
}

module.exports = {
  createOnboardingService,
};
