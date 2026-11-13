// Applies the saved (or system) theme before first paint so there is no flash.
(function () {
  var saved = null;
  try { saved = localStorage.getItem("mb.theme"); } catch (e) { /* storage blocked */ }
  var dark = saved === "dark" || (saved !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
})();
