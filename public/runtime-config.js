(function () {
  var config = {
    appTitle: "Noctua Mail",
    appEnvironmentLabel: ""
  };
  window.__NOCTUA_RUNTIME_CONFIG__ = config;
  if (config.appTitle) {
    document.title = config.appTitle;
  }
})();
