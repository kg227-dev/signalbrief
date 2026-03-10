/* SignalBrief — settings UI topic action helpers */
(function bootstrapSettingsUiTopicActionsRuntime(globalScope) {
  function createTopicUiHandlers({
    Prefs,
    prefState,
    byId,
    INDUSTRY_TOPICS,
    CAPABILITY_TOPICS,
    DEFAULT_TOPICS,
    showError,
  }) {
    const maxCustomKeywords = Math.max(1, Number(Prefs.MAX_CUSTOM_KEYWORDS || 3));

    function isCustomTopic(topic) {
      if (typeof Prefs.isCustomTopic === "function") return Prefs.isCustomTopic(topic);
      return !DEFAULT_TOPICS.includes(String(topic || ""));
    }

    function topicDisplayLabel(topic) {
      if (typeof Prefs.topicDisplayLabel === "function") return Prefs.topicDisplayLabel(topic);
      const key = String(topic || "");
      return key.replace(/^custom_/, "").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
    }

    function selectedTopicsList() {
      return prefState ? prefState.getTopics() : [];
    }

    function selectedCustomKeywordCount() {
      return selectedTopicsList().filter((topic) => isCustomTopic(topic)).length;
    }

    function updateSelectedSummary() {
      const el = byId("selectedSummary");
      if (!el) return;

      const topics = selectedTopicsList();
      if (!topics.length) {
        el.innerHTML = "No topics selected yet.";
        return;
      }

      const labels = topics.map((topic) => topicDisplayLabel(topic));
      el.innerHTML = `<strong>${topics.length} tracking:</strong> <span class="summary-topics">${labels.join(" · ")}</span>`;
    }

    function updateTopicNote() {
      const count = selectedTopicsList().length;
      const note = byId("topicMinNote");
      if (!note) return;
      note.textContent = `${count} selected${count < 2 ? " — pick at least 2" : ""}`;
      note.style.color = count > 0 && count < 2 ? "#DC2626" : "#6B7280";
      updateSelectedSummary();
    }

    function renderChip(topic, selected) {
      const chip = document.createElement("div");
      const custom = isCustomTopic(topic);
      chip.className = `chip${selected ? " selected" : ""}${custom ? " chip-custom" : ""}`;
      chip.dataset.topic = topic;
      chip.innerHTML = `<span class="chip-check">✓</span> ${topicDisplayLabel(topic)}`;

      chip.addEventListener("click", () => {
        if (!prefState) return;
        const isSelected = prefState.toggleTopic(topic);
        chip.classList.toggle("selected", isSelected);
        updateTopicNote();
      });

      return chip;
    }

    function renderGroupLabel(text) {
      const el = document.createElement("div");
      el.className = "topic-group-label";
      el.textContent = text;
      return el;
    }

    function renderChips(userTopics) {
      const container = byId("topicGrid");
      if (!container || !prefState) return;

      const normalizedUserTopics = Array.isArray(userTopics) ? userTopics.map(String) : [];
      prefState.setTopics(normalizedUserTopics);
      container.innerHTML = "";

      container.appendChild(renderGroupLabel("Industries"));
      INDUSTRY_TOPICS.forEach((topic) => {
        container.appendChild(renderChip(topic, prefState.hasTopic(topic)));
      });

      container.appendChild(renderGroupLabel("Capabilities"));
      CAPABILITY_TOPICS.forEach((topic) => {
        container.appendChild(renderChip(topic, prefState.hasTopic(topic)));
      });

      prefState.getTopics().filter(isCustomTopic).forEach((topic) => {
        container.appendChild(renderChip(topic, true));
      });

      updateTopicNote();
    }

    function findTopicChip(topic) {
      return Array.from(document.querySelectorAll("#topicGrid [data-topic]"))
        .find((chip) => chip.dataset.topic === topic) || null;
    }

    function bindTopicHandlers() {
      const addTopicBtn = byId("addTopicBtn");
      const customTopicInput = byId("customTopicInput");
      const topicGrid = byId("topicGrid");
      if (!addTopicBtn || !customTopicInput || !topicGrid || !prefState) return;

      addTopicBtn.addEventListener("click", () => {
        const value = String(customTopicInput.value || "").trim();
        if (!value) {
          customTopicInput.value = "";
          return;
        }

        const topicKey = typeof Prefs.topicKeyFromInput === "function"
          ? Prefs.topicKeyFromInput(value, { matchDefault: true })
          : `custom_${value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;

        if (!topicKey) {
          customTopicInput.value = "";
          return;
        }

        const existing = findTopicChip(topicKey);
        if (existing) {
          if (
            isCustomTopic(topicKey)
            && !prefState.hasTopic(topicKey)
            && selectedCustomKeywordCount() >= maxCustomKeywords
          ) {
            if (typeof showError === "function") {
              showError(`You can track up to ${maxCustomKeywords} custom keywords.`);
            }
            return;
          }
          prefState.addTopic(topicKey);
          existing.classList.add("selected");
          updateTopicNote();
          customTopicInput.value = "";
          if (typeof showError === "function") showError("");
          return;
        }

        if (isCustomTopic(topicKey) && selectedCustomKeywordCount() >= maxCustomKeywords) {
          if (typeof showError === "function") {
            showError(`You can track up to ${maxCustomKeywords} custom keywords.`);
          }
          return;
        }

        prefState.addTopic(topicKey);
        topicGrid.appendChild(renderChip(topicKey, true));
        updateTopicNote();
        customTopicInput.value = "";
        if (typeof showError === "function") showError("");
      });

      customTopicInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          addTopicBtn.click();
        }
      });
    }

    return {
      renderChips,
      bindTopicHandlers,
    };
  }

  globalScope.SignalBriefSettingsUiTopicActionsRuntime = {
    createTopicUiHandlers,
  };
})(window);
