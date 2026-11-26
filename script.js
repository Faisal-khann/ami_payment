const EXTERNAL_CONFIG = window.APP_CONFIG || {};

const CONFIG = {
  SCRIPT_URL: EXTERNAL_CONFIG.SCRIPT_URL || "",
  RAZORPAY_KEY_ID: EXTERNAL_CONFIG.RAZORPAY_KEY_ID || "",
  BASE_SEAT_PRICE: Number(EXTERNAL_CONFIG.BASE_SEAT_PRICE) || 14999,
  RECORDING_ADDON_PRICE: Number(EXTERNAL_CONFIG.RECORDING_ADDON_PRICE) ?? 999,
  WHATSAPP_LINKS: EXTERNAL_CONFIG.WHATSAPP_LINKS || {},
  STORAGE_KEY: "ami_reg_state_v3",
  QUEUE_KEY: "ami_sync_queue_v3"
};

let participantData = loadJSON(CONFIG.STORAGE_KEY, {});
let selectedOffer = { price: 0, label: "" };

const $ = (id) => document.getElementById(id);

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function generateSubmissionId() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `AMI-${ts}-${rand}`;
}

// Background sync queue with jitter + exponential backoff
function getQueueId(payload) {
  return `${payload.submissionId}_${payload.action}_${payload.razorpayPaymentId || "main"}`;
}

function enqueueSync(payload) {
  const queueId = getQueueId(payload);
  const queue = loadJSON(CONFIG.QUEUE_KEY, []).filter(item => item._queueId !== queueId);
  queue.push({ ...payload, _queueId: queueId });
  saveJSON(CONFIG.QUEUE_KEY, queue);
}

function dequeueSync(payload) {
  const queueId = getQueueId(payload);
  saveJSON(CONFIG.QUEUE_KEY, loadJSON(CONFIG.QUEUE_KEY, []).filter(item => item._queueId !== queueId));
}

async function sendWithRetry(payload, maxRetries = 5) {
  enqueueSync(payload);
  await new Promise(r => setTimeout(r, Math.floor(Math.random() * 750)));

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await fetch(CONFIG.SCRIPT_URL, {
        method: "POST",
        mode: "no-cors",
        keepalive: true,
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
      });
      dequeueSync(payload);
      return true;
    } catch {
      if (attempt === maxRetries) return false;
      const backoff = Math.pow(2, attempt) * 600 + Math.floor(Math.random() * 500);
      await new Promise(r => setTimeout(r, backoff));
    }
  }
  return false;
}

function flushPendingQueue() {
  loadJSON(CONFIG.QUEUE_KEY, []).forEach(item => sendWithRetry(item));
}

window.addEventListener("online", flushPendingQueue);
document.addEventListener("DOMContentLoaded", flushPendingQueue);

function formatInternationalPhone(rawCountryCode, rawMobile) {
  const codeDigits = (rawCountryCode || "+91").split("-")[0].replace(/\D/g, "");
  let localDigits = (rawMobile || "").replace(/\D/g, "");

  if (localDigits.startsWith(codeDigits) && localDigits.length > codeDigits.length + 6) {
    localDigits = localDigits.slice(codeDigits.length);
  }
  return `+${codeDigits}${localDigits.replace(/^0+/, "")}`;
}

function ensureRazorpayLoaded() {
  return new Promise((resolve, reject) => {
    if (typeof window.Razorpay !== "undefined") return resolve(window.Razorpay);
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(window.Razorpay);
    script.onerror = () => reject(new Error("Razorpay SDK load failed"));
    document.head.appendChild(script);
  });
}

async function openRazorpayCheckout({ amountINR, description, prefill, notes, buttonEl, onSuccess }) {
  if (!CONFIG.RAZORPAY_KEY_ID || CONFIG.RAZORPAY_KEY_ID.includes("YOUR_RAZORPAY_KEY_ID")) {
    alert("Please configure RAZORPAY_KEY_ID in config.js.");
    return;
  }

  const originalLabel = buttonEl.textContent;
  buttonEl.disabled = true;
  buttonEl.textContent = "Opening Razorpay...";

  const resetBtn = () => {
    buttonEl.disabled = false;
    buttonEl.textContent = originalLabel;
  };

  try {
    const RazorpayConstructor = await ensureRazorpayLoaded();
    const rzp = new RazorpayConstructor({
      key: CONFIG.RAZORPAY_KEY_ID,
      amount: Math.round(amountINR * 100),
      currency: "INR",
      name: "Abundance Mindset Intensive",
      description,
      prefill,
      notes,
      theme: { color: "#328a7e" },
      modal: { ondismiss: resetBtn },
      handler: (response) => onSuccess(response)
    });

    rzp.on("payment.failed", (res) => {
      resetBtn();
      alert("Payment failed: " + (res.error?.description || "Please try again."));
    });

    rzp.open();
  } catch {
    resetBtn();
    alert("Unable to load Razorpay checkout. Please check your connection and try again.");
  }
}

// Stepper navigation
function goToStep(stepNumber) {
  for (let i = 1; i <= 4; i++) {
    $(`step${i}View`)?.classList.toggle("hidden", i !== stepNumber);
    const stepEl = $(`vStep${i}`);
    const circleEl = $(`vCircle${i}`);
    if (!stepEl || !circleEl) continue;

    stepEl.classList.remove("active", "completed");
    if (i < stepNumber) {
      stepEl.classList.add("completed");
      circleEl.textContent = "✓";
    } else {
      if (i === stepNumber) stepEl.classList.add("active");
      circleEl.textContent = String(i);
    }
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// Step 1: Seat reservation & Razorpay checkout
const recordingAddonCheck = $("recordingAddonCheck");
const recordingAddonCard = $("recordingAddonCard");
const seatTotalDisplay = $("seatTotalDisplay");
const reserveSeatBtn = $("reserveSeatBtn");
const seatPaymentForm = $("seatPaymentForm");

function getCurrentSeatPrice() {
  return recordingAddonCheck.checked
    ? CONFIG.BASE_SEAT_PRICE + CONFIG.RECORDING_ADDON_PRICE
    : CONFIG.BASE_SEAT_PRICE;
}

function updateSeatPricingUI() {
  const formatted = `₹${getCurrentSeatPrice().toLocaleString("en-IN")}`;
  recordingAddonCard.classList.toggle("selected", recordingAddonCheck.checked);
  seatTotalDisplay.textContent = formatted;
  reserveSeatBtn.textContent = `Reserve my seat for ${formatted} →`;
}

recordingAddonCheck.addEventListener("change", updateSeatPricingUI);

document.querySelectorAll('input[name="batch"]').forEach(radio => {
  radio.addEventListener("change", () => {
    document.querySelectorAll(".batch-row-card").forEach(c => c.classList.remove("selected"));
    radio.closest(".batch-row-card")?.classList.add("selected");
  });
});

seatPaymentForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!seatPaymentForm.checkValidity()) {
    seatPaymentForm.reportValidity();
    return;
  }

  const selectedRadio = document.querySelector('input[name="batch"]:checked');
  const fullName = $("step1Name").value.trim();
  const email = $("step1Email").value.trim();
  const formattedMobile = formatInternationalPhone($("countryCodeSelect").value, $("step1Mobile").value);
  const seatAmount = getCurrentSeatPrice();
  const planLabel = recordingAddonCheck.checked
    ? "Abundance Mindset Intensive + 2 Years Recording Access"
    : "Abundance Mindset Intensive (1 Year Recording Access)";
  const submissionId = participantData.submissionId || generateSubmissionId();

  openRazorpayCheckout({
    amountINR: seatAmount,
    description: `${planLabel} — ${selectedRadio.dataset.date}`,
    prefill: { name: fullName, email, contact: formattedMobile },
    notes: { batch: selectedRadio.value, submissionId },
    buttonEl: reserveSeatBtn,
    onSuccess: (response) => {
      participantData = {
        submissionId,
        name: fullName,
        email,
        mobile: formattedMobile,
        batch: selectedRadio.value,
        batchDateOnly: selectedRadio.dataset.date,
        sheetName: selectedRadio.dataset.sheet,
        seatPlan: planLabel,
        seatAmountPaid: seatAmount,
        seatPaymentId: response.razorpay_payment_id,
        coursesPurchased: "None",
        courseAmountPaid: 0,
        coursePaymentId: ""
      };
      saveJSON(CONFIG.STORAGE_KEY, participantData);

      sendWithRetry({
        action: "seat_payment",
        submissionId,
        sheetName: selectedRadio.dataset.sheet,
        batch: selectedRadio.value,
        name: fullName,
        email,
        mobile: formattedMobile,
        coursesPurchased: planLabel,
        amountPaid: seatAmount,
        razorpayPaymentId: response.razorpay_payment_id
      });

      $("reservedBatchDate").textContent = selectedRadio.dataset.date;
      $("confirmedBatchName").textContent = selectedRadio.value;
      const waBtn = $("whatsappJoinBtn");
      waBtn.href = CONFIG.WHATSAPP_LINKS[selectedRadio.value] || "#";
      waBtn.textContent = `Join WhatsApp Group (${selectedRadio.value})`;

      goToStep(2);
    }
  });
});

// Step 2: Mega Offer upsell
const course1Check = $("course1Check");
const course2Check = $("course2Check");
const bundleCheck = $("bundleCheck");
const payCourseBtn = $("payCourseBtn");

function updateOfferSummary() {
  $("courseBox1")?.classList.toggle("selected", course1Check.checked);
  $("courseBox2")?.classList.toggle("selected", course2Check.checked);
  $("bundleBox")?.classList.toggle("selected", bundleCheck.checked);

  if (bundleCheck.checked) {
    selectedOffer = { price: Number(bundleCheck.dataset.price) || 0, label: "Both Courses Bundle (Peak Performance + Money Energy)" };
  } else if (course1Check.checked) {
    selectedOffer = { price: Number(course1Check.dataset.price) || 0, label: course1Check.value };
  } else if (course2Check.checked) {
    selectedOffer = { price: Number(course2Check.dataset.price) || 0, label: course2Check.value };
  } else {
    selectedOffer = { price: 0, label: "" };
  }

  const formattedINR = `₹${selectedOffer.price.toLocaleString("en-IN")}`;
  $("selectedCoursesText").textContent = selectedOffer.label || "None yet";
  $("totalAmountText").textContent = formattedINR;

  payCourseBtn.disabled = selectedOffer.price <= 0;
  payCourseBtn.textContent = selectedOffer.price > 0
    ? `Pay ${formattedINR} via Razorpay →`
    : "Select a course to continue";
}

[course1Check, course2Check].forEach(cb => {
  cb.addEventListener("change", () => {
    if (course1Check.checked && course2Check.checked) {
      course1Check.checked = false;
      course2Check.checked = false;
      bundleCheck.checked = true;
    } else if (cb.checked) {
      bundleCheck.checked = false;
    }
    updateOfferSummary();
  });
});

bundleCheck.addEventListener("change", () => {
  if (bundleCheck.checked) {
    course1Check.checked = false;
    course2Check.checked = false;
  }
  updateOfferSummary();
});

payCourseBtn.addEventListener("click", () => {
  if (selectedOffer.price <= 0) return;

  openRazorpayCheckout({
    amountINR: selectedOffer.price,
    description: selectedOffer.label,
    prefill: {
      name: participantData.name || "",
      email: participantData.email || "",
      contact: participantData.mobile || ""
    },
    notes: {
      batch: participantData.batch || "",
      submissionId: participantData.submissionId || ""
    },
    buttonEl: payCourseBtn,
    onSuccess: (response) => {
      participantData.coursesPurchased = selectedOffer.label;
      participantData.courseAmountPaid = selectedOffer.price;
      participantData.coursePaymentId = response.razorpay_payment_id;
      saveJSON(CONFIG.STORAGE_KEY, participantData);

      sendWithRetry({
        action: "course_payment",
        submissionId: participantData.submissionId,
        sheetName: participantData.sheetName,
        batch: participantData.batch,
        name: participantData.name,
        email: participantData.email,
        mobile: participantData.mobile,
        coursesPurchased: selectedOffer.label,
        amountPaid: selectedOffer.price,
        razorpayPaymentId: response.razorpay_payment_id
      });

      goToStep(3);
    }
  });
});

$("skipOfferBtn")?.addEventListener("click", () => goToStep(3));

// Step 3: Participant details onboarding
const profileDetailsForm = $("profileDetailsForm");
const saveDetailsBtn = $("saveDetailsBtn");
const occupationSelect = $("occupationSelect");
const referralInput = $("referralInput");
const referralNameField = $("referralNameField");
const referralNameInput = $("referralNameInput");
const termsCheckbox = $("termsCheckbox");

const conditionalMap = {
  "Salaried Professional": {
    containers: ["salariedFieldsCompany", "salariedFieldsDesignation"],
    inputs: ["companyNameInput", "designationInput"]
  },
  "Business Owner / Entrepreneur": {
    containers: ["businessFieldsName", "businessFieldsIndustry"],
    inputs: ["businessNameInput", "industryTypeInput"]
  }
};

occupationSelect.addEventListener("change", () => {
  Object.values(conditionalMap).forEach(({ containers, inputs }) => {
    containers.forEach(id => $(id)?.classList.add("hidden"));
    inputs.forEach(id => {
      const inp = $(id);
      if (inp) { inp.required = false; inp.value = ""; }
    });
  });

  const active = conditionalMap[occupationSelect.value];
  if (active) {
    active.containers.forEach(id => $(id)?.classList.remove("hidden"));
    active.inputs.forEach(id => { const inp = $(id); if (inp) inp.required = true; });
  }
});

referralInput.addEventListener("change", () => {
  const isFriend = referralInput.value === "Friend or colleague referral";
  referralNameField.classList.toggle("hidden", !isFriend);
  referralNameInput.required = isFriend;
  if (isFriend) referralNameInput.focus();
  else referralNameInput.value = "";
});

document.querySelectorAll('input[name="painPoints"]').forEach(cb => {
  cb.addEventListener("change", () => {
    cb.closest(".chip-option")?.classList.toggle("selected", cb.checked);
    $("painPointsError")?.classList.remove("visible");
  });
});

termsCheckbox.addEventListener("change", () => {
  $("termsConsentCard")?.classList.toggle("selected", termsCheckbox.checked);
  $("termsError")?.classList.remove("visible");
});

profileDetailsForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!profileDetailsForm.checkValidity()) {
    profileDetailsForm.reportValidity();
    return;
  }

  const selectedPainPoints = Array.from(document.querySelectorAll('input[name="painPoints"]:checked')).map(cb => cb.value);
  if (selectedPainPoints.length === 0) {
    $("painPointsError")?.classList.add("visible");
    $("painPointsGroup")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  if (!termsCheckbox.checked) {
    $("termsError")?.classList.add("visible");
    return;
  }

  saveDetailsBtn.disabled = true;

  const details = Object.fromEntries(new FormData(profileDetailsForm).entries());
  if (details.referral === "Friend or colleague referral" && details.referralName) {
    details.referral = `Friend or colleague referral (${details.referralName.trim()})`;
  }

  sendWithRetry({
    action: "profile_details",
    submissionId: participantData.submissionId || generateSubmissionId(),
    sheetName: participantData.sheetName || "06 Dec 2026",
    batch: participantData.batch || "Batch 1 - Sun, 6 Dec 2026",
    name: participantData.name || "",
    email: participantData.email || "",
    mobile: participantData.mobile || "",
    ...details,
    painPoints: selectedPainPoints.join(", ")
  });

  // Render Step 4 receipt safely
  const receiptEl = $("receiptCourseSummary");
  receiptEl.textContent = "";
  const totalPaid = (participantData.seatAmountPaid || 0) + (participantData.courseAmountPaid || 0);
  const lines = [
    `${participantData.seatPlan || "AMI Seat"} (₹${(participantData.seatAmountPaid || 0).toLocaleString("en-IN")} · ID: ${participantData.seatPaymentId || "Confirmed"})`
  ];
  if (participantData.courseAmountPaid > 0) {
    lines.push(`+ ${participantData.coursesPurchased} (₹${participantData.courseAmountPaid.toLocaleString("en-IN")} · ID: ${participantData.coursePaymentId})`);
  }
  lines.push(`Total Paid: ₹${totalPaid.toLocaleString("en-IN")}`);

  lines.forEach((line, idx) => {
    if (idx > 0) receiptEl.appendChild(document.createElement("br"));
    receiptEl.appendChild(document.createTextNode(line));
  });

  localStorage.removeItem(CONFIG.STORAGE_KEY);
  goToStep(4);
});