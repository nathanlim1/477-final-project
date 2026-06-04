export function observeSteps(steps, onChange) {
  const stepList = Array.from(steps);
  let activeId = null;

  function activate(step) {
    const stepId = step.dataset.step;
    if (!stepId || stepId === activeId) return;

    activeId = stepId;

    for (const currentStep of stepList) {
      currentStep.classList.toggle("is-active", currentStep === step);
    }

    onChange(stepId, step);
  }

  if (!("IntersectionObserver" in window)) {
    activate(stepList[0]);
    return () => {};
  }

  const observer = new IntersectionObserver(
    (entries) => {
      const visibleEntries = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

      if (visibleEntries.length) {
        activate(visibleEntries[0].target);
      }
    },
    {
      root: null,
      rootMargin: "-42% 0px -42% 0px",
      threshold: [0, 0.25, 0.5, 0.75, 1]
    }
  );

  for (const step of stepList) {
    observer.observe(step);
  }

  activate(stepList[0]);

  return () => observer.disconnect();
}
