/* Inline and independent of application bundles, so failed imports stay recoverable. */
(function () {
  var panel = document.getElementById("reader-startup");
  var title = document.getElementById("reader-startup-title");
  var notice = document.getElementById("reader-startup-notice");
  var actions = document.getElementById("reader-startup-actions");
  var started = false, failed = false, repairing = false;
  var base = new URL("./", document.baseURI);
  function show(message) {
    panel.hidden = false; actions.hidden = false;
    title.textContent = "墨读暂时未能打开";
    notice.textContent = message || "阅读器资源未加载完成。可以联网修复后重新打开，本机文献与笔记会保留。";
  }
  var timer = setTimeout(function () { if (!started) show("启动时间较长。可以先重新打开；若仍无法进入，请联网修复阅读器资源。"); }, 12000);
  window.paperinkBoot = {
    ready: function () { if (failed) return; started = true; clearTimeout(timer); panel.hidden = true; },
    fail: function (message) { failed = true; clearTimeout(timer); show(message); }
  };
  window.addEventListener("error", function () { if (!started) window.paperinkBoot.fail(); }, true);
  window.addEventListener("unhandledrejection", function () { if (!started) window.paperinkBoot.fail(); });
  document.getElementById("reader-retry").onclick = function () { location.reload(); };
  document.getElementById("reader-library").onclick = function () {
    try { localStorage.removeItem("paperink-last-document"); } catch (_) {}
    location.replace(base.href + "?paperink-library=1");
  };
  function readyWorker(registration) {
    return new Promise(function (resolve, reject) {
      var timeout = setTimeout(function () { finish(new Error("下载尚未完成，请保持联网后重试。")); }, 45000);
      var watched = [];
      function finish(error) {
        clearTimeout(timeout); registration.removeEventListener("updatefound", inspect);
        watched.forEach(function (worker) { worker.removeEventListener("statechange", inspect); });
        if (error) reject(error); else resolve(registration.waiting);
      }
      function inspect() {
        if (registration.waiting) { finish(); return; }
        var worker = registration.installing;
        if (!worker) { if (registration.active) finish(); return; }
        if (watched.indexOf(worker) === -1) { watched.push(worker); worker.addEventListener("statechange", inspect); }
        if (worker.state === "redundant") finish(new Error("资源下载未完成，请检查网络后重试。"));
      }
      registration.addEventListener("updatefound", inspect); inspect();
    });
  }
  function activate(worker) {
    return new Promise(function (resolve, reject) {
      var timeout = setTimeout(function () { cleanup(); reject(new Error("更新暂未完成，请重新打开墨读后重试。")); }, 15000);
      function cleanup() { clearTimeout(timeout); navigator.serviceWorker.removeEventListener("controllerchange", changed); }
      function changed() { cleanup(); resolve(); }
      navigator.serviceWorker.addEventListener("controllerchange", changed);
      worker.postMessage({ type: "ACTIVATE_UPDATE" });
    });
  }
  document.getElementById("reader-repair").onclick = async function () {
    if (repairing) return;
    repairing = true;
    var buttons = Array.from(actions.querySelectorAll("button"));
    buttons.forEach(function (button) { button.disabled = true; });
    notice.textContent = "正在下载并修复阅读器资源，本机文献与笔记会保留…";
    try {
      if (!navigator.onLine) throw new Error("请先连接网络，再点击联网修复。本机内容已保留。");
      // The probe bypasses old cache-first workers without touching their caches.
      var probe = await fetch(new URL("index.html?paperink-probe=" + Date.now(), base).href, { cache: "no-store", signal: AbortSignal.timeout(20000) });
      if (!probe.ok || !(await probe.text()).includes("reader-startup")) throw new Error("暂时无法下载修复版本，请检查网络后重试。");
      if ("serviceWorker" in navigator) {
        var registration = await navigator.serviceWorker.register(new URL("sw.js", base).href, { scope: base.href, updateViaCache: "none" });
        await registration.update();
        var worker = await readyWorker(registration);
        if (worker) await activate(worker);
      }
      location.replace(base.href + "?paperink-recover=" + Date.now());
    } catch (error) {
      notice.textContent = error && error.message ? error.message : "修复暂未完成，请保持联网后重试。本机内容已保留。";
      repairing = false; buttons.forEach(function (button) { button.disabled = false; });
    }
  };
})();
