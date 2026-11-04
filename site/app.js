(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const app = $("#app");
  const RARITY = { 1: "銀", 4: "金", 8: "稜鏡" };
  const LOW_GAMES = 5; // 少於這個場數的列會變淡

  // ---------------- 設定（每位使用者存在自己的瀏覽器）
  const DEFAULTS = {
    descMode: "short",   // off | short | full
    rarity: "all",       // all | 1 | 4 | 8
    augSort: "opgg",     // opgg | pop | perf
    hideRare: true,      // 隱藏選用率 0 的符文
    itemSort: "pick",    // pick | win | play
    minGames: 1,
    show: { aug: true, item: true, skill: true },
    side: "center",      // 主螢幕位置：left（介面靠左）| right（靠右並左右鏡像）| center
    width: "full",       // narrow | medium | full
    scale: "m",          // s | m | l
    compact: false,      // 精簡模式
    favs: [],
    recent: [],
  };
  const WIDTH_PX = { narrow: 960, medium: 1280, full: 1880 };
  const SCALE = { s: 0.9, m: 1, l: 1.15 };
  const settings = (() => {
    try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("mayhem-settings") || "{}") }; }
    catch { return { ...DEFAULTS }; }
  })();
  const save = () => { try { localStorage.setItem("mayhem-settings", JSON.stringify(settings)); } catch {} };

  // ---------------- 顯示設定（主螢幕位置、寬度、字體、精簡）
  function applyView() {
    const b = document.body;
    b.dataset.side = settings.side;
    b.style.setProperty("--w", `${WIDTH_PX[settings.width] || 1880}px`);
    b.classList.toggle("compact", !!settings.compact);
    // 用 zoom 放大縮小整頁；同時把根元素尺寸換算回視窗大小，避免出現捲軸
    const z = SCALE[settings.scale] || 1;
    const root = document.documentElement;
    root.style.zoom = z;
    root.style.width = z === 1 ? "" : `${window.innerWidth / z}px`;
    root.style.height = z === 1 ? "" : `${window.innerHeight / z}px`;
  }
  // 內容實際可用寬度（CSS 像素），用來決定要排幾欄
  function contentWidth() {
    const z = SCALE[settings.scale] || 1;
    return Math.min(WIDTH_PX[settings.width] || 1880, window.innerWidth / z);
  }
  const isNarrow = () => contentWidth() < 1150;

  const VIEW_OPTS = [
    ["side", "主螢幕在哪一邊", [["left", "左邊"], ["center", "不指定"], ["right", "右邊"]],
      "介面會貼齊靠近主螢幕的那一側；主螢幕在右邊時欄位順序也會左右對調"],
    ["width", "介面寬度", [["narrow", "窄"], ["medium", "中"], ["full", "滿版"]], ""],
    ["scale", "字體大小", [["s", "小"], ["m", "中"], ["l", "大"]], ""],
    ["compact", "精簡模式", [["false", "關"], ["true", "開"]], "隱藏工具列、說明與附註，只留關鍵數字"],
  ];
  function renderGear() {
    const panel = $("#gearPanel");
    panel.innerHTML = VIEW_OPTS.map(([k, label, opts, hint]) => `
      <div class="opt"><div class="opt-label">${label}</div>
        <span class="seg" data-opt="${k}">${opts.map(([v, l]) =>
          `<button data-v="${v}" class="${String(settings[k]) === v ? "on" : ""}">${l}</button>`).join("")}</span>
        ${hint ? `<div class="opt-hint">${hint}</div>` : ""}</div>`).join("");
    panel.querySelectorAll(".seg").forEach(s => s.addEventListener("click", e => {
      const btn = e.target.closest("button"); if (!btn) return;
      const k = s.dataset.opt;
      settings[k] = k === "compact" ? btn.dataset.v === "true" : btn.dataset.v;
      save(); applyView(); renderGear(); rerender();
    }));
  }
  function rerender() {
    if (state.current && state.cache[state.current]) renderChamp(state.cache[state.current]);
  }
  $("#gearBtn").addEventListener("click", () => {
    const p = $("#gearPanel");
    p.hidden = !p.hidden;
    $("#gearBtn").setAttribute("aria-expanded", String(!p.hidden));
    if (!p.hidden) renderGear();
  });
  document.addEventListener("mousedown", e => {
    if (!e.target.closest(".gear-wrap")) { $("#gearPanel").hidden = true; $("#gearBtn").setAttribute("aria-expanded", "false"); }
  });
  let lastNarrow = null;
  window.addEventListener("resize", () => {
    applyView();
    const n = isNarrow();
    if (n !== lastNarrow) { lastNarrow = n; rerender(); }
  });
  applyView();

  // ---------------- 資料
  const state = { index: null, items: {}, augs: {}, cache: {}, byKey: {}, current: null };

  async function getJSON(url) {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(`${url} ${r.status}`);
    return r.json();
  }

  async function boot() {
    try {
      const [index, items, augs] = await Promise.all([
        getJSON("data/index.json"), getJSON("data/items.json"), getJSON("data/augments.json"),
      ]);
      Object.assign(state, { index, items, augs });
      index.champions.forEach(c => { state.byKey[c.key] = c; });
      const d = new Date(index.updated);
      $("#meta").innerHTML = `版本 ${esc(index.patch || "?")}<br>更新 ${d.toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
      window.addEventListener("hashchange", route);
      route();
    } catch (e) {
      app.innerHTML = `<p class="error">資料載入失敗：${esc(e.message)}</p>`;
    }
  }

  // ---------------- 工具
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  const pct = v => `${(+v).toFixed(1)}%`;
  function winClass(w, play) {
    if (!play) return "";
    if (w >= 55) return "w-good";
    if (w >= 51) return "w-ok";
    if (w < 45) return "w-bad";
    if (w < 49) return "w-meh";
    return "";
  }
  const itemImg = id => state.items[id]?.image || "";
  const itemName = id => state.items[id]?.name || `#${id}`;

  // 把 OP.GG 說明裡的遊戲標籤轉成安全的 HTML：只保留文字、換行與上色用的 span
  function richText(src) {
    const tpl = document.createElement("template");
    // 去掉 OP.GG 沒有數值的統計行（例如「總治療量：?」），並把連續空行合併
    const lines = String(src || "").split(/<br\s*\/?>/i)
      .filter(l => !/[：:]\s*\?\s*$/.test(l.replace(/<[^>]*>/g, "").trim()));
    const compacted = [];
    for (const l of lines) {
      const blank = !l.replace(/<[^>]*>/g, "").trim();
      if (blank && (!compacted.length || compacted[compacted.length - 1].blank)) continue;
      compacted.push({ l, blank });
    }
    while (compacted.length && compacted[compacted.length - 1].blank) compacted.pop();
    tpl.innerHTML = compacted.map(x => x.l).join("\n");
    const out = document.createElement("span");
    const walkNode = (node, parent) => {
      for (const n of node.childNodes) {
        if (n.nodeType === Node.TEXT_NODE) {
          const parts = n.textContent.split("\n");
          parts.forEach((p, i) => {
            if (i) parent.appendChild(document.createElement("br"));
            parent.appendChild(document.createTextNode(p));
          });
        } else if (n.nodeType === Node.ELEMENT_NODE) {
          const span = document.createElement("span");
          let tag = n.tagName.toLowerCase();
          if (tag === "font") tag = "gold";
          if (/^[a-z]+$/.test(tag)) span.className = `k-${tag}`;
          walkNode(n, span);
          parent.appendChild(span);
        }
      }
    };
    walkNode(tpl.content, out);
    return out.innerHTML;
  }

  // ---------------- 搜尋
  const searchEl = $("#search");
  const suggestEl = $("#suggest");
  let suggestions = [];
  let active = 0;

  function matchChamps(q) {
    q = q.trim().toLowerCase();
    if (!q || !state.index) return [];
    const scored = [];
    for (const c of state.index.champions) {
      const names = [c.name.toLowerCase(), c.key, ...((window.ALIASES || {})[c.key] || []).map(a => a.toLowerCase())];
      let score = -1;
      for (const n of names) {
        if (n === q) score = Math.max(score, 3);
        else if (n.startsWith(q)) score = Math.max(score, 2);
        else if (n.includes(q)) score = Math.max(score, 1);
      }
      if (score >= 0) scored.push([score, c]);
    }
    return scored.sort((a, b) => b[0] - a[0] || a[1].rank - b[1].rank).slice(0, 8).map(x => x[1]);
  }

  function renderSuggest() {
    suggestions = matchChamps(searchEl.value);
    active = 0;
    if (!suggestions.length) { suggestEl.hidden = true; return; }
    suggestEl.innerHTML = suggestions.map((c, i) =>
      `<li data-key="${esc(c.key)}" class="${i === 0 ? "active" : ""}">
        <img src="${esc(c.image)}" alt="" loading="lazy"><span>${esc(c.name)}</span>
        <span class="sub">${esc(c.key)} · #${c.rank}</span></li>`).join("");
    suggestEl.hidden = false;
  }

  function go(key) {
    searchEl.value = "";
    suggestEl.hidden = true;
    searchEl.blur();
    location.hash = key;
  }

  searchEl.addEventListener("input", () => {
    renderSuggest();
    if (!state.current) renderHome();
  });
  searchEl.addEventListener("keydown", e => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!suggestions.length) return;
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length;
      [...suggestEl.children].forEach((li, i) => li.classList.toggle("active", i === active));
    } else if (e.key === "Enter") {
      if (suggestions[active]) go(suggestions[active].key);
    } else if (e.key === "Escape") {
      searchEl.value = ""; suggestEl.hidden = true; searchEl.blur();
      if (!state.current) renderHome();
    }
  });
  suggestEl.addEventListener("mousedown", e => {
    const li = e.target.closest("li");
    if (li) { e.preventDefault(); go(li.dataset.key); }
  });
  searchEl.addEventListener("blur", () => setTimeout(() => { suggestEl.hidden = true; }, 100));

  // 不用點搜尋框，直接打字就能搜尋
  document.addEventListener("keydown", e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return;
    if (e.key === "Escape") { location.hash = ""; return; }
    if (e.key.length === 1 || e.key === "Process") searchEl.focus();
  });

  // ---------------- 常用英雄列
  function renderQuick() {
    const keys = [...settings.favs, ...settings.recent.filter(k => !settings.favs.includes(k))].slice(0, 16);
    $("#quick").innerHTML = keys.map(k => {
      const c = state.byKey[k];
      if (!c) return "";
      const cls = [settings.favs.includes(k) ? "fav" : "", state.current === k ? "current" : ""].join(" ");
      return `<a href="#${esc(k)}" class="${cls}" title="${esc(c.name)}${settings.favs.includes(k) ? "（收藏）" : ""}"><img src="${esc(c.image)}" alt="${esc(c.name)}"></a>`;
    }).join("");
  }

  // ---------------- 路由
  function route() {
    const key = decodeURIComponent(location.hash.slice(1));
    if (key && state.byKey[key]) showChamp(key);
    else { state.current = null; renderHome(); }
    renderQuick();
  }

  function renderHome() {
    const q = searchEl.value.trim();
    const list = q ? matchChamps(q) : state.index.champions;
    document.title = "大混戰速查";
    app.innerHTML = `<section class="home">
      <h2>依 OP.GG 大混戰排名排序 · 共 ${state.index.champions.length} 隻 · 直接打字即可搜尋</h2>
      <div class="grid">${list.map(c => `
        <a class="card" href="#${esc(c.key)}" title="#${c.rank}">
          <span class="tier t${c.tier}">${c.tier}</span>
          <img src="${esc(c.image)}" alt="" loading="lazy"><span>${esc(c.name)}</span>
        </a>`).join("")}</div></section>`;
  }

  async function showChamp(key) {
    state.current = key;
    settings.recent = [key, ...settings.recent.filter(k => k !== key)].slice(0, 12);
    save();
    renderQuick();
    let data = state.cache[key];
    if (!data) {
      app.innerHTML = `<p class="loading">載入 ${esc(state.byKey[key].name)}…</p>`;
      try { data = state.cache[key] = await getJSON(`data/champions/${encodeURIComponent(key)}.json`); }
      catch (e) { app.innerHTML = `<p class="error">這隻英雄目前沒有資料（${esc(e.message)}）</p>`; return; }
      if (state.current !== key) return;
    }
    renderChamp(data);
  }

  // ---------------- 英雄頁
  function renderChamp(c) {
    document.title = `${c.name} · 大混戰速查`;
    const fav = settings.favs.includes(c.key);
    const lowSample = c.sample != null && c.sample < 100;
    let show = { ...DEFAULTS.show, ...(settings.show || {}) };
    if (!pickLayout(show)) show = { ...DEFAULTS.show }; // 全關時恢復預設
    const count = SECTIONS.filter(([k]) => show[k]).length;
    const narrow = isNarrow();
    lastNarrow = narrow;
    const layout = pickLayout(show, narrow);
    if (settings.side === "right") layout.cols.reverse();
    app.innerHTML = `<section class="champ">
      <div class="champ-head">
        <img src="${esc(c.image)}" alt="">
        <div>
          <h1>${esc(c.name)}</h1>
          <div class="facts">
            <span><span class="tier t${c.tier}">${c.tier}</span> 階</span>
            <span>排名 #${c.rank}</span>
            <span class="${lowSample ? "warn" : ""}" title="由裝備的場數與選用率推算">樣本約 ${c.sample ?? "?"} 場${lowSample ? "（偏少，勝率僅供參考）" : ""}</span>
          </div>
        </div>
        <div class="spacer"></div>
        <div class="toggles" role="group" aria-label="顯示的區塊">${SECTIONS.map(([k, l]) => {
          const on = show[k];
          const last = on && count === 1;
          return `<button class="btn tog ${on ? "on" : ""}" data-sec="${k}" aria-pressed="${on}" ${last ? `disabled title="至少要保留一個區塊"` : ""}>${l}</button>`;
        }).join("")}</div>
        <button class="btn ${fav ? "on" : ""}" id="favBtn">${fav ? "★ 已收藏" : "☆ 收藏"}</button>
        <a class="btn" href="https://op.gg/zh-tw/lol/modes/aram-mayhem/${encodeURIComponent(c.key)}/build" target="_blank" rel="noopener">OP.GG ↗</a>
      </div>
      <div class="cols ${layout.cls}" style="--cols:${layout.cols.map(col => `minmax(0,${col.fr}fr)`).join(" ")}">
        ${layout.cols.map(col => `<div class="col">${col.panels.map(p => PANEL_HTML[p]).join("")}</div>`).join("")}
      </div></section>`;
    $("#favBtn").onclick = () => {
      settings.favs = fav ? settings.favs.filter(k => k !== c.key) : [...settings.favs, c.key];
      save(); renderChamp(c); renderQuick();
    };
    app.querySelectorAll(".tog").forEach(b => b.onclick = () => {
      settings.show = { ...show, [b.dataset.sec]: !show[b.dataset.sec] };
      save(); renderChamp(c);
    });
    if (show.aug) renderAugments(c);
    if (show.item) { renderCore(c); renderItems(c); renderBoots(c); renderStarters(c); }
    if (show.skill) renderSkills(c);
  }

  // ---------------- 區塊開關與版面
  const SECTIONS = [["aug", "強化符文"], ["item", "裝備"], ["skill", "技能點法"]];
  const PANEL_HTML = {
    aug: `<div class="panel grow" id="augPanel"></div>`,
    core: `<div class="panel" id="corePanel"></div>`,
    items: `<div class="panel" id="itemPanel"></div>`,
    boots: `<div class="panel" id="bootPanel"></div>`,
    starters: `<div class="panel" id="starterPanel"></div>`,
    skill: `<div class="panel" id="skillPanel"></div>`,
  };

  // 依開啟的區塊決定欄數、比例與每欄放哪些面板
  function pickLayout(show, narrow = false) {
    const col = (fr, ...panels) => ({ fr, panels });
    const key = SECTIONS.filter(([k]) => show[k]).map(([k]) => k).join("+");
    switch (key) {
      case "aug+item+skill":
        // 寬度不夠三欄時改成兩欄：符文一欄，其他全部放另一欄
        if (narrow) return { cls: "n2", cols: [col(1.1, "aug"), col(1, "core", "items", "skill", "boots", "starters")] };
        return { cls: "n3", cols: [col(1.35, "aug"), col(1, "core", "items"), col(0.9, "skill", "boots", "starters")] };
      case "aug+item":
        return { cls: "n2", cols: [col(1.5, "aug"), col(1, "core", "items", "boots", "starters")] };
      case "aug+skill":
        return { cls: "n2", cols: [col(1.5, "aug"), col(1, "skill")] };
      case "item+skill":
        return { cls: "n2", cols: [col(1.2, "core", "items"), col(1, "skill", "boots", "starters")] };
      case "aug":
        return { cls: "n1 solo-aug", cols: [col(1, "aug")] };
      case "item":
        return { cls: "n1 solo-item", cols: [col(1.2, "items"), col(1, "core", "boots", "starters")] };
      case "skill":
        return { cls: "n1 solo-skill", cols: [col(1, "skill")] };
      default:
        return null;
    }
  }

  // ---- 強化符文
  function renderAugments(c) {
    const panel = $("#augPanel");
    const seg = (name, opts) => `<span class="seg" data-set="${name}">${opts.map(([v, l]) =>
      `<button data-v="${v}" class="${String(settings[name]) === String(v) ? "on" : ""}">${l}</button>`).join("")}</span>`;
    panel.innerHTML = `
      <h2>強化符文 <small>OP.GG 評級、選用率、表現分數</small></h2>
      <div class="toolbar">
        ${seg("rarity", [["all", "全部"], [1, "銀"], [4, "金"], [8, "稜鏡"]])}
        <span class="lbl">排序</span>${seg("augSort", [["opgg", "評級"], ["pop", "選用率"], ["perf", "表現"]])}
        <span class="lbl">說明</span>${seg("descMode", [["off", "隱藏"], ["short", "簡要"], ["full", "完整"]])}
        <input type="search" id="augQ" placeholder="篩選符文…">
        <label><input type="checkbox" id="hideRare" ${settings.hideRare ? "checked" : ""}>隱藏沒人選的</label>
      </div>
      <div class="panel-body" id="augList"></div>
      <div class="note">表現分數為 OP.GG 自訂指標，越高越好；選用率越低，數字越不可靠。</div>`;
    panel.querySelectorAll(".seg").forEach(s => s.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      const name = s.dataset.set;
      settings[name] = name === "rarity" && b.dataset.v !== "all" ? +b.dataset.v : b.dataset.v;
      save();
      s.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b));
      drawList();
    }));
    $("#hideRare").onchange = e => { settings.hideRare = e.target.checked; save(); drawList(); };
    $("#augQ").oninput = drawList;

    function drawList() {
      const q = $("#augQ").value.trim();
      let rows = c.augments.map(a => ({ ...a, info: state.augs[a.id] })).filter(a => a.info);
      if (settings.rarity !== "all") rows = rows.filter(a => a.info.rarity === settings.rarity);
      if (settings.hideRare) rows = rows.filter(a => a.pop > 0);
      if (q) rows = rows.filter(a => a.info.name.includes(q) || (a.info.desc || "").includes(q));
      if (settings.augSort === "pop") rows.sort((a, b) => b.pop - a.pop);
      else if (settings.augSort === "perf") rows.sort((a, b) => b.perf - a.perf);
      const list = $("#augList");
      if (!rows.length) { list.innerHTML = `<div class="empty">沒有符合的強化符文</div>`; return; }
      list.innerHTML = `<div class="aug-grid">${rows.map(a => {
        const desc = settings.descMode === "off" ? "" :
          `<div class="desc">${richText(settings.descMode === "full" ? (a.info.tooltip || a.info.desc) : a.info.desc)}</div>`;
        return `<div class="aug r${a.info.rarity} ${a.pop < 0.5 ? "dim" : ""}">
          <img src="${esc(a.info.icon)}" alt="" loading="lazy">
          <div class="name"><span class="tier t${a.tier}" title="OP.GG 評級">${a.tier}</span>${esc(a.info.name)}<span class="rar">${RARITY[a.info.rarity] || ""}</span></div>
          <div class="stats"><div>選用 ${pct(a.pop)}</div><div>表現 ${a.perf.toFixed(1)}</div></div>
          ${desc}</div>`;
      }).join("")}</div>`;
    }
    drawList();
  }

  // ---- 核心組合（前 3）
  function renderCore(c) {
    $("#corePanel").innerHTML = `<h2>熱門核心組合 <small>前 3 名</small></h2><div class="panel-body">${
      c.core.length ? c.core.map(b => `<div class="combo">
        <div class="icons">${b.ids.map(id => `<img src="${esc(itemImg(id))}" alt="${esc(itemName(id))}" title="${esc(itemName(id))}">`).join("<b>›</b>")}</div>
        <div class="nums"><div class="${winClass(b.win, b.play)}">勝率 ${pct(b.win)}</div><div>${pct(b.pick)} · ${b.play} 場</div></div>
      </div>`).join("") : `<div class="empty">沒有資料</div>`}</div>`;
  }

  // ---- 單件裝備（可排序）
  // 可信勝率：Wilson 信賴區間下限（95%），場數越少扣越多
  function reliableWin(win, play) {
    if (!play) return 0;
    const z = 1.96, n = play, p = win / 100;
    const den = 1 + z * z / n;
    const centre = p + z * z / (2 * n);
    const margin = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
    return Math.max(0, (centre - margin) / den * 100);
  }

  function itemTable(rows, sortKey, sortable) {
    const cols = [["pick", "選用率", ""], ["win", "勝率", ""], ...(sortable ? [["lb", "可信勝率", "把場數納入考量的保守勝率（95% 信賴下限）。2 場 100% 會排在 30 場 60% 後面"]] : []), ["play", "場數", ""]];
    const head = cols.map(([k, l, tip]) =>
      `<th class="${sortable ? "sortable" : ""} ${sortKey === k ? "sorted" : ""}" data-k="${k}" ${tip ? `title="${tip}"` : ""}>${l}${sortKey === k ? " ▾" : ""}</th>`).join("");
    const maxPick = Math.max(1, ...rows.map(r => r.pick));
    return `<table><thead><tr><th>裝備</th>${head}</tr></thead><tbody>${rows.map(r => `
      <tr class="${r.play < LOW_GAMES ? "dim" : ""}">
        <td><div class="it"><img src="${esc(itemImg(r.id))}" alt="" loading="lazy"><span>${esc(itemName(r.id))}</span></div></td>
        <td class="pick">${pct(r.pick)}<i style="width:${(r.pick / maxPick * 48).toFixed(0)}px"></i></td>
        <td class="${winClass(r.win, r.play)}">${pct(r.win)}</td>
        ${sortable ? `<td class="lb">${pct(r.lb)}</td>` : ""}
        <td>${r.play}</td></tr>`).join("")}</tbody></table>`;
  }

  function renderItems(c) {
    const panel = $("#itemPanel");
    const draw = () => {
      const k = settings.itemSort;
      const rows = c.items.filter(r => r.play >= settings.minGames)
        .map(r => ({ ...r, lb: reliableWin(r.win, r.play) }))
        .sort((a, b) => b[k] - a[k] || b.play - a.play);
      panel.innerHTML = `<h2>單件裝備 <small>點欄位排序</small></h2>
        <div class="toolbar"><label>最少場數
          <select id="minGames">${[1, 3, 5, 10, 20, 50].map(n => `<option ${n === settings.minGames ? "selected" : ""}>${n}</option>`).join("")}</select></label>
          <span class="lbl">少於 ${LOW_GAMES} 場的列會變淡</span></div>
        <div class="panel-body">${rows.length ? itemTable(rows, k, true) : `<div class="empty">沒有符合條件的裝備</div>`}</div>`;
      panel.querySelectorAll("th.sortable").forEach(th => th.onclick = () => { settings.itemSort = th.dataset.k; save(); draw(); });
      $("#minGames").onchange = e => { settings.minGames = +e.target.value; save(); draw(); };
    };
    draw();
  }

  function renderBoots(c) {
    $("#bootPanel").innerHTML = `<h2>鞋子</h2><div class="panel-body">${
      c.boots.length ? itemTable([...c.boots].sort((a, b) => b.pick - a.pick), "pick", false) : `<div class="empty">沒有資料</div>`}</div>`;
  }

  function renderStarters(c) {
    const rows = c.starters.slice(0, 3);
    $("#starterPanel").innerHTML = `<h2>起始裝備 <small>前 3 名</small></h2><div class="panel-body">${
      rows.length ? rows.map(b => `<div class="combo">
        <div class="icons">${b.ids.map(id => `<img src="${esc(itemImg(id))}" alt="${esc(itemName(id))}" title="${esc(itemName(id))}">`).join("")}</div>
        <div class="nums"><div class="${winClass(b.win, b.play)}">勝率 ${pct(b.win)}</div><div>${pct(b.pick)} · ${b.play} 場</div></div>
      </div>`).join("") : `<div class="empty">沒有資料</div>`}</div>`;
  }

  // ---- 技能點法
  function renderSkills(c) {
    const sp = c.skills.spells || {};
    const icon = k => sp[k] ? `<img src="${esc(sp[k].image)}" alt="${k}" title="${esc(k + " " + sp[k].name)}">` : `<b>${k}</b>`;
    const grid = order => {
      const cells = ["Q", "W", "E", "R"].map(k => `<div class="k">${k}</div>` +
        [...Array(15)].map((_, i) => `<div class="${order[i] === k ? `on ${k}` : ""}">${i + 1}</div>`).join("")).join("");
      return `<div class="lv">${cells}</div>`;
    };
    const ms = c.skills.masteries.slice(0, 3);
    $("#skillPanel").innerHTML = `<h2>技能點法 <small>主升順序</small></h2><div class="panel-body masts">${
      ms.length ? ms.map(m => {
        const top = m.builds[0];
        return `<div class="mast">
          <div class="mast-head">${[...m.order].map(icon).join('<span class="arrow">›</span>')}
            <div class="nums"><div class="${winClass(m.win, m.play)}">勝率 ${pct(m.win)}</div><div>${pct(m.pick)} · ${m.play} 場</div></div></div>
          ${top ? grid(top.order) : ""}
          ${m.builds.length > 1 ? `<div class="alt">${m.builds.slice(1).map(b =>
            `<span><code>${esc(b.order)}</code> · ${b.play} 場 · 勝率 ${pct(b.win)}</span>`).join("")}</div>` : ""}
        </div>`;
      }).join("") : `<div class="empty">沒有資料</div>`}</div>`;
  }

  boot();
})();
