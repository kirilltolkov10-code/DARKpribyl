import "./style.css";

const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const app = document.querySelector("#app");
let operations = [];
let busy = false;

const money = (value) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Number(value)) + " ₽";

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));
}

function authHeaders() {
  const initData = tg?.initData;
  if (!initData) throw new Error("Открой приложение через Telegram, чтобы войти.");
  return { "Content-Type": "application/json", "X-Telegram-Init-Data": initData };
}

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...authHeaders(), ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Не удалось выполнить запрос");
  return data;
}

function render() {
  const income = operations.filter(x => x.kind === "income").reduce((s, x) => s + Number(x.amount), 0);
  const expenses = operations.filter(x => x.kind === "expense").reduce((s, x) => s + Number(x.amount), 0);
  const profit = income - expenses;
  const user = tg?.initDataUnsafe?.user;
  const greeting = user?.first_name ? `, ${escapeHtml(user.first_name)}` : "";

  app.innerHTML = `
    <main class="shell">
      <header class="top">
        <div>
          <div class="brand">DARK<span>прибыль</span></div>
          <div class="muted">ФИНАНСОВАЯ ПАНЕЛЬ${greeting}</div>
        </div>
        <div class="status"><i></i> LIVE</div>
      </header>

      <section class="hero">
        <div class="eyebrow">ЧИСТЫЙ ФИНАНСОВЫЙ РЕЗУЛЬТАТ</div>
        <div class="profit">${money(profit)}</div>
        <div class="muted">Доходы минус расходы</div>
      </section>

      <section class="stats">
        <article class="stat">
          <div class="muted">Доходы</div>
          <strong class="green">${money(income)}</strong>
        </article>
        <article class="stat">
          <div class="muted">Расходы</div>
          <strong>${money(expenses)}</strong>
        </article>
      </section>

      <section class="panel">
        <div class="section-title">Новая операция</div>
        <form id="operation-form">
          <div class="switch">
            <button type="button" class="choice active" data-kind="income">Доход</button>
            <button type="button" class="choice" data-kind="expense">Расход</button>
          </div>
          <input name="title" maxlength="80" placeholder="Название операции" required />
          <input name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="Сумма в рублях" required />
          <button class="primary" type="submit" ${busy ? "disabled" : ""}>＋ Добавить операцию</button>
        </form>
        <div id="message" class="message"></div>
      </section>

      <section class="panel">
        <div class="section-title">История операций <span class="count">${operations.length}</span></div>
        <div class="history">
          ${operations.length ? operations.map(item => `
            <div class="operation">
              <div class="op-icon ${item.kind}">${item.kind === "income" ? "＋" : "−"}</div>
              <div class="op-main">
                <strong>${escapeHtml(item.title)}</strong>
                <small>${new Date(item.created_at).toLocaleString("ru-RU")}</small>
              </div>
              <strong class="${item.kind === "income" ? "green" : ""}">${item.kind === "income" ? "+" : "−"}${money(item.amount)}</strong>
              <button class="delete" data-delete="${item.id}" aria-label="Удалить">×</button>
            </div>`).join("") : `<div class="empty">Операций пока нет</div>`}
        </div>
      </section>
      <footer>Данные сохраняются в вашей базе и привязаны к Telegram ID.</footer>
    </main>`;

  let selectedKind = "income";
  app.querySelectorAll("[data-kind]").forEach(button => {
    button.addEventListener("click", () => {
      selectedKind = button.dataset.kind;
      app.querySelectorAll("[data-kind]").forEach(b => b.classList.toggle("active", b === button));
    });
  });

  app.querySelector("#operation-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") || "").trim();
    const amount = Number(form.get("amount"));
    if (!title || !Number.isFinite(amount) || amount <= 0) return showMessage("Проверьте название и сумму");
    setBusy(true);
    try {
      await api("/api/operations", {
        method: "POST",
        body: JSON.stringify({ title, amount, kind: selectedKind })
      });
      await loadOperations();
      tg?.HapticFeedback?.notificationOccurred("success");
    } catch (error) {
      showMessage(error.message);
    } finally {
      setBusy(false);
    }
  });

  app.querySelectorAll("[data-delete]").forEach(button => {
    button.addEventListener("click", async () => {
      if (!confirm("Удалить эту операцию?")) return;
      try {
        await api(`/api/operations/${button.dataset.delete}`, { method: "DELETE" });
        await loadOperations();
      } catch (error) { showMessage(error.message); }
    });
  });
}

function showMessage(message) {
  const el = app.querySelector("#message");
  if (el) el.textContent = message;
}

function setBusy(value) {
  busy = value;
  const button = app.querySelector(".primary");
  if (button) button.disabled = value;
}

async function loadOperations() {
  const data = await api("/api/operations");
  operations = data.operations;
  render();
}

if (!tg?.initData) {
  app.innerHTML = `<main class="shell"><div class="brand">DARK<span>прибыль</span></div><section class="hero"><h2>Открой приложение в Telegram</h2><p class="muted">Для безопасного входа необходимо запустить Mini App из кнопки Telegram-бота.</p></section></main>`;
} else {
  loadOperations().catch(error => {
    app.innerHTML = `<main class="shell"><div class="brand">DARK<span>прибыль</span></div><p class="message">${escapeHtml(error.message)}</p></main>`;
  });
}
