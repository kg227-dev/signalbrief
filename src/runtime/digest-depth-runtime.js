"use strict";

function applyDigestDepth(items, depth) {
  const d = String(depth || "").toLowerCase();
  if (d === "headline_only" || d === "headlines" || d === "scan") {
    return (items || []).map((i) => ({ ...i, wim: null }));
  }
  if (d === "oneliner" || d === "headline_plus_oneliner") {
    return (items || []).map((i) => {
      const brief = i?.wim_brief
        ? String(i.wim_brief).trim()
        : (i?.wim
          ? String(i.wim).replace(/<strong>(.*?)<\/strong>/s, "$1").split(".")[0] + "."
          : null);
      return { ...i, wim: brief };
    });
  }
  return (items || []).map((i) => ({ ...i }));
}

module.exports = {
  applyDigestDepth,
};
