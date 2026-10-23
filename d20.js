document.querySelectorAll("[data-preview]").forEach((preview) => {
  const toggle = preview.querySelector("[data-toggle]");
  toggle.closest("[data-enhance]").hidden = false;
  toggle.addEventListener("change", () => {
    preview.dataset.ok = toggle.checked;
  });
});
