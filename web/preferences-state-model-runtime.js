/* SignalBrief — preference state model runtime */
(function bootstrapPreferencesStateModelRuntime(globalScope) {
  function createPreferenceStateModel({
    topicState,
    defaultDepth,
    normalizeDayFn,
    normalizeDaysFn,
    frequencyFromDaysFn,
    toPositiveInteger,
    initialDepth,
    initialDeliveryTime,
    initialDaysOfWeek,
    initialItemsPerDigest,
  }) {
    let depth = String(initialDepth || defaultDepth);
    let deliveryTime = String(initialDeliveryTime || "07:00");
    let daysOfWeek = normalizeDaysFn(initialDaysOfWeek);
    let itemsPerDigest = toPositiveInteger(initialItemsPerDigest, 5);

    return {
      getTopics() {
        return topicState.getTopics();
      },
      setTopics(topics) {
        return topicState.setTopics(topics);
      },
      hasTopic(topic) {
        return topicState.hasTopic(topic);
      },
      addTopic(topic) {
        return topicState.addTopic(topic);
      },
      removeTopic(topic) {
        return topicState.removeTopic(topic);
      },
      toggleTopic(topic) {
        return topicState.toggleTopic(topic);
      },
      getDepth() {
        return depth || defaultDepth;
      },
      setDepth(nextDepth) {
        depth = String(nextDepth || "").trim() || defaultDepth;
        return depth;
      },
      getDeliveryTime() {
        return deliveryTime || "07:00";
      },
      setDeliveryTime(value) {
        deliveryTime = String(value || "").trim() || "07:00";
        return deliveryTime;
      },
      getDays() {
        return daysOfWeek.slice();
      },
      setDays(days) {
        daysOfWeek = normalizeDaysFn(days);
        return this.getDays();
      },
      toggleDay(day) {
        const normalized = normalizeDayFn(day);
        if (normalized == null) return false;
        if (daysOfWeek.includes(normalized)) {
          daysOfWeek = daysOfWeek.filter((value) => value !== normalized);
          return false;
        }
        daysOfWeek = normalizeDaysFn([...daysOfWeek, normalized]);
        return true;
      },
      setDaysPreset(preset) {
        if (preset === "weekdays") daysOfWeek = [1, 2, 3, 4, 5];
        else if (preset === "everyday") daysOfWeek = [0, 1, 2, 3, 4, 5, 6];
        return this.getDays();
      },
      getFrequency() {
        return frequencyFromDaysFn(daysOfWeek);
      },
      getItemsPerDigest() {
        return itemsPerDigest;
      },
      setItemsPerDigest(value) {
        itemsPerDigest = toPositiveInteger(value, itemsPerDigest);
        return itemsPerDigest;
      },
      snapshot() {
        return {
          topics: this.getTopics(),
          depth: this.getDepth(),
          delivery_time: this.getDeliveryTime(),
          frequency: this.getFrequency(),
          days_of_week: this.getDays(),
          items_per_digest: this.getItemsPerDigest(),
        };
      },
    };
  }

  globalScope.SignalBriefPrefsStateModelRuntime = {
    createPreferenceStateModel,
  };
})(window);
