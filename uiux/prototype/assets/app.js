/* ============================================================
   资源管理原型 — 共享脚本：图标 / 导航壳 / Tabs / 菜单 / 对话框 / Toast
   ============================================================ */

/* ---------- lucide 图标（与现有产品同源） ---------- */
const ICONS = {
  "shield-check": '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1 1 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  "bar-chart": '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  "search-check": '<path d="m8 11 2 2 4-4"/><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',
  "user-search": '<circle cx="10" cy="8" r="5"/><path d="M2 21a8 8 0 0 1 10.43-7.62"/><circle cx="18" cy="18" r="3"/><path d="m22 22-1.9-1.9"/>',
  "clipboard": '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
  bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
  workflow: '<rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
  scale: '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  ellipsis: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  play: '<path d="m6 3 14 9-14 9z"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  "chevron-right": '<path d="m9 18 6-6-6-6"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  "arrow-left": '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  "arrow-right": '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  "alert-triangle": '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  "book-open": '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
  server: '<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01"/><path d="M6 18h.01"/>',
  sparkles: '<path d="M9.94 15.5 8.5 14.06 2.36 12.48a.5.5 0 0 1 0-.96L8.5 9.94l1.44-6.14a.5.5 0 0 1 .96 0l1.44 6.14 6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58-1.44 6.14a.5.5 0 0 1-.96 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  "git-branch": '<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  layers: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/>',
  flask: '<path d="M10 2v7.53a2 2 0 0 1-.21.9L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.07-10.13a2 2 0 0 1-.21-.89V2"/><path d="M8.5 2h7"/><path d="M7 16h10"/>',
  package: '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><path d="m3.3 7 8.7 5 8.7-5"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  eye: '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
  "file-json": '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
};

function icon(name, cls = "ic") {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}

/* ---------- 导航壳 ---------- */
const RAIL_GROUPS = [
  {
    items: [
      { label: "质量概览", short: "概览", icon: "bar-chart", href: "#", off: true },
      { label: "质检结果", short: "结果", icon: "search-check", href: "#", off: true },
      { label: "坐席分析", short: "坐席", icon: "user-search", href: "#", off: true },
    ],
  },
  {
    items: [
      { label: "分析任务", short: "任务", icon: "clipboard", href: "#", off: true },
      { label: "Agents", short: "Agents", icon: "bot", href: "#", off: true },
      { label: "工作流", short: "工作流", icon: "workflow", href: "#", off: true },
      { label: "AI Resources", short: "AI资源", icon: "cpu", href: "ai-resources.html" },
      { label: "Data Resources", short: "数据资源", icon: "database", href: "data-resources.html" },
      { label: "结果规则", short: "规则", icon: "scale", href: "#", off: true },
    ],
  },
  {
    items: [{ label: "连接", short: "连接", icon: "plug", href: "#", off: true }],
  },
];

function mountShell(activeHref) {
  const rail = document.createElement("aside");
  rail.className = "rail";
  rail.innerHTML =
    `<div class="rail-logo"><div>${icon("shield-check", "ic-lg")}</div></div>` +
    RAIL_GROUPS.map(
      (g) =>
        `<div class="rail-group">${g.items
          .map((it) => {
            const isActive = it.href === activeHref;
            const cls = "rail-item" + (isActive ? " active" : "") + (it.off ? " off" : "");
            const title = it.off ? `${it.label}（不在本原型范围）` : it.label;
            return `<a class="${cls}" href="${it.off ? "javascript:void(0)" : it.href}" title="${title}">${icon(it.icon, "ic-lg")}<span>${it.short}</span></a>`;
          })
          .join("")}</div>`,
    ).join("");

  const shell = document.createElement("div");
  shell.className = "shell";
  const main = document.createElement("div");
  main.className = "main";
  main.innerHTML = `<header class="topbar"><nav class="crumbs" id="crumbs"></nav></header>`;
  const content = document.getElementById("content");
  main.appendChild(content);
  shell.appendChild(rail);
  shell.appendChild(main);
  document.body.prepend(shell);

  const toasts = document.createElement("div");
  toasts.className = "toasts";
  toasts.id = "toasts";
  document.body.appendChild(toasts);
}

function setCrumbs(items) {
  const el = document.getElementById("crumbs");
  el.innerHTML = items
    .map((it, i) => {
      const last = i === items.length - 1;
      const node = last || !it.href ? `<span class="cur">${it.label}</span>` : `<a href="${it.href}">${it.label}</a>`;
      return i === 0 ? node : `<span class="sep">${icon("chevron-right", "ic-sm")}</span>${node}`;
    })
    .join("");
}

/* ---------- Tabs ---------- */
function initTabs(root) {
  root.querySelectorAll("[data-tab-group]").forEach((group) => {
    group.addEventListener("click", (e) => {
      const tab = e.target.closest(".tab");
      if (!tab) return;
      const scope = tab.closest("[data-tab-scope]");
      scope.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
      const key = tab.dataset.tab;
      scope.querySelectorAll("[data-pane]").forEach((p) => {
        p.style.display = p.dataset.pane === key ? "" : "none";
      });
    });
  });
}

/* ---------- Dropdown menus ---------- */
let openMenu = null;
function closeMenus() {
  document.querySelectorAll(".menu.open").forEach((m) => m.classList.remove("open"));
  document.querySelectorAll(".rc-menu-btn.open").forEach((b) => b.classList.remove("open"));
  openMenu = null;
}
function initMenus() {
  document.addEventListener("click", (e) => {
    const trigger = e.target.closest("[data-menu-trigger]");
    if (trigger) {
      e.stopPropagation();
      const menu = trigger.parentElement.querySelector(".menu");
      const wasOpen = menu.classList.contains("open");
      closeMenus();
      if (!wasOpen) {
        menu.classList.add("open");
        trigger.classList.add("open");
        openMenu = menu;
      }
      return;
    }
    if (!e.target.closest(".menu")) closeMenus();
  });
}

/* ---------- Dialog ---------- */
function openDialog(id) {
  const d = document.getElementById(id);
  if (d) d.classList.add("open");
}
function closeDialog(id) {
  const d = document.getElementById(id);
  if (d) d.classList.remove("open");
}
function initDialogs() {
  document.querySelectorAll(".overlay").forEach((ov) => {
    ov.addEventListener("click", (e) => {
      if (e.target === ov) ov.classList.remove("open");
    });
    ov.querySelectorAll("[data-close]").forEach((b) =>
      b.addEventListener("click", () => ov.classList.remove("open")),
    );
  });
}

/* ---------- Toast ---------- */
function toast(msg, kind = "info", iconName) {
  const box = document.getElementById("toasts");
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.innerHTML = `${icon(iconName || (kind === "success" ? "check" : kind === "error" ? "alert-triangle" : "info"), "ic")}<div>${msg}</div>`;
  box.appendChild(t);
  setTimeout(() => {
    t.style.transition = "opacity .3s";
    t.style.opacity = "0";
    setTimeout(() => t.remove(), 300);
  }, 2800);
}

/* ---------- 模拟异步测试 ---------- */
function fakeRun(btn, ms, done) {
  const html = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> 执行中…`;
  setTimeout(() => {
    btn.disabled = false;
    btn.innerHTML = html;
    done();
  }, ms);
}

/* ---------- boot ---------- */
document.addEventListener("DOMContentLoaded", () => {
  // 静态图标占位符：<i data-ic="name" data-cls="ic ic-sm"></i>
  document.querySelectorAll("[data-ic]").forEach((el) => {
    el.outerHTML = icon(el.dataset.ic, el.dataset.cls || "ic");
  });
  const active = document.body.dataset.active || "";
  mountShell(active);
  const crumbs = JSON.parse(document.body.dataset.crumbs || "[]");
  setCrumbs(crumbs);
  initTabs(document);
  initMenus();
  initDialogs();
});
