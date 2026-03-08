"use strict";

const DB_NAME = "bookJournalDB";
const DB_VERSION = 1;
const STORE_NAME = "books";
const BACKUP_PREFIX = "BOOKJOURNAL1:";
const MAX_PHOTO_COUNT = 10;
const TARGET_PHOTO_BYTES = 1024 * 1024;

const state = {
  books: [],
  editingBookId: null,
  draftPhotos: [],
  currentView: "list",
  toastTimer: null,
  swRegistration: null,
  swUpdateReady: false,
  swControllerChanged: false
};

let dbPromise = null;

const elements = {
  backButton: document.getElementById("backButton"),
  headerTitle: document.getElementById("headerTitle"),
  topActions: document.getElementById("topActions"),
  addBookButton: document.getElementById("addBookButton"),
  checkUpdateButton: document.getElementById("checkUpdateButton"),
  openSettingsButton: document.getElementById("openSettingsButton"),
  listView: document.getElementById("listView"),
  formView: document.getElementById("formView"),
  settingsView: document.getElementById("settingsView"),
  bookListContainer: document.getElementById("bookListContainer"),
  emptyMessage: document.getElementById("emptyMessage"),
  bookForm: document.getElementById("bookForm"),
  formTitle: document.getElementById("formTitle"),
  formError: document.getElementById("formError"),
  startDateInput: document.getElementById("startDateInput"),
  endDateInput: document.getElementById("endDateInput"),
  titleInput: document.getElementById("titleInput"),
  authorInput: document.getElementById("authorInput"),
  reviewInput: document.getElementById("reviewInput"),
  photoInput: document.getElementById("photoInput"),
  photoPreviewList: document.getElementById("photoPreviewList"),
  deleteFromFormButton: document.getElementById("deleteFromFormButton"),
  backupOutput: document.getElementById("backupOutput"),
  generateBackupButton: document.getElementById("generateBackupButton"),
  copyBackupButton: document.getElementById("copyBackupButton"),
  restoreInput: document.getElementById("restoreInput"),
  restoreButton: document.getElementById("restoreButton"),
  settingsError: document.getElementById("settingsError"),
  updatePanel: document.getElementById("updatePanel"),
  updateStatusText: document.getElementById("updateStatusText"),
  applyUpdateButton: document.getElementById("applyUpdateButton"),
  toast: document.getElementById("toast")
};

document.addEventListener("DOMContentLoaded", () => {
  attachEvents();
  initializeApp().catch((error) => {
    console.error(error);
    showToast("初期化で問題が発生しました");
  });
});

async function initializeApp() {
  showView("list");
  await refreshBooks();
  await registerServiceWorker();
}

function attachEvents() {
  elements.backButton.addEventListener("click", () => {
    showView("list");
  });

  elements.addBookButton.addEventListener("click", () => {
    openFormForCreate();
  });

  elements.openSettingsButton.addEventListener("click", async () => {
    showView("settings");
    await refreshUpdatePanel();
  });

  elements.checkUpdateButton.addEventListener("click", async () => {
    await checkForUpdateFromTopButton();
  });

  elements.bookListContainer.addEventListener("click", (event) => {
    const row = event.target.closest(".book-row");
    if (!row) {
      return;
    }
    const id = row.dataset.id;
    if (!id) {
      return;
    }
    const book = findBookById(id);
    if (!book) {
      showToast("対象の記録が見つかりません");
      return;
    }
    openFormForEdit(book);
  });

  elements.bookForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveForm();
  });

  elements.deleteFromFormButton.addEventListener("click", async () => {
    await deleteFromForm();
  });

  elements.photoInput.addEventListener("change", async () => {
    await addSelectedPhotos();
  });

  elements.photoPreviewList.addEventListener("click", (event) => {
    const button = event.target.closest(".remove-photo-button");
    if (!button) {
      return;
    }
    const photoId = button.dataset.photoId;
    if (!photoId) {
      return;
    }
    state.draftPhotos = state.draftPhotos.filter((photo) => photo.id !== photoId);
    renderPhotoPreviewList();
  });

  elements.generateBackupButton.addEventListener("click", () => {
    generateBackupText();
  });

  elements.copyBackupButton.addEventListener("click", async () => {
    await copyBackupText();
  });

  elements.restoreButton.addEventListener("click", async () => {
    await restoreFromText();
  });

  elements.applyUpdateButton.addEventListener("click", async () => {
    await applyServiceWorkerUpdate();
  });
}

function showView(viewName) {
  state.currentView = viewName;

  const visibilityMap = {
    list: elements.listView,
    form: elements.formView,
    settings: elements.settingsView
  };

  Object.keys(visibilityMap).forEach((key) => {
    const view = visibilityMap[key];
    if (key === viewName) {
      view.classList.remove("hidden");
    } else {
      view.classList.add("hidden");
    }
  });

  const isList = viewName === "list";
  elements.topActions.classList.toggle("hidden", !isList);
  elements.backButton.classList.toggle("hidden", isList);
  elements.headerTitle.classList.remove("home-title");

  if (viewName === "list") {
    elements.headerTitle.textContent = "\u{1F516} \u4F59\u767D\u306E\u6809";
    elements.headerTitle.classList.add("home-title");
  } else if (viewName === "form") {
    elements.headerTitle.textContent = state.editingBookId ? "記録を編集" : "新しい記録";
  } else if (viewName === "settings") {
    elements.headerTitle.textContent = "設定";
  }
}

function openFormForCreate() {
  state.editingBookId = null;
  state.draftPhotos = [];
  elements.bookForm.reset();
  elements.formTitle.textContent = "新しい記録";
  elements.deleteFromFormButton.classList.add("hidden");
  clearFormError();
  renderPhotoPreviewList();
  showView("form");
}

function openFormForEdit(book) {
  state.editingBookId = book.id;
  state.draftPhotos = clonePhotos(book.photos);
  elements.formTitle.textContent = "記録を編集";
  elements.deleteFromFormButton.classList.remove("hidden");
  clearFormError();

  elements.startDateInput.value = book.startDate || "";
  elements.endDateInput.value = book.endDate || "";
  elements.titleInput.value = book.title || "";
  elements.authorInput.value = book.author || "";
  elements.reviewInput.value = book.review || "";
  elements.photoInput.value = "";

  renderPhotoPreviewList();
  showView("form");
}

async function saveForm() {
  clearFormError();

  const startDate = normalizeDateString(elements.startDateInput.value);
  const endDate = normalizeDateString(elements.endDateInput.value);
  const title = elements.titleInput.value.trim();
  const author = elements.authorInput.value.trim();
  const review = elements.reviewInput.value.trim();

  if (!startDate) {
    showFormError("読み始めた日を入力してください。");
    return;
  }
  if (!title) {
    showFormError("題名を入力してください。");
    return;
  }
  if (endDate && endDate < startDate) {
    showFormError("読み終わった日は、読み始めた日以降を指定してください。");
    return;
  }
  if (state.draftPhotos.length > MAX_PHOTO_COUNT) {
    showFormError("写真は最大10枚です。");
    return;
  }

  const now = Date.now();
  const existing = findBookById(state.editingBookId);
  const book = {
    id: existing ? existing.id : createId(),
    startDate,
    endDate,
    title: title.slice(0, 120),
    author: author.slice(0, 120),
    review: review.slice(0, 8000),
    photos: clonePhotos(state.draftPhotos).slice(0, MAX_PHOTO_COUNT),
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now
  };

  await dbPut(book);
  await refreshBooks();
  showToast("保存しました");
  showView("list");
}

async function deleteFromForm() {
  if (!state.editingBookId) {
    return;
  }
  const target = findBookById(state.editingBookId);
  if (!target) {
    showToast("削除対象が見つかりません");
    return;
  }

  const ok = window.confirm(`「${target.title}」を削除しますか？この操作は取り消せません。`);
  if (!ok) {
    return;
  }

  await dbDelete(target.id);
  await refreshBooks();
  showToast("削除しました");
  showView("list");
}

async function addSelectedPhotos() {
  const files = Array.from(elements.photoInput.files || []);
  elements.photoInput.value = "";

  if (files.length === 0) {
    return;
  }

  const allowed = MAX_PHOTO_COUNT - state.draftPhotos.length;
  if (allowed <= 0) {
    showToast("写真は最大10枚までです");
    return;
  }

  const targets = files.slice(0, allowed);
  if (files.length > targets.length) {
    showToast("10枚を超える分は追加されません");
  }

  for (const file of targets) {
    if (!file.type.startsWith("image/")) {
      showToast("画像ファイルのみ追加できます");
      continue;
    }
    try {
      const compressed = await compressImage(file, TARGET_PHOTO_BYTES);
      state.draftPhotos.push(compressed);
    } catch (error) {
      console.error(error);
      showToast("写真の処理に失敗しました");
    }
  }

  renderPhotoPreviewList();
}

function renderPhotoPreviewList() {
  elements.photoPreviewList.innerHTML = "";

  if (state.draftPhotos.length === 0) {
    const empty = document.createElement("li");
    empty.className = "photo-empty";
    empty.textContent = "写真はまだありません。";
    elements.photoPreviewList.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  state.draftPhotos.forEach((photo) => {
    const item = document.createElement("li");
    item.className = "photo-preview-item";

    const image = document.createElement("img");
    image.src = photo.dataUrl;
    image.alt = "写真プレビュー";
    image.loading = "lazy";

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "remove-photo-button";
    removeButton.dataset.photoId = photo.id;
    removeButton.setAttribute("aria-label", "写真を削除");
    removeButton.textContent = "×";

    item.appendChild(image);
    item.appendChild(removeButton);
    fragment.appendChild(item);
  });

  elements.photoPreviewList.appendChild(fragment);
}

async function refreshBooks() {
  const books = await dbGetAll();
  state.books = sortBooks(books);
  renderBookList();
}

function renderBookList() {
  elements.bookListContainer.innerHTML = "";

  if (state.books.length === 0) {
    elements.emptyMessage.classList.remove("hidden");
    return;
  }
  elements.emptyMessage.classList.add("hidden");

  const fragment = document.createDocumentFragment();
  let previousYear = "";

  state.books.forEach((book) => {
    const year = extractYear(book.startDate);
    if (year !== previousYear) {
      const yearHeading = document.createElement("h2");
      yearHeading.className = "year-heading";
      yearHeading.textContent = `${year}年`;
      fragment.appendChild(yearHeading);
      previousYear = year;
    }

    const row = document.createElement("button");
    row.type = "button";
    row.className = "book-row";
    row.dataset.id = book.id;
    row.setAttribute("aria-label", `${book.title}を編集`);

    const startDate = document.createElement("div");
    startDate.className = "book-start-date";
    const startDateMain = document.createElement("div");
    startDateMain.className = "book-start-date-main";
    startDateMain.textContent = formatDateForDisplay(book.startDate);

    const startDateSub = document.createElement("div");
    startDateSub.className = "book-start-date-sub";
    startDateSub.textContent = calculateDaysText(book.startDate, book.endDate);
    startDate.appendChild(startDateMain);
    startDate.appendChild(startDateSub);

    const meta = document.createElement("div");
    meta.className = "book-meta";

    const title = document.createElement("p");
    title.className = "book-title";
    title.textContent = book.title || "題名未入力";

    const author = document.createElement("p");
    author.className = "book-author";
    author.textContent = book.author || "著者未入力";

    meta.appendChild(title);
    meta.appendChild(author);

    row.appendChild(startDate);
    row.appendChild(meta);

    fragment.appendChild(row);
  });

  elements.bookListContainer.appendChild(fragment);
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.remove("hidden");

  if (state.toastTimer) {
    window.clearTimeout(state.toastTimer);
  }
  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.add("hidden");
  }, 2300);
}

function clearFormError() {
  elements.formError.textContent = "";
  elements.formError.classList.add("hidden");
}

function showFormError(message) {
  elements.formError.textContent = message;
  elements.formError.classList.remove("hidden");
}

function clearSettingsError() {
  elements.settingsError.textContent = "";
  elements.settingsError.classList.add("hidden");
}

function showSettingsError(message) {
  elements.settingsError.textContent = message;
  elements.settingsError.classList.remove("hidden");
}

function findBookById(id) {
  if (!id) {
    return null;
  }
  return state.books.find((book) => book.id === id) || null;
}

function sortBooks(books) {
  return [...books].sort((a, b) => {
    const aStart = a.startDate || "";
    const bStart = b.startDate || "";
    if (aStart !== bStart) {
      return aStart < bStart ? 1 : -1;
    }
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}

function extractYear(dateText) {
  if (!dateText || dateText.length < 4) {
    return "不明";
  }
  return dateText.slice(0, 4);
}

function formatDateForDisplay(dateText) {
  if (!dateText) {
    return "未入力";
  }
  const [year, month, day] = dateText.split("-");
  if (!year || !month || !day) {
    return dateText;
  }
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  if (!Number.isInteger(monthNumber) || !Number.isInteger(dayNumber)) {
    return dateText;
  }
  return `${monthNumber}/${dayNumber}`;
}

function calculateDaysText(startDate, endDate) {
  if (!startDate) {
    return "-";
  }
  if (!endDate) {
    return "読書中";
  }

  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return "日付エラー";
  }
  const msPerDay = 24 * 60 * 60 * 1000;
  const days = Math.floor((end - start) / msPerDay) + 1;
  return `${days}日`;
}

function createId() {
  if (window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeDateString(value) {
  if (typeof value !== "string") {
    return "";
  }
  const text = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) {
    return "";
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(year, month - 1, day);
  if (
    check.getFullYear() !== year ||
    check.getMonth() !== month - 1 ||
    check.getDate() !== day
  ) {
    return "";
  }
  return text;
}

function clonePhotos(photos) {
  if (!Array.isArray(photos)) {
    return [];
  }
  return photos
    .map((photo) => {
      if (!photo || typeof photo.dataUrl !== "string") {
        return null;
      }
      return {
        id: typeof photo.id === "string" && photo.id ? photo.id : createId(),
        dataUrl: photo.dataUrl
      };
    })
    .filter(Boolean);
}

async function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(String(reader.result || ""));
    };
    reader.onerror = () => {
      reject(new Error("FileReader error"));
    };
    reader.readAsDataURL(file);
  });
}

async function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image load error"));
    image.src = source;
  });
}

function estimateDataUrlBytes(dataUrl) {
  const base64 = (dataUrl.split(",")[1] || "").replace(/\s/g, "");
  return Math.floor((base64.length * 3) / 4);
}

async function compressImage(file, targetBytes) {
  const source = await readFileAsDataURL(file);
  const image = await loadImage(source);

  const maxEdge = 2200;
  let width = image.naturalWidth;
  let height = image.naturalHeight;
  const longerEdge = Math.max(width, height);
  if (longerEdge > maxEdge) {
    const ratio = maxEdge / longerEdge;
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    throw new Error("Canvas is not available");
  }

  let quality = 0.9;
  let output = "";

  for (let i = 0; i < 12; i += 1) {
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    output = canvas.toDataURL("image/jpeg", quality);
    const size = estimateDataUrlBytes(output);
    if (size <= targetBytes) {
      break;
    }

    if (quality > 0.55) {
      quality -= 0.1;
    } else {
      width *= 0.85;
      height *= 0.85;
      quality = 0.85;
    }
  }

  return {
    id: createId(),
    dataUrl: output
  };
}

function encodeUtf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function decodeBase64ToUtf8(base64) {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function generateBackupText() {
  clearSettingsError();
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    books: state.books
  };
  const json = JSON.stringify(payload);
  const backup = `${BACKUP_PREFIX}${encodeUtf8ToBase64(json)}`;
  elements.backupOutput.value = backup;
  showToast("バックアップ文字列を作成しました");
}

async function copyBackupText() {
  const text = elements.backupOutput.value.trim();
  if (!text) {
    showToast("先にバックアップ文字列を作成してください");
    return;
  }

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      elements.backupOutput.focus();
      elements.backupOutput.select();
      document.execCommand("copy");
      elements.backupOutput.setSelectionRange(0, 0);
    }
    showToast("バックアップ文字列をコピーしました");
  } catch (error) {
    console.error(error);
    showToast("コピーに失敗しました");
  }
}

function parseBackupText(raw) {
  const text = raw.trim();
  if (!text.startsWith(BACKUP_PREFIX)) {
    throw new Error("先頭が BOOKJOURNAL1: ではありません。");
  }

  const encoded = text.slice(BACKUP_PREFIX.length).trim();
  if (!encoded) {
    throw new Error("バックアップ文字列が空です。");
  }

  let decoded = "";
  try {
    decoded = decodeBase64ToUtf8(encoded);
  } catch (_error) {
    throw new Error("Base64の復号に失敗しました。文字列が壊れている可能性があります。");
  }

  let parsed = null;
  try {
    parsed = JSON.parse(decoded);
  } catch (_error) {
    throw new Error("JSONの解析に失敗しました。");
  }

  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.books)) {
    throw new Error("対応していないバックアップ形式です。");
  }

  return parsed.books.map((book, index) => sanitizeBook(book, index));
}

function sanitizeBook(raw, index) {
  if (!raw || typeof raw !== "object") {
    throw new Error(`${index + 1}件目のデータ形式が不正です。`);
  }

  const startDate = normalizeDateString(String(raw.startDate || ""));
  const endDate = normalizeDateString(String(raw.endDate || ""));
  const title = String(raw.title || "").trim();
  const author = String(raw.author || "").trim();
  const review = String(raw.review || "").trim();

  if (!startDate) {
    throw new Error(`${index + 1}件目: 読み始めた日が不正です。`);
  }
  if (!title) {
    throw new Error(`${index + 1}件目: 題名が空です。`);
  }
  if (endDate && endDate < startDate) {
    throw new Error(`${index + 1}件目: 日付の前後関係が不正です。`);
  }

  const normalizedPhotos = clonePhotos(raw.photos).slice(0, MAX_PHOTO_COUNT);
  const now = Date.now();

  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : createId(),
    startDate,
    endDate,
    title: title.slice(0, 120),
    author: author.slice(0, 120),
    review: review.slice(0, 8000),
    photos: normalizedPhotos,
    createdAt: Number.isFinite(raw.createdAt) ? Number(raw.createdAt) : now,
    updatedAt: Number.isFinite(raw.updatedAt) ? Number(raw.updatedAt) : now
  };
}

async function restoreFromText() {
  clearSettingsError();
  const source = elements.restoreInput.value;
  if (!source.trim()) {
    showSettingsError("復元用文字列を入力してください。");
    return;
  }

  let books = [];
  try {
    books = parseBackupText(source);
  } catch (error) {
    showSettingsError(error.message);
    return;
  }

  const ok = window.confirm(
    `現在の記録 ${state.books.length} 件を削除し、バックアップ ${books.length} 件で全置換えします。よろしいですか？`
  );
  if (!ok) {
    return;
  }

  await dbReplaceAll(books);
  await refreshBooks();
  showToast("復元しました");
  showView("list");
}

async function openDb() {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("startDate", "startDate", { unique: false });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error || new Error("IndexedDBを開けませんでした"));
    };
  });

  return dbPromise;
}

async function dbGetAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error("読み込みに失敗しました"));
  });
}

async function dbPut(book) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("保存に失敗しました"));
    const store = transaction.objectStore(STORE_NAME);
    store.put(book);
  });
}

async function dbDelete(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("削除に失敗しました"));
    transaction.objectStore(STORE_NAME).delete(id);
  });
}

async function dbReplaceAll(books) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("復元に失敗しました"));

    store.clear();
    books.forEach((book) => {
      store.put(book);
    });
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    setUpdatePanelState(false, "このブラウザは更新機能に対応していません。");
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register("./sw.js");
    state.swRegistration = registration;

    if (registration.waiting) {
      setUpdatePanelState(true, "新しいバージョンを利用できます。");
    } else {
      setUpdatePanelState(false, "現在は最新です");
    }

    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      if (!worker) {
        return;
      }

      setUpdatePanelState(false, "更新をダウンロード中です。");
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          setUpdatePanelState(true, "新しいバージョンを利用できます。");
          showToast("更新が利用可能です");
        } else if (worker.state === "activated") {
          setUpdatePanelState(false, "現在は最新です");
        }
      });
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (state.swControllerChanged) {
        return;
      }
      state.swControllerChanged = true;
      window.location.reload();
    });

    await refreshUpdatePanel();
  } catch (error) {
    console.error(error);
    setUpdatePanelState(false, "更新機能の初期化に失敗しました。");
  }
}

function setUpdatePanelState(isReady, statusText) {
  state.swUpdateReady = isReady;
  elements.updateStatusText.textContent = statusText;
  elements.applyUpdateButton.disabled = !isReady;
  elements.updatePanel.classList.toggle("highlight", isReady);
}

async function refreshUpdatePanel() {
  if (!state.swRegistration) {
    setUpdatePanelState(false, "更新機能を利用できません。");
    return;
  }

  if (state.swRegistration.waiting) {
    setUpdatePanelState(true, "新しいバージョンを利用できます。");
    return;
  }

  if (state.swRegistration.installing) {
    setUpdatePanelState(false, "更新をダウンロード中です。");
    return;
  }

  setUpdatePanelState(false, "現在は最新です");
}

async function checkForUpdateFromTopButton() {
  if (!state.swRegistration) {
    window.location.reload();
    return;
  }

  try {
    await state.swRegistration.update();
  } catch (error) {
    console.error(error);
  }

  await refreshUpdatePanel();
  if (state.swUpdateReady) {
    await applyServiceWorkerUpdate();
    return;
  }

  const refreshed = await refreshAppShellViaMessage();
  if (refreshed) {
    showToast("最新版を読み込みます");
    window.setTimeout(() => {
      window.location.reload();
    }, 250);
  } else if (state.swRegistration.installing) {
    showToast("更新をダウンロード中です");
  } else if (!navigator.onLine) {
    showToast("オフラインのため更新できません");
  } else {
    showToast("現在は最新です");
  }
}

async function applyServiceWorkerUpdate() {
  if (!state.swRegistration) {
    setUpdatePanelState(false, "更新機能を利用できません。");
    return;
  }

  if (!state.swRegistration.waiting) {
    await refreshUpdatePanel();
    showToast("現在は最新です");
    return;
  }

  state.swRegistration.waiting.postMessage({ type: "SKIP_WAITING" });
}

function postMessageToWorker(worker, message, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => {
      reject(new Error("Service Worker response timeout"));
    }, timeoutMs);

    channel.port1.onmessage = (event) => {
      window.clearTimeout(timer);
      resolve(event.data);
    };

    worker.postMessage(message, [channel.port2]);
  });
}

async function refreshAppShellViaMessage() {
  if (!state.swRegistration) {
    return false;
  }
  const worker = state.swRegistration.active || navigator.serviceWorker.controller;
  if (!worker) {
    return false;
  }

  try {
    const response = await postMessageToWorker(worker, { type: "REFRESH_APP_SHELL" });
    return Boolean(response && response.ok);
  } catch (error) {
    console.error(error);
    return false;
  }
}
