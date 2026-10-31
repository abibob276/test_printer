// --- STATE MANAGEMENT ---
const db = {
  baza: safeGetStorage("inkassa_baza", []),
  marshrutIds: safeGetStorage("inkassa_marshrut", []),
  tarix: safeGetStorage("inkassa_tarix", []),
};

const bleState = {
  device: null,
  gattServer: null,
  writeCharacteristic: null,
  isConnected: false,
};

const KNOWN_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "0000ffe0-0000-1000-8000-00805f9b34fb",
  "0000ffe1-0000-1000-8000-00805f9b34fb",
  "0000e025-0000-1000-8000-00805f9b34fb",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "00003858-0000-1000-8000-00805f9b34fb",
  "0000ada0-0000-1000-8000-00805f9b34fb",
];

let activeInkassaAtmId = null;
let pendingConfirmAction = null;
let activeInkassaAmount = 0;

// Hozir ochiq turgan swipe kartani kuzatish uchun
let activeSwipeCard = null;

window.onload = function () {
  if (window.Telegram?.WebApp) {
    Telegram.WebApp.ready();
    Telegram.WebApp.expand();
  }
  setupNavigation();
  setupExcelImport();
  renderAllViews();
};

function safeGetStorage(key, defaultVal) {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultVal;
  } catch (e) {
    return defaultVal;
  }
}

function saveData() {
  localStorage.setItem("inkassa_baza", JSON.stringify(db.baza));
  localStorage.setItem("inkassa_marshrut", JSON.stringify(db.marshrutIds));
  localStorage.setItem("inkassa_tarix", JSON.stringify(db.tarix));
  renderAllViews();
}

function showToast(message, type = "success") {
  const toast = document.getElementById("toast-notification");
  if (!toast) return;

  toast.innerText = message;
  toast.className = `toast ${type}`;

  setTimeout(() => {
    toast.classList.add("hidden");
  }, 3500);
}

function showConfirm(msg, yesCallback) {
  document.getElementById("confirm-message").innerText = msg;
  pendingConfirmAction = yesCallback;
  document.getElementById("confirm-modal").classList.remove("hidden");
}

function closeConfirmModal() {
  document.getElementById("confirm-modal").classList.add("hidden");
  pendingConfirmAction = null;
}

document
  .getElementById("confirm-yes-btn")
  .addEventListener("click", function () {
    if (pendingConfirmAction) pendingConfirmAction();
    closeConfirmModal();
  });

function setupNavigation() {
  const navItems = document.querySelectorAll(".nav-item");
  navItems.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-target");
      document
        .querySelectorAll(".nav-item")
        .forEach((i) => i.classList.remove("active"));
      document
        .querySelectorAll(".view")
        .forEach((v) => v.classList.remove("active"));

      btn.classList.add("active");
      document.getElementById(target).classList.add("active");
    });
  });
}

function renderAllViews() {
  renderMarshrutView();
  renderTarixView();
  renderBazaView();
}

// --- 1-OYNA: MARSHRUT ---
function renderMarshrutView() {
  const listEl = document.getElementById("marshrut-list");
  const activeAtms = db.baza.filter(
    (a) =>
      db.marshrutIds.includes(a.id) && !db.tarix.some((t) => t.id === a.id),
  );

  const doneCount = db.marshrutIds.filter((id) =>
    db.tarix.some((t) => t.id === id),
  ).length;

  document.getElementById("m-total").innerText = db.marshrutIds.length;
  document.getElementById("m-done").innerText = doneCount;
  document.getElementById("m-left").innerText = activeAtms.length;

  listEl.innerHTML = "";
  if (activeAtms.length === 0) {
    listEl.innerHTML = `<p style="text-align:center; color:#94a3b8; padding:20px;">Marshrutda bankomatlar mavjud emas.</p>`;
    return;
  }

  activeAtms.forEach((atm) => {
    const card = document.createElement("div");
    card.className = "atm-card";
    card.style.borderLeftColor = atm.color || "#2563eb";
    card.innerHTML = `
      <div class="atm-title">#${atm.id}. ${atm.name}</div>
      <div class="atm-actions-right">
        <button class="btn-icon-action btn-action-broken" title="Nosoz" onclick="markBroken(${atm.id})">
          <i class="fa-solid fa-ban"></i>
        </button>
        <button class="btn-icon-action btn-action-inkassa" title="Inkassa" onclick="openInkassaModal(${atm.id})">
          <i class="fa-solid fa-check"></i>
        </button>
      </div>
    `;
    listEl.appendChild(card);
  });
}

function openSelectModal() {
  const listEl = document.getElementById("select-checkbox-list");
  listEl.innerHTML = "";

  if (db.baza.length === 0) {
    showToast("Avval Baza bo'limida Excel faylini import qiling!", "error");
    return;
  }

  const groups = {};
  db.baza.forEach((atm) => {
    const groupName = atm.group || "Umumiy";
    if (!groups[groupName]) groups[groupName] = [];
    groups[groupName].push(atm);
  });

  Object.keys(groups).forEach((groupName, index) => {
    const groupAtms = groups[groupName];
    const allChecked = groupAtms.every((atm) =>
      db.marshrutIds.includes(atm.id),
    );

    const groupWrapper = document.createElement("div");
    groupWrapper.className = "group-wrapper";

    const groupHeader = document.createElement("div");
    groupHeader.className = "group-header";
    groupHeader.innerHTML = `
      <div class="group-title-area">
        <input type="checkbox" class="group-checkbox" data-group="${groupName}" ${allChecked ? "checked" : ""} onchange="toggleGroupCheck(this, '${groupName}')">
        <strong onclick="toggleGroupAccordion('group-items-${index}', this.closest('.group-wrapper'))" style="cursor:pointer;">📂 ${groupName} (${groupAtms.length} ta)</strong>
      </div>
      <span class="accordion-icon" onclick="toggleGroupAccordion('group-items-${index}', this.closest('.group-wrapper'))">▼</span>
    `;

    const itemsContainer = document.createElement("div");
    itemsContainer.id = `group-items-${index}`;
    itemsContainer.className = "group-items hidden";

    groupAtms.forEach((atm) => {
      const isChecked = db.marshrutIds.includes(atm.id) ? "checked" : "";
      const item = document.createElement("label");
      item.className = "checkbox-item";
      item.innerHTML = `
        <input type="checkbox" class="atm-checkbox" data-group="${groupName}" value="${atm.id}" ${isChecked} onchange="updateGroupCheckboxState('${groupName}')">
        <span style="width:8px; height:8px; border-radius:50%; background:${atm.color}; display:inline-block;"></span>
        <span>#${atm.id}. ${atm.name}</span>
      `;
      itemsContainer.appendChild(item);
    });

    groupWrapper.appendChild(groupHeader);
    groupWrapper.appendChild(itemsContainer);
    listEl.appendChild(groupWrapper);
  });

  document.getElementById("select-modal").classList.remove("hidden");
}

function toggleGroupCheck(groupMasterCb, groupName) {
  const isChecked = groupMasterCb.checked;
  const atmCheckboxes = document.querySelectorAll(
    `.atm-checkbox[data-group="${groupName}"]`,
  );
  atmCheckboxes.forEach((cb) => {
    cb.checked = isChecked;
  });
}

function updateGroupCheckboxState(groupName) {
  const masterCb = document.querySelector(
    `.group-checkbox[data-group="${groupName}"]`,
  );
  const atmCheckboxes = document.querySelectorAll(
    `.atm-checkbox[data-group="${groupName}"]`,
  );
  const allChecked = Array.from(atmCheckboxes).every((cb) => cb.checked);
  if (masterCb) masterCb.checked = allChecked;
}

function toggleGroupAccordion(containerId, targetWrapper) {
  const targetContainer = document.getElementById(containerId);
  const modalContent = document.querySelector("#select-modal .modal-content");
  const isCurrentlyHidden = targetContainer.classList.contains("hidden");

  document
    .querySelectorAll(".group-items")
    .forEach((el) => el.classList.add("hidden"));
  document
    .querySelectorAll(".group-wrapper")
    .forEach((el) => el.classList.remove("open"));

  if (isCurrentlyHidden) {
    targetContainer.classList.remove("hidden");
    targetWrapper.classList.add("open");
    if (modalContent) modalContent.classList.add("expanded");
  } else {
    if (modalContent) modalContent.classList.remove("expanded");
  }
}

function closeSelectModal() {
  const modalContent = document.querySelector("#select-modal .modal-content");
  if (modalContent) modalContent.classList.remove("expanded");
  document.getElementById("select-modal").classList.add("hidden");
}

function saveSelectedMarshrut() {
  const checkboxes = document.querySelectorAll(".atm-checkbox");
  const selected = [];
  checkboxes.forEach((cb) => {
    if (cb.checked) selected.push(parseInt(cb.value));
  });
  db.marshrutIds = selected;
  saveData();
  closeSelectModal();
  showToast("Marshrut muvaffaqiyatli saqlandi", "success");
}

function clearMarshrutData() {
  showConfirm("Bugungi marshrutni tozalamoqchimisiz?", function () {
    db.marshrutIds = [];
    saveData();
    showToast("Marshrut tozalandi", "success");
  });
}

// --- INKASSA & PRINTING LOGIC ---
function openInkassaModal(id) {
  activeInkassaAtmId = id;
  const atm = db.baza.find((a) => a.id === id);
  if (!atm) return;

  document.getElementById("inkassaModalTitle").innerText =
    `#${atm.id}. ${atm.name}`;
  document.getElementById("inkassaAmountInput").value = "";
  document.getElementById("inkassa-modal").classList.remove("hidden");
  document.getElementById("inkassaAmountInput").focus();
}

function closeInkassaModal() {
  document.getElementById("inkassa-modal").classList.add("hidden");
  activeInkassaAtmId = null;
}

function formatMoneyInput(input) {
  let rawValue = input.value.replace(/\D/g, "");
  if (!rawValue) {
    input.value = "";
    return;
  }
  let formattedValue = Number(rawValue)
    .toLocaleString("en-US")
    .replace(/,/g, " ");
  input.value = formattedValue;
}

function processInkassaAmountSubmit() {
  const inputEl = document.getElementById("inkassaAmountInput");
  const rawVal = inputEl.value.replace(/\s/g, "");
  activeInkassaAmount = rawVal ? parseFloat(rawVal) : 0;

  document.getElementById("inkassa-modal").classList.add("hidden");

  if (!activeInkassaAtmId) return;

  if (activeInkassaAmount <= 0) {
    saveInkassaRecord(0, false);
    showToast("Inkassa saqlandi (Summa 0)", "success");
    activeInkassaAtmId = null;
    activeInkassaAmount = 0;
    return;
  }

  const atm = db.baza.find((a) => a.id === activeInkassaAtmId);
  const now = new Date();
  const dateStr = `${String(now.getDate()).padStart(2, "0")}.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()}`;

  document.getElementById("printConfirmInfo").innerHTML = `
    <strong>#${atm.id}. ${atm.name}</strong><br>
    Summa: <b>${activeInkassaAmount.toLocaleString("en-US").replace(/,/g, " ")} so'm</b><br>
    Sana: ${dateStr}
  `;
  document.getElementById("print-confirm-modal").classList.remove("hidden");
}

async function processPrintDecision(shouldPrint) {
  document.getElementById("print-confirm-modal").classList.add("hidden");

  const atm = db.baza.find((a) => a.id === activeInkassaAtmId);
  if (!atm) return;

  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
  const dateStr = `${String(now.getDate()).padStart(2, "0")}.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()}`;

  const record = {
    id: atm.id,
    name: atm.name,
    amount: activeInkassaAmount,
    time: `${dateStr} ${timeStr}`,
    status: "success",
  };

  db.tarix.push(record);
  saveData();

  if (shouldPrint) {
    if (bleState.isConnected) {
      await printReceipt(record);
      showToast("Inkassa saqlandi va chek chop etildi", "success");
    } else {
      showToast("Ma'lumot saqlandi, lekin printer ulanmagan!", "error");
    }
  } else {
    showToast("Inkassa tarixga saqlandi", "success");
  }

  activeInkassaAtmId = null;
  activeInkassaAmount = 0;
}

function saveInkassaRecord(amount, printed) {
  const atm = db.baza.find((a) => a.id === activeInkassaAtmId);
  if (!atm) return;

  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
  const dateStr = `${String(now.getDate()).padStart(2, "0")}.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()}`;

  const record = {
    id: atm.id,
    name: atm.name,
    amount: amount,
    time: `${dateStr} ${timeStr}`,
    status: "success",
  };

  db.tarix.push(record);
  saveData();
}

function markBroken(id) {
  showConfirm("Ushbu bankomatni nosoz deb belgilamoqchimisiz?", function () {
    const atm = db.baza.find((a) => a.id === id);
    if (!atm) return;

    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;

    db.tarix.push({
      id: atm.id,
      name: atm.name,
      amount: 0,
      time: timeStr,
      status: "broken",
    });

    saveData();
    showToast("Bankomat nosoz deb belgilandi", "error");
  });
}

// --- 2-OYNA: TARIX & SWIPE LOGIC ---
function renderTarixView() {
  const listEl = document.getElementById("tarix-list");
  const totalSumEl = document.getElementById("tarix-total-sum");
  const successEl = document.getElementById("tarix-success-count");
  const brokenEl = document.getElementById("tarix-broken-count");

  let totalSum = 0;
  let successCount = 0;
  let brokenCount = 0;

  db.tarix.forEach((item) => {
    if (item.status === "broken") {
      brokenCount++;
    } else {
      successCount++;
      totalSum += item.amount || 0;
    }
  });

  totalSumEl.innerText = `${totalSum.toLocaleString("en-US").replace(/,/g, " ")} so'm`;
  successEl.innerText = successCount;
  brokenEl.innerText = brokenCount;

  listEl.innerHTML = "";
  const reversed = [...db.tarix].reverse();

  reversed.forEach((item) => {
    const isBroken = item.status === "broken";
    const isZeroAmount = !isBroken && (!item.amount || item.amount === 0);

    let cardStatusClass = "success";
    if (isBroken) {
      cardStatusClass = "broken";
    } else if (isZeroAmount) {
      cardStatusClass = "warning";
    }

    // item.time ichidan faqat vaqtni ajratib olamiz (masalan: "31.10.2026 14:30" -> "14:30")
    let displayTime = item.time;
    if (item.time && item.time.includes(" ")) {
      displayTime = item.time.split(" ")[1];
    }

    const wrapper = document.createElement("div");
    wrapper.className = "swipe-wrapper";

    wrapper.innerHTML = `
      <div class="swipe-background">
        <button class="swipe-action-btn swipe-btn-print" title="Chop etish" onclick="confirmReprint(${item.id})">
          <i class="fa-solid fa-print"></i>
        </button>
        <button class="swipe-action-btn swipe-btn-delete" title="O'chirish" onclick="confirmDeleteHistoryItem(${item.id})">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>

      <div class="swipe-card-content tarix-card ${cardStatusClass}">
        <div>
          <div class="atm-title">${displayTime} — #${item.id}. ${item.name}</div>
          ${
            isBroken
              ? `<div style="color:#dc2626; font-size:0.8rem;">Nosoz</div>`
              : isZeroAmount
                ? `<div class="tarix-amount-zero">0 so'm</div>`
                : `<div class="tarix-amount">${(item.amount || 0).toLocaleString("en-US").replace(/,/g, " ")} so'm</div>`
          }
        </div>
        <i class="fa-solid fa-chevron-left" style="color:#cbd5e1; font-size:0.9rem;"></i>
      </div>
    `;

    setupSwipeEvents(wrapper);
    listEl.appendChild(wrapper);
  });
}

function setupSwipeEvents(wrapper) {
  const card = wrapper.querySelector(".swipe-card-content");
  let startX = 0;
  let currentX = 0;
  let isOpened = false;

  card.addEventListener("touchstart", (e) => {
    startX = e.touches[0].clientX;
  });
  card.addEventListener(
    "touchmove",
    (e) => {
      const diffX = e.touches[0].clientX - startX;
      if (!isOpened && diffX < 0) {
        currentX = Math.max(diffX, -120);
        card.style.transform = `translateX(${currentX}px)`;
      } else if (isOpened && diffX > 0) {
        currentX = Math.min(-120 + diffX, 0);
        card.style.transform = `translateX(${currentX}px)`;
      }
    },
    { passive: true },
  );

  card.addEventListener("touchend", () => {
    if (currentX < -50) {
      // Agar boshqa karta ochiq bo'lsa, uni yopish
      if (activeSwipeCard && activeSwipeCard !== card) {
        activeSwipeCard.style.transform = `translateX(0px)`;
        const prevOpenedWrapper = activeSwipeCard.closest(".swipe-wrapper");
        if (prevOpenedWrapper) prevOpenedWrapper.classList.remove("swipe-open");
      }

      card.style.transform = `translateX(-120px)`;
      isOpened = true;
      activeSwipeCard = card;
      wrapper.classList.add("swipe-open");
    } else {
      card.style.transform = `translateX(0px)`;
      isOpened = false;
      wrapper.classList.remove("swipe-open");
      if (activeSwipeCard === card) {
        activeSwipeCard = null;
      }
    }
  });
}
function confirmReprint(id) {
  const item = db.tarix.find((t) => t.id === id);
  if (!item) return;

  showConfirm(
    `<strong>#${item.id}. ${item.name}</strong><br>ushbu chek qayta chop etilsinmi?`,
    function () {
      if (bleState.isConnected) {
        printReceipt(item);
        showToast("Chek qayta chop etilmoqda", "success");
      } else {
        showToast("Printerga ulanmagansiz!", "error");
      }
    },
  );
}

function confirmDeleteHistoryItem(id) {
  const item = db.tarix.find((t) => t.id === id);
  if (!item) return;

  showConfirm(
    `<strong>#${item.id}. ${item.name}</strong><br>ushbu tarix o'chirilsinmi?`,
    function () {
      removeFromTarixAndReturn(id);
    },
  );
}

function removeFromTarixAndReturn(id) {
  db.tarix = db.tarix.filter((t) => t.id !== id);
  if (!db.marshrutIds.includes(id)) {
    db.marshrutIds.push(id);
  }
  saveData();
  showToast("O'chirildi va bankomat marshrutga qaytarildi", "success");
}

// --- 3-OYNA: BAZA & BLUETOOTH & EXCEL ---
function renderBazaView() {
  const listEl = document.getElementById("baza-list");
  document.getElementById("bazaTotalCount").innerText = `${db.baza.length} ta`;

  listEl.innerHTML = "";
  db.baza.forEach((atm) => {
    const card = document.createElement("div");
    card.className = "atm-card";
    card.style.borderLeftColor = atm.color || "#2563eb";
    card.innerHTML = `<div class="atm-title">#${atm.id}. ${atm.name}</div>`;
    listEl.appendChild(card);
  });
}

function triggerFileInput() {
  document.getElementById("excel-file-input").click();
}

function setupExcelImport() {
  document
    .getElementById("excel-file-input")
    .addEventListener("change", function (e) {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = function (evt) {
        try {
          const data = new Uint8Array(evt.target.result);
          const workbook = XLSX.read(data, { type: "array" });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json(sheet);

          db.baza = jsonData.map((item) => ({
            id: item.id,
            name: item.name,
            group: item.group || "Umumiy",
            color: item.color || "#2563eb",
          }));

          saveData();
          showToast("Excel muvaffaqiyatli yuklandi!", "success");
        } catch (err) {
          showToast("Excel faylini o'qishda xatolik!", "error");
        }
      };
      reader.readAsArrayBuffer(file);
      this.value = "";
    });
}

function clearTarixData() {
  showConfirm("Haqiqatan ham tarixni tozalamoqchimisiz?", function () {
    db.tarix = [];
    saveData();
    showToast("Tarix tozalandi", "success");
  });
}

function clearFullBase() {
  showConfirm("Barcha ma'lumotlarni o'chirishni tasdiqlaysizmi?", function () {
    db.baza = [];
    db.marshrutIds = [];
    db.tarix = [];
    saveData();
    showToast("Baza tozalandi", "success");
  });
}

// --- WEB BLUETOOTH LOGIC (YANGI TARjima VA MODAL BILAN) ---
async function toggleBluetoothConnection() {
  if (bleState.isConnected) {
    if (bleState.device && bleState.device.gatt.connected) {
      bleState.device.gatt.disconnect();
    }
    updateBleUI(false);
    showToast("Printer uzildi", "error");
    return;
  }

  const scanningModal = document.getElementById("ble-scanning-modal");

  try {
    // 1. requestDevice chaqirishdan oldin custom modal chiqarish
    scanningModal.classList.remove("hidden");

    bleState.device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: KNOWN_SERVICES,
    });

    // Oynadan qurilma tanlangach, qidiruv modalini yopamiz
    scanningModal.classList.add("hidden");

    bleState.device.addEventListener("gattserverdisconnected", () =>
      updateBleUI(false),
    );

    bleState.gattServer = await bleState.device.gatt.connect();
    const services = await bleState.gattServer.getPrimaryServices();

    for (const s of services) {
      const chars = await s.getCharacteristics();
      for (const c of chars) {
        if (c.properties.write || c.properties.writeWithoutResponse) {
          bleState.writeCharacteristic = c;
          break;
        }
      }
    }

    if (!bleState.writeCharacteristic)
      throw new Error("Yozish kanali topilmadi");

    updateBleUI(true, bleState.device.name);
    showToast("Printer ulandi", "success");
  } catch (err) {
    scanningModal.classList.add("hidden");

    // Xatoliklarni foydalanuvchiga tushunarli tarjimada chiqarish
    const errMsg = err.message || "";
    if (errMsg.includes("User cancelled") || errMsg.includes("canceled")) {
      showToast("Qurilma tanlash bekor qilindi.", "error");
    } else if (
      errMsg.includes("Bluetooth adapter not available") ||
      errMsg.includes("powered off")
    ) {
      showToast("Telefoningizda Bluetooth o'chiq", "error");
    } else {
      showToast(`Ulanishda xatolik: ${err.message}`, "error");
    }

    updateBleUI(false);
  }
}

function updateBleUI(isConnected, name = "") {
  bleState.isConnected = isConnected;
  const quickBadge = document.getElementById("quickBleBadge");
  const quickText = document.getElementById("quickBleText");
  const deviceName = document.getElementById("bleDeviceName");
  const statusText = document.getElementById("bleStatusText");
  const connectBtn = document.getElementById("bleConnectBtn");

  if (isConnected) {
    quickBadge.className = "ble-badge connected";
    quickText.innerText = "Ulangan";
    deviceName.innerText = name || "iTech T1 mini";
    statusText.innerText = "Printer tayyor holatda";
    connectBtn.innerText = "Uzish";
    connectBtn.className = "btn btn-danger";
  } else {
    quickBadge.className = "ble-badge disconnected";
    quickText.innerText = "Ulanmagan";
    deviceName.innerText = "Qurilma ulanmagan";
    statusText.innerText = "Bluetooth qurilmasiga ulaning";
    connectBtn.innerText = "Ulanish";
    connectBtn.className = "btn btn-ble";
  }
}

// --- PRINTING CHEK GENERATION (CANVAS BITMAP) ---
async function printReceipt(record) {
  const canvas = document.getElementById("printCanvas");
  const ctx = canvas.getContext("2d");

  const width = 384;
  const height = 220;

  canvas.width = width;
  canvas.height = height;

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#000000";
  ctx.font = "normal 28px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`#${record.id}. ${record.name}`, width / 2, 40);

  ctx.font = "bold 32px sans-serif";
  ctx.fillText(
    `Summa: ${(record.amount || 0).toLocaleString()} so'm`,
    width / 2,
    85,
  );

  let dateOnly = "";
  if (record.time && typeof record.time === "string") {
    // Agar record.time ichida sana bo'lsa (masalan "31.10.2026 14:30"), birinchi qismini olamiz
    dateOnly = record.time.split(" ")[0];
  }
  // Agar vaqt saqlanganda faqat soat yozilgan bo'lsa, bugungi sanani olamiz
  if (!dateOnly || !dateOnly.includes(".") || dateOnly === "undefined") {
    const now = new Date();
    dateOnly = `${String(now.getDate()).padStart(2, "0")}.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()}`;
  }

  ctx.font = "normal 24px sans-serif";
  ctx.fillText(`Sana: ${dateOnly}`, width / 2, 125);

  const bytes = convertCanvasToEscPosRaster(ctx, width, height);
  await sendBytesInChunks(bytes);
}

function convertCanvasToEscPosRaster(ctx, width, height) {
  const imgData = ctx.getImageData(0, 0, width, height);
  const pixels = imgData.data;
  const widthBytes = Math.ceil(width / 8);
  const cmd = [0x1b, 0x40, 0x1d, 0x76, 0x30, 0];
  cmd.push(widthBytes & 0xff, (widthBytes >> 8) & 0xff);
  cmd.push(height & 0xff, (height >> 8) & 0xff);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < widthBytes; x++) {
      let byteVal = 0;
      for (let bit = 0; bit < 8; bit++) {
        const pixelX = x * 8 + bit;
        if (pixelX < width) {
          const offset = (y * width + pixelX) * 4;
          const lum =
            0.299 * pixels[offset] +
            0.587 * pixels[offset + 1] +
            0.114 * pixels[offset + 2];
          if (lum < 128) byteVal |= 0x80 >> bit;
        }
      }
      cmd.push(byteVal);
    }
  }
  return new Uint8Array(cmd);
}

async function sendBytesInChunks(bytes) {
  if (!bleState.writeCharacteristic) return;
  const chunkSize = 100;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, i + chunkSize);
    if (bleState.writeCharacteristic.properties.writeWithoutResponse) {
      await bleState.writeCharacteristic.writeValueWithoutResponse(chunk);
    } else {
      await bleState.writeCharacteristic.writeValue(chunk);
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}
