import {
  callAction,
  useActionMutation,
  useActionQuery,
  useSession,
  signOut,
} from "@agent-native/core/client/hooks";
import {
  IconActivity,
  IconAlertCircle,
  IconArrowDownRight,
  IconArrowUpRight,
  IconBuildingFactory2,
  IconBuilding,
  IconChevronDown,
  IconChevronRight,
  IconClock,
  IconDownload,
  IconFilter,
  IconPlus,
  IconPencil,
  IconTrash,
  IconLayoutDashboard,
  IconLogout,
  IconMap2,
  IconCurrentLocation,
  IconMaximize,
  IconMenu2,
  IconSearch,
  IconSettings,
  IconUsers,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

export function meta() {
  return [
    { title: "APRC | FAFS Progress" },
    {
      name: "description",
      content: "Fire alarm system implementation progress monitoring",
    },
  ];
}

type ProgressEntry = {
  id: string;
  name: string;
  weight: string;
  progress: number;
  contribution: number;
  updatedAt: string | null;
  updatedBy: string | null;
};
type MapPoint = { x: number; y: number };
type Building = {
  id: string;
  buildingNumber: string;
  name: string;
  manualStatus: string | null;
  statusReason: string;
  relativeWeight: string;
  progress: number;
  geometry: { points: MapPoint[] } | null;
  activities: ProgressEntry[];
};
type Activity = { id: string; name: string; weight: string; progress: number };
type HistoryEntry = {
  id: string;
  buildingId: string;
  activityId: string;
  buildingNumber: string;
  buildingName: string;
  activityName: string;
  previousProgress: string;
  newProgress: string;
  changedAt: string;
  changedBy: string;
  note: string;
};
type SiteMapInfo = { filename: string; contentType: string; updatedAt: string };
type InstallPromptEvent = Event & { prompt: () => Promise<void> };
type DashboardData = {
  overall: number;
  userRole: string | null;
  siteMap: SiteMapInfo | null;
  buildings: Building[];
  activeCount: number;
  removedCount: number;
  holdCount: number;
  delayedCount: number;
  completedCount: number;
  inProgressCount: number;
  notStartedCount: number;
  activities: Activity[];
  history: HistoryEntry[];
};
type ManagedUser = {
  username: string;
  displayName: string;
  role: string;
  active: boolean;
  createdAt: string;
};
type CreateUserInput = {
  username: string;
  displayName: string;
  role: "Supervisor" | "Viewer";
};
type DeactivateUserInput = { username: string };
type SaveBuildingInput = {
  buildingId?: string;
  buildingNumber: string;
  name: string;
  manualStatus: string | null;
  statusReason: string;
  relativeWeight: number;
};
type DeleteBuildingInput = { buildingId: string };
type SavePolygonInput = { buildingId: string; points: MapPoint[] | null };
type UpdateInput = {
  buildingId: string;
  activityId: string;
  progress: number;
  note?: string;
};
type UpdateActivityWeightInput = {
  weights: { activityId: string; weight: number }[];
};

const navItems = [
  { label: "Dashboard", icon: IconLayoutDashboard },
  { label: "Site map", icon: IconMap2 },
  { label: "Buildings", icon: IconBuilding },
  { label: "Activities", icon: IconActivity },
  { label: "Reports", icon: IconDownload },
  { label: "Progress history", icon: IconClock },
];

const MAP_ZOOM_MIN = 100;
const MAP_ZOOM_MAX = 2000;

const DISPLAY_NAME_OVERRIDES: Record<string, string> = {
  Chillers: "Chillers Electrical Station",
  "Unit 17": "Unit 17 Electrical Station A&B",
};

function splitBuildingName(rawName: string): {
  title: string;
  number: string | null;
} {
  const override = (title: string) =>
    DISPLAY_NAME_OVERRIDES[title.trim()] ?? title;
  const match = rawName.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (match && match[1].trim()) {
    return { title: override(match[1].trim()), number: match[2].trim() };
  }
  return { title: override(rawName), number: null };
}

// Plant numbers from the Shawqi progress sheet (SN/NO column) for buildings
// whose stored name has no "(number)". Display only; stored data unchanged.
const SHEET_NUMBER_BY_CODE: Record<string, string> = {
  "B-001": "116/92",
  "B-002": "117/93",
  "B-003": "117/93",
  "B-004": "113/89",
  "B-005": "114/90",
  "B-006": "1/1",
  "B-007": "2/2",
  "B-008": "112/88",
  "B-010": "4/3",
  "B-011": "9/6",
  "B-012": "124/113",
  "B-013": "126/115",
  "B-014": "125/114",
  "B-015": "110/86",
  "B-016": "98/76",
  "B-018": "99/77",
  "B-019": "95/75",
  "B-020": "57/43",
  "B-021": "81/64",
  "B-023": "45/33&46/33",
  "B-024": "44/32",
  "B-025": "50/37",
  "B-026": "42/30",
  "B-028": "32/24&33/25&37/25&36/25",
  "B-030": "38/26",
  "B-033": "39/27",
  "B-061": "108/84",
  "B-074": "80/63",
  الشيلرات: "74/57",
  "وحده 17": "75/58",
};

function displayBuildingNumber(buildingNumber: string, name: string) {
  const fromName = splitBuildingName(name).number;
  if (fromName) return SHEET_NUMBER_BY_CODE[fromName] ?? fromName;
  const code = buildingNumber.trim();
  if (SHEET_NUMBER_BY_CODE[code]) return SHEET_NUMBER_BY_CODE[code];
  if (/^B-\d+$/i.test(code)) return "";
  return code;
}

function displayBuildingLine(buildingNumber: string, name: string) {
  const { title } = splitBuildingName(name);
  const number = displayBuildingNumber(buildingNumber, name);
  return number ? `${number} · ${title}` : title;
}

const MAP_ZOOM_STEP = 5;
const PETROMAINT_LOGO =
  "data:image/jpeg;base64,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";

type AppLang = "en" | "ar";
const LANG_KEY = "fafs-lang";
// Arabic UI text. Keys are the exact English UI strings. Building names,
// activity names, numbers and user-entered notes are data and stay as stored.
const AR_TEXT: Record<string, string> = {
  "Project /": "المشروع /",
  Project: "المشروع",
  System: "النظام",
  Settings: "الإعدادات",
  "Project settings": "إعدادات المشروع",
  "Project configuration is read from the database.":
    "إعدادات المشروع تُقرأ من قاعدة البيانات.",
  "Project workspace": "مساحة المشروع",
  "APRC • Alexandria": "APRC • الإسكندرية",
  "Project Control": "التحكم في المشروع",
  "Fire & safety systems": "أنظمة الحريق والسلامة",
  "Sign out": "تسجيل الخروج",
  "Install app": "تثبيت التطبيق",
  "LIVE PROJECT": "مشروع حي",
  "Amreya Refinery": "مصفاة العامرية",
  "FAFS implementation": "تنفيذ نظام FAFS",
  "Amreya Petroleum Refining Company": "شركة العامرية لتكرير البترول",
  "Fire Alarm & Firefighting Alarm System":
    "نظام إنذار الحريق وإنذار مكافحة الحريق",
  "FAFS project overview": "نظرة عامة على مشروع FAFS",
  "Export report": "تصدير التقرير",
  Dashboard: "لوحة المتابعة",
  "Site map": "خريطة الموقع",
  Buildings: "المباني",
  Building: "المبنى",
  Activities: "الأنشطة",
  Reports: "التقارير",
  "Progress history": "سجل التقدم",
  "Checking project setup…": "جارٍ التحقق من إعداد المشروع…",
  "Checking sign-in…": "جارٍ التحقق من تسجيل الدخول…",
  "Loading project records…": "جارٍ تحميل سجلات المشروع…",
  Retry: "إعادة المحاولة",
  "Setup status unavailable": "حالة الإعداد غير متاحة",
  "Project data could not be loaded. Sign in with an authorized project account and retry.":
    "تعذر تحميل بيانات المشروع. سجّل الدخول بحساب مصرّح له وأعد المحاولة.",
  "Overall completion": "نسبة الإنجاز الكلية",
  Current: "الحالي",
  "Activity progress": "تقدم الأنشطة",
  "Average completion across active buildings":
    "متوسط الإنجاز في المباني الفعالة",
  "Building status": "حالة المباني",
  "Active project scope": "نطاق المشروع الفعال",
  "RECENTLY UPDATED": "آخر التحديثات",
  "No progress updates recorded yet.": "لا توجد تحديثات تقدم مسجلة بعد.",
  "Building progress": "تقدم المباني",
  "Latest status across the project": "آخر حالة على مستوى المشروع",
  "All buildings": "كل المباني",
  All: "الكل",
  "Add building": "إضافة مبنى",
  Cancel: "إلغاء",
  "Save all": "حفظ الكل",
  Edit: "تعديل",
  Weight: "الوزن",
  "Facility map": "خريطة المنشأة",
  "Status meanings": "معاني الحالات",
  "Not started": "لم يبدأ",
  "In progress": "جارٍ العمل",
  Hold: "متوقف مؤقتًا",
  Delayed: "متأخر",
  Finished: "منتهي",
  "Removed from scope": "خارج النطاق",
  "Removed from Scope": "خارج النطاق",
  "Filter by status": "تصفية حسب الحالة",
  "Work has not started. It can start anytime and nobody is blocking it.":
    "العمل لم يبدأ. يمكن أن يبدأ في أي وقت ولا شيء يعطّله.",
  "Work is currently underway on site.": "العمل جارٍ حاليًا في الموقع.",
  "Paused on purpose after work started. Reason is required.":
    "متوقف عمدًا بعد بدء العمل. السبب مطلوب.",
  "Someone delayed or blocked the work. The reason is shown in Status reason and is required.":
    "تم تأخير العمل أو تعطيله. السبب يظهر في سبب الحالة وهو مطلوب.",
  "Replace site map": "استبدال خريطة الموقع",
  "Upload site map": "رفع خريطة الموقع",
  "Choose File": "اختيار ملف",
  "No file chosen": "لم يتم اختيار ملف",
  "Save map": "حفظ الخريطة",
  "Uploading…": "جارٍ الرفع…",
  "PNG, JPEG, WebP · max 16 MB":
    "PNG أو JPEG أو WebP · الحد الأقصى 16 ميجابايت",
  "Upload an approved facility map to place buildings.":
    "ارفع خريطة المنشأة المعتمدة لتحديد أماكن المباني.",
  "Search building name": "بحث باسم المبنى",
  "Type a building name…": "اكتب اسم المبنى…",
  "No matching buildings.": "لا توجد مبانٍ مطابقة.",
  "Select building": "اختيار مبنى",
  "Select a building…": "اختر مبنى…",
  "Select a building to see its status and activities.":
    "اختر مبنى لعرض حالته وأنشطته.",
  "Draw polygon": "رسم المضلع",
  "Clear polygon": "مسح المضلع",
  Reset: "إعادة ضبط",
  "Pan tool": "أداة التحريك",
  "Pan: on": "التحريك: مفعل",
  "My location": "موقعي",
  "Stop location": "إيقاف الموقع",
  "Full screen": "ملء الشاشة",
  "Exit full screen": "إغلاق ملء الشاشة",
  "Pan mode is on. Turn it off to draw a polygon.":
    "وضع التحريك مفعل. أوقفه لرسم مضلع.",
  "Click the map to add polygon vertices.":
    "اضغط على الخريطة لإضافة نقاط المضلع.",
  "Draw or clear its polygon on the map.": "ارسم أو امسح مضلعه على الخريطة.",
  "Click at least 3 points on the map, then finish and save.":
    "اضغط 3 نقاط على الأقل على الخريطة ثم أنهِ واحفظ.",
  "No site map uploaded": "لم يتم رفع خريطة موقع",
  "A Site Manager can upload a PNG, JPEG, or WebP facility map up to 16 MB. Building locations can be assigned after upload.":
    "يمكن لمدير الموقع رفع خريطة المنشأة بصيغة PNG أو JPEG أو WebP حتى 16 ميجابايت. يمكن تحديد أماكن المباني بعد الرفع.",
  "Finding your location...": "جارٍ تحديد موقعك...",
  "You are outside the area covered by this map.":
    "أنت خارج المنطقة التي تغطيها هذه الخريطة.",
  "This browser does not support location.":
    "هذا المتصفح لا يدعم تحديد الموقع.",
  "Location permission was denied. Allow location for this site in your browser settings, then tap My location again.":
    "تم رفض إذن الموقع. اسمح بالموقع لهذا الموقع من إعدادات المتصفح ثم اضغط «موقعي» مرة أخرى.",
  "Location request timed out. Still trying.":
    "انتهت مهلة طلب الموقع. ما زالت المحاولة جارية.",
  "Your location is not available right now.": "موقعك غير متاح حاليًا.",
  "Browse building records": "تصفح سجلات المباني",
  "Search buildings": "بحث في المباني",
  "Search number, name, type": "ابحث بالرقم أو الاسم أو النوع",
  "No buildings match this search.": "لا توجد مبانٍ مطابقة لهذا البحث.",
  "Assign on map": "تحديد على الخريطة",
  "Most recent recorded activity updates": "أحدث تحديثات الأنشطة المسجلة",
  "No progress history is available yet.": "لا يوجد سجل تقدم بعد.",
  "Update history": "سجل التحديثات",
  "Recent progress changes and responsible users":
    "آخر تغييرات التقدم والمستخدمون المسؤولون",
  "Active buildings": "المباني الفعالة",
  "Preserved • excluded from totals": "محفوظة • غير محسوبة في الإجماليات",
  "Separate list; excluded from project totals":
    "قائمة منفصلة؛ غير محسوبة في إجماليات المشروع",
  "Scope-filtered progress summary": "ملخص التقدم حسب النطاق",
  "Activity summary": "ملخص الأنشطة",
  "Progress against configured activity weights":
    "التقدم مقابل أوزان الأنشطة المحددة",
  "Activity weights determine each activity’s contribution to building progress.":
    "أوزان الأنشطة تحدد مساهمة كل نشاط في تقدم المبنى.",
  "Buildings removed from scope": "مبانٍ خارج النطاق",
  "Configured activity weight total": "إجمالي أوزان الأنشطة",
  "User management": "إدارة المستخدمين",
  "Create accounts with a username and initial password. Email addresses are not required.":
    "أنشئ حسابات باسم مستخدم وكلمة مرور مبدئية. لا حاجة لعنوان بريد إلكتروني.",
  Username: "اسم المستخدم",
  "Display name": "الاسم المعروض",
  "Initial password (at least 12 characters)":
    "كلمة المرور المبدئية (12 حرفًا على الأقل)",
  Role: "الدور",
  Supervisor: "مشرف",
  Viewer: "مشاهد",
  "Site Manager": "مدير الموقع",
  "Create account": "إنشاء حساب",
  "Creating…": "جارٍ الإنشاء…",
  "Create Site Manager account": "إنشاء حساب مدير الموقع",
  "Creating account…": "جارٍ إنشاء الحساب…",
  Active: "فعال",
  Inactive: "غير فعال",
  Deactivate: "تعطيل",
  "Deactivating…": "جارٍ التعطيل…",
  "Only the provisioned Site Manager can create or manage project accounts.":
    "فقط مدير الموقع المعيّن يمكنه إنشاء حسابات المشروع أو إدارتها.",
  USERNAME: "اسم المستخدم",
  "DISPLAY NAME": "الاسم المعروض",
  ROLE: "الدور",
  STATUS: "الحالة",
  ACTION: "الإجراء",
  "Building details and project weight": "تفاصيل المبنى ووزنه في المشروع",
  "Building number": "رقم المبنى",
  "Building name": "اسم المبنى",
  Status: "الحالة",
  "Reason (required)": "السبب (مطلوب)",
  "Relative weight": "الوزن النسبي",
  "Save building": "حفظ المبنى",
  "Update activity progress": "تحديث تقدم النشاط",
  "Progress updates are disabled for excluded buildings.":
    "تحديث التقدم غير متاح للمباني خارج النطاق.",
  "Progress saved": "تم حفظ التقدم",
  "Progress values are validated and saved with history.":
    "يتم التحقق من قيم التقدم وحفظها مع السجل.",
  "Saving…": "جارٍ الحفظ…",
  "Save progress": "حفظ التقدم",
  Progress: "التقدم",
  "Account created.": "تم إنشاء الحساب.",
  "Polygon saved.": "تم حفظ المضلع.",
  "Polygon cleared.": "تم مسح المضلع.",
  "Activity weights saved.": "تم حفظ أوزان الأنشطة.",
  "Progress saved and project totals recalculated.":
    "تم حفظ التقدم وإعادة حساب إجماليات المشروع.",
  "Relative weight must be greater than zero.":
    "يجب أن يكون الوزن النسبي أكبر من صفر.",
  "A reason is required for Paused and Delayed statuses.":
    "السبب مطلوب لحالتي «متوقف» و«متأخر».",
  "Enter a weight from 0 to 100% for every activity.":
    "أدخل وزنًا من 0 إلى 100% لكل نشاط.",
  "The site map must be 16 MB or smaller.":
    "يجب ألا يتجاوز حجم خريطة الموقع 16 ميجابايت.",
  "Unable to upload the site map.": "تعذر رفع خريطة الموقع.",
  "Site map uploaded and saved.": "تم رفع خريطة الموقع وحفظها.",
  "Username must be 3 to 32 characters: letters, numbers, dot, dash or underscore only (no spaces).":
    "اسم المستخدم من 3 إلى 32 حرفًا: حروف إنجليزية وأرقام ونقطة وشرطة وشرطة سفلية فقط (بدون مسافات).",
  "That username is already taken. Choose a different username.":
    "اسم المستخدم مستخدم بالفعل. اختر اسمًا آخر.",
  "Unable to create account.": "تعذر إنشاء الحساب.",
  Language: "اللغة",
  Paused: "متوقف مؤقتًا",
  "Excluded from totals": "غير محسوبة في الإجماليات",
  "No buildings": "لا توجد مبانٍ",
  "Buildings per status and their average progress":
    "عدد المباني في كل حالة ومتوسط تقدمها",
  "Fire alarm & firefighting alarm system implementation":
    "تنفيذ نظام إنذار الحريق وإنذار مكافحة الحريق",
  "Active scope": "النطاق الفعال",
  buildings: "مبنى",
  "active buildings": "مبنى فعال",
  "View activities": "عرض الأنشطة",
  "Map assignment": "تحديد على الخريطة",
  Actions: "الإجراءات",
  Action: "الإجراء",
  Updated: "آخر تحديث",
  "not updated": "لم يتم التحديث",
  "Choose the language of the app. Your choice is saved on this device.":
    "اختر لغة التطبيق. يتم حفظ اختيارك على هذا الجهاز.",
  "Close menu": "إغلاق القائمة",
  "Close navigation": "إغلاق التنقل",
  "Open navigation": "فتح التنقل",
  "Zoom out": "تصغير",
  "Zoom in": "تكبير",
  "Map zoom": "تكبير الخريطة",
  "Your location": "موقعك",
  "Building search results": "نتائج بحث المباني",
  "Uploaded facility site map": "خريطة موقع المنشأة المرفوعة",
  "Close building editor": "إغلاق محرر المبنى",
  "Close details": "إغلاق التفاصيل",
  "Activity progress percentage": "نسبة تقدم النشاط",
  "Optional update note": "ملاحظة اختيارية على التحديث",
};
const AR_PATTERNS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/^Updated not updated$/, () => "لم يُحدَّث بعد"],
  [
    /^Updated (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2})$/,
    (m) => `آخر تحديث ${m[2]} ${AR_MONTHS[m[1]]}`,
  ],
  [/^([\d.]+)% weight$/, (m) => `الوزن ${m[1]}%`],
  [/^Contribution ([\d.]+%)$/, (m) => `المساهمة ${m[1]}`],
  [
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2})$/,
    (m) => `${m[2]} ${AR_MONTHS[m[1]]}`,
  ],
  [/^avg progress ([\d.]+)%$/, (m) => `متوسط التقدم ${m[1]}%`],
  [/^(\d+) completed$/, (m) => `${m[1]} مكتمل`],
  [/^(\d+) not started$/, (m) => `${m[1]} لم يبدأ`],
  [
    /^(\d+) buildings · ([\d.]+)% overall$/,
    (m) => `${m[1]} مبنى · ${m[2]}% إجمالي`,
  ],
  [/^(\d+) preserved records$/, (m) => `${m[1]} سجل محفوظ`],
  [/^(\d+) active activities$/, (m) => `${m[1]} نشاط فعال`],
  [/^(\d+) recent changes$/, (m) => `${m[1]} تغييرات حديثة`],
  [/^Edit (.+)$/, (m) => `تعديل ${m[1]}`],
  [/^Delete (.+)$/, (m) => `حذف ${m[1]}`],
  [
    /^Your location, accuracy about (\d+) m\.$/,
    (m) => `موقعك، الدقة حوالي ${m[1]} متر.`,
  ],
  [
    /^Password must be at least 12 characters \(you entered (\d+)\)\.$/,
    (m) => `كلمة المرور يجب ألا تقل عن 12 حرفًا (أدخلت ${m[1]}).`,
  ],
];
function translateToArabic(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const lead = text.slice(0, text.indexOf(trimmed));
  const trail = text.slice(lead.length + trimmed.length);
  const normalized = trimmed.replace(/\s+/g, " ");
  let out: string | undefined = AR_OVERRIDES[normalized] ?? AR_TEXT[normalized];
  if (!out) {
    for (const [pattern, fn] of AR_PATTERNS) {
      const m = normalized.match(pattern);
      if (m) {
        out = fn(m);
        break;
      }
    }
  }
  return out ? `${lead}${out}${trail}` : null;
}
const I18N_ATTRS = ["placeholder", "aria-label", "title", "alt"];
const AR_OVERRIDES: Record<string, string> = {
  Finished: "مكتمل",
  "In progress": "قيد التنفيذ",
  Current: "حتى الآن",
  "Overall completion": "نسبة الإنجاز الإجمالية",
  "Project workspace": "مساحة عمل المشروع",
  "LIVE PROJECT": "مشروع جارٍ",
  "Pan tool": "تحريك الخريطة",
  "Pan: on": "التحريك مفعّل",
  "Draw polygon": "رسم حدود المبنى",
  "Clear polygon": "مسح الحدود",
  "Polygon saved.": "تم حفظ حدود المبنى.",
  "Polygon cleared.": "تم مسح حدود المبنى.",
  "Click the map to add polygon vertices.":
    "اضغط على الخريطة لإضافة نقاط حدود المبنى.",
  "Draw or clear its polygon on the map.":
    "ارسم حدود المبنى على الخريطة أو امسحها.",
  "Click at least 3 points on the map, then finish and save.":
    "حدّد 3 نقاط على الأقل على الخريطة، ثم أنهِ الرسم واحفظ.",
  "Pan mode is on. Turn it off to draw a polygon.":
    "وضع التحريك مفعّل. أوقفه لرسم حدود المبنى.",
  "Someone delayed or blocked the work. The reason is shown in Status reason and is required.":
    "تأخر العمل أو تعطّل. يظهر السبب في خانة سبب الحالة وهو مطلوب.",
  "Paused on purpose after work started. Reason is required.":
    "تم إيقاف العمل عمدًا بعد بدئه. السبب مطلوب.",
  "Work has not started. It can start anytime and nobody is blocking it.":
    "لم يبدأ العمل بعد. يمكن البدء في أي وقت ولا يوجد ما يعطّله.",
  "Select activity": "اختر النشاط",
  "Automatic from progress": "تلقائي حسب نسبة التقدم",
  "No file chosen": "لم يتم اختيار ملف",
  "Choose File": "اختيار ملف",
  "Shop Drawings, Datasheets, and Design Verification":
    "الرسومات التنفيذية وأوراق البيانات ومراجعة التصميم",
  "First Fix": "التركيبات الأولية (First Fix)",
  "Cable Pulling": "سحب الكابلات",
  "Device Installation": "تركيب الأجهزة",
  Termination: "توصيل أطراف الكابلات",
  "Programming, Testing and Commissioning":
    "البرمجة والاختبار والتشغيل التجريبي",
  "As-built": "رسومات ما بعد التنفيذ (As-built)",
  Handover: "التسليم",
  "Fire alarm system implementation progress monitoring":
    "متابعة تقدم تنفيذ نظام إنذار الحريق",
  "Project Control · FAFS": "التحكم في المشروع · FAFS",
};
const AR_MONTHS: Record<string, string> = {
  Jan: "يناير",
  Feb: "فبراير",
  Mar: "مارس",
  Apr: "أبريل",
  May: "مايو",
  Jun: "يونيو",
  Jul: "يوليو",
  Aug: "أغسطس",
  Sep: "سبتمبر",
  Oct: "أكتوبر",
  Nov: "نوفمبر",
  Dec: "ديسمبر",
};

// Wrap a map label into a compact centred block of short lines.
function wrapMapLabel(text: string, maxChars = 16, maxLines = 3) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) current = word;
    else if (current.length + 1 + word.length <= maxChars)
      current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, maxChars - 1)}…`;
    return kept.join("\n");
  }
  return lines.join("\n");
}
function labelBox(text: string, fontSize: number) {
  const lines = text.split("\n");
  const longest = Math.max(...lines.map((line) => line.length));
  return {
    w: longest * fontSize * 0.62 + 10,
    h: lines.length * fontSize * 1.25 + 2,
  };
}

// lon/lat -> site-map percent. Web Mercator tile coordinates at zoom 18
// (X, Y), then a fitted affine transform (rotation, scale, offset) found from
// the KML building points against their positions on the map image.
// Fit residual 0 m on the 76 KML points. Traced building outlines sit a median
// 5 m (max 19 m) from the transformed KML points.
const GEO_FIT = {
  A: 4.9070176766111135,
  B: -4.41829856146164,
  C: -276083.78964765323,
  D: 8.526502500142746,
  E: 9.46964038438094,
  F: -2318339.376707291,
  // metres per 1% of map width / height (for the accuracy circle)
  metersPerPctX: 20.078497170290515,
  metersPerPctY: 10.404359250738624,
};
function geoToMapPercent(lat: number, lon: number) {
  const n = 2 ** 18;
  const X = ((lon + 180) / 360) * n;
  const Y =
    ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  return {
    x: GEO_FIT.A * X + GEO_FIT.B * Y + GEO_FIT.C,
    y: GEO_FIT.D * X + GEO_FIT.E * Y + GEO_FIT.F,
  };
}
type GeoState = {
  status: "off" | "locating" | "ok" | "outside" | "denied" | "error";
  x?: number;
  y?: number;
  accuracy?: number;
  message?: string;
};

const STATUS_FILTER_OPTIONS = [
  "Not started",
  "In progress",
  "Hold",
  "Delayed",
  "Finished",
  "Removed from scope",
];

function StatusFilterChips({
  value,
  onChange,
  counts,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  counts: Record<string, number>;
}) {
  const chip = (active: boolean) =>
    `inline-flex h-8 items-center gap-1 rounded-full border px-3 text-[11px] font-semibold ${active ? "border-[#142b3c] bg-[#142b3c] text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-400"}`;
  return (
    <div
      role="group"
      aria-label="Filter by status"
      className="flex flex-wrap gap-1.5"
    >
      <button
        type="button"
        aria-pressed={value.length === 0}
        onClick={() => onChange([])}
        className={chip(value.length === 0)}
      >
        All
      </button>
      {STATUS_FILTER_OPTIONS.map((status) => {
        const active = value.includes(status);
        return (
          <button
            key={status}
            type="button"
            aria-pressed={active}
            onClick={() =>
              onChange(
                active
                  ? value.filter((item) => item !== status)
                  : [...value, status],
              )
            }
            className={chip(active)}
          >
            {statusLabel(status)}
            <span className="opacity-70">{counts[status] ?? 0}</span>
          </button>
        );
      })}
    </div>
  );
}

const STATUS_DEFINITIONS: { status: string; meaning: string }[] = [
  {
    status: "Not started",
    meaning:
      "Work has not started. It can start anytime and nobody is blocking it.",
  },
  {
    status: "In progress",
    meaning: "Work is currently underway on site.",
  },
  {
    status: "Hold",
    meaning: "Paused on purpose after work started. Reason is required.",
  },
  {
    status: "Delayed",
    meaning:
      "Someone delayed or blocked the work. The reason is shown in Status reason and is required.",
  },
];

const pct = (value: number) => `${value.toFixed(1)}%`;
const isRemoved = (building: Building) =>
  building.manualStatus === "Removed from scope";
const statusLabel = (status: string) => (status === "Hold" ? "Paused" : status);
const buildingStatus = (building: Building) =>
  building.manualStatus ??
  (building.progress >= 99.99
    ? "Finished"
    : building.progress > 0
      ? "In progress"
      : "Not started");
const polygonColors: Record<string, { fill: string; stroke: string }> = {
  Finished: { fill: "rgba(16,185,129,0.2)", stroke: "#059669" },
  "In progress": { fill: "rgba(245,158,11,0.22)", stroke: "#d97706" },
  "Not started": { fill: "rgba(100,116,139,0.2)", stroke: "#64748b" },
  "Removed from scope": { fill: "rgba(71,85,105,0.2)", stroke: "#475569" },
  Hold: { fill: "rgba(245,158,11,0.18)", stroke: "#b45309" },
  Delayed: { fill: "rgba(239,68,68,0.18)", stroke: "#dc2626" },
};
const polygonPoints = (points: MapPoint[]) =>
  points.map(({ x, y }) => `${x},${y}`).join(" ");

export default function HomeRoute() {
  const [view, setView] = useState("Dashboard");
  const [selected, setSelected] = useState<Building | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [lang, setLang] = useState<AppLang>("en");
  const translatedNodes = useRef(new Map<Node, { src: string; out: string }>());
  const translatedAttrs = useRef(
    new Map<Element, Record<string, { src: string; out: string }>>(),
  );
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LANG_KEY);
      const device = (navigator.language || "").toLowerCase().startsWith("ar");
      if (saved === "ar" || (saved === null && device)) setLang("ar");
    } catch {
      // storage unavailable: stay on English
    }
  }, []);
  const chooseLang = (next: AppLang) => {
    setLang(next);
    try {
      window.localStorage.setItem(LANG_KEY, next);
    } catch {
      // storage unavailable: choice lasts for this visit only
    }
  };
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    const nodes = translatedNodes.current;
    const attrs = translatedAttrs.current;
    const doText = (node: Text) => {
      const known = nodes.get(node);
      if (known && node.data === known.out) return;
      nodes.delete(node);
      if (lang !== "ar") return;
      const out = translateToArabic(node.data);
      if (out && out !== node.data) {
        nodes.set(node, { src: node.data, out });
        node.data = out;
      }
    };
    const doAttrs = (el: Element) => {
      let rec = attrs.get(el);
      for (const name of I18N_ATTRS) {
        const value = el.getAttribute(name);
        if (value === null) continue;
        if (rec?.[name] && rec[name].out === value) continue;
        if (rec?.[name]) delete rec[name];
        if (lang !== "ar") continue;
        const out = translateToArabic(value);
        if (out && out !== value) {
          rec = rec ?? {};
          rec[name] = { src: value, out };
          attrs.set(el, rec);
          el.setAttribute(name, out);
        }
      }
    };
    const walk = (root: Node) => {
      if (root.nodeType === Node.TEXT_NODE) {
        doText(root as Text);
        return;
      }
      if (root.nodeType !== Node.ELEMENT_NODE) return;
      const el = root as Element;
      if (el.closest("[data-no-translate]")) return;
      doAttrs(el);
      for (const child of Array.from(el.childNodes)) walk(child);
    };
    if (lang !== "ar") {
      for (const [node, { src, out }] of Array.from(nodes)) {
        if ((node as Text).data === out) (node as Text).data = src;
      }
      nodes.clear();
      for (const [el, rec] of Array.from(attrs)) {
        for (const [name, { src, out }] of Object.entries(rec)) {
          if (el.getAttribute(name) === out) el.setAttribute(name, src);
        }
      }
      attrs.clear();
      return;
    }
    walk(document.body);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "characterData") doText(record.target as Text);
        else if (record.type === "attributes")
          doAttrs(record.target as Element);
        else record.addedNodes.forEach((added) => walk(added));
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: I18N_ATTRS,
    });
    return () => observer.disconnect();
  }, [lang]);
  const [updateActivity, setUpdateActivity] = useState("");
  const [updateValue, setUpdateValue] = useState("");
  const [updateNote, setUpdateNote] = useState("");
  const [feedback, setFeedback] = useState("");
  const [buildingEditor, setBuildingEditor] = useState<Building | "new" | null>(
    null,
  );
  const [buildingNumberDraft, setBuildingNumberDraft] = useState("");
  const [buildingNameDraft, setBuildingNameDraft] = useState("");
  const [buildingStatusDraft, setBuildingStatusDraft] = useState("");
  const [buildingReasonDraft, setBuildingReasonDraft] = useState("");
  const [buildingWeightDraft, setBuildingWeightDraft] = useState("1");
  const [buildingFeedback, setBuildingFeedback] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<"Supervisor" | "Viewer">(
    "Supervisor",
  );
  const [userFeedback, setUserFeedback] = useState("");
  const [bootstrapStatus, setBootstrapStatus] = useState<
    "loading" | "error" | "setup" | "ready"
  >("loading");
  const [firstManagerPending, setFirstManagerPending] = useState(false);
  const [firstManagerFeedback, setFirstManagerFeedback] = useState("");
  const [activityWeightDrafts, setActivityWeightDrafts] = useState<
    Record<string, string>
  >({});
  const [activityWeightFeedback, setActivityWeightFeedback] = useState("");
  const [activityWeightEditing, setActivityWeightEditing] = useState(false);
  const [mapFile, setMapFile] = useState<File | null>(null);
  const [mapFeedback, setMapFeedback] = useState("");
  const [mapUploading, setMapUploading] = useState(false);
  const [selectedMapBuildingId, setSelectedMapBuildingId] = useState("");
  const [mapBuildingSearch, setMapBuildingSearch] = useState("");
  const [mapDrawing, setMapDrawing] = useState(false);
  const [draftPolygon, setDraftPolygon] = useState<MapPoint[]>([]);
  const [mapZoom, setMapZoom] = useState(MAP_ZOOM_MIN);
  const [mapPanMode, setMapPanMode] = useState(false);
  const [mapDragging, setMapDragging] = useState(false);
  const [mapFullscreen, setMapFullscreen] = useState(false);
  const mapViewportRef = useRef<HTMLDivElement>(null);
  const mapShellRef = useRef<HTMLDivElement>(null);
  const [mapAspect, setMapAspect] = useState(3877 / 2009);
  const [geo, setGeo] = useState<GeoState>({ status: "off" });
  const geoWatchId = useRef<number | null>(null);
  const geoCentered = useRef(false);
  const stopGeo = () => {
    if (geoWatchId.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(geoWatchId.current);
    }
    geoWatchId.current = null;
    geoCentered.current = false;
    setGeo({ status: "off" });
  };
  const toggleGeo = () => {
    if (geoWatchId.current !== null) {
      stopGeo();
      return;
    }
    if (!navigator.geolocation) {
      setGeo({
        status: "error",
        message: "This browser does not support location.",
      });
      return;
    }
    setGeo({ status: "locating", message: "Finding your location..." });
    geoWatchId.current = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        const { x, y } = geoToMapPercent(latitude, longitude);
        if (x < 0 || x > 100 || y < 0 || y > 100) {
          setGeo({
            status: "outside",
            accuracy,
            message: "You are outside the area covered by this map.",
          });
          return;
        }
        setGeo({ status: "ok", x, y, accuracy });
        const viewport = mapViewportRef.current;
        const content = mapContentRef.current;
        if (!geoCentered.current && viewport && content) {
          geoCentered.current = true;
          viewport.scrollLeft =
            (x / 100) * content.clientWidth - viewport.clientWidth / 2;
          viewport.scrollTop =
            (y / 100) * content.clientHeight - viewport.clientHeight / 2;
        }
      },
      (error) => {
        if (error.code === 1) {
          if (geoWatchId.current !== null)
            navigator.geolocation.clearWatch(geoWatchId.current);
          geoWatchId.current = null;
          setGeo({
            status: "denied",
            message:
              "Location permission was denied. Allow location for this site in your browser settings, then tap My location again.",
          });
        } else {
          setGeo({
            status: "error",
            message:
              error.code === 3
                ? "Location request timed out. Still trying."
                : "Your location is not available right now.",
          });
        }
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
  };
  useEffect(
    () => () => {
      if (geoWatchId.current !== null && navigator.geolocation)
        navigator.geolocation.clearWatch(geoWatchId.current);
    },
    [],
  );
  const toggleMapFullscreen = (next: boolean) => {
    setMapFullscreen(next);
    try {
      if (next) {
        void mapShellRef.current?.requestFullscreen?.().catch(() => {});
      } else if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => {});
      }
    } catch {
      // CSS overlay fallback already applies
    }
  };
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setMapFullscreen(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const mapContentRef = useRef<HTMLDivElement>(null);
  const [mapContentSize, setMapContentSize] = useState({
    width: 0,
    height: 0,
  });
  const [installPromptEvent, setInstallPromptEvent] =
    useState<InstallPromptEvent | null>(null);
  const mapPanStart = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const mapZoomRef = useRef(MAP_ZOOM_MIN);
  mapZoomRef.current = mapZoom;
  const touchGesture = useRef<{
    moved: boolean;
    startX: number;
    startY: number;
    ox: number;
    oy: number;
    vbLeft: number;
    vbTop: number;
    z0: number;
    s: number;
    sBase: number;
    tx: number;
    ty: number;
    ax: number;
    ay: number;
    dist0: number;
    raf: number;
  } | null>(null);
  const touchSuppressClick = useRef(false);
  useEffect(() => {
    const viewport = mapViewportRef.current;
    const content = mapContentRef.current;
    if (!viewport || !content || view !== "Site map") return;
    const measure = (touches: TouchList) => {
      const a = touches[0];
      const b = touches[1];
      if (!a) return { cx: 0, cy: 0, dist: 0 };
      if (!b) return { cx: a.clientX, cy: a.clientY, dist: 0 };
      return {
        cx: (a.clientX + b.clientX) / 2,
        cy: (a.clientY + b.clientY) / 2,
        dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      };
    };
    const setLabelsHidden = (hidden: boolean) => {
      content
        .querySelectorAll<HTMLElement>("[data-map-label]")
        .forEach((node) => {
          node.style.visibility = hidden ? "hidden" : "";
        });
    };
    const applyTransform = () => {
      const g = touchGesture.current;
      if (!g) return;
      g.raf = 0;
      content.style.transform = `translate3d(${g.tx}px, ${g.ty}px, 0) scale(${g.s})`;
    };
    const reanchor = (
      g: NonNullable<typeof touchGesture.current>,
      cx: number,
      cy: number,
      dist: number,
    ) => {
      g.ax = (cx - g.vbLeft - g.ox - g.tx) / g.s;
      g.ay = (cy - g.vbTop - g.oy - g.ty) / g.s;
      g.sBase = g.s;
      g.dist0 = dist;
    };
    const commit = (g: NonNullable<typeof touchGesture.current>) => {
      if (g.raf) cancelAnimationFrame(g.raf);
      content.style.transform = "";
      content.style.transformOrigin = "";
      content.style.willChange = "";
      const nextZoom = Math.min(
        MAP_ZOOM_MAX,
        Math.max(MAP_ZOOM_MIN, g.z0 * g.s),
      );
      if (Math.abs(nextZoom - g.z0) > 0.01) {
        flushSync(() => setMapZoom(nextZoom));
        mapZoomRef.current = nextZoom;
      }
      const rect = content.getBoundingClientRect();
      const curX = rect.left - g.vbLeft;
      const curY = rect.top - g.vbTop;
      viewport.scrollLeft += curX - (g.ox + g.tx);
      viewport.scrollTop += curY - (g.oy + g.ty);
      setLabelsHidden(false);
    };
    const onStart = (event: TouchEvent) => {
      const { cx, cy, dist } = measure(event.touches);
      let g = touchGesture.current;
      if (!g) {
        const rect = content.getBoundingClientRect();
        const vb = viewport.getBoundingClientRect();
        g = {
          moved: false,
          startX: cx,
          startY: cy,
          ox: rect.left - vb.left,
          oy: rect.top - vb.top,
          vbLeft: vb.left,
          vbTop: vb.top,
          z0: mapZoomRef.current,
          s: 1,
          sBase: 1,
          tx: 0,
          ty: 0,
          ax: 0,
          ay: 0,
          dist0: 0,
          raf: 0,
        };
        touchGesture.current = g;
        touchSuppressClick.current = false;
      }
      reanchor(g, cx, cy, dist);
      if (event.touches.length > 1) touchSuppressClick.current = true;
    };
    const onMove = (event: TouchEvent) => {
      const g = touchGesture.current;
      if (!g) return;
      const { cx, cy, dist } = measure(event.touches);
      if (!g.moved) {
        if (
          event.touches.length < 2 &&
          Math.hypot(cx - g.startX, cy - g.startY) < 8
        )
          return;
        g.moved = true;
        reanchor(g, cx, cy, dist);
        content.style.transformOrigin = "0 0";
        content.style.willChange = "transform";
        setLabelsHidden(true);
      }
      touchSuppressClick.current = true;
      if (event.cancelable) event.preventDefault();
      if (event.touches.length > 1 && g.dist0 > 0 && dist > 0) {
        g.s = Math.min(
          MAP_ZOOM_MAX / g.z0,
          Math.max(MAP_ZOOM_MIN / g.z0, (g.sBase * dist) / g.dist0),
        );
      }
      g.tx = cx - g.vbLeft - g.ox - g.s * g.ax;
      g.ty = cy - g.vbTop - g.oy - g.s * g.ay;
      if (!g.raf) g.raf = requestAnimationFrame(applyTransform);
    };
    const onEnd = (event: TouchEvent) => {
      const g = touchGesture.current;
      if (!g) return;
      if (event.touches.length === 0) {
        touchGesture.current = null;
        if (g.moved) commit(g);
        return;
      }
      const { cx, cy, dist } = measure(event.touches);
      reanchor(g, cx, cy, dist);
    };
    viewport.addEventListener("touchstart", onStart, { passive: true });
    viewport.addEventListener("touchmove", onMove, { passive: false });
    viewport.addEventListener("touchend", onEnd, { passive: true });
    viewport.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      viewport.removeEventListener("touchstart", onStart);
      viewport.removeEventListener("touchmove", onMove);
      viewport.removeEventListener("touchend", onEnd);
      viewport.removeEventListener("touchcancel", onEnd);
    };
  }, [view, mapFullscreen, mapContentSize.width > 0]);
  useEffect(() => {
    if (!mapFullscreen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") toggleMapFullscreen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mapFullscreen]);
  type SmoothZoom = {
    z0: number;
    s: number;
    sTarget: number;
    cx: number;
    cy: number;
    ax: number;
    ay: number;
    ox: number;
    oy: number;
    vbLeft: number;
    vbTop: number;
    tx: number;
    ty: number;
    raf: number;
    timer: number;
  };
  const smoothZoom = useRef<SmoothZoom | null>(null);
  const zoomTextRef = useRef<HTMLSpanElement>(null);
  const zoomSliderRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (zoomSliderRef.current)
      zoomSliderRef.current.value = String(Math.round(mapZoom));
  }, [mapZoom]);
  const setMapLabelsHidden = (hidden: boolean) => {
    mapContentRef.current
      ?.querySelectorAll<HTMLElement>("[data-map-label]")
      .forEach((node) => {
        node.style.visibility = hidden ? "hidden" : "";
      });
  };
  const cancelSmoothZoom = () => {
    const g = smoothZoom.current;
    const content = mapContentRef.current;
    if (!g) return;
    if (g.raf) cancelAnimationFrame(g.raf);
    window.clearTimeout(g.timer);
    smoothZoom.current = null;
    if (content) {
      content.style.transform = "";
      content.style.transformOrigin = "";
      content.style.willChange = "";
    }
    setMapLabelsHidden(false);
  };
  const commitSmoothZoom = () => {
    const g = smoothZoom.current;
    const viewport = mapViewportRef.current;
    const content = mapContentRef.current;
    if (!g || !viewport || !content) return;
    if (g.raf) cancelAnimationFrame(g.raf);
    smoothZoom.current = null;
    content.style.transform = "";
    content.style.transformOrigin = "";
    content.style.willChange = "";
    const nextZoom = Math.min(
      MAP_ZOOM_MAX,
      Math.max(MAP_ZOOM_MIN, Math.round(g.z0 * g.s)),
    );
    if (nextZoom !== Math.round(g.z0)) {
      flushSync(() => setMapZoom(nextZoom));
      mapZoomRef.current = nextZoom;
    }
    if (zoomTextRef.current) zoomTextRef.current.textContent = `${nextZoom}%`;
    const rect = content.getBoundingClientRect();
    viewport.scrollLeft += rect.left - g.vbLeft - (g.ox + g.tx);
    viewport.scrollTop += rect.top - g.vbTop - (g.oy + g.ty);
    setMapLabelsHidden(false);
  };
  const zoomMapTo = (
    targetZoom: number,
    clientX?: number,
    clientY?: number,
  ) => {
    const viewport = mapViewportRef.current;
    const content = mapContentRef.current;
    if (!viewport || !content) return;
    const vb = viewport.getBoundingClientRect();
    let g = smoothZoom.current;
    if (!g) {
      const rect = content.getBoundingClientRect();
      g = {
        z0: mapZoomRef.current,
        s: 1,
        sTarget: 1,
        cx: 0,
        cy: 0,
        ax: 0,
        ay: 0,
        ox: rect.left - vb.left,
        oy: rect.top - vb.top,
        vbLeft: vb.left,
        vbTop: vb.top,
        tx: 0,
        ty: 0,
        raf: 0,
        timer: 0,
      };
      smoothZoom.current = g;
      content.style.transformOrigin = "0 0";
      content.style.willChange = "transform";
      setMapLabelsHidden(true);
    }
    const state = g;
    state.cx = (clientX ?? vb.left + vb.width / 2) - state.vbLeft;
    state.cy = (clientY ?? vb.top + vb.height / 2) - state.vbTop;
    state.ax = (state.cx - state.ox - state.tx) / state.s;
    state.ay = (state.cy - state.oy - state.ty) / state.s;
    state.sTarget =
      Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, targetZoom)) / state.z0;
    window.clearTimeout(state.timer);
    state.timer = window.setTimeout(commitSmoothZoom, 160);
    const step = () => {
      state.raf = 0;
      if (smoothZoom.current !== state) return;
      const diff = state.sTarget - state.s;
      state.s =
        Math.abs(diff) < state.sTarget * 0.002
          ? state.sTarget
          : state.s + diff * 0.35;
      state.tx = state.cx - state.ox - state.s * state.ax;
      state.ty = state.cy - state.oy - state.s * state.ay;
      if (content) {
        content.style.transform = `translate3d(${state.tx}px, ${state.ty}px, 0) scale(${state.s})`;
      }
      if (zoomTextRef.current)
        zoomTextRef.current.textContent = `${Math.round(state.z0 * state.s)}%`;
      if (state.s !== state.sTarget) state.raf = requestAnimationFrame(step);
    };
    if (!state.raf) state.raf = requestAnimationFrame(step);
  };
  const currentMapZoom = () => {
    const g = smoothZoom.current;
    return g ? g.z0 * g.sTarget : mapZoomRef.current;
  };
  useEffect(() => {
    const viewport = mapViewportRef.current;
    if (!viewport || view !== "Site map") return;
    const zoomWithWheel = (event: WheelEvent) => {
      event.preventDefault();
      let dy = event.deltaY;
      if (event.deltaMode === 1) dy *= 16;
      else if (event.deltaMode === 2) dy *= 100;
      dy = Math.max(-120, Math.min(120, dy));
      const factor = Math.exp(-dy * (event.ctrlKey ? 0.01 : 0.002));
      zoomMapTo(currentMapZoom() * factor, event.clientX, event.clientY);
    };
    viewport.addEventListener("wheel", zoomWithWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", zoomWithWheel);
  }, [view, mapFullscreen, mapContentSize.width > 0]);
  useEffect(() => {
    const content = mapContentRef.current;
    if (!content || view !== "Site map") return;
    const measure = () =>
      setMapContentSize({
        width: content.clientWidth,
        height: content.clientHeight,
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [view, mapZoom, mapFullscreen]);
  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setInstallPromptEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => setInstallPromptEvent(null);
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  const session = useSession();
  const dashboard = useActionQuery<DashboardData>(
    "get-project-dashboard",
    {},
    {
      enabled:
        bootstrapStatus === "ready" && session.status === "authenticated",
    },
  );
  const managedUsers = useActionQuery<ManagedUser[]>(
    "list-project-users",
    {},
    { enabled: dashboard.data?.userRole === "Site Manager" },
  );
  const createUserMutation = useActionMutation<
    unknown,
    CreateUserInput,
    "register-project-user"
  >("register-project-user", {
    onSuccess: () => {
      setNewUsername("");
      setNewDisplayName("");
      setNewUserPassword("");
      setUserFeedback("Account created.");
    },
    onError: (error) => setUserFeedback(error.message),
  });
  const deactivateUserMutation = useActionMutation<
    unknown,
    DeactivateUserInput,
    "deactivate-project-user"
  >("deactivate-project-user", {
    onSuccess: (_result, variables) =>
      setUserFeedback(`${variables.username} was deactivated.`),
    onError: (error) => setUserFeedback(error.message),
  });
  const savePolygonMutation = useActionMutation<
    unknown,
    SavePolygonInput,
    "save-building-map-polygon"
  >("save-building-map-polygon", {
    onSuccess: (_result, variables) => {
      setMapDrawing(false);
      setDraftPolygon([]);
      setMapFeedback(variables.points ? "Polygon saved." : "Polygon cleared.");
    },
    onError: (error) => setMapFeedback(error.message),
  });
  const saveBuildingMutation = useActionMutation<
    unknown,
    SaveBuildingInput,
    "save-project-building"
  >("save-project-building", {
    onSuccess: async () => {
      await dashboard.refetch();
      setBuildingEditor(null);
      setBuildingFeedback("");
    },
    onError: (error) => setBuildingFeedback(error.message),
  });
  const deleteBuildingMutation = useActionMutation<
    unknown,
    DeleteBuildingInput,
    "delete-project-building"
  >("delete-project-building", {
    onSuccess: () => {
      void dashboard.refetch();
    },
    onError: (error) => setBuildingFeedback(error.message),
  });
  const updateActivityWeightMutation = useActionMutation<
    unknown,
    UpdateActivityWeightInput,
    "update-activity-weight"
  >("update-activity-weight", {
    onSuccess: (_result, variables) => {
      void dashboard.refetch();
      setActivityWeightEditing(false);
      setActivityWeightDrafts({});
      setActivityWeightFeedback("Activity weights saved.");
    },
    onError: (error) => setActivityWeightFeedback(error.message),
  });
  const updateMutation = useActionMutation<
    unknown,
    UpdateInput,
    "update-activity-progress"
  >("update-activity-progress", {
    onSuccess: (_result, variables) => {
      setSelected((current) => {
        if (!current || current.id !== variables.buildingId) return current;
        const activities = current.activities.map((activity) =>
          activity.id === variables.activityId
            ? {
                ...activity,
                progress: variables.progress,
                contribution:
                  (variables.progress * Number(activity.weight)) / 100,
                updatedAt: new Date().toISOString(),
              }
            : activity,
        );
        return {
          ...current,
          activities,
          progress: activities.reduce(
            (sum, activity) => sum + activity.contribution,
            0,
          ),
        };
      });
      setFeedback("Progress saved and project totals recalculated.");
      setUpdateNote("");
    },
    onError: (error) => setFeedback(error.message),
  });
  const data = dashboard.data;
  useEffect(() => {
    let active = true;

    fetch("/setup-status", { credentials: "include" })
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then((result: { needsSetup?: unknown }) => {
        if (!active || typeof result.needsSetup !== "boolean") return;
        setBootstrapStatus(result.needsSetup ? "setup" : "ready");
      })
      .catch(() => {
        if (active) setBootstrapStatus("error");
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (bootstrapStatus === "ready" && session.status === "unauthenticated") {
      window.location.replace("/sign-in");
    }
  }, [bootstrapStatus, session.status]);
  const selectedMapBuilding =
    data?.buildings.find((building) => building.id === selectedMapBuildingId) ??
    null;
  const mapLabels = useMemo(() => {
    const polygonArea = (building: Building) => {
      const points = building.geometry!.points;
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      return (
        (Math.max(...xs) - Math.min(...xs)) *
        (Math.max(...ys) - Math.min(...ys))
      );
    };
    const buildings = (data?.buildings ?? [])
      .filter((building) => (building.geometry?.points.length ?? 0) >= 3)
      .filter(
        (building) =>
          statusFilter.length === 0 ||
          statusFilter.includes(buildingStatus(building)),
      )
      .sort((a, b) => {
        if (a.id === selectedMapBuildingId) return -1;
        if (b.id === selectedMapBuildingId) return 1;
        return polygonArea(b) - polygonArea(a);
      });
    const { width: contentWidth, height: contentHeight } = mapContentSize;
    const measured = contentWidth > 0 && contentHeight > 0;
    const baseFont = Math.max(11, Math.min(26, 11 * Math.sqrt(mapZoom / 100)));
    const placed: {
      left: number;
      right: number;
      top: number;
      bottom: number;
    }[] = [];
    const fullLabel = (item: Building) =>
      displayBuildingLine(item.buildingNumber, item.name);
    const shortName = (item: Building) => {
      const number = displayBuildingNumber(item.buildingNumber, item.name);
      if (number) return number;
      const { title } = splitBuildingName(item.name);
      return title.length > 14 ? `${title.slice(0, 13)}…` : title;
    };
    return buildings.flatMap((building) => {
      const points = building.geometry!.points;
      const minX = Math.min(...points.map((point) => point.x));
      const maxX = Math.max(...points.map((point) => point.x));
      const minY = Math.min(...points.map((point) => point.y));
      const maxY = Math.max(...points.map((point) => point.y));
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const isSelected = building.id === selectedMapBuildingId;
      const fullText = wrapMapLabel(
        fullLabel(building),
        16,
        isSelected ? 8 : 3,
      );
      const longestLine = Math.max(
        ...fullText.split("\n").map((line) => line.length),
      );
      let fontSize = baseFont;
      const polyWidthPx = ((maxX - minX) / 100) * contentWidth;
      const polyHeightPx = ((maxY - minY) / 100) * contentHeight;
      if (measured) {
        fontSize = Math.min(
          fontSize,
          Math.max(
            11,
            (polyWidthPx * 1.6) / Math.max(3, longestLine * 0.52),
            polyHeightPx * 1.2,
          ),
        );
      }
      fontSize = Math.round(fontSize * 10) / 10;
      const pick = (
        name: string,
        x: number,
        y: number,
        offsetX: number,
        offsetY: number,
      ) => ({ name, x, y, offsetX, offsetY });
      if (!measured) {
        return [
          {
            id: building.id,
            name: fullText,
            centerX,
            centerY,
            fontSize,
            color: polygonColors[buildingStatus(building)].stroke,
            selected: isSelected,
          },
        ];
      }
      const variants = [fullText, shortName(building)].filter(
        (name, index, all) => all.indexOf(name) === index,
      );
      const candidates: ReturnType<typeof pick>[] = [];
      for (const name of variants) {
        const { w, h } = labelBox(name, fontSize);
        candidates.push(pick(name, centerX, centerY, 0, 0));
        candidates.push(
          pick(name, centerX, centerY, 0, polyHeightPx / 2 + h / 2),
        );
        candidates.push(
          pick(name, centerX, centerY, 0, -(polyHeightPx / 2 + h / 2)),
        );
        candidates.push(
          pick(name, centerX, centerY, polyWidthPx / 2 + w / 2, 0),
        );
        candidates.push(
          pick(name, centerX, centerY, -(polyWidthPx / 2 + w / 2), 0),
        );
      }
      let chosen: {
        name: string;
        left: number;
        top: number;
        rect: (typeof placed)[number];
      } | null = null;
      for (const c of candidates) {
        const { w, h } = labelBox(c.name, fontSize);
        const px = (c.x / 100) * contentWidth + c.offsetX;
        const py = (c.y / 100) * contentHeight + c.offsetY;
        const rect = {
          left: px - w / 2,
          right: px + w / 2,
          top: py - h / 2,
          bottom: py + h / 2,
        };
        const collides = placed.some(
          (other) =>
            rect.left < other.right + 2 &&
            rect.right > other.left - 2 &&
            rect.top < other.bottom + 2 &&
            rect.bottom > other.top - 2,
        );
        if (!collides) {
          chosen = { name: c.name, left: px, top: py, rect };
          break;
        }
      }
      if (!chosen) {
        if (!isSelected) return [];
        const { w, h } = labelBox(fullText, fontSize);
        const px = (centerX / 100) * contentWidth;
        const py = (centerY / 100) * contentHeight;
        chosen = {
          name: fullText,
          left: px,
          top: py,
          rect: {
            left: px - w / 2,
            right: px + w / 2,
            top: py - h / 2,
            bottom: py + h / 2,
          },
        };
      }
      placed.push(chosen.rect);
      return [
        {
          id: building.id,
          name: isSelected ? fullText : chosen.name,
          centerX: (chosen.left / contentWidth) * 100,
          centerY: (chosen.top / contentHeight) * 100,
          fontSize,
          color: polygonColors[buildingStatus(building)].stroke,
          selected: isSelected,
        },
      ];
    });
  }, [
    data?.buildings,
    mapContentSize,
    mapZoom,
    selectedMapBuildingId,
    statusFilter,
  ]);
  const mapBuildingSearchResults = useMemo(() => {
    const query = mapBuildingSearch.trim().toLowerCase();
    if (!query) return [];
    return (data?.buildings ?? [])
      .filter((building) => building.name.toLowerCase().includes(query))
      .slice(0, 8);
  }, [data?.buildings, mapBuildingSearch]);
  const filtered = useMemo(
    () =>
      (data?.buildings ?? []).filter(
        (building) =>
          (statusFilter.length === 0 ||
            statusFilter.includes(buildingStatus(building))) &&
          `${building.buildingNumber} ${building.name} ${buildingStatus(building)} ${statusLabel(buildingStatus(building))} ${building.statusReason}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [data?.buildings, search, statusFilter],
  );
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const building of data?.buildings ?? []) {
      const status = buildingStatus(building);
      counts[status] = (counts[status] ?? 0) + 1;
    }
    return counts;
  }, [data?.buildings]);
  const statusStats = useMemo(() => {
    const acc: Record<string, { count: number; sum: number }> = {};
    for (const building of data?.buildings ?? []) {
      const status = buildingStatus(building);
      const entry = (acc[status] ??= { count: 0, sum: 0 });
      entry.count += 1;
      entry.sum += building.progress;
    }
    return acc;
  }, [data?.buildings]);
  const statusAvg = (status: string) => {
    const entry = statusStats[status];
    return entry && entry.count > 0 ? entry.sum / entry.count : 0;
  };
  const filteredActive = filtered.filter((building) => !isRemoved(building));
  const activeActivityProgress = (activityId: string) => {
    const buildings =
      data?.buildings.filter((building) => !isRemoved(building)) ?? [];
    return buildings.length
      ? buildings.reduce(
          (sum, building) =>
            sum +
            (building.activities.find((activity) => activity.id === activityId)
              ?.progress ?? 0),
          0,
        ) / buildings.length
      : 0;
  };

  function startBuildingEditor(building?: Building) {
    setBuildingEditor(building ?? "new");
    setBuildingNumberDraft(building?.buildingNumber ?? "");
    setBuildingNameDraft(building?.name ?? "");
    setBuildingStatusDraft(building?.manualStatus ?? "");
    setBuildingReasonDraft(building?.statusReason ?? "");
    setBuildingWeightDraft(
      building ? String(Number(building.relativeWeight)) : "1",
    );
    setBuildingFeedback("");
  }

  function saveBuilding(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const relativeWeight = Number(buildingWeightDraft);
    if (!Number.isFinite(relativeWeight) || relativeWeight <= 0) {
      setBuildingFeedback("Relative weight must be greater than zero.");
      return;
    }
    if (
      ["Hold", "Delayed"].includes(buildingStatusDraft) &&
      !buildingReasonDraft.trim()
    ) {
      setBuildingFeedback(
        "A reason is required for Paused and Delayed statuses.",
      );
      return;
    }
    saveBuildingMutation.mutate({
      ...(buildingEditor !== "new" && buildingEditor
        ? { buildingId: buildingEditor.id }
        : {}),
      buildingNumber: buildingNumberDraft.trim(),
      name: buildingNameDraft.trim(),
      manualStatus: buildingStatusDraft || null,
      statusReason: ["Hold", "Delayed"].includes(buildingStatusDraft)
        ? buildingReasonDraft.trim()
        : "",
      relativeWeight,
    });
  }

  function deleteBuilding(building: Building) {
    if (
      window.confirm(
        `Permanently delete ${displayBuildingLine(building.buildingNumber, building.name)} and all linked progress/history? This cannot be undone.`,
      )
    ) {
      setBuildingFeedback("");
      deleteBuildingMutation.mutate({ buildingId: building.id });
    }
  }

  function openBuilding(building: Building) {
    setSelected(building);
    setUpdateActivity(building.activities[0]?.id ?? "");
    setUpdateValue(String(building.activities[0]?.progress ?? 0));
    setFeedback("");
  }

  function startActivityWeightEditing() {
    if (!data) return;
    setActivityWeightDrafts(
      Object.fromEntries(
        data.activities.map((activity) => [
          activity.id,
          String(Number(activity.weight)),
        ]),
      ),
    );
    setActivityWeightEditing(true);
    setActivityWeightFeedback("");
  }

  function saveActivityWeights() {
    if (!data) return;
    const weights = data.activities.map((activity) => ({
      activityId: activity.id,
      weight: Number(activityWeightDrafts[activity.id]),
    }));
    if (
      weights.some(
        ({ weight }) => !Number.isFinite(weight) || weight < 0 || weight > 100,
      )
    ) {
      setActivityWeightFeedback(
        "Enter a weight from 0 to 100% for every activity.",
      );
      return;
    }
    const total = weights.reduce((sum, { weight }) => sum + weight, 0);
    if (Math.round(total * 10) !== 1000) {
      setActivityWeightFeedback(
        `Activity weights must total 100%. Current total: ${Number(total.toFixed(1))}%.`,
      );
      return;
    }
    setActivityWeightFeedback("");
    updateActivityWeightMutation.mutate({ weights });
  }

  function saveProgress() {
    if (!selected || !updateActivity || updateValue === "") return;
    updateMutation.mutate({
      buildingId: selected.id,
      activityId: updateActivity,
      progress: Number(updateValue),
      note: updateNote,
    });
  }

  function deactivateUser(username: string) {
    if (
      window.confirm(
        `Deactivate ${username}? They will no longer be able to use this project.`,
      )
    ) {
      setUserFeedback("");
      deactivateUserMutation.mutate({ username });
    }
  }

  async function uploadSiteMap(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mapFile) return;
    if (mapFile.size > 16 * 1024 * 1024) {
      setMapFeedback("The site map must be 16 MB or smaller.");
      return;
    }
    const form = event.currentTarget;
    const body = new FormData();
    body.append("map", mapFile);
    setMapUploading(true);
    setMapFeedback("");
    try {
      const response = await fetch("/site-map", {
        method: "POST",
        credentials: "include",
        body,
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          result.statusMessage ||
            result.message ||
            "Unable to upload the site map.",
        );
      await dashboard.refetch();
      setMapFile(null);
      setSelectedMapBuildingId("");
      setDraftPolygon([]);
      setMapDrawing(false);
      setMapFeedback("Site map uploaded and saved.");
      form.reset();
    } catch (error) {
      setMapFeedback(
        error instanceof Error
          ? error.message
          : "Unable to upload the site map.",
      );
    } finally {
      setMapUploading(false);
    }
  }

  function startMapPan(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch") return;
    const viewport = mapViewportRef.current;
    if (
      (!mapPanMode && event.button !== 1) ||
      (mapPanMode && event.button !== 0) ||
      !viewport
    )
      return;
    event.preventDefault();
    mapPanStart.current = {
      x: event.clientX,
      y: event.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
    };
    setMapDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveMapPan(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch") return;
    const viewport = mapViewportRef.current;
    const start = mapPanStart.current;
    if (!viewport || !start) return;
    viewport.scrollLeft = start.left - (event.clientX - start.x);
    viewport.scrollTop = start.top - (event.clientY - start.y);
  }

  function stopMapPan(event?: React.PointerEvent<HTMLDivElement>) {
    if (event?.pointerType === "touch") return;
    mapPanStart.current = null;
    setMapDragging(false);
  }

  function assignBuildingOnMap(building: Building) {
    setSelected(null);
    setView("Site map");
    setSelectedMapBuildingId(building.id);
    setDraftPolygon([]);
    setMapDrawing(true);
    setMapFeedback("");
  }

  function selectMapBuilding(buildingId: string) {
    setSelectedMapBuildingId(buildingId);
    setDraftPolygon([]);
    setMapDrawing(false);
    setMapFeedback("");
  }

  function addPolygonPoint(event: React.MouseEvent<HTMLDivElement>) {
    if (
      event.button !== 0 ||
      mapPanMode ||
      !mapDrawing ||
      !selectedMapBuilding ||
      data?.userRole !== "Site Manager"
    )
      return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = {
      x: Math.min(
        100,
        Math.max(0, ((event.clientX - bounds.left) / bounds.width) * 100),
      ),
      y: Math.min(
        100,
        Math.max(0, ((event.clientY - bounds.top) / bounds.height) * 100),
      ),
    };
    setDraftPolygon((points) => [...points, point]);
  }

  function saveDraftPolygon() {
    if (!selectedMapBuilding || draftPolygon.length < 3) return;
    savePolygonMutation.mutate({
      buildingId: selectedMapBuilding.id,
      points: draftPolygon,
    });
  }

  function clearSelectedPolygon() {
    if (!selectedMapBuilding?.geometry?.points.length) return;
    savePolygonMutation.mutate({
      buildingId: selectedMapBuilding.id,
      points: null,
    });
  }

  async function createManagedUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUserFeedback("");
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(newUsername.trim())) {
      setUserFeedback(
        "Username must be 3 to 32 characters: letters, numbers, dot, dash or underscore only (no spaces).",
      );
      return;
    }
    if (newUserPassword.length < 12) {
      setUserFeedback(
        `Password must be at least 12 characters (you entered ${newUserPassword.length}).`,
      );
      return;
    }
    try {
      const response = await fetch("/_agent-native/auth/register", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: `${newUsername.trim().toLowerCase()}@aprc.invalid`,
          name: newDisplayName,
          password: newUserPassword,
          callbackURL: "/",
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        const serverMessage =
          typeof result?.error === "string" ? result.error : "";
        throw new Error(
          /already|exists/i.test(serverMessage)
            ? "That username is already taken. Choose a different username."
            : serverMessage ||
                `Unable to create account (error ${response.status}).`,
        );
      }
      createUserMutation.mutate({
        username: newUsername.trim(),
        displayName: newDisplayName,
        role: newUserRole,
      });
    } catch (error) {
      setUserFeedback(
        error instanceof Error ? error.message : "Unable to create account.",
      );
    }
  }

  async function createFirstManager(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFirstManagerPending(true);
    setFirstManagerFeedback("");
    const username = newUsername.trim().toLowerCase();
    const displayName = newDisplayName.trim();
    const email = `${username}@aprc.invalid`;
    async function postAuth(path: string) {
      const response = await fetch(path, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          name: displayName,
          password: newUserPassword,
        }),
      });
      const result = await response.json().catch(() => null);
      return response.ok && result?.ok === true;
    }
    try {
      await postAuth("/_agent-native/auth/register").catch(() => false);
      const signedIn = await postAuth("/_agent-native/auth/login");
      if (!signedIn)
        throw new Error(
          "Could not create or sign in to this account. Check the username and password, then try again.",
        );
      await callAction("complete-first-manager", { username, displayName });
      window.location.assign("/");
    } catch {
      setFirstManagerFeedback(
        "Setup could not be completed. If this account was already created, retry with its original password; otherwise check the required fields.",
      );
      setFirstManagerPending(false);
    }
  }

  async function retrySetupStatus() {
    setBootstrapStatus("loading");
    try {
      const result = await callAction(
        "get-initial-setup-status",
        {},
        { method: "GET" },
      );
      if (typeof result.needsSetup !== "boolean") throw new Error();
      setBootstrapStatus(result.needsSetup ? "setup" : "ready");
    } catch {
      setBootstrapStatus("error");
    }
  }

  if (bootstrapStatus === "loading")
    return (
      <div className="grid min-h-screen place-items-center bg-[#f4f6f8] p-6 text-sm text-slate-500">
        Checking project setup…
      </div>
    );
  if (bootstrapStatus === "error")
    return (
      <div className="grid min-h-screen place-items-center bg-[#f4f6f8] p-6">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-bold text-[#142636]">
            Setup status unavailable
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            We couldn’t check whether a Site Manager has been created.
          </p>
          <button
            onClick={() => void retrySetupStatus()}
            className="mt-5 rounded-lg bg-[#142b3c] px-4 py-2 text-sm font-semibold text-white"
          >
            Retry
          </button>
        </div>
      </div>
    );
  if (bootstrapStatus === "setup")
    return (
      <div className="min-h-screen bg-[#f4f6f8] text-slate-900">
        <header className="flex h-[70px] items-center border-b border-slate-200 bg-white px-5 md:px-8">
          <div className="text-[13px] text-slate-400">
            Project /{" "}
            <span className="font-semibold text-slate-700">Settings</span>
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs font-semibold text-emerald-700">
            <IconSettings size={16} />
            User management
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-10 md:px-8">
          <div className="mb-6">
            <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-700">
              <span className="h-px w-5 bg-amber-500" />
              Project settings
            </div>
            <h1 className="text-[26px] font-bold tracking-[-0.035em] text-[#142636]">
              Settings
            </h1>
          </div>
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-7">
            <h2 className="text-base font-bold text-[#1c3041]">
              User management
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Create the first Site Manager account to secure this workspace. No
              sign-in is needed yet.
            </p>
            <form
              onSubmit={createFirstManager}
              className="mt-6 grid gap-4 sm:grid-cols-2"
            >
              <label className="text-xs font-semibold text-slate-600">
                Username
                <input
                  required
                  minLength={3}
                  maxLength={32}
                  pattern="[A-Za-z0-9._-]+"
                  value={newUsername}
                  onChange={(event) => setNewUsername(event.target.value)}
                  className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-[#7993a6] focus:ring-2 focus:ring-[#cad7df]"
                />
              </label>
              <label className="text-xs font-semibold text-slate-600">
                Display name
                <input
                  required
                  maxLength={100}
                  value={newDisplayName}
                  onChange={(event) => setNewDisplayName(event.target.value)}
                  className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-[#7993a6] focus:ring-2 focus:ring-[#cad7df]"
                />
              </label>
              <label className="text-xs font-semibold text-slate-600 sm:col-span-2">
                Initial password (at least 12 characters)
                <input
                  required
                  minLength={12}
                  type="password"
                  autoComplete="new-password"
                  value={newUserPassword}
                  onChange={(event) => setNewUserPassword(event.target.value)}
                  className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-[#7993a6] focus:ring-2 focus:ring-[#cad7df]"
                />
              </label>
              <div className="sm:col-span-2">
                <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  Role{" "}
                  <strong className="ml-2 text-[#1c3041]">Site Manager</strong>
                </div>
                {firstManagerFeedback && (
                  <p role="alert" className="mt-3 text-sm text-rose-700">
                    {firstManagerFeedback}
                  </p>
                )}
                <button
                  disabled={firstManagerPending}
                  className="mt-4 rounded-lg bg-[#142b3c] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {firstManagerPending
                    ? "Creating account…"
                    : "Create Site Manager account"}
                </button>
              </div>
            </form>
          </section>
        </main>
      </div>
    );
  if (session.status !== "authenticated")
    return (
      <div className="grid min-h-screen place-items-center bg-[#f4f6f8] p-6 text-sm text-slate-500">
        Checking sign-in…
      </div>
    );

  return (
    <div className="min-h-screen bg-[#f4f6f8] text-slate-900 lg:flex">
      <aside
        className={`${mobileOpen ? "fixed inset-0 z-40 flex" : "hidden"} lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-[248px] lg:shrink-0`}
      >
        <div className="flex h-full w-[248px] flex-col bg-[#101e2b] text-slate-300 shadow-xl lg:shadow-none">
          <div className="flex h-[78px] items-center gap-3 border-b border-white/10 px-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500 text-[#132330]">
              <IconBuildingFactory2 size={22} stroke={1.8} />
            </div>
            <div>
              <div className="text-[14px] font-bold tracking-[0.1em] text-white">
                APRC
              </div>
              <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400">
                Project Control
              </div>
            </div>
            <button
              className="ml-auto rounded-md p-1 text-slate-400 lg:hidden"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
            >
              ×
            </button>
          </div>
          <div className="px-4 pt-6 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Fire &amp; safety systems
          </div>
          <nav className="space-y-1 px-3">
            {navItems.map(({ label, icon: Icon }) => {
              const active = view === label;
              return (
                <button
                  key={label}
                  onClick={() => {
                    setView(label);
                    setMobileOpen(false);
                    setSelected(null);
                  }}
                  className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium transition-colors ${active ? "bg-[#213648] text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-100"}`}
                >
                  <Icon
                    size={17}
                    stroke={1.8}
                    className={
                      active
                        ? "text-amber-400"
                        : "text-slate-500 group-hover:text-slate-300"
                    }
                  />
                  {label}
                  {label === "Dashboard" && (
                    <span className="ml-auto h-1.5 w-1.5 rounded-full bg-amber-400" />
                  )}
                </button>
              );
            })}
          </nav>
          <div className="mt-auto border-t border-white/10 p-4">
            <button
              onClick={() => {
                setView("Settings");
                setSelected(null);
              }}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium ${view === "Settings" ? "bg-[#213648] text-white" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}
            >
              <IconSettings size={17} />
              Settings
            </button>
            <div className="mt-4 flex items-center gap-3 rounded-xl bg-white/[0.06] p-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-600 text-[11px] font-bold text-white">
                AP
              </div>
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-white">
                  Project workspace
                </div>
                <div className="mt-0.5 text-[10px] text-slate-400">
                  APRC • Alexandria
                </div>
              </div>
              <IconChevronDown size={14} className="ml-auto text-slate-500" />
            </div>
            <button
              onClick={() => void signOut()}
              className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[12px] font-medium text-slate-400 transition-colors hover:bg-white/5 hover:text-white"
            >
              <IconLogout size={16} />
              Sign out
            </button>
            <div className="mt-3 flex justify-center rounded-xl bg-white p-2">
              <img
                src={PETROMAINT_LOGO}
                alt="Petromaint"
                width={96}
                height={96}
                className="h-24 w-24 object-contain"
              />
            </div>
            <div
              data-no-translate=""
              dir="ltr"
              className="mt-2 text-center text-[10px] font-medium text-slate-400"
            >
              Designed By eng. Mostafa Nasser
            </div>
          </div>
        </div>
        <button
          className="flex-1 bg-black/40 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        />
      </aside>

      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-[70px] items-center justify-between border-b border-slate-200/80 bg-white/95 px-4 backdrop-blur md:px-8">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
              aria-label="Open navigation"
            >
              <IconMenu2 size={19} />
            </button>
            <div className="text-[13px] text-slate-400">
              Project /{" "}
              <span className="font-semibold text-slate-700">{view}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {installPromptEvent && (
              <button
                onClick={() => {
                  const promptEvent = installPromptEvent;
                  setInstallPromptEvent(null);
                  void promptEvent.prompt();
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
              >
                <IconDownload size={13} />
                Install app
              </button>
            )}
            <div className="hidden items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-semibold text-emerald-700 sm:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              LIVE PROJECT
            </div>
            <div className="hidden text-right sm:block">
              <div className="text-xs font-semibold text-slate-700">
                Amreya Refinery
              </div>
              <div className="text-[10px] text-slate-400">
                FAFS implementation
              </div>
            </div>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#dbe4eb] text-[10px] font-bold text-[#243849]">
              AR
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-[1500px] px-4 py-7 md:px-8 md:py-9">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-amber-700">
                <span className="h-px w-5 bg-amber-500" />
                Amreya Petroleum Refining Company
              </div>
              <h1 className="text-[26px] font-bold tracking-[-0.035em] text-[#142636] md:text-[30px]">
                {view === "Dashboard" ? "FAFS project overview" : view}
              </h1>
              <p className="mt-1.5 text-[13px] text-slate-500">
                Fire alarm &amp; firefighting alarm system implementation
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setView("Reports")}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
              >
                <IconDownload size={15} />
                Export report
              </button>
              <button
                onClick={() => setView("Buildings")}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#142b3c] px-3.5 text-xs font-semibold text-white shadow-sm transition hover:bg-[#1d3b50]"
              >
                <IconBuilding size={15} />
                Buildings
              </button>
            </div>
          </div>

          {dashboard.isLoading && (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              Loading project records…
            </div>
          )}
          {dashboard.isError && (
            <div className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">
              <IconAlertCircle size={18} />
              Project data could not be loaded. Sign in with an authorized
              project account and retry.
            </div>
          )}
          {data && (
            <>
              {view === "Dashboard" && (
                <>
                  <section className="grid gap-4 lg:grid-cols-[minmax(240px,300px)_1fr]">
                    <div className="relative overflow-hidden rounded-xl bg-[#142b3c] p-5 text-white shadow-[0_4px_16px_rgba(20,43,60,0.12)]">
                      <div className="absolute -right-5 -top-10 h-32 w-32 rounded-full border-[18px] border-white/[0.04]" />
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-300">
                          Overall completion
                        </span>
                        <IconActivity size={17} className="text-amber-400" />
                      </div>
                      <div className="mt-5 flex items-end gap-2">
                        <strong className="text-[36px] leading-none tracking-[-0.04em]">
                          {pct(data.overall)}
                        </strong>
                        <span className="mb-1 inline-flex items-center gap-1 text-[11px] text-emerald-300">
                          <IconArrowUpRight size={14} />
                          Current
                        </span>
                      </div>
                      <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/15">
                        <div
                          className="h-full rounded-full bg-amber-400"
                          style={{
                            width: `${Math.max(0, Math.min(100, data.overall))}%`,
                          }}
                        />
                      </div>
                      <div className="mt-2 flex justify-between text-[10px] text-slate-400">
                        <span>Active scope</span>
                        <span>{data.activeCount} buildings</span>
                      </div>
                      <div className="mt-5 space-y-2 border-t border-white/10 pt-4 text-[12px]">
                        {(
                          [
                            ["Active buildings", data.activeCount],
                            ["Finished", statusStats["Finished"]?.count ?? 0],
                            ["Paused", statusStats["Hold"]?.count ?? 0],
                            ["Delayed", statusStats["Delayed"]?.count ?? 0],
                          ] as [string, number][]
                        ).map(([label, value]) => (
                          <div
                            key={label}
                            className="flex items-center justify-between text-slate-300"
                          >
                            <span>{label}</span>
                            <span className="font-semibold tabular-nums text-white">
                              {value}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
                      {(
                        [
                          ["Finished", "bg-emerald-500", "text-emerald-700"],
                          ["In progress", "bg-amber-500", "text-amber-700"],
                          ["Hold", "bg-yellow-700", "text-yellow-800"],
                          ["Delayed", "bg-red-600", "text-red-700"],
                          ["Not started", "bg-slate-300", "text-slate-600"],
                          [
                            "Removed from scope",
                            "bg-slate-500",
                            "text-slate-600",
                          ],
                        ] as [string, string, string][]
                      ).map(([status, dot, text]) => {
                        const count = statusStats[status]?.count ?? 0;
                        const avg = statusAvg(status);
                        const removed = status === "Removed from scope";
                        return (
                          <button
                            key={status}
                            type="button"
                            onClick={() => {
                              setStatusFilter([status]);
                              setView("Buildings");
                            }}
                            className="rounded-xl border border-slate-200 bg-white p-4 text-start shadow-[0_2px_10px_rgba(17,33,49,0.025)] transition hover:border-slate-300"
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className={`h-2.5 w-2.5 rounded-full ${dot}`}
                              />
                              <span
                                className={`text-[11px] font-semibold uppercase tracking-[0.06em] ${text}`}
                              >
                                {statusLabel(status)}
                              </span>
                            </div>
                            <div className="mt-3 text-[30px] font-bold leading-none tracking-[-0.04em] text-[#192e3e]">
                              {count}
                            </div>
                            {removed ? (
                              <div className="mt-2 text-[11px] text-slate-400">
                                Excluded from totals
                              </div>
                            ) : (
                              <>
                                <div className="mt-2 text-[11px] text-slate-500">
                                  {count > 0
                                    ? `avg progress ${avg.toFixed(1)}%`
                                    : "No buildings"}
                                </div>
                                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                                  <div
                                    className={`h-full rounded-full ${dot}`}
                                    style={{
                                      width: `${Math.max(0, Math.min(100, avg))}%`,
                                    }}
                                  />
                                </div>
                              </>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  <section className="mt-5 grid gap-5 xl:grid-cols-[1.55fr_1fr]">
                    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_2px_10px_rgba(17,33,49,0.025)] md:p-6">
                      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h2 className="text-[14px] font-bold text-[#1c3041]">
                            Activity progress
                          </h2>
                          <p className="mt-1 text-[11px] text-slate-400">
                            Average completion across active buildings
                          </p>
                        </div>
                        <button
                          onClick={() => setView("Activities")}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#335a72] hover:text-amber-700"
                        >
                          View activities <IconChevronRight size={14} />
                        </button>
                      </div>
                      <div className="space-y-[18px]">
                        {data.activities.map((activity) => (
                          <div key={activity.id}>
                            <div className="mb-2 flex items-center justify-between gap-3">
                              <span className="truncate pr-4 text-[12px] font-medium text-slate-700">
                                {activity.name}
                              </span>
                              <span className="shrink-0 text-[11px] font-semibold tabular-nums text-slate-600">
                                {pct(activeActivityProgress(activity.id))}
                                <span className="ml-2 font-normal text-slate-400">
                                  {Number(activity.weight)}%
                                </span>
                              </span>
                            </div>
                            <ProgressBar
                              value={activeActivityProgress(activity.id)}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_2px_10px_rgba(17,33,49,0.025)] md:p-6">
                      <div className="mb-5 flex items-center justify-between">
                        <div>
                          <h2 className="text-[14px] font-bold text-[#1c3041]">
                            Building status
                          </h2>
                          <p className="mt-1 text-[11px] text-slate-400">
                            Buildings per status and their average progress
                          </p>
                        </div>
                        <IconFilter size={16} className="text-slate-400" />
                      </div>
                      <div className="space-y-4">
                        {(
                          [
                            ["Finished", "bg-emerald-500"],
                            ["In progress", "bg-amber-500"],
                            ["Hold", "bg-yellow-700"],
                            ["Delayed", "bg-red-600"],
                            ["Not started", "bg-slate-300"],
                          ] as [string, string][]
                        ).map(([status, color]) => {
                          const count = statusStats[status]?.count ?? 0;
                          const avg = statusAvg(status);
                          return (
                            <div key={status}>
                              <div className="flex items-center gap-3">
                                <span
                                  className={`h-2 w-2 rounded-full ${color}`}
                                />
                                <span className="flex-1 text-xs text-slate-600">
                                  {statusLabel(status)}
                                </span>
                                <span className="text-xs font-bold tabular-nums text-slate-700">
                                  {count}
                                </span>
                                <span className="w-12 text-end text-[11px] tabular-nums text-slate-400">
                                  {count > 0 ? `${avg.toFixed(0)}%` : "—"}
                                </span>
                              </div>
                              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-100">
                                <div
                                  className={`h-full rounded-full ${color}`}
                                  style={{
                                    width: `${Math.max(0, Math.min(100, avg))}%`,
                                  }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div
                        dir="ltr"
                        className="mt-6 flex h-2 overflow-hidden rounded-full bg-slate-100"
                      >
                        {data.activeCount > 0 &&
                          (
                            [
                              ["Finished", "bg-emerald-500"],
                              ["In progress", "bg-amber-500"],
                              ["Hold", "bg-yellow-700"],
                              ["Delayed", "bg-red-600"],
                              ["Not started", "bg-slate-300"],
                            ] as [string, string][]
                          ).map(([status, color]) => (
                            <div
                              key={status}
                              className={color}
                              style={{
                                width: `${((statusStats[status]?.count ?? 0) / data.activeCount) * 100}%`,
                              }}
                            />
                          ))}
                      </div>
                      <div className="mt-6 border-t border-slate-100 pt-4">
                        <h3 className="mb-3 text-[11px] font-semibold text-slate-500">
                          RECENTLY UPDATED
                        </h3>
                        {data.history.length === 0 ? (
                          <div className="text-xs text-slate-400">
                            No progress updates recorded yet.
                          </div>
                        ) : (
                          data.history.slice(0, 3).map((item) => (
                            <div
                              key={item.id}
                              className="mb-3 flex items-start justify-between gap-3 last:mb-0"
                            >
                              <div className="min-w-0">
                                <button
                                  className="truncate text-left text-xs font-semibold text-[#29475d] hover:underline"
                                  onClick={() => {
                                    const building = data.buildings.find(
                                      (entry) => entry.id === item.buildingId,
                                    );
                                    if (building) openBuilding(building);
                                  }}
                                >
                                  {displayBuildingLine(
                                    item.buildingNumber,
                                    item.buildingName,
                                  )}
                                </button>
                                <div className="mt-1 truncate text-[10px] text-slate-400">
                                  {item.activityName} · {item.changedBy}
                                </div>
                              </div>
                              <span className="shrink-0 text-[10px] text-slate-400">
                                {dateText(item.changedAt)}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </section>

                  <section className="mt-5 rounded-xl border border-slate-200 bg-white shadow-[0_2px_10px_rgba(17,33,49,0.025)]">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 md:px-6">
                      <div>
                        <h2 className="text-[14px] font-bold text-[#1c3041]">
                          Building progress
                        </h2>
                        <p className="mt-1 text-[11px] text-slate-400">
                          Latest status across the project
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="relative">
                          <IconSearch
                            size={15}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                          />
                          <input
                            className="h-8 w-[190px] rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-xs outline-none placeholder:text-slate-400 focus:border-[#7993a6] focus:ring-2 focus:ring-[#cad7df]"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Search buildings"
                          />
                        </label>
                        <button
                          onClick={() => setView("Buildings")}
                          className="hidden rounded-lg border border-slate-200 px-3 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 sm:inline-flex"
                        >
                          All buildings
                        </button>
                      </div>
                    </div>
                    <BuildingTable
                      buildings={filtered.slice(0, 6)}
                      onOpen={openBuilding}
                      onAssignOnMap={
                        dashboard.data?.userRole === "Site Manager"
                          ? assignBuildingOnMap
                          : undefined
                      }
                    />
                  </section>
                </>
              )}

              {view === "Buildings" && (
                <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
                    <h2 className="text-sm font-bold text-[#1c3041]">
                      All buildings{" "}
                      <span className="ml-2 text-xs font-medium text-slate-400">
                        {filtered.length}
                      </span>
                    </h2>
                    <div className="flex items-center gap-3">
                      <label className="relative">
                        <IconSearch
                          size={15}
                          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                        />
                        <input
                          className="h-9 w-56 rounded-lg border border-slate-200 pl-9 pr-3 text-xs outline-none focus:border-slate-400"
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                          placeholder="Search number, name, type"
                        />
                      </label>
                      {data.userRole === "Site Manager" && (
                        <button
                          onClick={() => startBuildingEditor()}
                          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#142b3c] px-3 text-xs font-semibold text-white hover:bg-[#1d3b50]"
                        >
                          <IconPlus size={15} />
                          Add building
                        </button>
                      )}
                    </div>
                  </div>
                  {buildingFeedback && (
                    <p
                      role="status"
                      className="border-b border-slate-100 px-5 py-2 text-xs text-slate-600"
                    >
                      {buildingFeedback}
                    </p>
                  )}
                  <div className="border-b border-slate-100 px-5 py-3">
                    <StatusFilterChips
                      value={statusFilter}
                      onChange={setStatusFilter}
                      counts={statusCounts}
                    />
                  </div>
                  <BuildingTable
                    buildings={filtered}
                    onOpen={openBuilding}
                    onAssignOnMap={
                      dashboard.data?.userRole === "Site Manager"
                        ? assignBuildingOnMap
                        : undefined
                    }
                    onEdit={
                      dashboard.data?.userRole === "Site Manager"
                        ? startBuildingEditor
                        : undefined
                    }
                    onDelete={
                      dashboard.data?.userRole === "Site Manager"
                        ? deleteBuilding
                        : undefined
                    }
                  />
                </section>
              )}

              {view === "Activities" && (
                <div>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-slate-500">
                      Activity weights determine each activity’s contribution to
                      building progress.
                    </p>
                    {data.userRole === "Site Manager" && (
                      <div className="flex items-center gap-2">
                        {activityWeightEditing ? (
                          <>
                            <span className="text-xs text-slate-500">
                              Total:{" "}
                              {Number(
                                data.activities
                                  .reduce(
                                    (sum, activity) =>
                                      sum +
                                      Number(
                                        activityWeightDrafts[activity.id] ??
                                          activity.weight,
                                      ),
                                    0,
                                  )
                                  .toFixed(1),
                              )}
                              %
                            </span>
                            <button
                              onClick={() => {
                                setActivityWeightEditing(false);
                                setActivityWeightDrafts({});
                                setActivityWeightFeedback("");
                              }}
                              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={saveActivityWeights}
                              disabled={updateActivityWeightMutation.isPending}
                              className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                            >
                              Save all
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={startActivityWeightEditing}
                            className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white"
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {activityWeightFeedback && (
                    <p role="status" className="mb-3 text-xs text-slate-600">
                      {activityWeightFeedback}
                    </p>
                  )}
                  <div className="grid gap-4 md:grid-cols-2">
                    {data.activities.map((activity) => (
                      <div
                        key={activity.id}
                        className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-bold text-[#1c3041]">
                              {activity.name}
                            </div>
                            <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                              {activityWeightEditing ? (
                                <>
                                  <label
                                    htmlFor={`activity-weight-${activity.id}`}
                                  >
                                    Weight
                                  </label>
                                  <input
                                    id={`activity-weight-${activity.id}`}
                                    type="number"
                                    min="0"
                                    max="100"
                                    step="0.1"
                                    value={
                                      activityWeightDrafts[activity.id] ??
                                      String(Number(activity.weight))
                                    }
                                    onChange={(event) =>
                                      setActivityWeightDrafts((current) => ({
                                        ...current,
                                        [activity.id]: event.target.value,
                                      }))
                                    }
                                    className="h-7 w-20 rounded-md border border-slate-200 px-2 text-xs text-slate-700 outline-none focus:border-slate-400"
                                  />
                                  <span>
                                    % · {data.activeCount} active buildings
                                  </span>
                                </>
                              ) : (
                                <span>
                                  Weight {Number(activity.weight)}% ·{" "}
                                  {data.activeCount} active buildings
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs font-bold text-slate-600">
                            {pct(activeActivityProgress(activity.id))}
                          </div>
                        </div>
                        <div className="mt-5">
                          <ProgressBar
                            value={activeActivityProgress(activity.id)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {view === "Site map" && (
                <div
                  ref={mapShellRef}
                  className={
                    mapFullscreen
                      ? "fixed inset-0 z-[100] flex h-[100dvh] flex-col overflow-hidden bg-slate-950"
                      : "rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-7"
                  }
                >
                  <div
                    className={
                      mapFullscreen
                        ? "hidden"
                        : "flex flex-wrap items-start justify-between gap-3"
                    }
                  >
                    <div>
                      <h2 className="text-sm font-bold text-[#1c3041]">
                        Facility map
                      </h2>
                      <p className="mt-1 text-xs text-slate-500">
                        {data.siteMap
                          ? `Map: ${data.siteMap.filename}`
                          : "Upload an approved facility map to place buildings."}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-3 text-[10px] text-slate-500">
                      <Legend color="bg-emerald-500" label="Finished" />
                      <Legend color="bg-amber-500" label="In progress" />
                      <Legend color="bg-slate-300" label="Not started" />
                      <Legend color="bg-slate-500" label="Removed from scope" />
                      <Legend color="bg-yellow-700" label="Paused" />
                      <Legend color="bg-red-600" label="Delayed" />
                      <div className="w-full">
                        <StatusFilterChips
                          value={statusFilter}
                          onChange={setStatusFilter}
                          counts={statusCounts}
                        />
                      </div>
                      <details className="w-full">
                        <summary className="cursor-pointer font-semibold text-slate-600">
                          Status meanings
                        </summary>
                        <div className="mt-1 space-y-0.5 leading-snug">
                          {STATUS_DEFINITIONS.map((item) => (
                            <div key={item.status}>
                              <span className="font-bold">
                                {statusLabel(item.status)}:
                              </span>{" "}
                              {item.meaning}
                            </div>
                          ))}
                        </div>
                      </details>
                    </div>
                  </div>
                  {!mapFullscreen && data.userRole === "Site Manager" && (
                    <form
                      onSubmit={uploadSiteMap}
                      className="mt-4 flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 p-3"
                    >
                      <label className="min-w-[220px] flex-1 text-[11px] font-semibold text-slate-600">
                        {data.siteMap ? "Replace site map" : "Upload site map"}
                        <span className="mt-1.5 flex w-full items-center gap-3 text-xs text-slate-600">
                          <span className="rounded-md bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                            Choose File
                          </span>
                          <span
                            className="min-w-0 truncate"
                            data-no-translate-name=""
                          >
                            {mapFile ? mapFile.name : "No file chosen"}
                          </span>
                        </span>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          onChange={(event) =>
                            setMapFile(event.target.files?.[0] ?? null)
                          }
                          className="sr-only"
                        />
                      </label>
                      <div className="flex items-center gap-3">
                        <span className="text-[10px] text-slate-400">
                          PNG, JPEG, WebP · max 16 MB
                        </span>
                        <button
                          type="submit"
                          disabled={!mapFile || mapUploading}
                          className="rounded-lg bg-[#142b3c] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1d3b50] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {mapUploading ? "Uploading…" : "Save map"}
                        </button>
                      </div>
                    </form>
                  )}
                  {!mapFullscreen && mapFeedback && (
                    <div role="status" className="mt-3 text-xs text-slate-600">
                      {mapFeedback}
                    </div>
                  )}
                  {data.siteMap ? (
                    <>
                      <div
                        className={`mt-4 flex flex-wrap items-center gap-3 ${mapFullscreen ? "hidden" : ""}`}
                      >
                        <div className="relative">
                          <label className="text-[11px] font-semibold text-slate-600">
                            Search building name
                            <input
                              type="search"
                              value={mapBuildingSearch}
                              onChange={(event) =>
                                setMapBuildingSearch(event.target.value)
                              }
                              placeholder="Type a building name…"
                              className="ml-2 h-9 w-52 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 outline-none focus:border-slate-400"
                            />
                          </label>
                          {mapBuildingSearch.trim() && (
                            <div
                              className="absolute left-0 top-full z-40 mt-1 max-h-60 w-64 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
                              role="listbox"
                              aria-label="Building search results"
                            >
                              {mapBuildingSearchResults.length ? (
                                mapBuildingSearchResults.map((building) => (
                                  <button
                                    key={building.id}
                                    type="button"
                                    role="option"
                                    aria-selected={
                                      selectedMapBuildingId === building.id
                                    }
                                    onClick={() => {
                                      selectMapBuilding(building.id);
                                      setMapBuildingSearch("");
                                    }}
                                    className="block w-full rounded-md px-2.5 py-2 text-left text-xs text-slate-700 hover:bg-slate-100"
                                  >
                                    <span className="font-semibold">
                                      {splitBuildingName(building.name).title}
                                    </span>
                                    <span className="ml-2 text-slate-400">
                                      {displayBuildingNumber(
                                        building.buildingNumber,
                                        building.name,
                                      )}
                                    </span>
                                  </button>
                                ))
                              ) : (
                                <div className="px-2.5 py-2 text-xs text-slate-500">
                                  No matching buildings.
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <label className="text-[11px] font-semibold text-slate-600">
                          Select building
                          <select
                            value={selectedMapBuildingId}
                            onChange={(event) => {
                              setSelectedMapBuildingId(event.target.value);
                              setDraftPolygon([]);
                              setMapDrawing(false);
                              setMapFeedback("");
                            }}
                            className="ml-2 h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700"
                          >
                            <option value="">Select a building…</option>
                            {data.buildings.map((building) => (
                              <option key={building.id} value={building.id}>
                                {displayBuildingLine(
                                  building.buildingNumber,
                                  building.name,
                                )}
                              </option>
                            ))}
                          </select>
                        </label>
                        <span className="text-[11px] text-slate-400">
                          {data.userRole === "Site Manager"
                            ? mapPanMode
                              ? "Pan mode is on. Turn it off to draw a polygon."
                              : mapDrawing
                                ? "Click the map to add polygon vertices."
                                : selectedMapBuilding
                                  ? "Draw or clear its polygon on the map."
                                  : "Select a building to see its status and activities."
                            : "Select a building to see its status and activities."}
                        </span>
                        {data.userRole === "Site Manager" &&
                          selectedMapBuilding && (
                            <div className="flex flex-wrap gap-2">
                              {mapDrawing ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setMapDrawing(false);
                                      setDraftPolygon([]);
                                    }}
                                    className="rounded-md border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    onClick={saveDraftPolygon}
                                    disabled={
                                      draftPolygon.length < 3 ||
                                      savePolygonMutation.isPending
                                    }
                                    className="rounded-md bg-[#142b3c] px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
                                  >
                                    Finish &amp; save
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDraftPolygon([]);
                                    setMapDrawing(true);
                                    setMapFeedback("");
                                  }}
                                  className="rounded-md bg-[#142b3c] px-2.5 py-1.5 text-[11px] font-semibold text-white"
                                >
                                  Draw polygon
                                </button>
                              )}
                              {!mapDrawing &&
                              selectedMapBuilding.geometry?.points.length ? (
                                <button
                                  type="button"
                                  onClick={clearSelectedPolygon}
                                  disabled={savePolygonMutation.isPending}
                                  className="rounded-md border border-rose-200 px-2.5 py-1.5 text-[11px] font-semibold text-rose-700 disabled:opacity-40"
                                >
                                  Clear polygon
                                </button>
                              ) : null}
                            </div>
                          )}
                      </div>
                      <div
                        className={`flex flex-wrap items-center gap-3 bg-slate-50 p-2.5 ${mapFullscreen ? "shrink-0 rounded-none" : "mt-4 rounded-lg"}`}
                      >
                        <button
                          type="button"
                          onClick={() => zoomMapTo(currentMapZoom() / 1.25)}
                          disabled={mapZoom <= MAP_ZOOM_MIN}
                          aria-label="Zoom out"
                          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-bold text-slate-700 disabled:opacity-40"
                        >
                          −
                        </button>
                        <input
                          type="range"
                          aria-label="Map zoom"
                          min={MAP_ZOOM_MIN}
                          max={MAP_ZOOM_MAX}
                          step={MAP_ZOOM_STEP}
                          ref={zoomSliderRef}
                          defaultValue={mapZoom}
                          onChange={(event) =>
                            zoomMapTo(Number(event.target.value))
                          }
                          className="w-32 accent-[#142b3c]"
                        />
                        <button
                          type="button"
                          onClick={() => zoomMapTo(currentMapZoom() * 1.25)}
                          disabled={mapZoom >= MAP_ZOOM_MAX}
                          aria-label="Zoom in"
                          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm font-bold text-slate-700 disabled:opacity-40"
                        >
                          +
                        </button>
                        <span
                          ref={zoomTextRef}
                          className="w-12 text-center text-xs font-semibold tabular-nums text-slate-600"
                        >
                          {Math.round(mapZoom)}%
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            cancelSmoothZoom();
                            setMapZoom(MAP_ZOOM_MIN);
                            if (mapViewportRef.current) {
                              mapViewportRef.current.scrollLeft = 0;
                              mapViewportRef.current.scrollTop = 0;
                            }
                          }}
                          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
                        >
                          Reset
                        </button>
                        <button
                          type="button"
                          aria-pressed={mapPanMode}
                          onClick={() => setMapPanMode((enabled) => !enabled)}
                          className={`rounded-md border px-3 py-1.5 text-[11px] font-semibold ${mapPanMode ? "border-[#142b3c] bg-[#142b3c] text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"}`}
                        >
                          {mapPanMode ? "Pan: on" : "Pan tool"}
                        </button>
                        <button
                          type="button"
                          aria-pressed={geo.status !== "off"}
                          onClick={toggleGeo}
                          className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[11px] font-semibold ${geo.status === "ok" ? "border-blue-600 bg-blue-600 text-white" : geo.status === "off" ? "border-slate-200 bg-white text-slate-600 hover:bg-slate-100" : "border-blue-300 bg-blue-50 text-blue-700"}`}
                        >
                          <IconCurrentLocation size={14} aria-hidden="true" />
                          {geo.status === "off"
                            ? "My location"
                            : "Stop location"}
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleMapFullscreen(!mapFullscreen)}
                          className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-[#142b3c] px-3 py-1.5 text-[11px] font-semibold text-white"
                        >
                          <IconMaximize size={14} aria-hidden="true" />
                          {mapFullscreen ? "Exit full screen" : "Full screen"}
                        </button>
                        {geo.status !== "off" && (
                          <p
                            role="status"
                            className={`w-full text-[11px] ${geo.status === "denied" || geo.status === "error" || geo.status === "outside" ? "font-semibold text-red-600" : "text-blue-700"}`}
                          >
                            {geo.status === "ok"
                              ? `Your location, accuracy about ${Math.round(geo.accuracy ?? 0)} m.`
                              : (geo.message ?? "")}
                          </p>
                        )}
                      </div>
                      {mapFullscreen && (
                        <div className="shrink-0 bg-slate-50 px-2.5 pb-2.5">
                          <StatusFilterChips
                            value={statusFilter}
                            onChange={setStatusFilter}
                            counts={statusCounts}
                          />
                        </div>
                      )}
                      <div
                        style={
                          mapFullscreen ? undefined : { aspectRatio: mapAspect }
                        }
                        className={`relative ${mapFullscreen ? "min-h-0 flex-1" : "mt-3 max-h-[80vh] w-full"}`}
                      >
                        {selectedMapBuilding && (
                          <section
                            className="pointer-events-auto absolute right-3 top-3 z-30 max-h-[75%] w-[360px] max-w-[calc(100vw-1.5rem)] origin-top-right scale-75 overflow-y-auto rounded-lg border border-slate-200 bg-white/30 p-3 shadow-xl backdrop-blur-sm"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="text-xs font-bold text-slate-800">
                                  {displayBuildingLine(
                                    selectedMapBuilding.buildingNumber,
                                    selectedMapBuilding.name,
                                  )}
                                </div>
                                <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                                  <span
                                    className="h-2 w-2 rounded-full"
                                    style={{
                                      backgroundColor:
                                        polygonColors[
                                          buildingStatus(selectedMapBuilding)
                                        ].stroke,
                                    }}
                                  />
                                  {statusLabel(
                                    buildingStatus(selectedMapBuilding),
                                  )}
                                  <span>·</span>
                                  {selectedMapBuilding.progress.toFixed(1)}%
                                  overall
                                </div>
                              </div>
                            </div>
                            <div className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2">
                              {selectedMapBuilding.activities.map(
                                (activity) => (
                                  <div key={activity.id}>
                                    <div className="mb-1 flex justify-between gap-2 text-[10px]">
                                      <span className="min-w-0 whitespace-normal break-words text-slate-700">
                                        {activity.name}
                                      </span>
                                      <span className="shrink-0 font-semibold tabular-nums text-slate-500">
                                        {activity.progress.toFixed(1)}%
                                      </span>
                                    </div>
                                    <ProgressBar value={activity.progress} />
                                  </div>
                                ),
                              )}
                            </div>
                            {mapDrawing && (
                              <div className="mt-2 text-[10px] text-slate-400">
                                Click at least 3 points on the map, then finish
                                and save.
                              </div>
                            )}
                          </section>
                        )}
                        <div
                          ref={mapViewportRef}
                          dir="ltr"
                          style={{ touchAction: "none" }}
                          className={`absolute inset-0 overflow-auto ${mapFullscreen ? "flex rounded-none border-0 bg-slate-950" : "rounded-xl border border-slate-200 bg-slate-50"} ${mapDragging ? "cursor-grabbing" : mapPanMode ? "cursor-grab" : mapDrawing && data.userRole === "Site Manager" ? "cursor-crosshair" : ""}`}
                        >
                          <div
                            ref={mapContentRef}
                            className={`relative max-w-none shrink-0 ${mapFullscreen ? "m-auto" : ""}`}
                            style={{
                              width: `${mapZoom}%`,
                              touchAction: "none",
                              containerType: "inline-size",
                            }}
                            onClickCapture={(event) => {
                              if (touchSuppressClick.current) {
                                touchSuppressClick.current = false;
                                event.preventDefault();
                                event.stopPropagation();
                              }
                            }}
                            onPointerDown={startMapPan}
                            onPointerMove={moveMapPan}
                            onPointerUp={(event) => stopMapPan(event)}
                            onPointerCancel={(event) => stopMapPan(event)}
                            onAuxClick={(event) => event.preventDefault()}
                            onClick={addPolygonPoint}
                          >
                            <img
                              src={`/site-map-image?v=${encodeURIComponent(data.siteMap.updatedAt)}`}
                              alt="Uploaded facility site map"
                              className="block h-auto w-full select-none"
                              draggable={false}
                              onLoad={(event) => {
                                const img = event.currentTarget;
                                if (img.naturalWidth && img.naturalHeight)
                                  setMapAspect(
                                    img.naturalWidth / img.naturalHeight,
                                  );
                              }}
                            />
                            {data.buildings
                              .filter(
                                (building) =>
                                  (building.geometry?.points.length ?? 0) >=
                                    3 &&
                                  (statusFilter.length === 0 ||
                                    statusFilter.includes(
                                      buildingStatus(building),
                                    )),
                              )
                              .map((building) => {
                                const points = building.geometry!.points;
                                const colors =
                                  polygonColors[buildingStatus(building)];
                                return (
                                  <svg
                                    key={building.id}
                                    viewBox="0 0 100 100"
                                    preserveAspectRatio="none"
                                    className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
                                  >
                                    <polygon
                                      points={polygonPoints(points)}
                                      fill={colors.fill}
                                      stroke={colors.stroke}
                                      strokeWidth={
                                        selectedMapBuildingId === building.id
                                          ? 0.7
                                          : 0.45
                                      }
                                      vectorEffect="non-scaling-stroke"
                                      className="pointer-events-auto cursor-pointer"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        selectMapBuilding(building.id);
                                      }}
                                    />
                                    {points.map((point, index) => (
                                      <circle
                                        key={index}
                                        cx={point.x}
                                        cy={point.y}
                                        r="0.0975"
                                        fill={colors.stroke}
                                        stroke={colors.stroke}
                                        strokeWidth="0.25"
                                        vectorEffect="non-scaling-stroke"
                                        className="pointer-events-auto cursor-pointer"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          selectMapBuilding(building.id);
                                        }}
                                      />
                                    ))}
                                  </svg>
                                );
                              })}
                            {geo.status === "ok" &&
                              geo.x !== undefined &&
                              geo.y !== undefined && (
                                <div
                                  aria-label="Your location"
                                  className="pointer-events-none absolute z-20"
                                  style={{
                                    left: `${geo.x}%`,
                                    top: `${geo.y}%`,
                                  }}
                                >
                                  {geo.accuracy ? (
                                    <div
                                      className="absolute rounded-full border border-blue-500/60 bg-blue-500/15"
                                      style={{
                                        width: `${(2 * geo.accuracy) / GEO_FIT.metersPerPctX}cqw`,
                                        height: `${(2 * geo.accuracy) / GEO_FIT.metersPerPctX}cqw`,
                                        transform: "translate(-50%, -50%)",
                                      }}
                                    />
                                  ) : null}
                                  <div className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-blue-600 shadow-[0_0_0_2px_rgba(37,99,235,0.35)]" />
                                </div>
                              )}
                            {mapLabels.map((label) => (
                              <div
                                key={`label-${label.id}`}
                                data-map-label=""
                                onClick={(event) => {
                                  event.stopPropagation();
                                  selectMapBuilding(label.id);
                                }}
                                className={`pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer whitespace-pre rounded px-1 text-center font-bold leading-[1.25] ${label.selected ? "z-20 bg-white/75" : "z-10"}`}
                                style={{
                                  left: `${label.centerX}%`,
                                  top: `${label.centerY}%`,
                                  color: label.color,
                                  fontSize: `${label.fontSize}px`,
                                  textShadow:
                                    "0 0 2px rgba(255,255,255,0.95), 0 0 4px rgba(255,255,255,0.85)",
                                }}
                              >
                                {label.name}
                              </div>
                            ))}
                            {mapDrawing && draftPolygon.length > 0 && (
                              <svg
                                viewBox="0 0 100 100"
                                preserveAspectRatio="none"
                                className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
                              >
                                <polygon
                                  points={polygonPoints(draftPolygon)}
                                  fill={
                                    draftPolygon.length >= 3
                                      ? polygonColors[
                                          buildingStatus(selectedMapBuilding!)
                                        ].fill
                                      : "none"
                                  }
                                  stroke={
                                    polygonColors[
                                      buildingStatus(selectedMapBuilding!)
                                    ].stroke
                                  }
                                  strokeWidth="0.55"
                                  vectorEffect="non-scaling-stroke"
                                />
                                {draftPolygon.map((point, index) => (
                                  <circle
                                    key={index}
                                    cx={point.x}
                                    cy={point.y}
                                    r="0.105"
                                    fill={
                                      polygonColors[
                                        buildingStatus(selectedMapBuilding!)
                                      ].stroke
                                    }
                                    stroke={
                                      polygonColors[
                                        buildingStatus(selectedMapBuilding!)
                                      ].stroke
                                    }
                                    strokeWidth="0.25"
                                    vectorEffect="non-scaling-stroke"
                                  />
                                ))}
                              </svg>
                            )}
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="mt-5 flex min-h-[300px] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-[#f5f7f8] p-6">
                      <div className="max-w-md text-center">
                        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-white text-slate-400 shadow-sm">
                          <IconMap2 size={22} />
                        </div>
                        <div className="text-sm font-semibold text-slate-700">
                          No site map uploaded
                        </div>
                        <p className="mt-1.5 text-xs leading-5 text-slate-500">
                          A Site Manager can upload a PNG, JPEG, or WebP
                          facility map up to 16 MB. Building locations can be
                          assigned after upload.
                        </p>
                        <button
                          type="button"
                          onClick={() => setView("Buildings")}
                          className="mt-4 rounded-lg bg-[#142b3c] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1d3b50]"
                        >
                          Browse building records
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {view === "Reports" && (
                <div className="grid gap-4 md:grid-cols-2">
                  <ReportCard
                    title="Active buildings"
                    subtitle="Scope-filtered progress summary"
                    value={`${data.activeCount} buildings · ${pct(data.overall)} overall`}
                    onClick={() => setView("Buildings")}
                  />
                  <ReportCard
                    title="Removed from scope"
                    subtitle="Separate list; excluded from project totals"
                    value={`${data.removedCount} preserved records`}
                    onClick={() => {
                      setSearch("Removed from scope");
                      setView("Buildings");
                    }}
                  />
                  <ReportCard
                    title="Activity summary"
                    subtitle="Progress against configured activity weights"
                    value={`${data.activities.length} active activities`}
                    onClick={() => setView("Activities")}
                  />
                  <ReportCard
                    title="Update history"
                    subtitle="Recent progress changes and responsible users"
                    value={`${data.history.length} recent changes`}
                    onClick={() => setView("Progress history")}
                  />
                </div>
              )}

              {view === "Progress history" && (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-100 p-5">
                    <h2 className="text-sm font-bold text-[#1c3041]">
                      Progress history
                    </h2>
                    <p className="mt-1 text-xs text-slate-400">
                      Most recent recorded activity updates
                    </p>
                  </div>
                  {data.history.length ? (
                    <div className="divide-y divide-slate-100">
                      {data.history.map((item) => (
                        <div
                          key={item.id}
                          className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                        >
                          <div>
                            <div className="text-xs font-semibold text-slate-700">
                              {displayBuildingLine(
                                item.buildingNumber,
                                item.buildingName,
                              )}{" "}
                              <span className="font-normal text-slate-400">
                                / {item.activityName}
                              </span>
                            </div>
                            <div className="mt-1 text-[11px] text-slate-400">
                              {item.changedBy}
                              {item.note ? ` · ${item.note}` : ""}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs tabular-nums text-slate-500">
                              {Number(item.previousProgress)}%
                            </span>
                            <IconArrowUpRight
                              size={14}
                              className="text-slate-300"
                            />
                            <span className="text-xs font-bold tabular-nums text-[#29475d]">
                              {Number(item.newProgress)}%
                            </span>
                            <span className="w-20 text-right text-[10px] text-slate-400">
                              {dateText(item.changedAt)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-8 text-center text-xs text-slate-400">
                      No progress history is available yet.
                    </div>
                  )}
                </div>
              )}

              {view === "Settings" && (
                <div className="max-w-3xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="mb-5">
                    <h2 className="text-sm font-bold text-[#1c3041]">
                      Project settings
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                      Project configuration is read from the database.
                    </p>
                  </div>
                  <div className="mb-5 rounded-lg border border-slate-100 bg-slate-50 p-4">
                    <div className="text-xs font-bold text-[#1c3041]">
                      Language
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Choose the language of the app. Your choice is saved on
                      this device.
                    </p>
                    <div className="mt-3 flex gap-2">
                      {(
                        [
                          ["en", "English"],
                          ["ar", "العربية"],
                        ] as [AppLang, string][]
                      ).map(([code, name]) => (
                        <button
                          key={code}
                          type="button"
                          data-no-translate=""
                          aria-pressed={lang === code}
                          onClick={() => chooseLang(code)}
                          className={`rounded-lg border px-4 py-2 text-xs font-semibold ${lang === code ? "border-[#142b3c] bg-[#142b3c] text-white" : "border-slate-200 bg-white text-slate-600"}`}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {[
                      ["Project", "Amreya Petroleum Refining Company"],
                      ["System", "Fire Alarm & Firefighting Alarm System"],
                      ["Active buildings", String(data.activeCount)],
                      [
                        "Buildings removed from scope",
                        String(data.removedCount),
                      ],
                      [
                        "Configured activity weight total",
                        `${data.activities.reduce((sum, item) => sum + Number(item.weight), 0)}%`,
                      ],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="flex justify-between gap-4 py-3 text-xs"
                      >
                        <span className="text-slate-500">{label}</span>
                        <span className="text-right font-semibold text-slate-700">
                          {value}
                        </span>
                      </div>
                    ))}
                  </div>
                  {data.userRole === "Site Manager" ? (
                    <div className="mt-6 border-t border-slate-100 pt-5">
                      <h3 className="text-sm font-bold text-[#1c3041]">
                        User management
                      </h3>
                      <p className="mt-1 text-xs text-slate-500">
                        Create accounts with a username and initial password.
                        Email addresses are not required.
                      </p>
                      <form
                        onSubmit={createManagedUser}
                        className="mt-4 grid gap-3 sm:grid-cols-2"
                      >
                        <label className="text-[11px] font-semibold text-slate-600">
                          Username
                          <input
                            required
                            minLength={3}
                            maxLength={32}
                            pattern="[A-Za-z0-9._-]+"
                            value={newUsername}
                            onChange={(event) =>
                              setNewUsername(event.target.value)
                            }
                            className="mt-1 block h-10 w-full rounded-lg border border-slate-200 px-3 text-xs font-normal outline-none focus:border-[#829aaa]"
                          />
                        </label>
                        <label className="text-[11px] font-semibold text-slate-600">
                          Display name
                          <input
                            required
                            maxLength={100}
                            value={newDisplayName}
                            onChange={(event) =>
                              setNewDisplayName(event.target.value)
                            }
                            className="mt-1 block h-10 w-full rounded-lg border border-slate-200 px-3 text-xs font-normal outline-none focus:border-[#829aaa]"
                          />
                        </label>
                        <label className="text-[11px] font-semibold text-slate-600">
                          Initial password (at least 12 characters)
                          <input
                            required
                            minLength={12}
                            maxLength={128}
                            type="password"
                            autoComplete="new-password"
                            value={newUserPassword}
                            onChange={(event) =>
                              setNewUserPassword(event.target.value)
                            }
                            className="mt-1 block h-10 w-full rounded-lg border border-slate-200 px-3 text-xs font-normal outline-none focus:border-[#829aaa]"
                          />
                        </label>
                        <label className="text-[11px] font-semibold text-slate-600">
                          Role
                          <select
                            value={newUserRole}
                            onChange={(event) =>
                              setNewUserRole(
                                event.target.value as "Supervisor" | "Viewer",
                              )
                            }
                            className="mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs font-normal outline-none focus:border-[#829aaa]"
                          >
                            <option>Supervisor</option>
                            <option>Viewer</option>
                          </select>
                        </label>
                        <div className="flex items-center justify-between gap-3 sm:col-span-2">
                          <span className="text-[11px] text-slate-500">
                            {userFeedback}
                          </span>
                          <button
                            disabled={
                              createUserMutation.isPending ||
                              !newUsername ||
                              !newDisplayName ||
                              !newUserPassword
                            }
                            className="rounded-lg bg-[#142b3c] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#1d3b50] disabled:opacity-50"
                          >
                            {createUserMutation.isPending
                              ? "Creating…"
                              : "Create account"}
                          </button>
                        </div>
                      </form>
                      <div className="mt-5 overflow-x-auto rounded-lg border border-slate-100">
                        <table className="w-full min-w-[520px] text-left">
                          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400">
                            <tr>
                              <th className="px-3 py-2">Username</th>
                              <th className="px-3 py-2">Display name</th>
                              <th className="px-3 py-2">Role</th>
                              <th className="px-3 py-2">Status</th>
                              <th className="px-3 py-2">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {(managedUsers.data ?? []).map((user) => (
                              <tr key={user.username} className="text-xs">
                                <td className="px-3 py-2.5 font-semibold text-slate-700">
                                  {user.username}
                                </td>
                                <td className="px-3 py-2.5 text-slate-600">
                                  {user.displayName}
                                </td>
                                <td className="px-3 py-2.5 text-slate-600">
                                  {user.role}
                                </td>
                                <td className="px-3 py-2.5 text-slate-500">
                                  {user.active ? "Active" : "Inactive"}
                                </td>
                                <td className="px-3 py-2.5">
                                  {user.active ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        deactivateUser(user.username)
                                      }
                                      disabled={
                                        deactivateUserMutation.isPending
                                      }
                                      className="rounded-md px-2 py-1 font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-wait disabled:opacity-50"
                                    >
                                      {deactivateUserMutation.isPending &&
                                      deactivateUserMutation.variables
                                        ?.username === user.username
                                        ? "Deactivating…"
                                        : "Deactivate"}
                                    </button>
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-5 rounded-lg bg-amber-50 p-3 text-[11px] leading-5 text-amber-900">
                      Only the provisioned Site Manager can create or manage
                      project accounts.
                    </div>
                  )}
                </div>
              )}

              {buildingEditor && (
                <div
                  className="fixed inset-0 z-50 flex items-end justify-center bg-[#081722]/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-5"
                  onMouseDown={(event) => {
                    if (event.target === event.currentTarget)
                      setBuildingEditor(null);
                  }}
                >
                  <form
                    onSubmit={saveBuilding}
                    className="w-full max-w-lg rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl"
                  >
                    <div className="mb-5 flex items-start justify-between">
                      <div>
                        <h2 className="text-lg font-bold text-[#152c3d]">
                          {buildingEditor === "new"
                            ? "Add building"
                            : `Edit ${splitBuildingName(buildingEditor.name).title}`}
                        </h2>
                        <p className="mt-1 text-xs text-slate-500">
                          Building details and project weight
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setBuildingEditor(null)}
                        aria-label="Close building editor"
                        className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
                      >
                        ×
                      </button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-[11px] font-semibold text-slate-600">
                        Building number
                        <input
                          required
                          maxLength={60}
                          value={buildingNumberDraft}
                          onChange={(event) =>
                            setBuildingNumberDraft(event.target.value)
                          }
                          className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-slate-400"
                        />
                      </label>
                      <label className="text-[11px] font-semibold text-slate-600">
                        Building name
                        <input
                          required
                          maxLength={200}
                          value={buildingNameDraft}
                          onChange={(event) =>
                            setBuildingNameDraft(event.target.value)
                          }
                          className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-slate-400"
                        />
                      </label>
                      <label className="text-[11px] font-semibold text-slate-600">
                        Status
                        <select
                          value={buildingStatusDraft}
                          onChange={(event) =>
                            setBuildingStatusDraft(event.target.value)
                          }
                          className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-slate-400"
                        >
                          <option value="">Automatic from progress</option>
                          <option value="In progress">In progress</option>
                          <option value="Removed from scope">
                            Removed from scope
                          </option>
                          <option value="Hold">Paused</option>
                          <option value="Delayed">Delayed</option>
                        </select>
                      </label>
                      <div className="rounded-lg bg-slate-50 p-2.5 text-[10px] leading-snug text-slate-500 sm:col-span-2">
                        {STATUS_DEFINITIONS.map((item) => (
                          <div
                            key={item.status}
                            className={
                              buildingStatusDraft === item.status
                                ? "font-semibold text-slate-800"
                                : ""
                            }
                          >
                            <span className="font-bold">
                              {statusLabel(item.status)}:
                            </span>{" "}
                            {item.meaning}
                          </div>
                        ))}
                      </div>
                      {["Hold", "Delayed"].includes(buildingStatusDraft) && (
                        <label className="text-[11px] font-semibold text-slate-600 sm:col-span-2">
                          Reason (required)
                          <textarea
                            required
                            maxLength={1000}
                            value={buildingReasonDraft}
                            onChange={(event) =>
                              setBuildingReasonDraft(event.target.value)
                            }
                            className="mt-1.5 min-h-20 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-slate-400"
                          />
                        </label>
                      )}
                      <label className="text-[11px] font-semibold text-slate-600">
                        Relative weight
                        <input
                          required
                          type="number"
                          min="0.001"
                          step="0.001"
                          value={buildingWeightDraft}
                          onChange={(event) =>
                            setBuildingWeightDraft(event.target.value)
                          }
                          className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 px-3 text-xs outline-none focus:border-slate-400"
                        />
                      </label>
                    </div>
                    {buildingFeedback && (
                      <p role="alert" className="mt-3 text-xs text-rose-700">
                        {buildingFeedback}
                      </p>
                    )}
                    <div className="mt-5 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setBuildingEditor(null)}
                        className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={saveBuildingMutation.isPending}
                        className="rounded-lg bg-[#142b3c] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        Save building
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {selected && (
                <div
                  className="fixed inset-0 z-50 flex items-end justify-center bg-[#081722]/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-5"
                  onMouseDown={(event) => {
                    if (event.target === event.currentTarget) setSelected(null);
                  }}
                >
                  <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="building-heading"
                    className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
                  >
                    <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-100 bg-white px-5 py-4 md:px-6">
                      <div>
                        <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                          Building{" "}
                          {displayBuildingNumber(
                            selected.buildingNumber,
                            selected.name,
                          )}
                        </div>
                        <h2
                          id="building-heading"
                          className="text-lg font-bold tracking-tight text-[#152c3d]"
                        >
                          {splitBuildingName(selected.name).title}
                        </h2>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-slate-600">
                            {statusLabel(buildingStatus(selected))}
                          </span>
                          {selected.statusReason && (
                            <span className="text-xs text-slate-400">
                              {selected.statusReason}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => setSelected(null)}
                        className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
                        aria-label="Close details"
                      >
                        ×
                      </button>
                    </div>
                    <div className="p-5 md:p-6">
                      <div className="mb-5 flex items-end justify-between rounded-xl bg-[#f5f7f8] p-4">
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                            Building progress
                          </div>
                          <div className="mt-1 text-2xl font-bold tracking-tight text-[#1b3345]">
                            {pct(selected.progress)}
                          </div>
                        </div>
                        <div className="text-right text-[10px] text-slate-500">
                          Relative weight
                          <br />
                          <strong className="text-xs text-slate-700">
                            {Number(selected.relativeWeight).toFixed(2)}
                          </strong>
                        </div>
                      </div>
                      {isRemoved(selected) && (
                        <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                          Removed from Scope — this building is excluded from
                          project progress calculations. Its recorded activity
                          progress and history are retained.
                        </div>
                      )}
                      <div className="space-y-4">
                        {selected.activities.map((activity) => (
                          <div key={activity.id}>
                            <div className="mb-2 flex justify-between gap-4">
                              <div className="text-xs font-semibold text-slate-700">
                                {activity.name}
                                <span className="ms-2 font-normal text-slate-400">
                                  {`${Number(activity.weight)}% weight`}
                                </span>
                              </div>
                              <div className="text-xs font-semibold text-slate-600">
                                {pct(activity.progress)}
                              </div>
                            </div>
                            <ProgressBar value={activity.progress} />
                            <div className="mt-1 text-right text-[10px] text-slate-400">
                              {`Contribution ${pct(activity.contribution)}`}
                            </div>
                          </div>
                        ))}
                      </div>
                      {!isRemoved(selected) && (
                        <div className="mt-6 border-t border-slate-100 pt-5">
                          <h3 className="mb-3 text-xs font-bold text-[#1c3041]">
                            Update activity progress
                          </h3>
                          <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
                            <select
                              value={updateActivity}
                              onChange={(event) => {
                                setUpdateActivity(event.target.value);
                                setUpdateValue(
                                  String(
                                    selected.activities.find(
                                      (item) => item.id === event.target.value,
                                    )?.progress ?? 0,
                                  ),
                                );
                              }}
                              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 outline-none focus:border-[#829aaa]"
                            >
                              <option value="">Select activity</option>
                              {selected.activities.map((activity) => (
                                <option key={activity.id} value={activity.id}>
                                  {activity.name}
                                </option>
                              ))}
                            </select>
                            <div className="relative">
                              <input
                                aria-label="Activity progress percentage"
                                type="number"
                                min="0"
                                max="100"
                                step="0.1"
                                value={updateValue}
                                onChange={(event) =>
                                  setUpdateValue(event.target.value)
                                }
                                className="h-10 w-full rounded-lg border border-slate-200 px-3 pr-8 text-xs outline-none focus:border-[#829aaa]"
                              />
                              <span className="absolute right-3 top-3 text-xs text-slate-400">
                                %
                              </span>
                            </div>
                          </div>
                          <textarea
                            value={updateNote}
                            onChange={(event) =>
                              setUpdateNote(event.target.value)
                            }
                            maxLength={1000}
                            rows={2}
                            placeholder="Optional update note"
                            className="mt-3 w-full resize-y rounded-lg border border-slate-200 px-3 py-2.5 text-xs outline-none placeholder:text-slate-400 focus:border-[#829aaa]"
                          />
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                            <span
                              className={`text-[11px] ${feedback && !feedback.startsWith("Progress saved") ? "text-rose-600" : "text-slate-500"}`}
                            >
                              {feedback ||
                                "Progress values are validated and saved with history."}
                            </span>
                            <button
                              disabled={
                                !updateActivity ||
                                updateValue === "" ||
                                Number(updateValue) < 0 ||
                                Number(updateValue) > 100 ||
                                updateMutation.isPending
                              }
                              onClick={saveProgress}
                              className="rounded-lg bg-[#142b3c] px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-[#1d3b50] disabled:cursor-not-allowed disabled:opacity-45"
                            >
                              {updateMutation.isPending
                                ? "Saving…"
                                : "Save progress"}
                            </button>
                          </div>
                        </div>
                      )}
                      {isRemoved(selected) && (
                        <div className="mt-5 text-[11px] text-slate-400">
                          Progress updates are disabled for excluded buildings.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  icon,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
  tone: "blue" | "amber" | "slate";
}) {
  const colors = {
    blue: "bg-sky-50 text-sky-700",
    amber: "bg-amber-50 text-amber-700",
    slate: "bg-slate-100 text-slate-600",
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-[0_2px_10px_rgba(17,33,49,0.025)]">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
          {label}
        </span>
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-lg ${colors[tone]}`}
        >
          {icon}
        </span>
      </div>
      <div className="mt-5 text-[32px] font-bold leading-none tracking-[-0.04em] text-[#192e3e]">
        {value}
      </div>
      <div className="mt-2 text-[11px] text-slate-400">{detail}</div>
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-[6px] overflow-hidden rounded-full bg-slate-100">
      <div
        className={`h-full rounded-full transition-[width] duration-300 ${value >= 99.99 ? "bg-emerald-500" : value > 0 ? "bg-amber-500" : "bg-slate-300"}`}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

function BuildingTable({
  buildings,
  onOpen,
  onAssignOnMap,
  onEdit,
  onDelete,
}: {
  buildings: Building[];
  onOpen: (building: Building) => void;
  onAssignOnMap?: (building: Building) => void;
  onEdit?: (building: Building) => void;
  onDelete?: (building: Building) => void;
}) {
  const [sort, setSort] = useState<{
    key: "building" | "status" | "progress" | "weight";
    direction: "asc" | "desc";
  }>({ key: "building", direction: "asc" });
  const sortedBuildings = useMemo(
    () =>
      [...buildings].sort((a, b) => {
        const comparison =
          sort.key === "building"
            ? `${a.buildingNumber} ${a.name}`.localeCompare(
                `${b.buildingNumber} ${b.name}`,
                undefined,
                { numeric: true, sensitivity: "base" },
              )
            : sort.key === "status"
              ? buildingStatus(a).localeCompare(buildingStatus(b), undefined, {
                  sensitivity: "base",
                })
              : sort.key === "progress"
                ? a.progress - b.progress
                : Number(a.relativeWeight) - Number(b.relativeWeight);
        return sort.direction === "asc" ? comparison : -comparison;
      }),
    [buildings, sort],
  );
  function sortButton(key: typeof sort.key, label: string) {
    return (
      <button
        type="button"
        onClick={() =>
          setSort((current) => ({
            key,
            direction:
              current.key === key && current.direction === "asc"
                ? "desc"
                : "asc",
          }))
        }
        className="inline-flex items-center gap-1 hover:text-slate-700"
      >
        {label}
        <span aria-hidden="true">
          {sort.key === key ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    );
  }
  if (!buildings.length)
    return (
      <div className="p-8 text-center text-xs text-slate-400">
        No buildings match this search.
      </div>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[700px] border-collapse text-left">
        <thead>
          <tr className="bg-[#f8fafb] text-[10px] font-semibold uppercase tracking-[0.07em] text-slate-400">
            <th className="px-5 py-3 md:px-6">
              {sortButton("building", "Building")}
            </th>
            <th className="px-4 py-3">{sortButton("status", "Status")}</th>
            <th className="w-[240px] px-4 py-3">
              {sortButton("progress", "Progress")}
            </th>
            <th className="px-4 py-3">{sortButton("weight", "Weight")}</th>
            <th className="px-4 py-3">Map assignment</th>
            <th className="px-4 py-3">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sortedBuildings.map((building) => (
            <tr
              key={building.id}
              onClick={() => onOpen(building)}
              className="cursor-pointer transition-colors hover:bg-[#f9fbfc]"
            >
              <td className="px-5 py-3.5 md:px-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                    <IconBuilding size={15} />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-[#243c4e]">
                      {displayBuildingNumber(
                        building.buildingNumber,
                        building.name,
                      )}
                      <span className="ml-2 font-medium text-slate-600">
                        {splitBuildingName(building.name).title}
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] text-slate-400">
                      {`Updated ${mostRecentUpdate(building)}`}
                    </div>
                  </div>
                </div>
              </td>
              <td className="px-4 py-3.5">
                <div>
                  <span
                    className={`text-[11px] ${buildingStatus(building) === "Finished" ? "font-semibold text-emerald-700" : buildingStatus(building) === "Hold" || buildingStatus(building) === "Delayed" ? "font-semibold text-amber-700" : "text-slate-500"}`}
                  >
                    {statusLabel(buildingStatus(building))}
                  </span>
                  {building.statusReason && (
                    <div className="mt-1 max-w-48 text-[10px] text-slate-400">
                      {building.statusReason}
                    </div>
                  )}
                </div>
              </td>
              <td className="px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <div className="min-w-[95px] flex-1">
                    <ProgressBar value={building.progress} />
                  </div>
                  <span
                    className={`w-11 text-right text-[11px] font-bold tabular-nums ${isRemoved(building) ? "text-slate-400" : "text-slate-700"}`}
                  >
                    {pct(building.progress)}
                  </span>
                </div>
              </td>
              <td className="px-4 py-3.5 text-xs tabular-nums text-slate-600">
                {Number(building.relativeWeight).toFixed(2)}
              </td>
              <td className="px-4 py-3.5">
                {onAssignOnMap && !building.geometry?.points.length && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onAssignOnMap(building);
                    }}
                    className="whitespace-nowrap rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-semibold text-[#335a72] hover:border-slate-300 hover:bg-slate-50"
                  >
                    Assign on map
                  </button>
                )}
              </td>
              <td className="px-4 py-3.5">
                <div className="flex items-center gap-2">
                  {onEdit && (
                    <button
                      type="button"
                      aria-label={`Edit ${splitBuildingName(building.name).title}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onEdit(building);
                      }}
                      className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                    >
                      <IconPencil size={15} />
                    </button>
                  )}
                  {onDelete && (
                    <button
                      type="button"
                      aria-label={`Delete ${splitBuildingName(building.name).title}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onDelete(building);
                      }}
                      className="rounded p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-700"
                    >
                      <IconTrash size={15} />
                    </button>
                  )}
                  <IconChevronRight size={15} className="text-slate-300" />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScopeBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.04em] text-slate-600">
      Removed from scope
    </span>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

function ReportCard({
  title,
  subtitle,
  value,
  onClick,
}: {
  title: string;
  subtitle: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
    >
      <div className="text-sm font-bold text-[#1c3041]">{title}</div>
      <div className="mt-1 text-xs text-slate-400">{subtitle}</div>
      <div className="mt-6 flex items-center justify-between text-xs font-semibold text-[#335a72]">
        {value}
        <IconChevronRight size={15} />
      </div>
    </button>
  );
}

function dateText(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function mostRecentUpdate(building: Building) {
  const dates = building.activities
    .map((activity) => activity.updatedAt)
    .filter((value): value is string => Boolean(value))
    .sort();
  const date = dates[dates.length - 1];
  return date ? dateText(date) : "not updated";
}
